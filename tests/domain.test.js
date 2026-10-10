import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/data.js';
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
  saveProfile,
  passwordCredential,
  validState,
} from '../src/domain.js';

test('rating: only the question author, new value replaces the old one', () => {
  const initial = createInitialState();
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
  let state = createInitialState();
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
  const state = createInitialState();
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
  const state = createInitialState();
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
  const state = createInitialState();
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
  assert.equal(validState(createInitialState()), true);

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
    { ...createInitialState(), users: [null] },
    { ...createInitialState(), questions: [null] },
    { ...createInitialState(), session: 'unknown' },
    { ...createInitialState(), answers: [orphanAnswer] },
  ];
  for (const bad of broken) assert.equal(validState(bad), false);
});
