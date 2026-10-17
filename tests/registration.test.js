import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createRegistrationRouter } from '../server/registration.js';
import { createRegistrationMailer } from '../server/registration-mailer.js';
function fixture(options = {}) {
  const sql = new DatabaseSync(':memory:');
  let time = 1000000;
  const state = { users: [] }, mails = [];
  const config = { sql, getData: () => ({ state }), now: () => time,
    sendMail: async m => mails.push(m), onVerified(user,{beforeCommit}) {
      sql.exec('BEGIN');
      try { beforeCommit(sql); sql.exec('COMMIT'); } catch(e) { sql.exec('ROLLBACK'); throw e; }
      state.users.push(user); return { token: 'session', me: user.id, state: {} };
    }, ...options };
  let router = createRegistrationRouter(config);
  return { sql,state,mails, advance: ms => { time += ms; }, restart: () => { router = createRegistrationRouter(config); },
    async call(path,body = {}) {
      const route = router.stack.find(x => x.route?.path === path).route;
      let status = 200, payload;
      await route.stack[0].handle({body,ip:'127.0.0.1'}, {status(n) {status=n;return this;}, json(v) {payload=v;}}, e => {throw e;});
      return {status,...payload};
    } };
}
const valid = { name: 'Test Person', email: 'test@example.org', password: 'StrongSecret123', aiConsent: true };
test('verification gates account creation, persists credential only and prevents replay', async () => {
 const f=fixture();
 const issued=await f.call('/register',valid);
 assert.equal(issued.status,202); assert.equal(f.state.users.length,0); assert.equal(issued.code,undefined);
 const pending=f.sql.prepare('SELECT * FROM registration_challenges').get();
 assert.ok(!pending.user_json.includes(valid.password)); assert.notEqual(pending.digest,f.mails[0].code);
 f.restart();
 const verified=await f.call('/register/verify',{challengeId:issued.challengeId,code:f.mails[0].code});
 assert.equal(verified.status,201); assert.equal(f.state.users.length,1);
 assert.deepEqual(f.state.users[0].aiConsent,{version:1,provider:'gemini',acceptedAt:1000000,adultConfirmed:true});
 assert.equal((await f.call('/register/verify',{challengeId:issued.challengeId,code:f.mails[0].code})).status,400);
 assert.equal((await f.call('/register',valid)).status,409);
 f.sql.close();
});
test('attempt budget survives resend and restart; expiry clears challenge',async () => {
 const f=fixture(); const issued=await f.call('/register',valid);
 assert.equal((await f.call('/register/resend',{challengeId:issued.challengeId})).error,'RESEND_COOLDOWN');
 assert.equal((await f.call('/register',valid)).error,'REGISTRATION_PENDING');
 for(let i=0;i<4;i++) assert.equal((await f.call('/register/verify',{challengeId:issued.challengeId,code:'bad'})).error,'CODE_INVALID');
 f.advance(60000); f.restart();
 assert.equal((await f.call('/register/resend',{challengeId:issued.challengeId})).status,202);
 assert.equal((await f.call('/register/verify',{challengeId:issued.challengeId,code:'bad'})).error,'ATTEMPTS_EXHAUSTED');
 assert.equal((await f.call('/register/verify',{challengeId:issued.challengeId,code:f.mails.at(-1).code})).error,'ATTEMPTS_EXHAUSTED');
 f.advance(600000);
 assert.equal((await f.call('/register/verify',{challengeId:issued.challengeId,code:'123456'})).error,'CHALLENGE_EXPIRED');
 assert.equal(f.state.users.length,0); f.sql.close();
});
test('mail failure returns retry metadata, preserves cooldown, and never creates account',async () => {
 const f=fixture({sendMail:async()=>{throw new Error('private SMTP detail');}});
 const result=await f.call('/register',valid);
 assert.equal(result.status,503); assert.equal(result.error,'MAIL_DELIVERY_FAILED'); assert.ok(result.challengeId);
 assert.equal((await f.call('/register/resend',{challengeId:result.challengeId})).error,'RESEND_COOLDOWN');
 assert.equal(f.state.users.length,0); f.sql.close();
});
test('configuration and consent fail closed', async () => {
 const f=fixture({mailReady:()=>false});
 assert.equal((await f.call('/register',{...valid,aiConsent:false})).error,'AI_CONSENT_REQUIRED');
 assert.equal((await f.call('/register',valid)).error,'MAIL_NOT_CONFIGURED');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM registration_challenges').get().n,0);
 assert.equal(createRegistrationMailer({env:{NODE_ENV:'production',HOST:'127.0.0.1',REGISTRATION_MAIL_MODE:'local'}}).ready(),false);
 assert.equal(createRegistrationMailer({env:{NODE_ENV:'development',HOST:'0.0.0.0',REGISTRATION_MAIL_MODE:'local'}}).ready(),false);
 f.sql.close();
});
test('email send quota persists across router recreation and expired challenges',async()=>{
 const f=fixture();
 for(let i=0;i<5;i++) { assert.equal((await f.call('/register',valid)).status,202); f.advance(600001); f.restart(); }
 assert.equal((await f.call('/register',valid)).error,'RATE_LIMITED');
 assert.equal(f.mails.length,5); f.sql.close();
});
