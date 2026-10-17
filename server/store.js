import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validState } from '../src/domain.js';
import { openSqliteStore } from './sqlite-store.js';
import { createLessonStore, exportLesson } from './lesson-database.js';
import { createBackupManager } from './backups.js';
import { createDriveBackupUploader } from './drive-backups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDirectory = process.env.DATA_DIR || path.join(__dirname, 'storage');
export const databaseFile = path.join(dataDirectory, 'medium.sqlite');
let repository;
try { repository = openSqliteStore({ file: databaseFile, legacyFile: path.join(dataDirectory, 'db.json') }); }
catch (error) { throw new Error('Не удалось прочитать базу SQLite или исходный JSON', { cause: error }); }
export const sql = repository.sql;
export const db = repository.read();
const storageError = cause => Object.assign(new Error('Не удалось сохранить данные', { cause }), { code: 'STORAGE_UNAVAILABLE' });
// SQLite keeps an open descriptor. Detect a moved/replaced directory before writing
// so an unlinked database cannot silently accept changes that will disappear later.
const identity = fs.statSync(databaseFile);
export function assertStorageAvailable() {
  try {
    const current = fs.statSync(databaseFile);
    if (!current.isFile() || current.ino !== identity.ino || current.dev !== identity.dev) throw new Error('DATABASE_REPLACED');
  } catch (error) { throw storageError(error); }
}
export function refreshFromDatabase() {
  try {
    assertStorageAvailable();
    const saved = repository.read();
    // Preserve references used by async credential/job guards when nothing changed.
    if (!isDeepStrictEqual(saved.state, db.state)) db.state = saved.state;
    if (!isDeepStrictEqual(saved.sessions, db.sessions)) db.sessions = saved.sessions;
  } catch (error) { throw storageError(error); }
}
let backups;
export const lesson = createLessonStore(sql, { beforeWrite: () => {
  assertStorageAvailable();
  if (backups) { const snapshot = backups.create({ force: false }); if (snapshot) sendOffsite(snapshot); }
} });
backups = createBackupManager({ dataDirectory, now: () => Date.now(), readSource: () => ({ ...repository.read(), lesson: exportLesson(sql) }) });
const drive = createDriveBackupUploader({ dataDirectory, backupDirectory: process.env.BACKUP_DIR || path.join(dataDirectory, 'backups'), configFile: process.env.DRIVE_BACKUP_CONFIG || undefined });
export const getBackupStatus = () => ({ ...backups.getStatus(), drive: drive.getStatus() });
function sendOffsite(snapshot) {
  const upload = snapshot ? drive.enqueueSnapshot(snapshot.file) : drive.retryLatestSnapshot();
  upload.catch(() => {});
}
function scheduledBackup(force = false) {
  try { assertStorageAvailable(); sendOffsite(backups.create({ force })); }
  catch { console.error('BACKUP_UNAVAILABLE: automatic snapshot failed'); }
}
scheduledBackup(true);
export function startBackupSchedule() {
  const timer = setInterval(() => scheduledBackup(), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
export function commit(next, options) {
  if (!validState(next?.state)) throw new Error('INVALID_STATE');
  try {
    assertStorageAvailable();
    const snapshot = backups.create({ force: false });
    if (snapshot) sendOffsite(snapshot);
    repository.write(next, options);
    const saved = repository.read();
    db.state = next.state;
    db.sessions = saved.sessions;
  } catch (error) { throw storageError(error); }
}
export const joinedQuestionAnswers = id => repository.questionAnswers(id);
