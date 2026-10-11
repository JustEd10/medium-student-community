import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, renameSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSeed } from '../src/data.js';
import { passwordCredential } from '../src/domain.js';

const fixturePassword = 'isolated-fixture-pass';
const port = 3999;
const base = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), 'medium-'));
let server;
let startupError = '';

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
  const state = createSeed();
  const credential = await passwordCredential(fixturePassword);
  state.users = state.users.map(u => ({ ...u, credential }));
  state.users.push({ ...state.users[0], id: 'legacy-unregistered', email: 'legacy@example.test', credential: null });
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({ state, sessions: {} }));
  writeFileSync(join(dataDir, 'admin-bootstrap.json'), JSON.stringify({ login: 'fixture-moderator', credential }));
  server = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, PORT: port, DATA_DIR: dataDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', chunk => { startupError += chunk; });
  // ждём, пока сервер поднимется (максимум ~6 секунд)
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(base + '/time');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`server did not start: ${startupError}`);
});

after(async () => {
  if (server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
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

test('legacy demo profiles are hidden and cannot authenticate', async () => {
  const state = (await call('/api/app/state')).data.state;
  assert.ok(!state.users.some(u => u.id === 'legacy-unregistered'));
  assert.equal((await post('/api/app/auth/login', {
    email: 'legacy@example.test', password: fixturePassword,
  })).status, 401);
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
  const { data } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'alina').email, password: fixturePassword });
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
  const { data } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'alina').email, password: fixturePassword });
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

test('message receipts: authenticated recipient, viewed boundary, sender refresh and retry deduplication', async () => {
  const { data: sender } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'alina').email, password: fixturePassword });
  const { data: recipient } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'wei').email, password: fixturePassword });
  const { data: outsider } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'maria').email, password: fixturePassword });
  const send = { type: 'sendMessage', args: { chatId: 'c1', body: 'Проверка галочек', clientId: 'api-retry', readAt: 1 } };
  const sent = await post('/api/app/act', send, sender.token);
  assert.equal(sent.status, 200);
  const messages = sent.data.state.chats.find(c => c.id === 'c1').messages;
  const message = messages.at(-1);
  assert.equal(message.readAt, null); // клиент не может подделать прочтение при отправке
  const retry = await post('/api/app/act', send, sender.token);
  assert.equal(retry.data.state.chats.find(c => c.id === 'c1').messages.length, messages.length);
  assert.equal((await post('/api/app/act', { ...send, args: { ...send.args, body: 'Подмена' } }, sender.token)).status, 400);
  const later = await post('/api/app/act', { type: 'sendMessage', args: { chatId: 'c1', body: 'После просмотра' } }, sender.token);
  const laterId = later.data.state.chats.find(c => c.id === 'c1').messages.at(-1).id;
  const receipt = { type: 'markChatRead', args: { chatId: 'c1', throughId: message.id } };
  assert.equal((await post('/api/app/act', receipt)).status, 401);
  assert.equal((await post('/api/app/act', receipt, outsider.token)).status, 403);
  assert.equal((await post('/api/app/act', { ...receipt, args: { chatId: 'c1', throughId: 'missing' } }, recipient.token)).status, 404);
  assert.equal((await post('/api/app/act', receipt, recipient.token)).status, 200);
  const refreshed = (await call('/api/app/state', { token: sender.token })).data.state.chats.find(c => c.id === 'c1');
  const readAt = refreshed.messages.find(m => m.id === message.id).readAt;
  assert.ok(Number.isFinite(readAt) && readAt >= message.createdAt);
  assert.equal(refreshed.messages.find(m => m.id === laterId).readAt, null);
  assert.equal(refreshed.messages.find(m => m.id === 'm1').readAt, undefined);
  const repeated = await post('/api/app/act', receipt, recipient.token);
  assert.equal(repeated.data.state.chats.find(c => c.id === 'c1').messages.find(m => m.id === message.id).readAt, readAt);
  assert.equal((await call('/api/app/state')).data.state.chats.length, 0);
});

