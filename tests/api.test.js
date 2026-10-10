import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 3999;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'medium-'));
let server;

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const post = (path, body, token) => call(path, { method: 'POST', body, token });

before(async () => {
  server = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: port, DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  // ждём, пока сервер поднимется (максимум ~6 секунд)
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(base + '/time');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('server did not start');
});

after(async () => {
  const exited = once(server, 'exit');
  server.kill();
  await exited;
  rmSync(dataDir, { recursive: true, force: true });
});

test('invalid JSON and non-object bodies get HTTP errors', async () => {
  for (const [body, expected] of [['{broken', 400], ['[]', 400], [JSON.stringify({ body: 'x'.repeat(110000) }), 413]]) {
    const res = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(res.status, expected);
    assert.equal(typeof (await res.json()).error, 'string');
  }
});

test('Bearer header is required and logout revokes a token without a body', async () => {
  const { data } = await post('/api/login', { login: 'user', password: 'qwerty' });
  for (const header of [data.token, `Basic ${data.token}`, `Bearer ${data.token} extra`]) {
    const res = await fetch(base + '/api/records/my', { headers: { Authorization: header } });
    assert.equal(res.status, 401);
  }
  const lower = await fetch(base + '/api/records/my', { headers: { Authorization: `bearer ${data.token}` } });
  assert.equal(lower.status, 200);
  assert.equal((await post('/api/logout', undefined, data.token)).status, 200);
  assert.equal((await call('/api/records/my', { token: data.token })).status, 401);
});

