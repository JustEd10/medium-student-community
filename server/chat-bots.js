import { BOT_PERSONAS, BOT_ERROR_TEXT, isBotUser, botSystemInstruction } from '../src/bot-personas.js';
import { sendMessage } from '../src/domain.js';
import { hasChatConsent } from '../src/ai-consent.js';
import { generateChatReply, chatBotReady, loadChatBotConfig } from './chat-provider.js';

export function provisionChatBots(state) {
  const additions = BOT_PERSONAS.filter(p => !state.users.some(u => u.id === p.id)).map(({ instruction, persona, ...p }) => ({
    ...p, botPersona: persona, role: 'user', email: '', credential: null,
    botProfileVersion: 2, skills: [], studyHelpVisible: false,
  }));
  let changed = additions.length > 0;
  const users = state.users.map(u => {
    if (!isBotUser(u) || u.botProfileVersion === 2) return u;
    const { instruction, persona, ...profile } = BOT_PERSONAS.find(p => p.id === u.id);
    changed = true;
    return { ...u, ...profile, botProfileVersion: 2 };
  });
  return changed ? { ...state, users: [...users, ...additions] } : state;
}

function conversation(state, actor, chatId) {
  const human = state.users.find(u => u.id === actor && u.credential && !isBotUser(u) && u.deletedAt == null && u.bannedAt == null);
  const chat = state.chats.find(c => c.id === chatId && c.deletedAt == null && c.members.includes(actor));
  const bot = chat && state.users.find(u => cPartner(chat, actor) === u.id && isBotUser(u) && u.deletedAt == null && u.bannedAt == null);
  if (!human || !bot) throw new Error('CHAT_NOT_ALLOWED');
  return { chat, bot, human };
}
const cPartner = (chat, actor) => chat.members.find(id => id !== actor);

export function setBotConsent(state, actor, chatId, consent, now = Date.now(), config = loadChatBotConfig()) {
  const { chat } = conversation(state, actor, chatId);
  if (typeof consent !== 'boolean') throw new Error('INVALID_DATA');
  return { ...state, chats: state.chats.map(c => c.id !== chat.id ? c : {
    ...c, botConsentAt: consent ? now : null, botConsentProvider: consent ? config.provider : null,
    ...(!consent && c.botJob?.status === 'pending' ? { botJob: { ...c.botJob, status: 'error', error: 'BOT_CONSENT_REQUIRED' } } : {}),
  }) };
}

function reserve(state, actor, chat, config, now) {
  if (!chatBotReady(config)) throw new Error('BOT_UNAVAILABLE');
  if (!hasChatConsent(state.users.find(u => u.id === actor), chat, config.provider)) throw new Error('BOT_CONSENT_REQUIRED');
  if (chat.botJob?.status === 'pending') throw new Error('BOT_BUSY');
  const day = new Date(now).toISOString().slice(0, 10);
  const usage = state.botUsage?.day === day ? state.botUsage : { day, total: 0, users: {} };
  const own = usage.users[actor] || { count: 0, lastAt: 0 };
  if (usage.total >= 20 || own.count >= 10) throw new Error('BOT_LIMIT');
  if (own.lastAt && now - own.lastAt < 4000) throw new Error('BOT_RATE_LIMIT');
  return { ...usage, total: usage.total + 1, users: { ...usage.users, [actor]: { count: own.count + 1, lastAt: now } } };
}

export function sendBotMessage(state, actor, chatId, body, clientId, config = loadChatBotConfig(), now = Date.now()) {
  const chat = state.chats.find(c => c.id === chatId && c.members.includes(actor));
  const bot = chat && state.users.find(u => u.id === cPartner(chat, actor) && isBotUser(u));
  if (!bot) return sendMessage(state, actor, chatId, body, clientId);
  conversation(state, actor, chatId);
  const next = sendMessage(state, actor, chatId, body, clientId);
  if (next === state) return state; // Delivery retries must not trigger another provider call.
  const botUsage = reserve(state, actor, chat, config, now);
  return { ...next, botUsage, chats: next.chats.map(c => c.id !== chatId ? c : { ...c,
    botJob: { actor, messageId: c.messages.at(-1).id, status: 'pending', requestedAt: now, provider: config.provider },
  }) };
}

