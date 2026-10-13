import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createSeed } from '../src/data.js';
import { createBackupManager, checkSnapshot, rehearseRestore } from '../server/backups.js';

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medium-backups-'));
  const dataDirectory = path.join(root, 'data');
  fs.mkdirSync(dataDirectory);
  const state = createSeed();
  state.users[0].about = 'Preserved profile';
  state.users[0].bannedAt = 100;
  state.users[0].bannedBy = state.users[1].id;
  fs.writeFileSync(path.join(dataDirectory, 'db.json'), JSON.stringify({ state, sessions: { secret: { userId: state.users[0].id } } }));
  try { run({ root, dataDirectory, state }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('verified external snapshot restores all relationships, profiles and bans without sessions', () => fixture(({root, dataDirectory, state}) => {
  const backupDirectory = path.join(root, 'external');
  const manager = createBackupManager({ dataDirectory, backupDirectory });
  const snapshot = manager.create();
  const target = path.join(root, 'rehearsal');
  assert.deepEqual(rehearseRestore(snapshot.file, target), { verified: true, users: state.users.length, sessions: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'db.json'))), { state, sessions: {} });
  assert.equal(fs.statSync(snapshot.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(backupDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(target).mode & 0o777, 0o700);
  assert.throws(() => rehearseRestore(snapshot.file, dataDirectory), /EEXIST/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dataDirectory, 'db.json'))).sessions.secret);
}));

test('tampering and invalid schemas reject before restoration creates a target', () => fixture(({root, dataDirectory}) => {
  const snapshot = createBackupManager({ dataDirectory }).create();
  const original = JSON.parse(fs.readFileSync(snapshot.file));
  fs.writeFileSync(snapshot.file, JSON.stringify({ ...original, payload: original.payload + ' ' }));
  assert.throws(() => checkSnapshot(snapshot.file), /INTEGRITY/);
  const target = path.join(root, 'rejected');
  assert.throws(() => rehearseRestore(snapshot.file, target));
  assert.equal(fs.existsSync(target), false);
  const payload = JSON.stringify({ state: {}, sessions: {} });
  fs.writeFileSync(snapshot.file, JSON.stringify({ ...original, payload, sha256: crypto.createHash('sha256').update(payload).digest('hex') }));
  assert.throws(() => checkSnapshot(snapshot.file), /SCHEMA/);
}));

test('daily snapshots skip repeated writes and retain the latest configured valid copies', () => fixture(({dataDirectory}) => {
  let time = 1000;
  const manager = createBackupManager({ dataDirectory, retention: 2, now: () => time });
  manager.create();
  for (let i = 0; i < 20; i++) assert.equal(manager.create({force: false}), null);
  time += 86400000;
  manager.create({force: false});
  time += 86400000;
  manager.create({force: false});
  const directory = path.join(dataDirectory, 'backups');
  const files = fs.readdirSync(directory);
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(name => checkSnapshot(path.join(directory, name)).createdAt).sort((a,b) => a-b), [86401000, 172801000]);
  assert.equal(manager.getStatus().lastSuccessAt, time);
}));

test('backup destination cannot equal source and errors expose only safe status', () => fixture(({dataDirectory}) => {
  const manager = createBackupManager({ dataDirectory, backupDirectory: dataDirectory });
  const before = fs.readFileSync(path.join(dataDirectory, 'db.json'), 'utf8');
  assert.throws(() => manager.create(), /BACKUP_UNAVAILABLE/);
  assert.equal(manager.getStatus().error, 'BACKUP_UNAVAILABLE');
  assert.equal(JSON.stringify(manager.getStatus()).includes(dataDirectory), false);
  assert.equal(fs.readFileSync(path.join(dataDirectory, 'db.json'), 'utf8'), before);
}));

test('CLI validates and rehearses without printing stored content or paths', () => fixture(({root,dataDirectory}) => {
  const snapshot = createBackupManager({dataDirectory}).create();
  for (const args of [['check', snapshot.file], ['rehearse', snapshot.file, path.join(root,'cli-restore')]]) {
    const result = spawnSync(process.execPath, ['scripts/backup.mjs', ...args], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).verified, true);
    assert.equal(result.stdout.includes('Preserved profile'), false);
    assert.equal(result.stdout.includes(root), false);
  }
}));
