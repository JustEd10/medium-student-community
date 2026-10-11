import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/data.js';
import {
  addQuestion,
  addAnswer,
  rateAnswer,
  rankings,
  offerHelp,
  completeHelp,
  rateHelp,
  openChat,
  sendMessage,
  markChatRead,
  saveProfile,
  passwordCredential,
  validState,
} from '../src/domain.js';

test('rating: only the question author, new value replaces the old one', () => {
  const initial = createSeed();
  assert.throws(() => rateAnswer(initial, 'wei', 'a1', 5), /RATING_NOT_ALLOWED/);
  assert.throws(() => rateAnswer(initial, 'alina', 'a5', 5), /RATING_NOT_ALLOWED/);
  for (const value of [0, 6, 2.5, '5'])
    assert.throws(() => rateAnswer(initial, 'alina', 'a1', value), /INVALID_RATING/);

  const rated = rateAnswer(initial, 'alina', 'a1', 5);
  assert.equal(rankings(rated).find((r) => r.user.id === 'maria').total, 10);

  const changed = rateAnswer(rated, 'alina', 'a1', 2);
  const maria = rankings(changed).find((r) => r.user.id === 'maria');
  assert.equal(maria.total, 7);
  assert.equal(maria.count, 2);
  assert.equal(maria.average, 3.5);
  // исходный state не должен был измениться
  assert.equal(initial.answers[0].rating, null);
});

test('help: offer, complete, then rate', () => {
  let state = createSeed();
  assert.throws(() => rateHelp(state, 'gabriel', 'h1', 5), /RATING_NOT_ALLOWED/);
  assert.throws(() => offerHelp(state, 'gabriel', 'h1'), /HELP_NOT_ALLOWED/);

  state = offerHelp(state, 'wei', 'h1');
  state = offerHelp(state, 'wei', 'h1');
  assert.deepEqual(state.helpRequests.find((h) => h.id === 'h1').helpers, ['wei']);

  assert.throws(() => completeHelp(state, 'alina', 'h1', 'wei'), /HELP_NOT_ALLOWED/);
  assert.throws(() => completeHelp(state, 'gabriel', 'h1', 'maria'), /HELP_NOT_ALLOWED/);
  state = completeHelp(state, 'gabriel', 'h1', 'wei');

  state = rateHelp(state, 'gabriel', 'h1', 4);
  state = rateHelp(state, 'gabriel', 'h1', 3);
  assert.equal(rankings(state).find((r) => r.user.id === 'wei').total, 3);
  assert.throws(() => rateHelp(state, 'wei', 'h1', 5), /RATING_NOT_ALLOWED/);
});

test('questions and answers: validation, unknown user', () => {
  const state = createSeed();
  assert.throws(
    () => addQuestion(state, 'unknown', { title: 'Valid question', body: '', category: 'Учёба' }),
    /AUTH_REQUIRED/,
  );
  assert.throws(
    () => addQuestion(state, 'alina', { title: 'short', body: '', category: 'Учёба' }),
    /INVALID_QUESTION/,
  );

  const result = addQuestion(state, 'alina', {
    title: ' Как найти аудиторию? ',
    body: 'Описание',
    category: 'Кампус',
  });
  assert.equal(result.state.questions[0].title, 'Как найти аудиторию?');

  const answered = addAnswer(result.state, 'wei', result.id, 'На первом этаже.');
  assert.equal(answered.answers.at(-1).questionId, result.id);
  assert.throws(() => addAnswer(state, 'wei', 'missing', 'Ответ'), /NOT_FOUND/);
});

test('chats: existing chat is reused, outsiders cannot write', () => {
  const state = createSeed();
  assert.equal(openChat(state, 'wei', 'alina').id, 'c1');
  assert.throws(() => openChat(state, 'alina', 'alina'), /CHAT_NOT_ALLOWED/);
  assert.throws(() => sendMessage(state, 'maria', 'c1', 'Hi'), /CHAT_NOT_ALLOWED/);
  assert.throws(() => sendMessage(state, 'alina', 'c1', '  '), /INVALID_MESSAGE/);

  // теги не вырезаем, текст хранится как есть (экранирует уже React)
  const next = sendMessage(state, 'alina', 'c1', ' <script>alert(1)</script> ');
  assert.equal(next.chats[0].messages.at(-1).body, '<script>alert(1)</script>');
  assert.equal(state.chats[0].messages.length, 2);
});

test('profile: needs a language and course 1-6', () => {
  const state = createSeed();
  const profile = { ...state.users[0] };
  assert.throws(
    () => saveProfile(state, 'alina', { ...profile, languages: [] }),
    /INVALID_PROFILE/,
  );
  assert.throws(() => saveProfile(state, 'alina', { ...profile, course: 7 }), /INVALID_PROFILE/);

  const next = saveProfile(state, 'alina', { ...profile, firstName: ' Алина ', course: '2' });
  assert.equal(next.users[0].course, 2);
  assert.equal(next.users[0].firstName, 'Алина');
});

