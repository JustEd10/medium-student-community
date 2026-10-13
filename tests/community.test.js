import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { passwordCredential } from '../src/domain.js';
import { loadKnowledge, validateKnowledgeOverride } from '../server/knowledge-store.js';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'medium-community-'));
process.env.DATA_DIR = dir;
const { db, commit } = await import('../server/store.js');
const { createCommunityRouter } = await import('../server/community.js');
test('community boundaries, decisions, appeal identity and persisted directory', async () => {
  const credential = await passwordCredential('Test-only-Password-123');
  const users = ['user', 'other', 'admin', 'banned'].map(id => ({ id, firstName: 'Тест', lastName: 'Тестов', direction: '', about: '', course: 1, languages: [], interests: [], skills: [], login: id, email: `${id}@example.test`, credential, role: id === 'admin' ? 'admin' : 'user', ...(id === 'banned' ? { bannedAt: 123, bannedBy: 'admin' } : {}) }));
  commit({ state: { ...db.state, users, questions: [{ id: 'q', authorId: 'other', title: 'Вопрос', body: '', category: 'Учёба', createdAt: 1 }, { id: 'hidden', authorId: 'banned', title: 'Вопрос', body: '', category: 'Учёба', createdAt: 1 }], answers: [], helpRequests: [] }, sessions: Object.fromEntries(users.map(u => [u.id, { userId: u.id, expiresAt: Date.now() + 60000 }])) });
  const app = express(); app.use(express.json()); app.use('/community', createCommunityRouter());
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/community`;
  async function request(url, token, method = 'GET', body) { const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: await res.json() }; }
  try {
    assert.equal((await request('/admin')).status, 401);
    assert.equal((await request('/admin', 'user')).status, 403);
    assert.equal((await request('/admin', 'banned')).status, 401);
    assert.equal((await request('/reports', 'user', 'POST', { kind: 'chat', id: 'private', reason: 'Private chat' })).status, 404);
    assert.equal((await request('/reports', 'user', 'POST', { kind: 'question', id: 'hidden', reason: 'Hidden item' })).status, 404);
    const report = { kind: 'question', id: 'q', reason: 'Проверить содержание' };
    const first = await request('/reports', 'user', 'POST', report);
    const duplicate = await request('/reports', 'user', 'POST', report);
    assert.equal(first.status, 201); assert.equal(first.data.id, duplicate.data.id); assert.equal(db.state.reports.length, 1);
    assert.equal((await request(`/admin/reports/${first.data.id}`, 'other', 'PATCH', { status: 'resolved', reason: 'Рассмотрено' })).status, 403);
    assert.equal((await request(`/admin/reports/${first.data.id}`, 'admin', 'PATCH', { status: 'resolved', reason: 'Рассмотрено' })).status, 200);
    assert.equal(db.state.moderationLog.length, 1);
    assert.equal((await request(`/admin/reports/${first.data.id}`, 'admin', 'PATCH', { status: 'dismissed', reason: 'Изменено' })).status, 409);
    assert.equal((await request('/ai-feedback', 'user', 'POST', { question: 'Где?', answer: 'Кабинет 1', reason: 'Неверный кабинет' })).status, 201);
    const beforeSessions = JSON.stringify(db.sessions);
    const bad = await request('/appeals/authenticated', null, 'POST', { identity: 'missing@example.test', password: 'Test-only-Password-123', reason: 'Пересмотрите решение' });
    const good = await request('/appeals/authenticated', null, 'POST', { identity: 'banned@example.test', password: 'Test-only-Password-123', reason: 'Пересмотрите решение' });
    assert.deepEqual(bad, good); assert.equal(db.state.appeals.length, 1); assert.equal(JSON.stringify(db.sessions), beforeSessions);
    const entry = { office: '100', building: '1', hours: '10–17', contact: 'office@example.test', checkedAt: '2026-01-01', source: 'https://www.rea.ru/' };
    assert.equal((await request('/admin/directory/schedule', 'user', 'PUT', entry)).status, 403);
    assert.equal((await request('/admin/directory/schedule', 'admin', 'PUT', { ...entry, source: 'javascript:alert(1)' })).status, 400);
    assert.equal((await request('/admin/directory/schedule', 'admin', 'PUT', entry)).status, 200);
    const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).state;
    assert.equal(persisted.knowledgeOverrides.schedule.office, '100'); assert.equal(persisted.reports[0].status, 'resolved'); assert.equal(persisted.appeals.length, 1);
    const view = await request('/admin', 'admin'); assert.equal(view.status, 200); assert.equal(view.data.directory.find(x => x.id === 'schedule').directory.office, '100');
  } finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('knowledge override keeps stable identity and replaces stale location', () => {
  const entry = { office: '42', building: '', hours: '', contact: '', checkedAt: '2026-01-01', source: 'https://www.rea.ru/' };
  assert.throws(() => validateKnowledgeOverride({ ...entry, checkedAt: '2026-02-30' }));
  assert.throws(() => validateKnowledgeOverride({ ...entry, source: 'file:///etc/passwd' }));
  const result = loadKnowledge([{ id: 'office', title: 'Отдел', text: 'Old location', office: { aliases: ['отдел'], answer: 'Old answer' } }], { knowledgeOverrides: { office: entry } });
  assert.equal(result[0].id, 'office'); assert.match(result[0].text, /42/); assert.doesNotMatch(result[0].text, /Old/); assert.match(result[0].office.answer, /42/);
});