test('failed disk write returns 503 and keeps the previous state', async () => {
  const { data } = await post('/api/app/auth/login', { email: createSeed().users.find(u => u.id === 'alina').email, password: fixturePassword });
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

test('moderation boundaries, cascades, recovery and permanent session revocation', async () => {
  const register = async name => (await post('/api/app/auth/register', { name: `${name} Тестовый`, email: `${name}@example.test`, password: fixturePassword, role: 'admin' })).data;
  const owner = await register('owner');
  const other = await register('other');
  assert.equal(owner.state.users.find(u => u.id === owner.me).role, 'user');
  const admin = (await post('/api/app/auth/login', { identity: 'fixture-moderator', password: fixturePassword })).data;
  assert.ok(admin.token);
  const act = (session, type, args) => post('/api/app/act', { type, args }, session.token);
  const question = await act(owner, 'addQuestion', { title: 'Тестовый вопрос владельца', body: '', category: 'Кампус' });
  const qid = question.data.id;
  const answered = await act(other, 'addAnswer', { questionId: qid, body: 'Тестовый ответ' });
  const aid = answered.data.state.answers.find(a => a.questionId === qid).id;
  assert.equal((await act(owner, 'deleteContent', { kind: 'answer', id: aid })).status, 403);
  assert.equal((await act(other, 'deleteContent', { kind: 'question', id: qid })).status, 403);
  assert.equal((await act(other, 'deleteContent', { kind: 'answer', id: aid })).status, 200);
  assert.equal((await act(owner, 'restoreContent', { kind: 'answer', id: aid })).status, 403);
  assert.equal((await act(other, 'restoreContent', { kind: 'answer', id: aid })).status, 200);
  const removed = await act(owner, 'deleteContent', { kind: 'question', id: qid });
  assert.ok(!removed.data.state.answers.some(a => a.id === aid));
  assert.equal((await act(other, 'addAnswer', { questionId: qid, body: 'Новый ответ' })).status, 404);
  const restored = await act(owner, 'restoreContent', { kind: 'question', id: qid });
  assert.ok(restored.data.state.answers.some(a => a.id === aid));
  assert.equal((await act(other, 'deleteContent', { kind: 'user', id: owner.me })).status, 403);
  const opened = await act(owner, 'openChat', { partner: other.me });
  const cid = opened.data.id;
  const sent = await act(owner, 'sendMessage', { chatId: cid, body: 'Приватный тестовый текст' });
  const mid = sent.data.state.chats.find(c => c.id === cid).messages[0].id;
  assert.equal((await act(other, 'deleteContent', { kind: 'message', id: mid })).status, 403);
  assert.equal((await act(admin, 'deleteContent', { kind: 'message', id: mid })).status, 200);
  const help = await act(owner, 'addHelp', { subject: 'Тест', body: 'Нужна тестовая помощь' });
  const hid = help.data.state.helpRequests.find(h => h.authorId === owner.me).id;
  assert.equal((await act(other, 'deleteContent', { kind: 'help', id: hid })).status, 403);
  assert.equal((await act(admin, 'deleteContent', { kind: 'help', id: hid })).status, 200);
  assert.equal((await act(admin, 'deleteContent', { kind: 'answer', id: aid })).status, 200);
  assert.equal((await act(admin, 'deleteContent', { kind: 'question', id: qid })).status, 200);
  assert.equal((await act(admin, 'restoreContent', { kind: 'question', id: qid })).status, 200);
  assert.equal((await act(admin, 'deleteContent', { kind: 'user', id: owner.me })).status, 200);
  assert.equal((await act(owner, 'addQuestion', {})).status, 401);
  assert.equal((await post('/api/app/auth/login', { email: 'owner@example.test', password: fixturePassword })).status, 401);
  const publicData = (await call('/api/app/state')).data.state;
  assert.ok(!publicData.users.some(u => u.id === owner.me));
  assert.ok(!publicData.questions.some(q => q.id === qid));
  assert.deepEqual(publicData.trash, []);
  assert.ok(publicData.users.every(u => !('login' in u) && !('credential' in u) && u.email === ''));
  assert.equal((await act(admin, 'restoreContent', { kind: 'user', id: owner.me })).status, 200);
  assert.equal((await act(owner, 'addQuestion', {})).status, 401);
  assert.equal((await post('/api/app/auth/login', { email: 'owner@example.test', password: fixturePassword })).status, 200);
  assert.equal((await post('/api/app/auth/demo', { id: 'alina' })).status, 404);
});


test('bans revoke sessions and allow amnesty with fresh login', async () => {
  const account = { name: 'Ban Boundary', email: 'ban-boundary@example.test', password: fixturePassword };
  const user = (await post('/api/app/auth/register', account)).data;
  const admin = (await post('/api/app/auth/login', { identity: 'fixture-moderator', password: fixturePassword })).data;
  const action = (session, type, args) => post('/api/app/act', { type, args }, session?.token);
  const args = { id: user.me, banned: true };
  assert.equal((await action(null, 'setUserBan', args)).status, 401);
  assert.equal((await action(user, 'setUserBan', args)).status, 403);
  assert.equal((await action(admin, 'setUserBan', { id: admin.me, banned: true })).status, 403);
  const question = await action(user, 'addQuestion', { title: 'Preserved during account ban', body: '', category: 'Кампус' });
  assert.equal((await action(admin, 'setUserBan', args)).status, 200);
  assert.equal((await action(user, 'setStudyHelpVisibility', { visible: false })).status, 401);
  assert.equal((await post('/api/app/auth/login', account)).status, 401);
  assert.ok(!(await call('/api/app/state')).data.state.questions.some(q => q.id === question.data.id));
  assert.equal((await action(admin, 'setUserBan', { ...args, banned: false })).status, 200);
  assert.equal((await action(user, 'setStudyHelpVisibility', { visible: false })).status, 401);
  const fresh = (await post('/api/app/auth/login', account)).data;
  assert.ok(fresh.token);
  assert.ok(fresh.state.questions.some(q => q.id === question.data.id));
  assert.equal((await action(fresh, 'setStudyHelpVisibility', { visible: false })).status, 200);
});


test('assistant requires an active account, bounds requests and isolates unavailable provider', async () => {
  assert.equal((await post('/api/app/assistant', { question: 'Где расписание?' })).status, 401);
  const user = (await post('/api/app/auth/register', { email: 'ai-fixture@example.test', password: fixturePassword, name: 'AI Fixture' })).data;
  assert.ok(user.token);
  assert.equal((await post('/api/app/assistant', { question: 'x'.repeat(2201) }, user.token)).status, 400);
  assert.equal((await post('/api/app/assistant', { question: 'Где найти расписание?' }, user.token)).data.error, 'AI_NOT_CONFIGURED');
  const created = await post('/api/app/act', { type: 'addQuestion', args: { title: 'Где найти расписание РЭУ?', body: '', category: 'Учёба', autoAI: true } }, user.token);
  assert.equal(created.status, 200);
  let q;
  for (let i = 0; i < 10; i++) {
    q = (await call('/api/app/state', { token: user.token })).data.state.questions.find(x => x.id === created.data.id);
    if (q.aiResponse?.status === 'error') break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal(q.aiResponse.error, 'AI_NOT_CONFIGURED');
  const admin = (await post('/api/app/auth/login', { email: 'fixture-moderator', password: fixturePassword })).data;
  await post('/api/app/act', { type: 'setUserBan', args: { id: user.me, banned: true } }, admin.token);
  assert.equal((await post('/api/app/assistant', { question: 'Где расписание?' }, user.token)).status, 401);
});
