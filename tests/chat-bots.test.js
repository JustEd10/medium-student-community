import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeed } from '../src/data.js';
import { openChat, validState } from '../src/domain.js';
import { BOT_PERSONAS, botSystemInstruction } from '../src/bot-personas.js';
import { provisionChatBots, setBotConsent, sendBotMessage, retryBotReply, createBotWorker, recoverBotJobs } from '../server/chat-bots.js';
import { loadChatBotConfig, chatBotReady, generateChatReply } from '../server/chat-provider.js';

const config = { enabled: true, apiKey: 'test-only-placeholder', provider: 'gemini', model: 'gemini-3.5-flash-lite' };
const now = Date.UTC(2026, 0, 1);
function fixture(persona = 0) {
  let state = provisionChatBots(createSeed());
  state = { ...state, users: state.users.map(u => u.id === 'alina' || u.id === 'wei' ? { ...u, credential: { salt: Array(16).fill(1), hash: Array(32).fill(2) } } : u) };
  const result = openChat(state, 'alina', BOT_PERSONAS[persona].id);
  return { state: setBotConsent(result.state, 'alina', result.id, true, now, config), chatId: result.id };
}
function pending(input = fixture(), id = 'one', at = now) {
  return { ...input, state: sendBotMessage(input.state, 'alina', input.chatId, 'Привет!', id, config, at) };
}
function workerFor(initial, generate) {
  let state = initial;
  const worker = createBotWorker({ read: () => state, write: next => { assert.ok(validState(next)); state = next; }, generate, ready: () => true, delay: 0 });
  return { worker, read: () => state, write: next => { state = next; } };
}

test('three persistent AI identities: idempotent provisioning preserves bans/deletion and has no login credentials', () => {
  const { state } = fixture();
  assert.ok(validState(state));
  assert.equal(state.users.filter(u => u.botPersona).length, 3);
  assert.equal(provisionChatBots(state), state);
  assert.ok(state.users.filter(u => u.botPersona).every(u => u.credential === null && u.role === 'user'));
  const banned = { ...state, users: state.users.map(u => u.id === BOT_PERSONAS[0].id ? { ...u, deletedAt: now } : u) };
  assert.equal(provisionChatBots(banned), banned);
  assert.match(botSystemInstruction(state.users.find(u => u.botPersona === 'zh')), /ONLY in simplified Chinese/);
  assert.match(botSystemInstruction(state.users.find(u => u.botPersona === 'fr')), /incorrect noun cases/);
  assert.match(botSystemInstruction(state.users.find(u => u.botPersona === 'es')), /Spanish, English and Russian/);
  assert.equal(validState({ ...state, users: state.users.map(u => u.id === 'wei' ? { ...u, botPersona: 'zh' } : u) }), false);
});

test('authentication, consent, availability and pending reply are server-enforced', () => {
  const { state, chatId } = fixture();
  assert.throws(() => setBotConsent(state, 'wei', chatId, true, now, config), /CHAT_NOT_ALLOWED/);
  assert.throws(() => sendBotMessage(state, 'wei', chatId, 'x', 'x', config, now), /CHAT_NOT_ALLOWED/);
  const revoked = setBotConsent(state, 'alina', chatId, false, now, config);
  assert.throws(() => sendBotMessage(revoked, 'alina', chatId, 'x', 'x', config, now), /BOT_CONSENT_REQUIRED/);
  assert.throws(() => sendBotMessage(state, 'alina', chatId, 'x', 'x', { ...config, apiKey: '' }, now), /BOT_UNAVAILABLE/);
  assert.throws(() => sendBotMessage(state, 'alina', chatId, 'x', 'x', { ...config, provider: 'groq', model: 'qwen/qwen3.8-27b' }, now), /BOT_CONSENT_REQUIRED/);
  const p = pending({ state, chatId });
  assert.throws(() => sendBotMessage(p.state, 'alina', chatId, 'Again', 'two', config, now + 5000), /BOT_BUSY/);
  assert.equal(sendBotMessage(p.state, 'alina', chatId, 'Привет!', 'one', config, now), p.state);
});

test('worker sends only current chat history and publishes exactly one reply, without overwriting concurrent changes', async () => {
  const { state, chatId } = pending();
  let calls = 0;
  const target = workerFor(state, async request => {
    calls++;
    assert.deepEqual(request.contents, [{ role: 'user', parts: [{ text: 'Привет!' }] }]);
    assert.ok(!JSON.stringify(request).includes('@'));
    target.write({ ...target.read(), locale: 'en' });
    return '你好！';
  });
  await Promise.all([target.worker.drain(), target.worker.drain()]);
  await target.worker.drain();
  const chat = target.read().chats.find(c => c.id === chatId);
  assert.equal(calls, 1);
  assert.equal(chat.messages.length, 2);
  assert.equal(chat.messages[1].body, '你好！');
  assert.equal(chat.botJob.status, 'done');
  assert.equal(target.read().locale, 'en');
});

