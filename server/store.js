import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createInitialState } from '../src/data.js';
import { validState } from '../src/domain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.DATA_DIR || path.join(__dirname, 'storage');
const file = path.join(dir, 'db.json');

export const db = { state: createInitialState(), sessions: {} };

try {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!validState(saved.state)) throw new Error('Сохранённое состояние повреждено');
  db.state = saved.state;
  // Старые бессрочные токены не восстанавливаем; аккаунты и записи сохраняются.
  db.sessions = Object.fromEntries(Object.entries(saved.sessions || {}).filter(([token, session]) =>
    /^[a-f0-9]{48}$/.test(token) && session && typeof session === 'object' &&
    Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() &&
    db.state.users.some(u => u.id === session.userId),
  ));
} catch (err) {
  if (err.code !== 'ENOENT') throw new Error(`Не удалось прочитать базу ${file}: ${err.message}`);
}

// Публикуем новое состояние в памяти только после успешной записи файла.
export function commit(next) {
  const temporary = path.join(dir, `.db-${process.pid}-${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
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
}
