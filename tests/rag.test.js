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