test('chat receipts: only the recipient can mark incoming messages through the viewed boundary', () => {
  const initial = createSeed(); // старые сообщения без readAt остаются допустимыми
  const sent = sendMessage(initial, 'alina', 'c1', 'Первое сообщение', 'client-first');
  const first = sent.chats[0].messages.at(-1);
  const later = sendMessage(sent, 'alina', 'c1', 'Новое сообщение после просмотра');
  assert.equal(first.readAt, null);
  assert.throws(() => markChatRead(later, 'maria', 'c1', first.id), /CHAT_NOT_ALLOWED/);
  assert.throws(() => markChatRead(later, 'wei', 'c1', 'missing'), /NOT_FOUND/);
  const read = markChatRead(later, 'wei', 'c1', first.id);
  assert.ok(read.chats[0].messages.find(m => m.id === first.id).readAt >= first.createdAt);
  assert.ok(read.chats[0].messages.find(m => m.id === 'm2').readAt);
  assert.equal(read.chats[0].messages.find(m => m.id === 'm1').readAt, undefined);
  assert.equal(read.chats[0].messages.at(-1).readAt, null);
  assert.equal(later.chats[0].messages.find(m => m.id === first.id).readAt, null);
  assert.equal(markChatRead(read, 'wei', 'c1', first.id), read);
  assert.equal(validState(read), true);
});

test('message retry: a stable client ID prevents duplicates without accepting changed text', () => {
  const initial = createSeed();
  const sent = sendMessage(initial, 'alina', 'c1', 'Привет', 'retry-id');
  assert.equal(sendMessage(sent, 'alina', 'c1', ' Привет ', 'retry-id'), sent);
  assert.equal(sent.chats[0].messages.length, initial.chats[0].messages.length + 1);
  assert.throws(() => sendMessage(sent, 'alina', 'c1', 'Другой текст', 'retry-id'), /INVALID_MESSAGE/);
  for (const clientId of ['', ' ', 7, null, 'a'.repeat(101)])
    assert.throws(() => sendMessage(initial, 'alina', 'c1', 'Привет', clientId), /INVALID_MESSAGE/);
  const otherSender = sendMessage(sent, 'wei', 'c1', 'Привет', 'retry-id');
  assert.equal(otherSender.chats[0].messages.length, sent.chats[0].messages.length + 1);
});

test('password: same salt gives the same hash', async () => {
  const a = await passwordCredential('demonstration123');
  const b = await passwordCredential('demonstration123', a.salt);
  const c = await passwordCredential('another-password', a.salt);
  assert.deepEqual(a.hash, b.hash);
  assert.notDeepEqual(a.hash, c.hash);
  assert.equal(a.salt.length, 16);
  assert.equal(a.hash.length, 32);
});

test('validState: broken data is rejected', () => {
  assert.equal(validState(createSeed()), true);

  const orphanAnswer = {
    id: 'a',
    authorId: 'alina',
    questionId: 'missing',
    body: 'text',
    rating: 5,
    createdAt: 1,
  };
  const broken = [
    null,
    {},
    { ...createSeed(), users: [null] },
    { ...createSeed(), questions: [null] },
    { ...createSeed(), session: 'unknown' },
    { ...createSeed(), answers: [orphanAnswer] },
  ];
  for (const bad of broken) assert.equal(validState(bad), false);
  for (const metadata of [{ readAt: NaN }, { readAt: -1 }, { readAt: 'today' },
    { clientId: null }, { clientId: '' }, { clientId: 'a'.repeat(101) }]) {
    const state = createSeed();
    Object.assign(state.chats[0].messages[0], metadata);
    assert.equal(validState(state), false);
  }
});


test('undo deadline, protected roots, bans and study withdrawal', async () => {
  const { deleteContent, restoreContent, setUserBan } = await import('../src/moderation.js');
  const { withdrawHelp, setStudyHelpVisibility } = await import('../src/domain.js');
  let state = createSeed();
  state.users.push({ ...state.users[0], id: 'admin', role: 'admin' });
  const q = state.questions[0];
  const deleted = deleteContent(state, q.authorId, 'question', q.id);
  assert.throws(() => restoreContent(deleted, 'admin', 'question', q.id), /RESTORE_NOT_ALLOWED/);
  assert.equal(restoreContent(deleted, q.authorId, 'question', q.id).questions[0].deletedAt, undefined);
  const expired = { ...deleted, questions: deleted.questions.map(item => item.id === q.id ? { ...item, deletedAt: Date.now() - 5000 } : item) };
  assert.throws(() => restoreContent(expired, q.authorId, 'question', q.id), /RESTORE_NOT_ALLOWED/);
  assert.throws(() => setUserBan(state, 'wei', 'alina', true), /BAN_NOT_ALLOWED/);
  assert.throws(() => setUserBan(state, 'admin', 'admin', true), /BAN_NOT_ALLOWED/);
  state = setUserBan(state, 'admin', 'alina', true);
  assert.throws(() => addQuestion(state, 'alina', { title: 'Valid question', body: '', category: 'Кампус' }), /AUTH_REQUIRED/);
  assert.equal(state.questions.length, createSeed().questions.length);
  state = setUserBan(state, 'admin', 'alina', false);
  assert.equal(state.users.find(u => u.id === 'alina').bannedAt, undefined);
  state = offerHelp(state, 'wei', 'h1');
  assert.throws(() => withdrawHelp(state, 'maria', 'h1'), /HELP_NOT_ALLOWED/);
  state = withdrawHelp(state, 'wei', 'h1');
  assert.ok(!state.helpRequests.find(h => h.id === 'h1').helpers.includes('wei'));
  state = setStudyHelpVisibility(state, 'alina', false);
  assert.equal(state.users.find(u => u.id === 'alina').studyHelpVisible, false);
  assert.throws(() => setStudyHelpVisibility(state, 'unknown', false), /AUTH_REQUIRED/);
});