test('reply is discarded after consent withdrawal, deleted input, banned account or changed history', async () => {
  for (const mutation of [
    (s, id) => setBotConsent(s, 'alina', id, false, now, config),
    (s, id) => ({ ...s, chats: s.chats.map(c => c.id !== id ? c : { ...c, messages: c.messages.map(m => ({ ...m, deletedAt: now })) }) }),
    s => ({ ...s, users: s.users.map(u => u.id !== 'alina' ? u : { ...u, bannedAt: now, bannedBy: 'wei' }) }),
    (s, id) => ({ ...s, chats: s.chats.map(c => c.id !== id ? c : { ...c, messages: c.messages.map(m => ({ ...m, body: 'Changed' })) }) }),
  ]) {
    const { state, chatId } = pending();
    const target = workerFor(state, async () => { target.write(mutation(target.read(), chatId)); return 'Ignored reply'; });
    await target.worker.drain();
    assert.equal(target.read().chats.find(c => c.id === chatId).messages.length, 1);
  }
});

test('errors remain private safe codes, restart does not call provider, retry and quota survive persistence', async () => {
  const { state, chatId } = pending();
  const target = workerFor(state, async () => { throw new Error('secret-provider-response'); });
  await target.worker.drain();
  let saved = JSON.parse(JSON.stringify(target.read()));
  assert.equal(saved.chats.find(c => c.id === chatId).botJob.error, 'BOT_FAILED');
  assert.ok(!JSON.stringify(saved).includes('secret-provider-response'));
  assert.throws(() => retryBotReply(saved, 'wei', chatId, config, now + 5000), /CHAT_NOT_ALLOWED/);
  for (let i = 1; i < 10; i++) {
    saved = retryBotReply(saved, 'alina', chatId, config, now + i * 5000);
    saved = recoverBotJobs(JSON.parse(JSON.stringify(saved)));
    assert.ok(validState(saved));
  }
  assert.equal(saved.botUsage.total, 10);
  assert.throws(() => retryBotReply(saved, 'alina', chatId, config, now + 60000), /BOT_LIMIT/);
  assert.equal(saved.chats.find(c => c.id === chatId).botJob.error, 'BOT_INTERRUPTED');
});

test('private configuration fails closed; no key is required for disabled default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medium-chat-config-'));
  try {
    assert.equal(chatBotReady(loadChatBotConfig({ DATA_DIR: dir })), false);
    writeFileSync(join(dir, 'chat-bots.json'), JSON.stringify(config));
    assert.equal(chatBotReady(loadChatBotConfig({ DATA_DIR: dir })), true);
    assert.equal(chatBotReady(loadChatBotConfig({ DATA_DIR: dir, CHAT_BOTS_ENABLED: '0' })), false);
    writeFileSync(join(dir, 'chat-bots.json'), '{broken');
    assert.equal(chatBotReady(loadChatBotConfig({ DATA_DIR: dir })), false);
  } finally { rmSync(dir, { recursive: true }); }
});

test('Gemini HTTP contract, bounded output, safe errors, no tools or retries', async () => {
  let calls = 0;
  const request = { provider: 'gemini', instruction: 'Only Chinese', contents: [{ role: 'user', parts: [{ text: '你好' }] }] };
  const reply = await generateChatReply(request, { config, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    assert.ok(!url.includes(config.apiKey));
    assert.equal(options.headers['x-goog-api-key'], config.apiKey);
    const payload = JSON.parse(options.body);
    assert.ok(!payload.tools);
    assert.equal(payload.generationConfig.maxOutputTokens, 450);
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'hidden', thought: true }, { text: '你好！' }] } }] });
  } });
  assert.equal(reply, '你好！');
  assert.equal(calls, 1);
  for (const [status, code] of [[429, 'BOT_RATE_LIMIT'], [403, 'BOT_UNAVAILABLE'], [500, 'BOT_FAILED']]) {
    await assert.rejects(generateChatReply(request, { config, fetchImpl: async () => new Response('secret', { status }) }), new RegExp(code));
  }
  await assert.rejects(generateChatReply(request, { config, fetchImpl: async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }) }), /BOT_BLOCKED/);
  await assert.rejects(generateChatReply(request, { config: { ...config, model: '../../evil' } }), /BOT_UNAVAILABLE/);
});

test('Groq alternate uses its fixed endpoint and no silent switch from Gemini', async () => {
  const groq = { ...config, provider: 'groq', model: 'qwen/qwen3.8-27b' };
  const reply = await generateChatReply({ provider: 'groq', instruction: 'Test', contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] }, { config: groq, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.deepEqual(JSON.parse(options.body).messages, [{ role: 'system', content: 'Test' }, { role: 'user', content: 'Hi' }]);
    return Response.json({ choices: [{ message: { content: 'Hello!' } }] });
  } });
  assert.equal(reply, 'Hello!');
  await assert.rejects(generateChatReply({ provider: 'gemini' }, { config: groq }), /BOT_UNAVAILABLE/);
});
