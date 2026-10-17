import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createEmptyState } from '../src/data.js';
import { validState } from '../src/domain.js';
import { isBotUser } from '../src/bot-personas.js';
import { createBackupManager } from './backups.js';
import { createDriveBackupUploader } from './drive-backups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DATA_DIR || path.join(__dirname, 'storage');
export const dataDirectory = dir;
const file = path.join(dir, 'db.json');

export const db = { state: createEmptyState(), sessions: {} };

try {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validState(saved.state)) throw new Error('Сохранённое состояние повреждено');
  db.state = saved.state;
  // Старые бессрочные токены не восстанавливаем; аккаунты и записи сохраняются.
  db.sessions = Object.fromEntries(Object.entries(saved.sessions || {}).filter(([token, session]) =>
    /^[a-f0-9]{48}$/.test(token) && session && typeof session === 'object' &&
    Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() &&
    db.state.users.some(u => u.id === session.userId && u.credential && !isBotUser(u) && u.deletedAt == null && u.bannedAt == null),
  ));
} catch (err) {
  if (err.code !== 'ENOENT') throw new Error(`Не удалось прочитать базу ${file}: ${err.message}`);
}

const backups = createBackupManager({ dataDirectory: dir });
const drive = createDriveBackupUploader({ dataDirectory: dir, backupDirectory: process.env.BACKUP_DIR || path.join(dir, 'backups'), configFile: process.env.DRIVE_BACKUP_CONFIG || undefined });
export const getBackupStatus = () => ({ ...backups.getStatus(), drive: drive.getStatus() });
function sendOffsite(snapshot) {
  // Remote failure never invalidates a durable local save. Retry on the hourly schedule.
  const upload = snapshot ? drive.enqueueSnapshot(snapshot.file) : drive.retryLatestSnapshot();
  upload.catch(() => {});
}
function scheduledBackup(force = false) {
  if (!fs.existsSync(file)) return;
  try { sendOffsite(backups.create({ force })); }
  catch { console.error('BACKUP_UNAVAILABLE: automatic snapshot failed'); }
}
// Never recover a corrupt database implicitly. Reaching here means the source passed validation.
scheduledBackup(true);
export function startBackupSchedule() {
  const timer = setInterval(() => scheduledBackup(), 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

// Публикуем новое состояние в памяти только после успешной записи файла.
export function commit(next) {
  if (!validState(next?.state)) throw new Error('INVALID_STATE');
  const hadFile = fs.existsSync(file);
  const temporary = path.join(dir, `.db-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    // A due snapshot captures the previous good state before any replacement.
    if (hadFile) { const snapshot = backups.create({ force: false }); if (snapshot) sendOffsite(snapshot); }
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, JSON.stringify(next), { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temporary, file);
  } catch (err) {
    try { fs.unlinkSync(temporary); } catch { /* временный файл мог не создаться */ }
    throw Object.assign(new Error('Не удалось сохранить данные', { cause: err }), {
      code: 'STORAGE_UNAVAILABLE',
    });
  }
  db.state = next.state;
  db.sessions = next.sessions;
  // Initial creation has no previous source. A backup failure cannot undo a successful rename.
  if (!hadFile) scheduledBackup(true);
}