test('parallel registration cannot create two users with the same email', async () => {
  const input = { name: 'Анна Тестовая', email: 'parallel@example.com', password: 'longpassword123' };
  const results = await Promise.all([post('/api/app/auth/register', input), post('/api/app/auth/register', input)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const created = results.find(r => r.status === 201);
  assert.equal(created.data.state.users.filter(u => u.email === input.email).length, 1);
  assert.ok(created.data.me && created.data.token);
  assert.equal(created.data.state.chats.length, 0);
});

test('private chats are filtered and API responses cannot be cached', async () => {
  const { data } = await post('/api/app/auth/demo', { id: 'alina' });
  const res = await fetch(base + '/api/app/state', { headers: { Authorization: `Bearer ${data.token}` } });
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('vary'), /Authorization/);
  const own = await res.json();
  assert.ok(own.state.chats.length > 0);
  assert.ok(own.state.chats.every(c => c.members.includes('alina')));
  assert.ok(own.state.users.every(u => !Object.hasOwn(u, 'credential') && (u.id === 'alina' || u.email === '')));
  assert.equal((await call('/api/app/state')).data.state.chats.length, 0);
  await post('/api/app/auth/logout', undefined, data.token);
  assert.equal((await call('/api/app/state', { token: data.token })).data.me, null);
});

test('wrong types and oversized text are rejected without changing server state', async () => {
  const { data } = await post('/api/app/auth/demo', { id: 'alina' });
  const beforeState = (await call('/api/app/state', { token: data.token })).data.state;
  const actions = [
    { type: 'addQuestion', args: { title: 'x'.repeat(181), body: '', category: 'Кампус' } },
    { type: 'addQuestion', args: { title: { title: 'Неверный объект' }, body: '', category: 'Кампус' } },
    { type: 'rateAnswer', args: { answerId: 'a1', value: true } },
    { type: 'saveProfile', args: { ...beforeState.users.find(u => u.id === 'alina'), course: true } },
    { type: 'toString', args: {} },
    { type: 'addQuestion', args: [] },
  ];
  for (const action of actions) assert.equal((await post('/api/app/act', action, data.token)).status, 400);
  assert.deepEqual((await call('/api/app/state', { token: data.token })).data.state, beforeState);
});

test('failed disk write returns 503 and keeps the previous state', async () => {
  const { data } = await post('/api/app/auth/demo', { id: 'alina' });
  const beforeState = (await call('/api/app/state', { token: data.token })).data.state;
  const backup = dataDir + '-backup';
  renameSync(dataDir, backup);
  writeFileSync(dataDir, 'not a directory');
  try {
    const result = await post('/api/app/act', {
      type: 'addQuestion', args: { title: 'Вопрос при недоступном диске', body: '', category: 'Кампус' },
    }, data.token);
    assert.equal(result.status, 503);
    assert.equal(result.data.error, 'STORAGE_UNAVAILABLE');
    assert.deepEqual((await call('/api/app/state', { token: data.token })).data.state, beforeState);
  } finally {
    rmSync(dataDir);
    renameSync(backup, dataDir);
  }
  assert.equal((await post('/api/app/act', {
    type: 'addQuestion', args: { title: 'Запись после восстановления диска', body: '', category: 'Кампус' },
  }, data.token)).status, 200);
});

test('hello, time, random, demo list', async () => {
  const hello = await fetch(base + '/hello');
  assert.equal(await hello.text(), 'Привет, это сервер моего сайта');

  assert.ok((await call('/time')).data.time);
  const { random } = (await call('/random')).data;
  assert.ok(random >= 1 && random <= 100);

  const demo = (await call('/api/demo')).data;
  assert.equal(demo.length, 3);
  assert.ok(demo.every((d) => d.id && d.title && d.price));
});

test('items: protected write, validation, delete', async () => {
  const payload = {
    title: 'Где находится библиотека?',
    body: 'Нужен читательский',
    category: 'Кампус',
  };
  assert.equal((await post('/api/items', payload)).status, 401);

  const { data: login } = await post('/api/login', { login: 'user', password: 'qwerty' });
  assert.ok(login.token);
  const wrong = await post('/api/login', { login: 'user', password: 'x' });
  assert.equal(wrong.status, 401);

  const short = await post('/api/items', { ...payload, title: 'коротко' }, login.token);
  assert.equal(short.status, 400);
  const created = await post('/api/items', payload, login.token);
  assert.equal(created.status, 201);

  const id = created.data.id;
  assert.equal((await call(`/api/items/${id}`)).data.title, payload.title);
  const removed = await call(`/api/items/${id}`, { method: 'DELETE', token: login.token });
  assert.equal(removed.status, 200);
  assert.equal((await call(`/api/items/${id}`)).status, 404);
});

test('records: item title is joined, my records are filtered', async () => {
  const { data: login } = await post('/api/login', { login: 'wei', password: 'wei2026' });

  const noItem = await post('/api/records', { item_id: 999, body: 'Ответ на вопрос' }, login.token);
  assert.equal(noItem.status, 400);

  const created = await post('/api/records', { item_id: 2, body: 'Ответ на вопрос' }, login.token);
  assert.equal(created.status, 201);
  assert.ok(created.data.item_title);

  const mine = await call('/api/records/my', { token: login.token });
  assert.ok(mine.data.length >= 1 && mine.data.every((r) => r.author === 'wei'));
});

test('site api: register, ask a question, no password leaks', async () => {
  const ivan = { name: 'Иван Петров', email: 'ivan@example.com', password: 'password123' };
  const reg = await post('/api/app/auth/register', ivan);
  assert.equal(reg.status, 201);
  assert.equal((await post('/api/app/auth/register', ivan)).status, 409);

  const badLogin = await post('/api/app/auth/login', {
    email: 'ivan@example.com',
    password: 'bad-password',
  });
  assert.equal(badLogin.status, 401);

  const question = {
    type: 'addQuestion',
    args: { title: 'Как получить пропуск?', body: '', category: 'Кампус' },
  };
  const act = await post('/api/app/act', question, reg.data.token);
  assert.equal(act.status, 200);
  assert.ok(act.data.id);
  // без токена действие не проходит
  assert.equal((await post('/api/app/act', { type: 'addQuestion', args: {} })).status, 401);

  const state = await call('/api/app/state', { token: reg.data.token });
  assert.ok(!JSON.stringify(state.data).includes('credential'));
  assert.ok(state.data.state.questions.some((q) => q.id === act.data.id));
});
