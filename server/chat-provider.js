import fs from 'node:fs';
import path from 'node:path';
import { generateGeminiChat, geminiChatReady } from './gemini-chat.js';

export function loadChatBotConfig(env = process.env) {
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(path.join(env.DATA_DIR || new URL('./storage/', import.meta.url).pathname, 'chat-bots.json'), 'utf8'));
  } catch (error) { if (error.code !== 'ENOENT') return { enabled: false, provider: env.CHAT_BOT_PROVIDER || 'gemini' }; }
  const provider = env.CHAT_BOT_PROVIDER || saved.provider || 'gemini';
  return {
    provider,
    enabled: env.CHAT_BOTS_ENABLED === '1' || (env.CHAT_BOTS_ENABLED === undefined && saved.enabled === true),
    apiKey: (provider === 'groq' ? env.GROQ_API_KEY : env.GEMINI_CHAT_API_KEY) || saved.apiKey || '',
    model: env.CHAT_BOT_MODEL || saved.model || (provider === 'groq' ? 'qwen/qwen3.8-27b' : 'gemini-3.5-flash-lite'),
  };
}
export const chatBotReady = config => config?.provider === 'gemini' ? geminiChatReady(config) :
  config?.provider === 'groq' && config.enabled === true && typeof config.apiKey === 'string' && !!config.apiKey.trim() && /^[a-z0-9./-]+$/.test(config.model);

export async function generateChatReply(request, { config = loadChatBotConfig(), fetchImpl = fetch } = {}) {
  if (!chatBotReady(config) || request.provider !== config.provider) throw new Error('BOT_UNAVAILABLE');
  if (config.provider === 'gemini') return generateGeminiChat(request, { config, fetchImpl });
  let response;
  try {
    response = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, temperature: 0.65, max_completion_tokens: 450,
        messages: [{ role: 'system', content: request.instruction }, ...request.contents.map(c => ({
          role: c.role === 'model' ? 'assistant' : 'user', content: c.parts.map(p => p.text).join(''),
        }))] }),
    });
  } catch { throw new Error('BOT_FAILED'); }
  if (response.status === 429) throw new Error('BOT_RATE_LIMIT');
  if ([401, 403, 404].includes(response.status)) throw new Error('BOT_UNAVAILABLE');
  if (!response.ok) throw new Error('BOT_FAILED');
  let result;
  try { result = await response.json(); } catch { throw new Error('BOT_FAILED'); }
  const body = result.choices?.[0]?.message?.content?.trim();
  if (!body || body.length > 2000) throw new Error('BOT_FAILED');
  return body;
}
