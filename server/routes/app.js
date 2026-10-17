import { createRegistrationRouter } from '../registration.js';
import { AI_CONSENT_VERSION } from '../../src/ai-consent.js';
import { appendModerationLog } from '../community.js';
import { notificationsFor, markNotificationsRead } from '../../src/notifications.js';
import crypto from 'crypto';
import { Router } from 'express';
import { db, commit, joinedQuestionAnswers, sql } from '../store.js';
import { startAutomaticAnswer } from '../assistant.js';
import { prepareReviews, adminReviewAction } from '../ai-moderation.js';
import { reviewWorker } from '../review-worker.js';
import { getToken } from '../auth.js';
import { isBotUser } from '../../src/bot-personas.js';
import { sendBotMessage, setBotConsent, retryBotReply } from '../chat-bots.js';
import { chatBotReady, loadChatBotConfig } from '../chat-provider.js';
import { botWorker } from '../bot-worker.js';
import { CATEGORIES, INTERESTS, LANGUAGES } from '../../src/data.js';
import { deleteContent, restoreContent, setUserBan } from '../../src/moderation.js';
import {
  addAnswer,
  withdrawHelp,
  setStudyHelpVisibility,
  setPeopleVisibility,
  addHelp,
  addQuestion,
  completeHelp,
  selectHelp,
  reopenHelp,
  offerHelp,
  openChat,
  markChatRead,
  passwordCredential,
  rateAnswer,
  rateHelp,
  saveProfile,
  uid,
  validState,
} from '../../src/domain.js';

const router = Router();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const trimmed = v => typeof v === 'string' ? v.trim() : '';
const text = (v = '', max) => {
  if (typeof v !== 'string' || v.length > max) throw new Error('INVALID_DATA');
  return v;
};
const pick = (list, allowed) => {
  if (!Array.isArray(list) || list.some(v => !allowed.includes(v))) throw new Error('INVALID_PROFILE');
  return [...new Set(list)];
};

function currentUserId(req) {
  const session = db.sessions[getToken(req)];
  if (!session || session.expiresAt <= Date.now()) return null;
  const id = session.userId;
  return db.state.users.some((u) => u.id === id && u.credential && !isBotUser(u) && u.deletedAt == null && u.bannedAt == null) ? id : null;
}

// пользователям отдаём всё, кроме паролей и чужих почт; чаты только свои
function publicState(userId) {
  const s = db.state;
  const botConfig = loadChatBotConfig();
  const administrator = s.users.some(u => u.id === userId && u.role === 'admin' && u.deletedAt == null && u.bannedAt == null);
  // Старые демонстрационные анкеты без учётных данных не участвуют в рабочем сайте.
  const alive = new Set(s.users.filter(u => u.deletedAt == null && (u.credential || isBotUser(u)) && (administrator || u.bannedAt == null)).map(u => u.id));
  const questions = s.questions.filter(q => q.deletedAt == null && alive.has(q.authorId));
  const questionIds = new Set(questions.map(q => q.id));
  return {
    users: s.users.filter(u => alive.has(u.id)).map(({ credential, login, email, role, ...u }) =>
      u.id === userId ? { ...u, email, role: role || 'user', isAdministrator: role === 'admin' } : { ...u, isAdministrator: role === 'admin', aiConsent: undefined,
        ...(!administrator && u.peopleVisible === false ? { about: '', interests: [] } : {}),
        email: '', ...(administrator ? { role: role || 'user' } : {}) },
    ),
    questions,
    answers: s.answers.filter(a => a.deletedAt == null && alive.has(a.authorId) && questionIds.has(a.questionId)),
    helpRequests: s.helpRequests.filter(h => h.deletedAt == null && alive.has(h.authorId)).map(h => {
      const helperExists = !h.helperId || alive.has(h.helperId);
      return { ...h, helpers: h.helpers.filter(id => alive.has(id)),
        ...(!helperExists ? { helperId: null, status: 'open', rating: null } : {}) };
    }),
    chats: s.chats.filter(c => c.deletedAt == null && c.members.every(id => alive.has(id)) &&
      (administrator || c.members.includes(userId))).map(c => ({ ...c,
        messages: c.messages.filter(m => m.deletedAt == null && alive.has(m.senderId)) })),
    trash: [],
    chatAI: { ready: chatBotReady(botConfig), provider: botConfig.provider },
    notifications: notificationsFor(s, userId),
    ...(administrator ? { aiReviews: s.aiReviews || {} } : {}),
  };
}

