import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function inStore(dir, code) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, DATA_DIR: dir, BACKUP_DIR: join(dir, 'backups'), BACKUP_RETENTION: '14' }, encoding: 'utf8', timeout: 5000,
  });
}

test('state survives a new process; expired and legacy sessions do not', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-store-'));
  try {
    const created = inStore(dir, `
      import { db, commit } from './server/store.js';
      import { createSeed } from './src/data.js';
      import { sendMessage, markChatRead, passwordCredential } from './src/domain.js';
      const seed = createSeed();
      seed.users.find(u => u.id === 'alina').credential = await passwordCredential('isolated-fixture-pass');
      let state = sendMessage(seed, 'alina', 'c1', 'Сохранённое сообщение', 'persisted-client-id');
      state = markChatRead(state, 'wei', 'c1', state.chats[0].messages.at(-1).id);
      state.users.find(u => u.id === 'alina').about = 'Сохранённый профиль';
      state.users.find(u => u.id === 'alina').peopleVisible = false;
      commit({ state, sessions: {
        ['a'.repeat(48)]: { userId: 'alina', expiresAt: Date.now() + 60000 },
        ['b'.repeat(48)]: { userId: 'alina', expiresAt: 1 },
        ['c'.repeat(48)]: 'alina',
        ['d'.repeat(48)]: { userId: 'unknown', expiresAt: Date.now() + 60000 },
      }});
    `);
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(readdirSync(dir).sort(), ['backups', 'medium.sqlite']);
    const reopened = inStore(dir, `
      import { db } from './server/store.js';
      const message = db.state.chats[0].messages.at(-1);
      console.log(JSON.stringify({ about: db.state.users.find(u => u.id === 'alina').about, peopleVisible: db.state.users.find(u => u.id === 'alina').peopleVisible, tokens: Object.keys(db.sessions),
        clientId: message.clientId, read: Number.isFinite(message.readAt) && message.readAt >= message.createdAt }));
    `);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), { about: 'Сохранённый профиль', peopleVisible: false, tokens: ['a'.repeat(48)],
      clientId: 'persisted-client-id', read: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt saved data stops startup and is never replaced with demo data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-corrupt-'));
  try {
    for (const contents of ['{broken JSON', JSON.stringify({ state: { users: [] }, sessions: {} })]) {
      writeFileSync(join(dir, 'db.json'), contents);
      const result = inStore(dir, "import './server/store.js';");
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Не удалось прочитать базу/);
      assert.equal(readFileSync(join(dir, 'db.json'), 'utf8'), contents);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty install and private hashed bootstrap are idempotent and reject invalid input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-admin-'));
  try {
    const initial = inStore(dir, `import { db } from './server/store.js'; console.log(db.state.users.length);`);
    assert.equal(initial.status, 0, initial.stderr);
    assert.equal(initial.stdout.trim(), '0');
    for (const config of [null, {}, { login: 'fixture-admin', credential: { salt: [], hash: [] } }]) {
      writeFileSync(join(dir, 'admin-bootstrap.json'), JSON.stringify(config));
      const invalid = inStore(dir, `import { provisionAdministrator } from './server/admin.js'; provisionAdministrator();`);
      assert.notEqual(invalid.status, 0);
      assert.ok(!readdirSync(dir).includes('db.json'));
    }
    const created = inStore(dir, `
      import fs from 'node:fs';
      import { passwordCredential } from './src/domain.js';
      import { db } from './server/store.js';
      import { provisionAdministrator } from './server/admin.js';
      fs.writeFileSync(process.env.DATA_DIR + '/admin-bootstrap.json', JSON.stringify({ login: 'fixture-admin', credential: await passwordCredential('fabricated-admin-pass') }));
      provisionAdministrator(); provisionAdministrator();
      console.log(JSON.stringify({ count: db.state.users.length, role: db.state.users[0].role }));
    `);
    assert.equal(created.status, 0, created.stderr);
    assert.deepEqual(JSON.parse(created.stdout), { count: 1, role: 'admin' });
    assert.ok(!readFileSync(join(dir, 'medium.sqlite')).includes(Buffer.from('fabricated-admin-pass')));
    const reopened = inStore(dir, `import { db } from './server/store.js'; import { provisionAdministrator } from './server/admin.js'; provisionAdministrator(); console.log(db.state.users.length);`);
    assert.equal(reopened.stdout.trim(), '1');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bans and interrupted AI requests survive restart safely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-ban-ai-'));
  try {
    const created = inStore(dir, `
      import { db, commit } from './server/store.js';
      import { createSeed } from './src/data.js';
      import { passwordCredential } from './src/domain.js';
      const state = createSeed();
      const user = state.users.find(u => u.id === 'alina');
      user.credential = await passwordCredential('isolated-fixture-pass');
      user.bannedAt = Date.now(); user.bannedBy = 'wei';
      state.questions[0].aiResponse = { status: 'pending', createdAt: Date.now() };
      commit({state,sessions:{['a'.repeat(48)]:{userId:'alina',expiresAt:Date.now()+60000}}});
    `);
    assert.equal(created.status, 0, created.stderr);
    const reopened = inStore(dir, `
      import { db } from './server/store.js';
      import { createAssistantRouter } from './server/assistant.js';
      createAssistantRouter();
      console.log(JSON.stringify({ banned: db.state.users.find(u => u.id === 'alina').bannedAt != null,
        sessions: Object.keys(db.sessions).length, ai: db.state.questions[0].aiResponse.status,
        preserved: db.state.questions.length > 0 }));
    `);
    assert.equal(reopened.status, 0, reopened.stderr);
    assert.deepEqual(JSON.parse(reopened.stdout), { banned: true, sessions: 0, ai: 'error', preserved: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('failed due backup blocks mutation and keeps memory and disk aligned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-backup-failure-'));
  try {
    const result = inStore(dir, `
      import fs from 'node:fs';
      import { db, commit, getBackupStatus, sql } from './server/store.js';
      import { createSeed } from './src/data.js';
      commit({state:createSeed(),sessions:{}});
      fs.rmSync(process.env.BACKUP_DIR,{recursive:true});
      fs.writeFileSync(process.env.BACKUP_DIR, 'blocked destination');
      const clock = Date.now; Date.now = () => clock() + 2 * 86400000;
      const before = JSON.stringify(sql.prepare('SELECT * FROM users').all());
      const next = structuredClone(db); next.state.users[0].about = 'must not persist';
      let code; try { commit(next); } catch (error) { code = error.code; }
      console.log(JSON.stringify({ code, sameDisk: before === JSON.stringify(sql.prepare('SELECT * FROM users').all()),
        sameMemory: db.state.users[0].about !== 'must not persist', backupError:getBackupStatus().error }));
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {code:'STORAGE_UNAVAILABLE',sameDisk:true,sameMemory:true,backupError:'BACKUP_UNAVAILABLE'});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('replaced SQLite path refuses writes and leaves cached state unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-rename-failure-'));
  try {
    const result = inStore(dir, `
      import fs from 'node:fs';
      import { db, commit } from './server/store.js';
      import { createSeed } from './src/data.js';
      commit({state:createSeed(),sessions:{}});
      fs.renameSync(process.env.DATA_DIR+'/medium.sqlite',process.env.DATA_DIR+'/moved.sqlite'); fs.mkdirSync(process.env.DATA_DIR+'/medium.sqlite');
      const next = structuredClone(db); next.state.users[0].about = 'must not persist';
      let code; try { commit(next); } catch(error) { code=error.code; }
      console.log(JSON.stringify({code,unchanged:db.state.users[0].about !== 'must not persist',temp:fs.readdirSync(process.env.DATA_DIR).some(n=>n.endsWith('.tmp'))}));
    `);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),{code:'STORAGE_UNAVAILABLE',unchanged:true,temp:false});
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
