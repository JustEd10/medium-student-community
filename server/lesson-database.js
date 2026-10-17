import fs from 'node:fs';
import crypto from 'node:crypto';
import { seedUsers, seedItems, seedRecords } from './data.js';

export function transaction(sql, operation) {
  sql.exec('BEGIN IMMEDIATE');
  try { const result = operation(); sql.exec('COMMIT'); return result; }
  catch (error) { sql.exec('ROLLBACK'); throw error; }
}

export function createLessonStore(sql, { beforeWrite = () => {}, seed = true } = {}) {
  sql.exec(fs.readFileSync(new URL('./migrations/002-lesson.sql', import.meta.url), 'utf8'));
  sql.function('casefold', { deterministic: true }, value => String(value).toLocaleLowerCase('ru'));
  const write = operation => { beforeWrite(); return transaction(sql, operation); };
  if (seed && !sql.prepare("SELECT 1 FROM lesson_meta WHERE key = 'initialized'").get()) {
    write(() => {
      const user = sql.prepare('INSERT INTO lesson_users(login,salt,password_hash,role) VALUES (?,?,?,?)');
      for (const fixture of seedUsers) {
        const salt = crypto.randomBytes(16).toString('hex');
        user.run(fixture.login, salt, crypto.scryptSync(fixture.password, salt, 64).toString('hex'), fixture.role);
      }
      const id = login => sql.prepare('SELECT id FROM lesson_users WHERE login=?').get(login).id;
      for (const i of seedItems) sql.prepare('INSERT INTO lesson_items(id,author_id,title,body,category,created_at) VALUES (?,?,?,?,?,?)')
        .run(i.id, id(i.author), i.title, i.body, i.category, i.createdAt);
      for (const r of seedRecords) sql.prepare('INSERT INTO lesson_records(id,item_id,author_id,body,rating,created_at) VALUES (?,?,?,?,?,?)')
        .run(r.id, r.item_id, id(r.author), r.body, r.rating, r.createdAt);
      sql.prepare("INSERT INTO lesson_meta VALUES ('initialized','1')").run();
    });
  }
  const itemSelect = `SELECT i.id, i.title, i.body, i.category, u.login AS author, i.created_at AS createdAt,
    (SELECT count(*) FROM lesson_records r WHERE r.item_id=i.id) AS answersCount
    FROM lesson_items i JOIN lesson_users u ON u.id=i.author_id`;
  const recordSelect = `SELECT r.id, r.item_id, u.login AS author, r.body, r.rating, r.created_at AS createdAt,
    i.title AS item_title FROM lesson_records r JOIN lesson_items i ON i.id=r.item_id
    JOIN lesson_users u ON u.id=r.author_id`;
  const bodyLength = item => item && { ...item, bodyLength: item.body.length };
  return {
    login(login, password) {
      if (typeof login !== 'string' || typeof password !== 'string' || password.length > 128) return null;
      const u = sql.prepare('SELECT * FROM lesson_users WHERE login=?').get(login);
      if (!u || !crypto.timingSafeEqual(crypto.scryptSync(password, u.salt, 64), Buffer.from(u.password_hash, 'hex'))) return null;
      const token = crypto.randomBytes(16).toString('hex');
      write(() => {
        sql.prepare('DELETE FROM lesson_sessions WHERE expires_at<=?').run(Date.now());
        sql.prepare('INSERT INTO lesson_sessions VALUES (?,?,?)').run(token, u.id, Date.now() + 7 * 86400000);
      });
      return { token, login: u.login, role: u.role };
    },
    userForToken(token) {
      return sql.prepare(`SELECT u.id,u.login,u.role FROM lesson_sessions s JOIN lesson_users u ON u.id=s.user_id
        WHERE s.token=? AND s.expires_at>?`).get(token, Date.now()) || null;
    },
    logout(token) { write(() => sql.prepare('DELETE FROM lesson_sessions WHERE token=?').run(token)); },
    items({ category, search, author, sort } = {}) {
      const where = [], args = [];
      for (const [field, value] of [['i.category', category], ['u.login', author]]) if (value) { where.push(`${field}=?`); args.push(value); }
      if (search) { where.push("instr(casefold(i.title || ' ' || i.body),?)>0"); args.push(search.toLocaleLowerCase('ru')); }
      return sql.prepare(itemSelect + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        (sort === 'answers' ? ' ORDER BY answersCount DESC, i.id DESC' : ' ORDER BY i.created_at DESC, i.id DESC')).all(...args).map(bodyLength);
    },
    item(id) { return bodyLength(sql.prepare(itemSelect + ' WHERE i.id=?').get(id)); },
    addItem(input, actor) {
      return write(() => {
        const result = sql.prepare('INSERT INTO lesson_items(author_id,title,body,category,created_at) VALUES (?,?,?,?,?)')
          .run(actor.id, input.title, input.body, input.category, new Date().toISOString());
        return this.item(Number(result.lastInsertRowid));
      });
    },
    updateItem(id, input) {
      return write(() => { sql.prepare('UPDATE lesson_items SET title=?,body=?,category=? WHERE id=?').run(input.title, input.body, input.category, id); return this.item(id); });
    },
    deleteItem(id) {
      return write(() => {
        sql.prepare('DELETE FROM lesson_records WHERE item_id=?').run(id);
        sql.prepare('DELETE FROM lesson_items WHERE id=?').run(id);
      });
    },
    records({ item_id, author } = {}) {
      const where = [], args = [];
      if (item_id !== undefined) { where.push('r.item_id=?'); args.push(item_id); }
      if (author) { where.push('u.login=?'); args.push(author); }
      return sql.prepare(recordSelect + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY r.id').all(...args);
    },
    record(id) { return sql.prepare(recordSelect + ' WHERE r.id=?').get(id); },
    addRecord(input, actor) {
      return write(() => {
        const result = sql.prepare('INSERT INTO lesson_records(item_id,author_id,body,rating,created_at) VALUES (?,?,?,NULL,?)')
          .run(input.item_id, actor.id, input.body, new Date().toISOString());
        return this.record(Number(result.lastInsertRowid));
      });
    },
    rateRecord(id, rating) {
      return write(() => { sql.prepare('UPDATE lesson_records SET rating=? WHERE id=?').run(rating, id); return this.record(id); });
    },
    ranking() {
      return sql.prepare(`SELECT u.login, coalesce(sum(r.rating),0) AS total, count(r.rating) AS count,
        coalesce(round(avg(r.rating),2),0) AS average FROM lesson_users u LEFT JOIN lesson_records r ON r.author_id=u.id
        GROUP BY u.id ORDER BY total DESC,count DESC,u.id`).all();
    },
  };
}

const tables = ['lesson_users', 'lesson_items', 'lesson_records', 'lesson_meta'];
export function exportLesson(sql) {
  if (!sql.prepare("SELECT 1 FROM sqlite_master WHERE name='lesson_meta'").get()) return undefined;
  return Object.fromEntries(tables.map(table => [table, sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row }))]));
}
export function importLesson(sql, lesson) {
  if (!lesson) return;
  createLessonStore(sql, { seed: false });
  transaction(sql, () => {
    for (const table of ['lesson_sessions', ...tables.toReversed()]) sql.exec(`DELETE FROM ${table}`);
    for (const table of tables) {
      if (!Array.isArray(lesson[table])) throw new Error('INVALID_LESSON_BACKUP');
      const columns = sql.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
      const insert = sql.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
      for (const row of lesson[table]) {
        if (Object.keys(row).length !== columns.length) throw new Error('INVALID_LESSON_BACKUP');
        insert.run(...columns.map(c => row[c]));
      }
    }
  });
}