function startSession(userId, state = db.state) {
  const token = crypto.randomBytes(24).toString('hex');
  const sessions = Object.fromEntries(Object.entries(db.sessions).filter(([, s]) => s.expiresAt > Date.now()));
  sessions[token] = { userId, expiresAt: Date.now() + SESSION_TTL };
  commit({ state, sessions });
  return token;
}

function sessionResponse(userId, state) {
  const token = startSession(userId, state);
  return { token, me: userId, state: publicState(userId) };
}

function samePassword(credential, other) {
  const a = Buffer.from(credential.hash);
  const b = Buffer.from(other.hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/state', (req, res) => {
  const me = currentUserId(req);
  res.json({ me, state: publicState(me) });
});

// The forum can request display-ready answer data with a real SQL JOIN.
router.get('/questions/:id/answers', (req, res) => {
  const me = currentUserId(req);
  const visible = publicState(me);
  if (!visible.questions.some(q => q.id === req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
  const visibleAnswers = new Set(visible.answers.map(a => a.id));
  res.json(joinedQuestionAnswers(req.params.id).filter(a => visibleAnswers.has(a.id)));
});

router.use('/auth', createRegistrationRouter({
  sql, getData: () => db,
  onVerified(user, { beforeCommit }) {
    if (db.state.users.some(u => u.email.toLowerCase() === user.email || u.login?.toLowerCase() === user.email))
      throw Object.assign(new Error('EMAIL_TAKEN'), {status:409,code:'EMAIL_TAKEN'});
    const state = prepareReviews(db.state, { ...db.state, users: [...db.state.users, user] });
    const token = crypto.randomBytes(24).toString('hex');
    const sessions = Object.fromEntries(Object.entries(db.sessions).filter(([, s]) => s.expiresAt > Date.now()));
    sessions[token] = { userId: user.id, expiresAt: Date.now() + SESSION_TTL };
    commit({ state, sessions }, { beforeCommit });
    reviewWorker.start();
    return { token, me: user.id, state: publicState(user.id) };
  },
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const identity = trimmed(req.body.identity ?? req.body.email).toLowerCase();
  const password = req.body.password;
  if (!identity || typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  const user = db.state.users.find((u) => u.deletedAt == null && u.bannedAt == null &&
    (u.email === identity || (u.role === 'admin' && u.login === identity)));
  if (!user || !user.credential || isBotUser(user)) return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  const check = await passwordCredential(password, user.credential.salt);
  if (!samePassword(user.credential, check) || !db.state.users.some(u => u.id === user.id && u.deletedAt == null && u.bannedAt == null && u.credential === user.credential))
    return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  res.json(sessionResponse(user.id));
}));

router.post('/auth/logout', (req, res) => {
  const sessions = { ...db.sessions };
  delete sessions[getToken(req)];
  commit({ state: db.state, sessions });
  res.json({ ok: true });
});

// каждое действие вызывает те же правила, что и раньше жили в браузере
const actions = {
  dismissAIReview: (s, me, a) => adminReviewAction(s, me, a),
  retryAIReview: (s, me, a) => adminReviewAction(s, me, a, true),
  addQuestion: (s, me, a) => {
    if (a.autoAI !== undefined && typeof a.autoAI !== 'boolean') throw new Error('INVALID_QUESTION');
    if (!CATEGORIES.includes(a.category)) throw new Error('INVALID_QUESTION');
    return addQuestion(s, me, {
      title: text(a.title, 180),
      body: text(a.body, 2000),
      category: a.category,
    });
  },
  addAnswer: (s, me, a) => addAnswer(s, me, text(a.questionId, 100), text(a.body, 2000)),
  rateAnswer: (s, me, a) => rateAnswer(s, me, text(a.answerId, 100), a.value),
  addHelp: (s, me, a) =>
    addHelp(s, me, { subject: text(a.subject, 80), body: text(a.body, 2000) }),
  offerHelp: (s, me, a) => {
    // повторное нажатие «Помогу» не считаем ошибкой
    const help = s.helpRequests.find((h) => h.id === a.helpId);
    if (help && help.deletedAt == null && help.helpers.includes(me)) return s;
    return offerHelp(s, me, text(a.helpId, 100));
  },
  markNotificationsRead: (s, me, a) => markNotificationsRead(s, me, a.ids),
  selectHelp: (s, me, a) => selectHelp(s, me, text(a.helpId, 100), text(a.helperId, 100)),
  reopenHelp: (s, me, a) => reopenHelp(s, me, text(a.helpId, 100)),
  completeHelp: (s, me, a) => completeHelp(s, me, text(a.helpId, 100), text(a.helperId, 100)),
  rateHelp: (s, me, a) => rateHelp(s, me, text(a.helpId, 100), a.value),
  openChat: (s, me, a) => openChat(s, me, text(a.partner, 100)),
  sendMessage: (s, me, a) => sendBotMessage(
    s, me, text(a.chatId, 100), text(a.body, 2000),
    a.clientId === undefined ? undefined : text(a.clientId, 100),
  ),
  setAIConsent: (s, me, a) => {
    if (typeof a.consent !== 'boolean') throw new Error('INVALID_DATA');
    const provider = loadChatBotConfig().provider;
    return { ...s, users: s.users.map(u => u.id !== me ? u : { ...u, aiConsent: a.consent ? { version: AI_CONSENT_VERSION, provider, acceptedAt: Date.now(), adultConfirmed: true } : { version: AI_CONSENT_VERSION, provider, acceptedAt: null, adultConfirmed: false } }),
      chats: s.chats.map(c => !c.members.includes(me) || a.consent || c.botJob?.status !== 'pending' ? c : { ...c, botJob: { ...c.botJob, status: 'error', error: 'BOT_CONSENT_REQUIRED' } }) };
  },
  setBotConsent: (s, me, a) => setBotConsent(s, me, text(a.chatId, 100), a.consent),
  retryBotReply: (s, me, a) => retryBotReply(s, me, text(a.chatId, 100)),
  markChatRead: (s, me, a) => markChatRead(s, me, text(a.chatId, 100), text(a.throughId, 100)),
  deleteContent: (s, me, a) => deleteContent(s, me, text(a.kind, 20), text(a.id, 100)),
  setUserBan: (s, me, a) => setUserBan(s, me, text(a.id, 100), a.banned),
  withdrawHelp: (s, me, a) => withdrawHelp(s, me, text(a.helpId, 100)),
  setStudyHelpVisibility: (s, me, a) => setStudyHelpVisibility(s, me, a.visible),
  setPeopleVisibility: (s, me, a) => setPeopleVisibility(s, me, a.visible),
  restoreContent: (s, me, a) => restoreContent(s, me, text(a.kind, 20), text(a.id, 100)),
  saveProfile: (s, me, a) => {
    if (!['number', 'string'].includes(typeof a.course)) throw new Error('INVALID_PROFILE');
    return saveProfile(s, me, {
      firstName: text(a.firstName, 60),
      lastName: text(a.lastName, 60),
      direction: text(a.direction, 100),
      course: Number(a.course),
      languages: pick(a.languages, LANGUAGES),
      interests: pick(a.interests, INTERESTS),
      about: text(a.about, 600),
      skills: (() => {
        if (!Array.isArray(a.skills) || a.skills.length > 10) throw new Error('INVALID_PROFILE');
        return a.skills.map(v => text(v, 40).trim()).filter(Boolean);
      })(),
    });
  },
};

router.post('/act', (req, res) => {
  const me = currentUserId(req);
  if (!me) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  const action = Object.hasOwn(actions, req.body.type) ? actions[req.body.type] : null;
  if (!action) return res.status(400).json({ error: 'UNKNOWN_ACTION' });
  const args = req.body.args ?? {};
  if (typeof args !== 'object' || Array.isArray(args))
    return res.status(400).json({ error: 'INVALID_DATA' });

  try {
    const actionStartedAt = Date.now();
    const out = action(db.state, me, args);
    // часть функций возвращает { state, id }, остальные просто новый state
    let next = out.state || out;
    const admin = db.state.users.find(u => u.id === me && u.role === 'admin');
    if (admin && ['setUserBan', 'deleteContent', 'restoreContent', 'dismissAIReview', 'retryAIReview'].includes(req.body.type)) {
      const reason = req.body.type === 'setUserBan' ? (args.reason === undefined ? 'Решение администратора' : text(args.reason, 2000).trim()) : args.reason === undefined ? '' : text(args.reason, 2000).trim();
      if (req.body.type === 'setUserBan' && reason.length < 5) throw new Error('REASON_REQUIRED');
      if (req.body.type === 'setUserBan') next = { ...next, users: next.users.map(u => u.id === args.id && args.banned ? { ...u, banReason: reason } : u) };
      next = appendModerationLog(next, me, req.body.type === 'setUserBan' ? (args.banned ? 'user.banned' : 'user.unbanned') : req.body.type, args.key || `${args.kind || 'user'}:${args.id}`, reason);
    }
    // A removed/banned selected helper must not leave the owner with a hidden, unusable assignment.
    if (next.helpRequests.some(h => h.status === 'assigned' && !next.users.some(u => u.id === h.helperId && u.deletedAt == null && u.bannedAt == null))) next = { ...next, helpRequests: next.helpRequests.map(h => {
      if (h.status !== 'assigned' || next.users.some(u => u.id === h.helperId && u.deletedAt == null && u.bannedAt == null)) return h;
      const { assignedAt, ...rest } = h;
      return { ...rest, helperId: null, status: 'open', rating: null };
    }) };
    if (!validState(next)) return res.status(400).json({ error: 'INVALID_DATA' });
    if (next !== db.state) {
      const activeUsers = new Set(next.users.filter(u => u.deletedAt == null && u.bannedAt == null).map(u => u.id));
      const sessions = Object.fromEntries(Object.entries(db.sessions).filter(([, session]) => activeUsers.has(session.userId)));
      commit({ state: prepareReviews(db.state, next), sessions });
      reviewWorker.start();
    }
    if (req.body.type === 'addQuestion' && args.autoAI !== false) startAutomaticAnswer(out.id, me);
    if (['sendMessage', 'retryBotReply'].includes(req.body.type)) botWorker.start();
    res.json({ id: out.id, me, state: publicState(me), ...(req.body.type === 'deleteContent' ? { undoExpiresAt: actionStartedAt + 5000 } : {}) });
  } catch (err) {
    if (err.code === 'STORAGE_UNAVAILABLE')
      return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' });
    // наружу отдаём только свои коды ошибок, всё остальное прячем
    const known = /^[A-Z_]+$/.test(err.message);
    const status = err.message === 'NOT_FOUND' ? 404 : /_NOT_ALLOWED$/.test(err.message) ? 403 : 400;
    res.status(status).json({ error: known ? err.message : 'INVALID_DATA' });
  }
});

export default router;
