import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { atomicPrivateWrite, checkSnapshot, rehearseRestore } from './backups.js';

const API = 'https://www.googleapis.com/drive/v3';
// Multipart requests stay below the 5 MB provider limit, including envelope/headers.
const MAX = 4 * 1024 * 1024;
const AAD = Buffer.from('medium-drive-backup:v1:aes-256-gcm');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const idValid = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
const unavailable = () => new Error('DRIVE_BACKUP_UNAVAILABLE');

export function encryptSnapshot(bytes, key) {
  if (bytes.length > MAX || key.length !== 32) throw unavailable();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([AAD, nonce, cipher.getAuthTag(), ciphertext]);
}
export function decryptSnapshot(bytes, key) {
  if (bytes.length > MAX + 256 || !bytes.subarray(0, AAD.length).equals(AAD) || key.length !== 32) throw unavailable();
  const offset = AAD.length;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(offset, offset + 12));
  decipher.setAAD(AAD);
  decipher.setAuthTag(bytes.subarray(offset + 12, offset + 28));
  return Buffer.concat([decipher.update(bytes.subarray(offset + 28)), decipher.final()]);
}
function privateJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.size > 16384) throw unavailable();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function readConfig(file) {
  let value;
  try { value = privateJson(file); } catch (error) { if (error.code === 'ENOENT') return null; throw unavailable(); }
  if (value.enabled === false) return null;
  if (value.enabled !== true || !idValid(value.folderId) ||
      !['clientId', 'clientSecret', 'refreshToken'].every(k => typeof value[k] === 'string' && value[k].length > 0 && value[k].length < 8192) ||
      typeof value.encryptionKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.encryptionKey)) throw unavailable();
  const key = Buffer.from(value.encryptionKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value.encryptionKey) throw unavailable();
  return { ...value, key };
}