export function retryBotReply(state, actor, chatId, config = loadChatBotConfig(), now = Date.now()) {
  const { chat } = conversation(state, actor, chatId);
  if (chat.botJob?.actor !== actor || chat.botJob?.status !== 'error') throw new Error('BOT_NOT_ALLOWED');
  const latest = chat.messages.filter(m => m.deletedAt == null && m.senderId === actor).at(-1);
  if (!latest || latest.id !== chat.botJob.messageId) throw new Error('BOT_NOT_ALLOWED');
  const botUsage = reserve(state, actor, chat, config, now);
  return { ...state, botUsage, chats: state.chats.map(c => c.id !== chatId ? c : { ...c,
    botJob: { actor, messageId: latest.id, status: 'pending', requestedAt: now, provider: config.provider },
  }) };
}

function prompt(state, chatId, job) {
  const { chat, bot, human } = conversation(state, job.actor, chatId);
  if (!hasChatConsent(human, chat, job.provider) || chat.botJob?.status !== 'pending' || chat.botJob.messageId !== job.messageId || chat.botJob.requestedAt !== job.requestedAt) throw new Error('BOT_CONTEXT_CHANGED');
  const index = chat.messages.findIndex(m => m.id === job.messageId && m.senderId === job.actor && m.deletedAt == null);
  if (index < 0) throw new Error('BOT_CONTEXT_CHANGED');
  // Only this conversation; no email, profile, other chats or internal IDs leave the server.
  const history = chat.messages.slice(0, index + 1).filter(m => m.deletedAt == null).slice(-12);
  while (history.reduce((n, m) => n + m.body.length, 0) > 10000) history.shift();
  while (history.length && history[0]?.senderId !== job.actor) history.shift();
  const contents = history.map(m => ({ role: m.senderId === bot.id ? 'model' : 'user', parts: [{ text: m.body }] }));
  return { provider: job.provider, instruction: botSystemInstruction(bot), contents, bot, fingerprint: JSON.stringify(history.map(m => [m.id, m.body])) };
}

export function recoverBotJobs(state) {
  return { ...state, chats: state.chats.map(c => c.botJob?.status === 'pending' ? { ...c,
    botJob: { ...c.botJob, status: 'error', error: 'BOT_INTERRUPTED' },
  } : c) };
}

export function createBotWorker({ read, write, generate = generateChatReply, ready = () => chatBotReady(loadChatBotConfig()), delay = 4000 }) {
  let running = false;
  async function drain() {
    if (running || !ready()) return;
    running = true;
    try {
      for (;;) {
        const target = read().chats.filter(c => c.botJob?.status === 'pending').sort((a, b) => a.botJob.requestedAt - b.botJob.requestedAt)[0];
        if (!target) break;
        const job = target.botJob;
        try {
          const request = prompt(read(), target.id, job);
          const body = await generate({ provider: request.provider, instruction: request.instruction, contents: request.contents });
          if (typeof body !== 'string' || !body.trim() || body.length > 2000) throw new Error('BOT_FAILED');
          const current = read();
          if (prompt(current, target.id, job).fingerprint !== request.fingerprint) throw new Error('BOT_CONTEXT_CHANGED');
          const next = sendMessage(current, request.bot.id, target.id, body, `bot:${job.messageId}`);
          write({ ...next, chats: next.chats.map(c => c.id !== target.id ? c : { ...c, botJob: { ...job, status: 'done' } }) });
        } catch (error) {
          const current = read();
          const chat = current.chats.find(c => c.id === target.id);
          if (chat?.botJob?.status === 'pending' && chat.botJob.messageId === job.messageId && chat.botJob.requestedAt === job.requestedAt) {
            const safe = Object.hasOwn(BOT_ERROR_TEXT, error.message) ? error.message : 'BOT_FAILED';
            write({ ...current, chats: current.chats.map(c => c.id !== target.id ? c : { ...c, botJob: { ...job, status: 'error', error: safe } }) });
          }
        }
        if (delay) await new Promise(resolve => { const timer = setTimeout(resolve, delay); timer.unref?.(); });
      }
    } finally { running = false; }
  }
  return { start() { queueMicrotask(() => drain().catch(() => { /* Safe persistent pending job is recovered on restart. */ })); }, drain };
}
