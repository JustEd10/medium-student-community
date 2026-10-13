import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/data.js';
import { addQuestion, addAnswer, addHelp, offerHelp, selectHelp, reopenHelp, completeHelp, withdrawHelp, validState, sendMessage, markChatRead } from '../src/domain.js';
import { notificationsFor, markNotificationsRead } from '../src/notifications.js';

test('notifications are recipient-only, exclude hidden authors and never copy message content', () => {
  let state = createSeed();
  const q = addQuestion(state, 'alina', { title: 'Как найти расписание?', body: '', category: 'Учёба' }); state = q.state;
  state = addAnswer(state, 'wei', q.id, 'Посмотри на сайте РЭУ');
  const answerId = state.answers.at(-1).id;
  assert.ok(notificationsFor(state, 'alina').some(n => n.id === `answer:${answerId}`));
  assert.ok(!notificationsFor(state, 'maria').some(n => n.id === `answer:${answerId}`));
  assert.throws(() => markNotificationsRead(state, 'maria', [`answer:${answerId}`]), /NOTIFICATION_NOT_ALLOWED/);
  state = markNotificationsRead(state, 'alina', [`answer:${answerId}`]);
  assert.equal(notificationsFor(state, 'alina').find(n => n.id === `answer:${answerId}`).read, true);
  state = sendMessage(state, 'wei', 'c1', 'Private synthetic message');
  const messageId = state.chats[0].messages.at(-1).id;
  const feed = notificationsFor(state, 'alina');
  assert.ok(feed.some(n => n.id === `message:${messageId}` && !n.read));
  assert.ok(!JSON.stringify(feed).includes('Private synthetic'));
  assert.ok(!notificationsFor(state, 'maria').some(n => n.id === `message:${messageId}`));
  state = markChatRead(state, 'alina', 'c1', messageId);
  assert.equal(notificationsFor(state, 'alina').find(n => n.id === `message:${messageId}`).read, true);
  state = { ...state, users: state.users.map(u => u.id === 'wei' ? { ...u, bannedAt: Date.now(), bannedBy: 'alina' } : u) };
  assert.ok(!notificationsFor(state, 'alina').some(n => n.id === `answer:${answerId}`));
  assert.deepEqual(notificationsFor(state, null), []);
});

test('only request owner selects an offered helper; assignment, reopen and completion preserve valid state', () => {
  let state = addHelp(createSeed(), 'alina', { subject: 'Матрицы', body: 'Помогите разобраться с задачей' });
  const id = state.helpRequests[0].id;
  state = offerHelp(state, 'wei', id);
  state = offerHelp(state, 'maria', id);
  assert.throws(() => selectHelp(state, 'wei', id, 'maria'), /HELP_NOT_ALLOWED/);
  assert.throws(() => selectHelp(state, 'alina', id, 'gabriel'), /HELP_NOT_ALLOWED/);
  state = selectHelp(state, 'alina', id, 'wei');
  assert.equal(validState(state), true);
  assert.equal(state.helpRequests[0].status, 'assigned');
  assert.ok(notificationsFor(state, 'wei').some(n => n.type === 'assigned' && n.subject === 'Матрицы'));
  assert.throws(() => withdrawHelp(state, 'wei', id), /HELP_NOT_ALLOWED/);
  assert.throws(() => completeHelp(state, 'alina', id, 'maria'), /HELP_NOT_ALLOWED/);
  assert.throws(() => reopenHelp(state, 'wei', id), /HELP_NOT_ALLOWED/);
  state = reopenHelp(state, 'alina', id);
  assert.equal(validState(state), true);
  assert.equal(state.helpRequests[0].helperId, null);
  state = selectHelp(state, 'alina', id, 'maria');
  state = completeHelp(state, 'alina', id, 'maria');
  assert.equal(validState(state), true);
  assert.equal(state.helpRequests[0].status, 'completed');
  assert.ok(notificationsFor(state, 'maria').some(n => n.type === 'completed'));
  assert.throws(() => reopenHelp(state, 'alina', id), /HELP_NOT_ALLOWED/);
});

test('schema rejects malformed optional fields, while existing databases remain valid', () => {
  assert.equal(validState(createSeed()), true);
  for (const patch of [{ notificationReads: [] }, {notificationReads: { missing: ['x'] }}, {reports:[{id:'bad'}]}, {moderationLog: [null]}, {knowledgeOverrides:{x:{office:'x'}}}]) assert.equal(validState({...createSeed(), ...patch}), false);
});
