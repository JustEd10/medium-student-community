import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrieve, generateUniversityAnswer } from '../server/rag.js';

test('RAG retrieves relevant official REU excerpts for Russian and English questions', () => {
  assert.equal(retrieve('Как найти расписание занятий?')[0].id, 'schedule');
  assert.equal(retrieve('Where can I get dormitory accommodation?')[0].id, 'dormitory');
  assert.equal(retrieve('Не приходит письмо с логином и паролем')[0].id, 'account');
});
test('RAG abstains on unrelated topics without calling provider', async () => {
  const answer = await generateUniversityAnswer('Напиши рецепт борща', () => { assert.fail('must not call provider'); });
  assert.equal(answer.grounded, false);
  assert.deepEqual(answer.sources, []);
});
test('RAG passes only retrieved excerpts and binds citations to official metadata', async () => {
  const answer = await generateUniversityAnswer('Где находится общежитие?', async messages => {
    assert.equal(messages.length, 2);
    const input = JSON.parse(messages[1].content);
    assert.ok(input.sources.some(c => c.title.includes('Общежития')));
    assert.ok(!JSON.stringify(input).includes('credential'));
    return 'Смотрите источник [1]. <script>bad</script> https://evil.example/test';
  });
  assert.ok(answer.sources.every(s => new URL(s.url).hostname === 'www.rea.ru'));
  assert.ok(!answer.body.includes('<script>'));
  assert.ok(!answer.body.includes('evil.example'));
});
test('RAG rejects oversized or empty queries before provider call', async () => {
  await assert.rejects(generateUniversityAnswer(''), /AI_INVALID_QUESTION/);
  await assert.rejects(generateUniversityAnswer('x'.repeat(2201)), /AI_INVALID_QUESTION/);
});

test('VUS inflections find military registration rather than unrelated offices', () => {
  for (const question of ['Какой кабинет вуса?', 'Где ВУС?', 'Как попасть в ВУСе?', 'Где военно-учётный стол?']) {
    assert.equal(retrieve(question)[0].id, 'military-registration', question);
  }
  assert.deepEqual(retrieve('Где кабинет международного отдела?'), []);
});
test('VUS office answer uses project correction with explicit provenance', async () => {
  for (const question of ['Какой кабинет вуса?', 'Где находится военно-учетный стол?', 'Where is the military registration office?']) {
    const result = await generateUniversityAnswer(question, () => assert.fail('directory must not use model'));
    assert.match(result.body, /кабинет 100/);
    assert.match(result.sources[0].sourceNote, /владельцем проекта/);
    assert.match(result.body, /vus@rea.ru/);
    assert.equal(result.sources[0].id, 'military-registration');
    assert.equal(result.body.includes('343'), false);
  }
});
test('known social office fact is distinct from missing or ambiguous offices', async () => {
  const complete = () => assert.fail('must use directory or clarification');
  const known = await generateUniversityAnswer('Какой кабинет отдела социальной работы?', complete);
  assert.match(known.body, /кабинет 343/);
  assert.equal(known.sources[0].id, 'social');
  for (const question of ['В каком кабинете деканат?', 'Где кабинет ВУС и соцотдела?']) {
    const unknown = await generateUniversityAnswer(question, complete);
    assert.equal(unknown.grounded, false);
    assert.deepEqual(unknown.sources, []);
  }
});
test('unsupported numbers and generated room assignments are withheld', async () => {
  for (const raw of ['За пропуском иди в кабинет 777. [1]', 'Билет выдадут через 15 дней. [1]', 'Каб. 343. [1]']) {
    const answer = await generateUniversityAnswer('Как получить пропуск?', async () => raw);
    assert.equal(answer.grounded, false);
    assert.equal(answer.body.includes('777'), false);
    assert.equal(answer.body.includes('343'), false);
  }
  const grounded = await generateUniversityAnswer('Где находится общежитие?', async () => 'Стремянный переулок, 14, строение 1. [1]');
  assert.equal(grounded.grounded, true);
  assert.match(grounded.body, /14/);
});

test('directory distinguishes library registration, specific international office and VUC', async () => {
  const noModel = () => assert.fail('directory must not call model');
  for (const [q, id, expected] of [
    ['Где сектор записи читателей?', 'library-registration', '301'],
    ['Где кабинет отдела стран Европы?', 'international-europe', '649'],
    ['Какой кабинет ВУЦ?', 'military-training', 'VUC@rea.ru'],
  ]) {
    const a = await generateUniversityAnswer(q, noModel);
    assert.equal(a.sources[0].id, id);
    assert.ok(a.body.includes(expected));
    if (id === 'military-training') assert.ok(!a.body.includes('100'));
  }
});