export function createDriveBackupUploader({ dataDirectory, configFile = path.join(dataDirectory, 'drive-backup-config.json'), backupDirectory = path.join(dataDirectory, 'backups'), fetchImpl = globalThis.fetch } = {}) {
  const stateFile = path.join(dataDirectory, 'drive-backup-state.json');
  let flight = null;
  let status = { configured: false, lastSuccessAt: null, error: 'DRIVE_BACKUP_NOT_CONFIGURED' };
  function configuration() {
    const config = readConfig(configFile);
    status.configured = Boolean(config);
    if (!config) status.error = 'DRIVE_BACKUP_NOT_CONFIGURED';
    else if (status.error === 'DRIVE_BACKUP_NOT_CONFIGURED') status.error = null;
    return config;
  }
  try { const config = configuration(); if (config) { const previous = readState(); if (previous.binding === hash(`${config.folderId}:${config.encryptionKey}`) && Number.isFinite(previous.lastSuccessAt)) status.lastSuccessAt = previous.lastSuccessAt; } } catch { status.error = 'DRIVE_BACKUP_UNAVAILABLE'; }
  // Read provider bodies within both a size and a wall-clock bound; never expose provider errors.
  async function request(url, options = {}, limit = MAX + 256, allowMissing = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
      if (allowMissing && response.status === 404) return null;
      if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) throw unavailable();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) { controller.abort(); throw unavailable(); }
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timer); }
  }
  async function session(config) {
    const bytes = await request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' }).toString(),
    }, 16384);
    const token = JSON.parse(bytes).access_token;
    if (typeof token !== 'string' || !token || token.length > 8192) throw unavailable();
    const headers = { authorization: `Bearer ${token}` };
    const json = async url => JSON.parse(await request(url, { headers }, 65536));
    const folder = await json(`${API}/files/${config.folderId}?fields=id,mimeType,trashed,ownedByMe,capabilities(canAddChildren)`);
    if (folder.ownedByMe !== true || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' || folder.capabilities?.canAddChildren !== true) throw unavailable();
    const permissions = await json(`${API}/files/${config.folderId}/permissions?fields=nextPageToken,permissions(type,role,deleted)&pageSize=100`);
    if (permissions.nextPageToken || !Array.isArray(permissions.permissions) || !permissions.permissions.length ||
        permissions.permissions.some(p => p.type !== 'user' || p.role !== 'owner' || p.deleted)) throw unavailable();
    return { headers, json };
  }
  function readState() {
    try { return privateJson(stateFile); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  }
  async function download(id, headers, config) {
    if (!idValid(id)) throw unavailable();
    const meta = JSON.parse(await request(`${API}/files/${id}?fields=parents,trashed`, { headers }, 65536));
    if (meta.trashed || !meta.parents?.includes(config.folderId)) throw unavailable();
    return request(`${API}/files/${id}?alt=media`, { headers });
  }
  function validateBytes(bytes, restoreTarget) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'medium-drive-'));
    try {
      const file = path.join(temp, 'snapshot.json');
      fs.writeFileSync(file, bytes, { mode: 0o600 });
      return restoreTarget ? rehearseRestore(file, restoreTarget) : checkSnapshot(file);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
  async function upload(file) {
    try {
      const config = configuration();
      if (!config) return false;
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > MAX) throw unavailable();
      const bytes = fs.readFileSync(file);
      validateBytes(bytes);
      const signature = hash(bytes);
      const binding = hash(`${config.folderId}:${config.encryptionKey}`);
      const state = readState();
      const { headers, json } = await session(config);
      if (state.binding === binding && state.lastSnapshotHash === signature && idValid(state.remoteId)) {
        const existingBytes = await download(state.remoteId, headers, config);
        if (!decryptSnapshot(existingBytes, config.key).equals(bytes)) throw unavailable();
        status = { configured: true, lastSuccessAt: state.lastSuccessAt, error: null }; return true;
      }
      let remoteId = state.binding === binding && state.pendingHash === signature ? state.pendingId : null;
      if (!idValid(remoteId)) {
        remoteId = (await json(`${API}/files/generateIds?count=1&space=drive&type=files`)).ids?.[0];
        if (!idValid(remoteId)) throw unavailable();
        atomicPrivateWrite(stateFile, JSON.stringify({ ...state, binding, pendingHash: signature, pendingId: remoteId }));
      }
      const existing = await request(`${API}/files/${remoteId}?fields=id`, { headers }, 65536, true);
      if (!existing) {
        const encrypted = encryptSnapshot(bytes, config.key);
        const boundary = `medium_${crypto.randomUUID()}`;
        const metadata = JSON.stringify({ id: remoteId, name: `medium-backup-${Date.now()}.enc`, parents: [config.folderId], mimeType: 'application/octet-stream', appProperties: { mediumBackup: 'v1' } });
        const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), encrypted, Buffer.from(`\r\n--${boundary}--\r\n`)]);
        await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { ...headers, 'content-type': `multipart/related; boundary=${boundary}` }, body }, 65536);
        const readback = await download(remoteId, headers, config);
        if (hash(readback) !== hash(encrypted)) throw unavailable();
        if (!decryptSnapshot(readback, config.key).equals(bytes)) throw unavailable();
      } else {
        const readback = await download(remoteId, headers, config);
        if (!decryptSnapshot(readback, config.key).equals(bytes)) throw unavailable();
      }
      const lastSuccessAt = Date.now();
      atomicPrivateWrite(stateFile, JSON.stringify({ binding, lastSnapshotHash: signature, remoteId, lastSuccessAt }));
      status = { configured: true, lastSuccessAt, error: null }; return true;
    } catch { status.error = 'DRIVE_BACKUP_UNAVAILABLE'; return false; }
  }
  function enqueueSnapshot(file) {
    if (flight) return flight;
    flight = upload(file).finally(() => { flight = null; });
    return flight;
  }
  async function retryLatestSnapshot() {
    try {
      if (!configuration()) return false;
      const latest = fs.readdirSync(backupDirectory).filter(name => /^snapshot-\d+-[a-f0-9-]+\.json$/.test(name))
        .map(name => ({ name, time: Number(name.split('-')[1]) })).sort((a, b) => b.time - a.time)[0];
      return latest ? enqueueSnapshot(path.join(backupDirectory, latest.name)) : false;
    } catch { status.error = 'DRIVE_BACKUP_UNAVAILABLE'; return false; }
  }
  async function verifyRestore(remoteId, targetDirectory) {
    try {
      const config = configuration();
      if (!config || fs.existsSync(targetDirectory)) throw unavailable();
      const { headers } = await session(config);
      const plain = decryptSnapshot(await download(remoteId, headers, config), config.key);
      return validateBytes(plain, targetDirectory);
    } catch { throw unavailable(); }
  }
  return { enqueueSnapshot, retryLatestSnapshot, verifyRestore, getStatus: () => ({ ...status }) };
}
