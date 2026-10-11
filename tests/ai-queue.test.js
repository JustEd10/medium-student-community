import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAIQueue } from '../server/ai-queue.js';
import { createReviewWorker, prepareReviews } from '../server/ai-moderation.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('one stream, moderation priority, FIFO and no preemption', async () => {
  const queue = createAIQueue();
  const gate = deferred();
  const order = [];
  const first = queue.enqueue(async () => { order.push('running'); await gate.promise; });
  await tick();
  const jobs = [
    queue.enqueue(() => order.push('answer1')),
    queue.enqueue(() => order.push('review1'), { priority: 'moderation' }),
    queue.enqueue(() => order.push('answer2')),
    queue.enqueue(() => order.push('review2'), { priority: 'moderation' }),
  ];
  await tick();
  assert.deepEqual(order, ['running']);
  gate.resolve();
  await Promise.all([first, ...jobs]);
  assert.deepEqual(order, ['running', 'review1', 'review2', 'answer1', 'answer2']);
});

test('failure and stale jobs release the queue without calling cancelled provider', async () => {
  const queue = createAIQueue();
  const failure = assert.rejects(queue.enqueue(() => { throw Error('provider'); }), /provider/);
  let called = false;
  const cancelled = assert.rejects(queue.enqueue(() => { called = true; }, { canRun: () => false }), /AI_CANCELLED/);
  const next = queue.enqueue(() => 'ok');
  await Promise.all([failure, cancelled]);
  assert.equal(await next, 'ok');
  assert.equal(called, false);
});

test('reserved moderation capacity and overall waiting limit', async () => {
  const queue = createAIQueue({ maxWaiting: 3, moderationReserve: 1 });
  const gate = deferred();
  const first = queue.enqueue(() => gate.promise);
  await tick();
  const a = queue.enqueue(() => 'a');
  const b = queue.enqueue(() => 'b');
  await assert.rejects(queue.enqueue(() => 'overflow'), /AI_QUEUE_FULL/);
  const review = queue.enqueue(() => 'review', { priority: 'moderation' });
  await assert.rejects(queue.enqueue(() => 'overflow', { priority: 'moderation' }), /AI_QUEUE_FULL/);
  gate.resolve();
  await Promise.all([first, a, b, review]);
});

test('expired waiting job never runs and subsequent requests still work', async () => {
  const queue = createAIQueue({ maxWaitMs: 20 });
  const gate = deferred();
  const first = queue.enqueue(() => gate.promise);
  await tick();
  let called = false;
  await assert.rejects(queue.enqueue(() => { called = true; }), /AI_QUEUE_TIMEOUT/);
  gate.resolve();
  await first;
  assert.equal(await queue.enqueue(() => 'ok'), 'ok');
  assert.equal(called, false);
});

test('review worker refills priority lane before a waiting answer', async () => {
  const queue = createAIQueue();
  const before = { users: [{ id: 'u', credential: {} }], questions: [], answers: [], helpRequests: [] };
  const next = structuredClone(before);
  next.questions = [1, 2, 3, 4].map(id => ({ id: String(id), authorId: 'u', title: String(id), body: 'Body' }));
  let state = prepareReviews(before, next);
  const gate = deferred();
  const first = queue.enqueue(() => gate.promise);
  await tick();
  const order = [];
  const worker = createReviewWorker({
    read: () => state,
    write: value => { state = value; },
    complete: (messages, options) => queue.enqueue(() => {
      order.push('review');
      return '{"flagged":false,"categories":[]}';
    }, options),
  });
  worker.start();
  const answer = queue.enqueue(() => order.push('answer'));
  gate.resolve();
  await Promise.all([first, answer]);
  assert.deepEqual(order, ['review', 'review', 'review', 'review', 'answer']);
  assert.equal(Object.values(state.aiReviews).every(review => review.status === 'clean'), true);
});
