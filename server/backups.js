import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { validState } from '../src/domain.js';
import { openSqliteStore } from './sqlite-store.js';
import { exportLesson, importLesson } from './lesson-database.js';

const DAY = 24 * 60 * 60 * 1000;
const snapshotName = /^snapshot-\d+-[a-f0-9-]+\.json$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

export function atomicPrivateWrite(file, contents) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function checkSnapshot(file) {
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (snapshot.format !== 1 || !Number.isFinite(snapshot.createdAt) ||
      typeof snapshot.payload !== 'string' || snapshot.sha256 !== digest(snapshot.payload)) {
    throw new Error('BACKUP_INTEGRITY_FAILED');
  }
  const data = JSON.parse(snapshot.payload);
  if (!validState(data.state) || !data.sessions || typeof data.sessions !== 'object' ||
      Array.isArray(data.sessions) || Object.keys(data.sessions).length) throw new Error('BACKUP_SCHEMA_FAILED');
  if (data.lesson !== undefined) {
    const sql = new DatabaseSync(':memory:');
    try { sql.exec('PRAGMA foreign_keys=ON'); importLesson(sql, data.lesson); }
    catch { throw new Error('BACKUP_SCHEMA_FAILED'); }
    finally { sql.close(); }
  }
  return { data, storage: snapshot.storage, createdAt: snapshot.createdAt, sha256: snapshot.sha256 };
}

export function rehearseRestore(snapshotFile, targetDirectory) {
  const verified = checkSnapshot(snapshotFile);
  // Exclusive creation prevents accidental replacement, including an existing empty/live directory.
  fs.mkdirSync(targetDirectory, { mode: 0o700 });
  // Retain old JSON restore compatibility; every restored copy also has SQLite.
  if (verified.storage !== 'sqlite') atomicPrivateWrite(path.join(targetDirectory, 'db.json'), JSON.stringify(verified.data));
  const store = openSqliteStore({ file: path.join(targetDirectory, 'medium.sqlite') });
  try {
    store.write(verified.data);
    importLesson(store.sql, verified.data.lesson);
    const restored = store.read();
    if (!isDeepStrictEqual(restored, { state: verified.data.state, sessions: {} }) ||
        !isDeepStrictEqual(exportLesson(store.sql), verified.data.lesson)) throw new Error('RESTORE_VERIFICATION_FAILED');
    return { verified: true, users: restored.state.users.length, sessions: 0 };
  } finally { store.close(); }
}

export function readBackupData(dataDirectory) {
  const file = path.join(dataDirectory, 'medium.sqlite');
  if (!fs.existsSync(file)) return JSON.parse(fs.readFileSync(path.join(dataDirectory, 'db.json'), 'utf8'));
  const store = openSqliteStore({ file });
  try { return { ...store.read(), lesson: exportLesson(store.sql) }; }
  finally { store.close(); }
}

export function createBackupManager({ dataDirectory, backupDirectory = process.env.BACKUP_DIR || path.join(dataDirectory, 'backups'), retention = Number(process.env.BACKUP_RETENTION || 14), now = Date.now, readSource = () => readBackupData(dataDirectory) } = {}) {
  if (!Number.isInteger(retention) || retention < 2 || retention > 365) throw new Error('INVALID_BACKUP_RETENTION');
  const destination = path.resolve(backupDirectory);
  let lastSuccessAt = null;
  let status = { enabled: true, destinationConfigured: Boolean(process.env.BACKUP_DIR), lastSuccessAt: null, lastErrorAt: null, error: null };
  function fail(error) {
    status = { ...status, lastErrorAt: now(), error: 'BACKUP_UNAVAILABLE' };
    throw Object.assign(new Error('BACKUP_UNAVAILABLE'), { cause: error, code: 'BACKUP_UNAVAILABLE' });
  }
  function create({ force = true } = {}) {
    if (!force && lastSuccessAt !== null && now() - lastSuccessAt < DAY) return null;
    try {
      const raw = readSource();
      if (!validState(raw.state)) throw new Error('BACKUP_SOURCE_INVALID');
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      if (fs.realpathSync(destination) === fs.realpathSync(dataDirectory)) throw new Error('BACKUP_DESTINATION_IS_SOURCE');
      fs.chmodSync(destination, 0o700);
      const createdAt = now();
      const payload = JSON.stringify({ state: raw.state, sessions: {}, ...(raw.lesson !== undefined ? { lesson: raw.lesson } : {}) });
      const file = path.join(destination, `snapshot-${createdAt}-${crypto.randomUUID()}.json`);
      atomicPrivateWrite(file, JSON.stringify({ format: 1, storage: fs.existsSync(path.join(dataDirectory, 'medium.sqlite')) ? 'sqlite' : 'json', createdAt, sha256: digest(payload), payload }));
      checkSnapshot(file);
      // Only verified snapshots count toward retention. Invalid files are retained for investigation.
      const valid = fs.readdirSync(destination).filter(name => snapshotName.test(name)).flatMap(name => {
        try { return [{ name, createdAt: checkSnapshot(path.join(destination, name)).createdAt }]; } catch { return []; }
      }).sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
      for (const old of valid.slice(retention)) fs.unlinkSync(path.join(destination, old.name));
      lastSuccessAt = createdAt;
      status = { ...status, lastSuccessAt: createdAt, error: null };
      return { file, createdAt, verified: true };
    } catch (error) { return fail(error); }
  }
  return { create, getStatus: () => ({ ...status }) };
}
