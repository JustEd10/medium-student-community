export const geminiChatReady = config => config?.enabled === true && typeof config.apiKey === 'string' && !!config.apiKey.trim() && /^gemini-[a-z0-9.-]+$/.test(config.model);

// No tools, paid fallback, automatic retries, or provider response logging.
export async function generateGeminiChat({ instruction, contents }, { config, fetchImpl = fetch } = {}) {
  if (!geminiChatReady(config)) throw new Error('BOT_UNAVAILABLE');
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents,
        generationConfig: { temperature: 0.65, maxOutputTokens: 450 } }),
    });
  } catch { throw new Error('BOT_FAILED'); }
  if (response.status === 429) throw new Error('BOT_RATE_LIMIT');
  if ([401, 403, 404].includes(response.status)) throw new Error('BOT_UNAVAILABLE');
  if (!response.ok) throw new Error('BOT_FAILED');
  let result;
  try { result = await response.json(); } catch { throw new Error('BOT_FAILED'); }
  const candidate = result.candidates?.[0];
  if (result.promptFeedback?.blockReason || !['STOP', 'MAX_TOKENS'].includes(candidate?.finishReason)) throw new Error('BOT_BLOCKED');
  const body = candidate.content?.parts?.filter(p => p.thought !== true && typeof p.text === 'string').map(p => p.text).join('').trim();
  if (!body || body.length > 2000) throw new Error('BOT_FAILED');
  return body;
}
