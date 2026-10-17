import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openSqliteStore } from '../server/sqlite-store.js';
import { createSeed, createEmptyState } from '../src/data.js';
import { BOT_PERSONAS } from '../src/bot-personas.js';
import { validState } from '../src/domain.js';

function setup(t) {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'medium-sqlite-'));
 const file = path.join(dir,'private','app.sqlite');
 const legacyFile = path.join(dir,'db.json');
 const stores = [];
 t.after(() => { for (const store of stores) { try { store.close(); } catch {} } fs.rmSync(dir,{recursive:true,force:true}); });
 return {file,legacyFile,open:() => {const s = openSqliteStore({file,legacyFile}); stores.push(s); return s;}};
}
function fixture() {
 const state = createSeed();
 state.users[0].credential = {salt:Array(16).fill(1),hash:Array(32).fill(2)};
 Object.assign(state.users[0],{role:'admin',login:'fixture-admin',peopleVisible:false,studyHelpVisible:true,custom:{nested:[1,null]}});
 Object.assign(state.users[1],{bannedAt:12,bannedBy:'alina',deletedAt:null});
 Object.assign(state.questions[0],{deletedAt:null,aiResponse:{status:'pending',createdAt:123}});
 state.answers[0].deletedAt = 456;
 state.helpRequests[2].helperOfferedAt = {maria:123};
 Object.assign(state.chats[0],{botConsentAt:123,botConsentProvider:'groq',botJob:{actor:'wei',messageId:'m1',requestedAt:123,provider:'groq',status:'done'}});
 Object.assign(state.chats[0].messages[0],{readAt:state.chats[0].messages[0].createdAt + 1,clientId:'fixture-client',deletedAt:null});
 state.botUsage = {day:'2026-10-17',total:1,users:{alina:{count:1,lastAt:123}}};
 state.notificationReads = {alina:['answer:a1']};
 const report = {id:'r',authorId:'alina',key:'fixture',createdAt:123,status:'open',reason:'fixture'};
 state.reports = [{...report,kind:'answer',targetId:'a1'}];
 state.appeals = [{...report}];
 state.aiFeedback = [{...report,question:'fixture',answer:'fixture',questionId:'q1'}];
 state.moderationLog = [{id:'log',actorId:'alina',action:'fixture',target:'a1',reason:'fixture',createdAt:123}];
 state.knowledgeOverrides = {entry:{office:'office',building:'building',hours:'hours',contact:'contact',checkedAt:'2026-10-17',source:'https://example.invalid/'}};
 state.extension = {unknown:['kept',null]};
 assert.equal(validState(state),true);
 return {state,sessions:{['a'.repeat(48)]:{userId:'alina',expiresAt:Date.now()+3600000,extra:'preserved'}}};
}
test('exact full fixture roundtrip, reopen, normalized tables and private file permissions', t => {
 const ctx = setup(t); const s = ctx.open(); const data = fixture();
 s.write(data);
 assert.deepEqual(s.read(),data);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM messages').get().n,4);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM chat_members').get().n,6);
 assert.equal(s.sql.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 assert.equal(fs.statSync(ctx.file).mode & 0o777,0o600);
 assert.equal(fs.statSync(path.dirname(ctx.file)).mode & 0o777,0o700);
 s.close(); assert.deepEqual(ctx.open().read(),data);
});
test('JSON migrates once, preserves original bytes, and empty SQLite remains authoritative', t => {
 const ctx = setup(t); const data = fixture(); const original = JSON.stringify(data,null,2);
 fs.writeFileSync(ctx.legacyFile,original);
 const s = ctx.open(); assert.deepEqual(s.read(),data);
 assert.equal(fs.readFileSync(ctx.legacyFile,'utf8'),original);
 s.write({state:createEmptyState(),sessions:{}}); s.close();
 assert.deepEqual(ctx.open().read(),{state:createEmptyState(),sessions:{}});
 assert.equal(fs.readFileSync(ctx.legacyFile,'utf8'),original);
});
test('malformed or invalid legacy data never creates final SQLite', t => {
 const ctx = setup(t);
 for (const content of ['{broken',JSON.stringify({state:{version:1}})]) {
  fs.writeFileSync(ctx.legacyFile,content);
  assert.throws(() => ctx.open());
  assert.equal(fs.existsSync(ctx.file),false);
  assert.equal(fs.readFileSync(ctx.legacyFile,'utf8'),content);
 }
});
test('corrupt SQLite fails closed despite valid legacy; invalid domain writes preserve state', t => {
 const ctx = setup(t); const s = ctx.open(); s.write(fixture()); const before = s.read();
 assert.throws(() => s.write({state:{},sessions:{}}),/INVALID_STATE/);
 assert.deepEqual(s.read(),before); s.close();
 fs.writeFileSync(ctx.file,'corrupt sqlite'); fs.writeFileSync(ctx.legacyFile,JSON.stringify(fixture()));
 assert.throws(() => ctx.open()); assert.equal(fs.readFileSync(ctx.file,'utf8'),'corrupt sqlite');
});
test('SQL constraint failure midway rolls back all rows and leaves teaching tables intact', t => {
 const s = setup(t).open(); const before = fixture(); s.write(before);
 s.sql.exec("CREATE TABLE lesson_items(id INTEGER PRIMARY KEY, title TEXT); INSERT INTO lesson_items VALUES(1,'keep'); CREATE TRIGGER reject_answer BEFORE INSERT ON answers BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 const next = structuredClone(before); next.state.users[0].firstName = 'changed';
 assert.throws(() => s.write(next),/fixture failure/);
 assert.deepEqual(s.read(),before);
 assert.equal(s.sql.prepare('SELECT title FROM lesson_items').get().title,'keep');
 s.sql.exec('DROP TRIGGER reject_answer');
 assert.throws(() => s.sql.prepare("INSERT INTO help_offers(help_id,position,user_id) VALUES('missing',0,'missing')").run(),/FOREIGN KEY/);
 s.write({state:createEmptyState(),sessions:{}});
 assert.equal(s.sql.prepare('SELECT title FROM lesson_items').get().title,'keep');
});
test('session restoration drops expired, anonymous, banned, deleted and legacy tokens', t => {
 const ctx = setup(t); const data = fixture();
 data.state.users[2].credential = data.state.users[0].credential; data.state.users[2].deletedAt=123;
 data.state.users[1].credential = data.state.users[0].credential;
 const valid = structuredClone(data.sessions);
 Object.assign(data.sessions,{
  ['b'.repeat(48)]:{userId:'alina',expiresAt:1},
  ['c'.repeat(48)]:{userId:'wei',expiresAt:Date.now()+3600000},
  ['d'.repeat(48)]:{userId:'maria',expiresAt:Date.now()+3600000},
  ['e'.repeat(48)]:'alina',
  ['f'.repeat(48)]:{userId:'gabriel',expiresAt:Date.now()+3600000},
  bad:{userId:'alina',expiresAt:Date.now()+3600000},
 });
 fs.writeFileSync(ctx.legacyFile,JSON.stringify(data));
 assert.deepEqual(ctx.open().read().sessions,valid);
});
test('real question JOIN exposes only public fields and excludes moderation-hidden records', t => {
 const s = setup(t).open(); const data = fixture();
 data.state.users.find(u => u.id === 'timur').credential = data.state.users[0].credential;
 s.write(data);
 const result = s.questionAnswers('q1');
 assert.equal(result.length,1); assert.equal(result[0].id,'a3');
 assert.equal(result[0].authorName,'Тимур Каримов');
 assert.equal(result[0].questionTitle,data.state.questions[0].title);
 assert.deepEqual(Object.keys(result[0]).sort(),['id','questionId','authorId','body','rating','createdAt','authorName','questionTitle'].sort());
 data.state.users[0].bannedAt=123; data.state.users[0].bannedBy='alina'; s.write(data);
 assert.deepEqual(s.questionAnswers('q1'),[]);
 assert.deepEqual(s.questionAnswers("q1' OR 1=1 --"),[]);
});

test('optional relational collections preserve absence, empty arrays, reviewed fields and order', t => {
 const s = setup(t).open();
 const data = fixture();
 Object.assign(data.state.reports[0],{status:'resolved',reviewerId:'alina',reviewedAt:456,decision:'fixture decision'});
 data.state.reports.unshift({...data.state.reports[0],id:'second',key:'second'});
 s.write(data); assert.deepEqual(s.read(),data);
 for (const table of ['reports','ai_feedback','appeals','moderation_log']) {
  assert.ok(s.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n > 0);
 }
 assert.equal(s.sql.prepare("SELECT reviewer_id FROM reports WHERE id='r'").get().reviewer_id,'alina');
 assert.equal(s.sql.prepare("SELECT value FROM metadata WHERE key='reports'").get().value,'null');
 for (const key of ['reports','aiFeedback','appeals','moderationLog']) data.state[key] = [];
 s.write(data); assert.deepEqual(s.read(),data);
 for (const key of ['reports','aiFeedback','appeals','moderationLog']) delete data.state[key];
 s.write(data); assert.deepEqual(s.read(),data);
});
test('JOIN excludes unregistered legacy accounts but accepts managed bot identities', t => {
 const s = setup(t).open(); const data = fixture();
 s.write(data); assert.deepEqual(s.questionAnswers('q1'),[]);
 const persona = BOT_PERSONAS[0];
 data.state.users.push({...data.state.users[3],id:persona.id,botPersona:persona.persona,role:'user',credential:null});
 data.state.answers.push({id:'bot-answer',questionId:'q1',authorId:persona.id,body:'Fixture answer',rating:null,createdAt:123});
 s.write(data); assert.deepEqual(s.questionAnswers('q1').map(a => a.id),['bot-answer']);
});
