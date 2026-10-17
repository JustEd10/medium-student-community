import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createBackupManager, rehearseRestore, checkSnapshot } from '../server/backups.js';
import { openSqliteStore } from '../server/sqlite-store.js';

async function start(dir) {
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, HOST:'127.0.0.1', PORT:'0', DATA_DIR:dir,
    BACKUP_DIR:path.join(dir,'backups'), NODE_ENV:'test', REGISTRATION_MAIL_MODE:'local', CHAT_BOTS_ENABLED:'0', GEMINI_CHAT_API_KEY:'', GROQ_API_KEY:'',
    GIGACHAT_AUTH_KEY:'', GIGACHAT_CREDENTIALS:'', DRIVE_BACKUP_CONFIG:path.join(dir,'absent-drive.json') }, stdio:['ignore','pipe','pipe'] });
  let text = '', errors=''; child.stderr.on('data', c => { errors += c; });
  const base = await new Promise((resolve,reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('START_TIMEOUT '+errors)); },8000);
    child.stdout.on('data', c => { text+=c; const match=text.match(/http:\/\/localhost:(\d+)/); if(match) { clearTimeout(timer); resolve('http://127.0.0.1:'+match[1]); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('SERVER_EXIT '+errors)); });
  });
  return { base, async stop() { if(child.exitCode===null && child.signalCode===null) {const done=once(child,'exit');child.kill();await done;} } };
}
test('real API persists both sites across restart, SQL rollback, JOIN and complete backup restore', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'medium-db-integration-'));
  const dir=path.join(root,'source');fs.mkdirSync(dir);
  const evidence = [];
  let app = await start(dir);
  t.after(async()=>{await app.stop();fs.rmSync(root,{recursive:true,force:true});});
  async function request(url, method='GET', body, token) {
    const r=await fetch(app.base+url,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data = await r.json();
    evidence.push({method,path:url,status:r.status,summary:{...(data?.title?{title:data.title}:{}),...(data?.item_title?{item_title:data.item_title}:{}),...(Array.isArray(data)?{count:data.length,firstAuthor:data[0]?.authorName,questionTitle:data[0]?.questionTitle}:{}),...(data?.state?{authenticated:!!data.me,questions:data.state.questions.length,answers:data.state.answers.length}:{}),...(data?.error?{error:data.error}:{})}});
    return { status:r.status, data };
  }
  const register = async email=>{
    const issued = await request('/api/app/auth/register','POST',{name:'Тестовый Студент',email,password:'only-test-password',aiConsent:true});
    assert.equal(issued.status,202);
    const code = JSON.parse(fs.readFileSync(path.join(dir,'mail-preview.json'))).code;
    return (await request('/api/app/auth/register/verify','POST',{challengeId:issued.data.challengeId,code})).data;
  };
  const owner=await register('owner@example.test'), helper=await register('helper@example.test');
  assert.equal((await request('/api/app/auth/register','POST',{name:'Consent Check',email:'missing-consent@example.test',password:'only-test-password'})).status,400);
  const issued = await request('/api/app/auth/register','POST',{name:'Pending Check',email:'pending@example.test',password:'only-test-password',aiConsent:true});
  assert.equal(issued.status,202);assert.equal(issued.data.token,undefined);
  const pendingCode = JSON.parse(fs.readFileSync(path.join(dir,'mail-preview.json'))).code;
  assert.ok(!JSON.stringify(issued.data).includes(pendingCode));
  assert.equal((await request('/api/app/auth/login','POST',{email:'pending@example.test',password:'only-test-password'})).status,401);
  const faultSql = new DatabaseSync(path.join(dir,'medium.sqlite'));
  faultSql.exec("CREATE TRIGGER fail_verification BEFORE DELETE ON registration_challenges BEGIN SELECT RAISE(ABORT,'verification fixture'); END");
  assert.equal((await request('/api/app/auth/register/verify','POST',{challengeId:issued.data.challengeId,code:pendingCode})).status,503);
  assert.equal(faultSql.prepare("SELECT count(*) AS n FROM users WHERE email='pending@example.test'").get().n,0);
  assert.equal(faultSql.prepare('SELECT count(*) AS n FROM registration_challenges WHERE id=?').get(issued.data.challengeId).n,1);
  faultSql.exec('DROP TRIGGER fail_verification');faultSql.close();
  const verifiedRegistration = await request('/api/app/auth/register/verify','POST',{challengeId:issued.data.challengeId,code:pendingCode});
  assert.equal(verifiedRegistration.status,201);
  assert.equal(verifiedRegistration.data.state.users.find(u=>u.id===verifiedRegistration.data.me).aiConsent.adultConfirmed,true);
  assert.equal((await request('/api/app/auth/register/verify','POST',{challengeId:issued.data.challengeId,code:pendingCode})).status,400);
  assert.ok((await request('/api/app/state','GET',undefined,owner.token)).data.state.users.every(u=>u.id===owner.me || !u.aiConsent));
  const question=await request('/api/app/act','POST',{type:'addQuestion',args:{title:'Кто объяснит матрицы?',body:'Локальный пример',category:'Учёба',autoAI:false}},owner.token);
  assert.equal(question.status,200); const qid=question.data.id;
  assert.equal((await request('/api/app/act','POST',{type:'addAnswer',args:{questionId:qid,body:'Помогу разобрать матрицы'}},helper.token)).status,200);
  const joined=await request('/api/app/questions/'+qid+'/answers');
  assert.equal(joined.status,200);assert.equal(joined.data[0].questionTitle,'Кто объяснит матрицы?');assert.equal(joined.data[0].authorName,'Тестовый Студент');
  assert.ok(!JSON.stringify(joined).includes('credential'));assert.ok(!JSON.stringify(joined).includes('example.test'));
  const lesson=(await request('/api/login','POST',{login:'user',password:'qwerty'})).data;
  const item=await request('/api/items','POST',{title:'Проверка сохранения SQL',body:'Сохранить после перезапуска',category:'Учёба'},lesson.token);
  assert.equal(item.status,201);
  assert.equal((await request('/api/items/'+item.data.id,'PATCH',{title:'Обновлённый вопрос SQLite'},lesson.token)).status,200);
  const lessonOther=(await request('/api/login','POST',{login:'wei',password:'wei2026'})).data;
  const record=await request('/api/records','POST',{item_id:item.data.id,body:'Ответ через настоящий JOIN'},lessonOther.token);
  assert.equal(record.status,201);assert.equal(record.data.item_title,'Обновлённый вопрос SQLite');
  assert.equal((await request('/api/items/'+item.data.id,'PATCH',{title:'Чужой вопрос менять нельзя'},lessonOther.token)).status,403);
  await app.stop();app=await start(dir);evidence.push({event:'restart',verified:true});
  assert.equal((await request('/api/app/state','GET',undefined,owner.token)).data.me,owner.me);
  assert.equal((await request('/api/records/my','GET',undefined,lessonOther.token)).data.some(r=>r.id===record.data.id),true);
  assert.equal((await request('/api/items/'+item.data.id)).data.answers[0].item_title,'Обновлённый вопрос SQLite');
  const sql=new DatabaseSync(path.join(dir,'medium.sqlite'));sql.exec('PRAGMA foreign_keys=ON');
  try {
    const before=(await request('/api/app/state','GET',undefined,owner.token)).data.state;
    sql.exec("CREATE TRIGGER reject_test_answer BEFORE INSERT ON answers WHEN NEW.body='Отказ тестовой записи' BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.equal((await request('/api/app/act','POST',{type:'addAnswer',args:{questionId:qid,body:'Отказ тестовой записи'}},helper.token)).status,503);
    assert.deepEqual((await request('/api/app/state','GET',undefined,owner.token)).data.state,before);
    evidence.push({event:'main_transaction_rollback',verified:true});
    sql.exec('DROP TRIGGER reject_test_answer');
    sql.exec("CREATE TRIGGER reject_test_delete BEFORE DELETE ON lesson_items BEGIN SELECT RAISE(ABORT,'test failure'); END");
    assert.equal((await request('/api/items/'+item.data.id,'DELETE',undefined,lesson.token)).status,500);
    assert.equal((await request('/api/items/'+item.data.id)).data.answers.length,1); // child DELETE also rolled back
    evidence.push({event:'lesson_transaction_rollback',verified:true});
    sql.exec('DROP TRIGGER reject_test_delete');
    assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {sql.close();}
  const snapshot=createBackupManager({dataDirectory:dir}).create();
  const verified=checkSnapshot(snapshot.file);assert.equal(verified.storage,'sqlite');assert.equal(Object.keys(verified.data.sessions).length,0);
  assert.ok(!Object.hasOwn(verified.data.lesson,'lesson_sessions'));
  assert.equal((await request('/api/items/'+item.data.id,'DELETE',undefined,lesson.token)).status,200);
  assert.equal((await request('/api/items/'+item.data.id)).status,404);
  evidence.push({event:'backup_without_sessions',verified:true});
  const restored=path.join(root,'restored');assert.equal(rehearseRestore(snapshot.file,restored).verified,true);
  const restoredStore=openSqliteStore({file:path.join(restored,'medium.sqlite')});
  assert.equal(restoredStore.sql.prepare('SELECT title FROM lesson_items WHERE id=?').get(item.data.id).title,'Обновлённый вопрос SQLite');
  assert.equal(restoredStore.sql.prepare('SELECT count(*) AS n FROM lesson_sessions').get().n,0);
  assert.equal(restoredStore.read().state.questions.find(q=>q.id===qid).title,'Кто объяснит матрицы?');restoredStore.close();
  await app.stop();app=await start(restored);
  assert.equal((await request('/api/items/'+item.data.id)).status,200);
  assert.equal((await request('/api/app/state','GET',undefined,owner.token)).data.me,null);
  assert.equal((await request('/api/app/auth/login','POST',{email:'owner@example.test',password:'only-test-password'})).status,200);
  evidence.push({event:'restore_and_fresh_login',verified:true});
  if(process.env.DATABASE_EVIDENCE_FILE) fs.writeFileSync(process.env.DATABASE_EVIDENCE_FILE,JSON.stringify(evidence,null,2)+'\n');
});
