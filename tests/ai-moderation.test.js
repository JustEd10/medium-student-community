import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContent, prepareReviews, createReviewWorker, adminReviewAction, reviewContent } from '../server/ai-moderation.js';
const fixture = () => ({ users: [{ id: 'u', credential: {}, firstName: 'Name', lastName: 'Public', about: 'Hello', email: 'private@example.test' }, { id: 'admin', role: 'admin', credential: {} }], questions: [], answers: [], helpRequests: [], chats: [{ messages: [{ body: 'private' }] }] });
const tick = () => new Promise(r => setImmediate(r));
test('strict classification and public allowlist', async () => {
  const content = reviewContent(fixture(), 'user', 'u');
  assert.equal(JSON.stringify(content).includes('private'), false);
  assert.equal((await classifyContent(content, async () => '{"flagged":false,"categories":[]}')).status, 'clean');
  assert.equal((await classifyContent(content, async () => '{"flagged":true,"categories":["spam"]}')).reason, 'Спам или мошенничество');
  for (const raw of ['{}', '```json {}```', '{"flagged":true,"categories":[]}', '{"flagged":false,"categories":["spam"]}', '{"flagged":true,"categories":["other"]}']) await assert.rejects(classifyContent(content, async () => raw));
});
test('admin authorization, dismiss and retry boundaries', () => {
  const before = fixture();
  const next = structuredClone(before); next.users[0].about = 'Changed';
  let state = prepareReviews(before, next);
  assert.throws(() => adminReviewAction(state, 'u', { key: 'user:u' }), /NOT_ALLOWED/);
  assert.throws(() => adminReviewAction(state, 'admin', { key: 'user:u' }, true), /NOT_ALLOWED/);
  state.aiReviews['user:u'].status = 'error';
  assert.equal(adminReviewAction(state, 'admin', { key: 'user:u' }, true).aiReviews['user:u'].status, 'pending');
  assert.equal(adminReviewAction(state, 'admin', { key: 'user:u' }).aiReviews['user:u'].status, 'dismissed');
});
test('worker isolates failure, rejects stale response and deduplicates', async () => {
  const before = fixture(); const next = structuredClone(before); next.users[0].about = 'First';
  let state = prepareReviews(before, next); let calls = 0; const resolve = [];
  const worker = createReviewWorker({ read: () => state, write: s => { state = s; }, complete: () => { calls++; return new Promise(r => resolve.push(r)); } });
  worker.start(); worker.start(); await tick(); assert.equal(calls, 1);
  const changed = structuredClone(state); changed.users[0].about = 'Second'; state = prepareReviews(state, changed);
  resolve.shift()('{"flagged":true,"categories":["spam"]}'); await tick();
  assert.equal(state.aiReviews['user:u'].status, 'pending'); assert.equal(calls, 2);
  resolve.shift()('invalid'); await tick(); assert.equal(state.aiReviews['user:u'].status, 'error');
  worker.start(); await tick(); assert.equal(calls, 2);
  const same = prepareReviews(state, structuredClone(state)); assert.equal(same.aiReviews['user:u'].status, 'error');
  assert.equal(state.users[0].deletedAt, undefined); assert.equal(state.users[0].bannedAt, undefined);
});
test('concurrency bounded and write failure cannot spin', async () => {
  const before = fixture(); const next = structuredClone(before);
  next.questions = [1,2,3].map(id => ({ id: String(id), authorId: 'u', title: 'Title', body: 'Body' }));
  let state = prepareReviews(before, next); const resolves = []; let calls = 0;
  const worker = createReviewWorker({ read: () => state, write: () => { throw Error('disk'); }, complete: () => { calls++; return new Promise(r => resolves.push(r)); } });
  worker.start(); await tick(); assert.equal(calls, 2);
  resolves.shift()('{"flagged":false,"categories":[]}'); await tick(); assert.equal(calls, 3);
  while (resolves.length) resolves.shift()('{"flagged":false,"categories":[]}');
  await tick(); worker.start(); await tick(); assert.equal(calls, 3);
});

test('review errors persist across restart and pending is safely recoverable', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'medium-review-'));
  const run = code => spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8', timeout: 5000 });
  try {
    const saved = run(`import { db, commit } from './server/store.js'; commit({ ...db, state: { ...db.state, aiReviews: { sample: { status: 'pending', kind: 'user', id: 'sample', hash: 'hash' } } } });`);
    assert.equal(saved.status, 0, saved.stderr);
    const recovered = run(`import { recoverReviews } from './server/review-worker.js'; import { db } from './server/store.js'; recoverReviews(); console.log(db.state.aiReviews.sample.status);`);
    assert.equal(recovered.status, 0, recovered.stderr); assert.equal(recovered.stdout.trim(), 'error');
    const reopened = run(`import { db } from './server/store.js'; console.log(db.state.aiReviews.sample.status);`);
    assert.equal(reopened.status, 0, reopened.stderr); assert.equal(reopened.stdout.trim(), 'error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
