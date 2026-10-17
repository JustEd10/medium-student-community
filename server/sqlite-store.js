import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createEmptyState } from '../src/data.js';
import { validState } from '../src/domain.js';
import { isBotUser, BOT_PERSONAS } from '../src/bot-personas.js';

const migration = fs.readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8');
// Required domain properties live in columns. Optional properties retain absence/null
// semantics in per-entity extras, without duplicating the normalized relationships.
const definitions = {
 users: ['users', { id:'id', firstName:'first_name', lastName:'last_name', direction:'direction', about:'about', email:'email', course:'course', languages:'languages', interests:'interests', skills:'skills', credential:'credential' }],
 questions: ['questions', { id:'id', authorId:'author_id', title:'title', body:'body', category:'category', createdAt:'created_at' }],
 answers: ['answers', { id:'id', questionId:'question_id', authorId:'author_id', body:'body', rating:'rating', createdAt:'created_at' }],
 helpRequests: ['help_requests', { id:'id', authorId:'author_id', subject:'subject', body:'body', helperId:'helper_id', status:'status', rating:'rating', createdAt:'created_at' }],
 chats: ['chats', { id:'id' }],
};
const optionalCollections = new Set(['reports','aiFeedback','appeals','moderationLog']);
for (const [key, table] of [['reports','reports'],['aiFeedback','ai_feedback'],['appeals','appeals']]) {
 definitions[key] = [table, {id:'id',authorId:'author_id',reviewerId:'reviewer_id',key:'key',reason:'reason',status:'status',createdAt:'created_at',reviewedAt:'reviewed_at',decision:'decision'}, ['reviewerId','reviewedAt','decision']];
}
definitions.moderationLog = ['moderation_log', {id:'id',actorId:'actor_id',action:'action',target:'target',reason:'reason',createdAt:'created_at'}];
const jsonFields = new Set(['languages','interests','skills','credential']);
const extras = (row, keys) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key))));
function restoredSessions(state, sessions) {
 return Object.fromEntries(Object.entries(sessions || {}).filter(([token, s]) =>
  /^[a-f0-9]{48}$/.test(token) && s && typeof s === 'object' && Number.isFinite(s.expiresAt) && s.expiresAt > Date.now() &&
  state.users.some(u => u.id === s.userId && u.credential && !isBotUser(u) && u.deletedAt == null && u.bannedAt == null)));
}
// Persona constants are application-controlled, never request input.
const quote = value => `'${value.replaceAll("'", "''")}'`;
const botSql = alias => '(' + BOT_PERSONAS.map(p => `(${alias}.id=${quote(p.id)} AND json_extract(${alias}.extras,'$.botPersona')=${quote(p.persona)})`).join(' OR ') + ')';
function adapter(sql) {
 function write({state, sessions = {}}, { beforeCommit } = {}) {
  if (!validState(state)) throw new Error('INVALID_STATE');
  sql.exec('BEGIN IMMEDIATE');
  try {
   // Deliberately never touch teaching/example tables sharing this database.
   for (const table of ['reports','ai_feedback','appeals','moderation_log','sessions','messages','chat_members','help_offers','answers','questions','help_requests','chats','users','metadata']) sql.exec(`DELETE FROM ${table}`);
   const meta = sql.prepare('INSERT INTO metadata(key,value) VALUES (?,?)');
   for (const [key,value] of Object.entries(state)) if (!Object.hasOwn(definitions,key) && value !== undefined) meta.run(key, JSON.stringify(value));
   // A marker distinguishes absent optional collections from explicitly empty arrays.
   for (const key of optionalCollections) if (state[key] !== undefined) meta.run(key,'null');
   for (const [key,[table,fields,optional = []]] of Object.entries(definitions)) {
    if (optionalCollections.has(key) && state[key] === undefined) continue;
    const keys = Object.keys(fields);
    const omit = [...keys, ...(key === 'chats' ? ['members','messages'] : key === 'helpRequests' ? ['helpers'] : [])];
    const columns = [...Object.values(fields),'position','extras', ...(optional.length ? ['present_fields'] : [])];
    const insert = sql.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
    state[key].forEach((row,index) => insert.run(...keys.map(k => jsonFields.has(k) ? JSON.stringify(row[k]) : row[k] ?? null), index, extras(row,omit), ...(optional.length ? [JSON.stringify(optional.filter(k => Object.hasOwn(row,k)))] : [])));
   }
   const offer = sql.prepare('INSERT INTO help_offers(help_id,position,user_id) VALUES (?,?,?)');
   for (const h of state.helpRequests) h.helpers.forEach((id,index) => offer.run(h.id,index,id));
   const member = sql.prepare('INSERT INTO chat_members(chat_id,user_id,position) VALUES (?,?,?)');
   const message = sql.prepare('INSERT INTO messages(chat_id,id,position,sender_id,body,created_at,extras) VALUES (?,?,?,?,?,?,?)');
   for (const c of state.chats) {
    c.members.forEach((id,index) => member.run(c.id,id,index));
    c.messages.forEach((m,index) => message.run(c.id,m.id,index,m.senderId,m.body,m.createdAt,extras(m,['id','senderId','body','createdAt'])));
   }
   const session = sql.prepare('INSERT INTO sessions(token,user_id,expires_at,extras) VALUES (?,?,?,?)');
   for (const [token,s] of Object.entries(restoredSessions(state,sessions))) session.run(token,s.userId,s.expiresAt,extras(s,['userId','expiresAt']));
   if (beforeCommit) beforeCommit(sql);
   sql.exec('COMMIT');
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
 }
 function read() {
  // A snapshot also prevents mixing collections across concurrent connections.
  sql.exec('BEGIN');
  try {
   const state = Object.fromEntries(sql.prepare('SELECT key,value FROM metadata').all().map(r => [r.key,JSON.parse(r.value)]));
   for (const [key,[table,fields,optional = []]] of Object.entries(definitions)) {
    if (optionalCollections.has(key) && !Object.hasOwn(state,key)) continue;
    state[key] = sql.prepare(`SELECT * FROM ${table} ORDER BY position`).all().map(row => ({
     ...JSON.parse(row.extras), ...Object.fromEntries(Object.entries(fields).filter(([k]) => !optional.includes(k) || JSON.parse(row.present_fields).includes(k)).map(([k,col]) => [k,jsonFields.has(k) ? JSON.parse(row[col]) : row[col]])),
    }));
   }
   const offers = sql.prepare('SELECT user_id FROM help_offers WHERE help_id=? ORDER BY position');
   for (const h of state.helpRequests) h.helpers = offers.all(h.id).map(r => r.user_id);
   const members = sql.prepare('SELECT user_id FROM chat_members WHERE chat_id=? ORDER BY position');
   const messages = sql.prepare('SELECT * FROM messages WHERE chat_id=? ORDER BY position');
   for (const c of state.chats) {
    c.members = members.all(c.id).map(r => r.user_id);
    c.messages = messages.all(c.id).map(m => ({...JSON.parse(m.extras),id:m.id,senderId:m.sender_id,body:m.body,createdAt:m.created_at}));
   }
   if (!validState(state)) throw new Error('INVALID_SQLITE_STATE');
   const sessions = Object.fromEntries(sql.prepare('SELECT * FROM sessions').all().map(s => [s.token,{...JSON.parse(s.extras),userId:s.user_id,expiresAt:s.expires_at}]));
   sql.exec('COMMIT');
   return {state,sessions:restoredSessions(state,sessions)};
  } catch (error) { sql.exec('ROLLBACK'); throw error; }
 }
 return {sql,write,read,close:() => sql.close(),questionAnswers(questionId) {
  return sql.prepare(`SELECT a.id, a.question_id AS questionId, a.author_id AS authorId, a.body, a.rating,
   a.created_at AS createdAt, trim(u.first_name || ' ' || u.last_name) AS authorName, q.title AS questionTitle
   FROM answers a JOIN users u ON u.id=a.author_id JOIN questions q ON q.id=a.question_id
   JOIN users owner ON owner.id=q.author_id
   WHERE a.question_id=? AND json_extract(a.extras,'$.deletedAt') IS NULL
   AND json_extract(q.extras,'$.deletedAt') IS NULL AND json_extract(u.extras,'$.deletedAt') IS NULL
   AND json_extract(u.extras,'$.bannedAt') IS NULL AND json_extract(owner.extras,'$.deletedAt') IS NULL
   AND json_extract(owner.extras,'$.bannedAt') IS NULL
   AND (u.credential != 'null' OR ${botSql('u')})
   AND (owner.credential != 'null' OR ${botSql('owner')}) ORDER BY a.position`).all(questionId).map(row => ({...row}));
 }};
}
function connect(file) {
 const sql = new DatabaseSync(file);
 try {
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return sql;
 } catch (error) { sql.close(); throw error; }
}
export function openSqliteStore({file, legacyFile}) {
 let sql;
 let temporary;
 try {
  if (!fs.existsSync(file)) {
   let initial = {state:createEmptyState(),sessions:{}};
   if (legacyFile && fs.existsSync(legacyFile)) {
    initial = JSON.parse(fs.readFileSync(legacyFile,'utf8'));
    if (!validState(initial?.state)) throw new Error('INVALID_LEGACY_STATE');
   }
   fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
   temporary = `${file}.${crypto.randomUUID()}.tmp`;
   fs.writeFileSync(temporary,'',{flag:'wx',mode:0o600});
   sql = connect(temporary);
   sql.exec(migration);
   adapter(sql).write(initial);
   adapter(sql).read();
   sql.close(); sql = undefined;
   // Publish only a fully validated SQLite file; never alter the legacy JSON.
   fs.renameSync(temporary,file); temporary = undefined;
  }
  sql = connect(file);
  if (sql.prepare('PRAGMA user_version').get().user_version !== 1 ||
      sql.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
      sql.prepare('PRAGMA foreign_key_check').all().length) throw new Error('INVALID_SQLITE_DATABASE');
  const store = adapter(sql);
  store.read();
  fs.chmodSync(file,0o600);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  return store;
 } catch (error) {
  if (sql) { try { sql.close(); } catch {} }
  if (temporary) { for (const suffix of ['', '-wal', '-shm', '-journal']) { try { fs.unlinkSync(temporary + suffix); } catch {} } }
  throw error;
 }
}
