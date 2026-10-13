import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createSeed } from '../src/data.js';
import { createBackupManager } from '../server/backups.js';
import { createDriveBackupUploader, encryptSnapshot, decryptSnapshot } from '../server/drive-backups.js';

async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medium-drive-test-'));
  const config = { enabled: true, clientId: 'test-client', clientSecret: 'test-secret', refreshToken: 'test-refresh', folderId: 'folder', encryptionKey: crypto.randomBytes(32).toString('base64') };
  const configFile = path.join(dir, 'drive-backup-config.json');
  fs.writeFileSync(configFile, JSON.stringify(config), { mode: 0o600 });
  const state = createSeed();
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ state, sessions: { private_session: 'never-upload' } }));
  const snapshot = createBackupManager({ dataDirectory: dir }).create();
  const remote = new Map(); let uploads = 0; let calls = 0; let failUpload = false; let publicFolder = false;
  const response = value => new Response(JSON.stringify(value));
  const fetchImpl = async (url, options = {}) => {
    calls++;
    assert.equal(options.redirect, 'error');
    if (url === 'https://oauth2.googleapis.com/token') return response({ access_token: 'fake-token' });
    if (url.includes('/permissions?')) return response({ permissions: [{ type: publicFolder ? 'anyone' : 'user', role: publicFolder ? 'reader' : 'owner' }] });
    if (url.includes('/files/folder?')) return response({ ownedByMe: true, mimeType: 'application/vnd.google-apps.folder', trashed: false, capabilities: { canAddChildren: true } });
    if (url.includes('/generateIds?')) return response({ ids: ['reserved_id'] });
    if (url.includes('/upload/')) {
      uploads++;
      const body = options.body;
      assert.equal(body.includes(Buffer.from('never-upload')), false);
      assert.equal(body.includes(Buffer.from(config.encryptionKey)), false);
      const prefix = Buffer.from('Content-Type: application/octet-stream\r\n\r\n');
      const start = body.indexOf(prefix) + prefix.length;
      const end = body.lastIndexOf(Buffer.from('\r\n--medium_'));
      remote.set('reserved_id', body.subarray(start, end));
      if (failUpload) throw new Error('provider secret error');
      return response({ id: 'reserved_id' });
    }
    if (url.includes('/files/reserved_id?')) {
      if (!remote.has('reserved_id')) return new Response('', { status: 404 });
      return url.endsWith('alt=media') ? new Response(remote.get('reserved_id')) : response({ id: 'reserved_id', parents: ['folder'], trashed: false });
    }
    throw new Error(`unexpected endpoint`);
  };
  try { await run({ dir, config, configFile, snapshot, state, remote, fetchImpl, counts: () => ({ uploads, calls }), failUpload: () => { failUpload = true; }, share: () => { publicFolder = true; } }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('encryption uses fresh nonces and rejects tamper, wrong key and oversized bytes', () => {
  const key = crypto.randomBytes(32); const plain = Buffer.from('private snapshot');
  const encrypted = encryptSnapshot(plain, key);
  assert.deepEqual(decryptSnapshot(encrypted, key), plain);
  assert.notDeepEqual(encrypted, encryptSnapshot(plain, key));
  assert.throws(() => decryptSnapshot(encrypted, crypto.randomBytes(32)));
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptSnapshot(encrypted, key));
  assert.throws(() => encryptSnapshot(Buffer.alloc(4 * 1024 * 1024 + 1), key));
});

test('upload readback, restore without sessions, private persisted state and restart deduplication', () => fixture(async f => {
  const uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.enqueueSnapshot(f.snapshot.file), true);
  assert.deepEqual(decryptSnapshot(f.remote.get('reserved_id'), Buffer.from(f.config.encryptionKey, 'base64')), fs.readFileSync(f.snapshot.file));
  assert.equal(fs.statSync(path.join(f.dir, 'drive-backup-state.json')).mode & 0o777, 0o600);
  const restored = path.join(f.dir, 'new-restore');
  assert.deepEqual(await uploader.verifyRestore('reserved_id', restored), { verified: true, users: f.state.users.length, sessions: 0 });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, 'db.json'))), { state: f.state, sessions: {} });
  await assert.rejects(uploader.verifyRestore('reserved_id', restored), /DRIVE_BACKUP_UNAVAILABLE/);
  const restarted = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await restarted.retryLatestSnapshot(), true);
  assert.equal(f.counts().uploads, 1);
  assert.equal(restarted.getStatus().error, null);
}));

test('lost upload response retains local snapshot and reuses reserved ID on retry; single flight', () => fixture(async f => {
  f.failUpload();
  const uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  const first = uploader.enqueueSnapshot(f.snapshot.file);
  assert.equal(uploader.enqueueSnapshot(f.snapshot.file), first);
  assert.equal(await first, false);
  assert.equal(fs.existsSync(f.snapshot.file), true);
  assert.equal(uploader.getStatus().error, 'DRIVE_BACKUP_UNAVAILABLE');
  assert.equal(await uploader.retryLatestSnapshot(), true);
  assert.equal(f.counts().uploads, 1);
}));

test('shared folder fails closed before upload', () => fixture(async f => {
  f.share();
  const uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.enqueueSnapshot(f.snapshot.file), false);
  assert.equal(f.counts().uploads, 0);
  assert.equal(fs.existsSync(f.snapshot.file), true);
}));

test('absent, insecure and malformed private config never accesses provider', () => fixture(async f => {
  fs.chmodSync(f.configFile, 0o644);
  let uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.enqueueSnapshot(f.snapshot.file), false);
  assert.equal(uploader.getStatus().error, 'DRIVE_BACKUP_UNAVAILABLE');
  fs.chmodSync(f.configFile, 0o600);
  fs.writeFileSync(f.configFile, '{invalid');
  uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.enqueueSnapshot(f.snapshot.file), false);
  fs.unlinkSync(f.configFile);
  uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.retryLatestSnapshot(), false);
  assert.deepEqual(uploader.getStatus(), { configured: false, lastSuccessAt: null, error: 'DRIVE_BACKUP_NOT_CONFIGURED' });
  assert.equal(f.counts().calls, 0);
}));

test('previous success is retained in status; remote tamper and new sharing fail recheck without duplicate upload', () => fixture(async f => {
  const uploader = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(await uploader.enqueueSnapshot(f.snapshot.file), true);
  const previous = uploader.getStatus().lastSuccessAt;
  const restarted = createDriveBackupUploader({ dataDirectory: f.dir, fetchImpl: f.fetchImpl });
  assert.equal(restarted.getStatus().lastSuccessAt, previous);
  f.remote.get('reserved_id')[f.remote.get('reserved_id').length - 1] ^= 1;
  assert.equal(await restarted.retryLatestSnapshot(), false);
  assert.equal(f.counts().uploads, 1);
  assert.equal(restarted.getStatus().lastSuccessAt, previous);
  f.share();
  assert.equal(await restarted.retryLatestSnapshot(), false);
  assert.equal(restarted.getStatus().error, 'DRIVE_BACKUP_UNAVAILABLE');
}));
