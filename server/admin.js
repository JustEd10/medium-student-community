import fs from 'node:fs';
import path from 'node:path';
import { db, commit, dataDirectory } from './store.js';
import { uid, validState } from '../src/domain.js';

// Этот файл конфигурации хранится только в закрытом постоянном хранилище.
export function provisionAdministrator() {
  if (db.state.users.some(u => u.role === 'admin' && u.deletedAt == null)) return;
  let configuration;
  try {
    configuration = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'admin-bootstrap.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw new Error('Не удалось прочитать закрытую конфигурацию администратора');
  }
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration))
    throw new Error('Некорректная конфигурация администратора');
  if (typeof configuration.login !== 'string' || !configuration.login.trim() || configuration.login.length > 100)
    throw new Error('Некорректная конфигурация администратора');
  const login = configuration.login.trim().toLowerCase();
  if (db.state.users.some(u => u.login?.toLowerCase() === login || u.email.toLowerCase() === login))
    throw new Error('Идентификатор администратора уже занят');
  const user = {
    id: uid(), role: 'admin', login: configuration.login.trim().toLowerCase(),
    credential: configuration.credential, firstName: 'Администратор', lastName: 'Медиума',
    email: '', direction: '', course: 1, languages: ['Русский'], interests: [], skills: [], about: '', color: 0,
  };
  const state = { ...db.state, users: [...db.state.users, user] };
  if (!user.credential || !validState(state)) throw new Error('Некорректная конфигурация администратора');
  commit({ state, sessions: db.sessions });
}
