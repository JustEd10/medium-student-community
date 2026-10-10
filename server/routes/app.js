import crypto from 'crypto';
import { Router } from 'express';
import { db, commit } from '../store.js';
import { getToken } from '../auth.js';
import { CATEGORIES, DEMO_USERS, INTERESTS, LANGUAGES } from '../../src/data.js';
import {
  addAnswer,
  addHelp,
  addQuestion,
  completeHelp,
  offerHelp,
  openChat,
  passwordCredential,
  rateAnswer,
  rateHelp,
  saveProfile,
  sendMessage,
  uid,
  validState,
} from '../../src/domain.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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
  return db.state.users.some((u) => u.id === id) ? id : null;
}

// пользователям отдаём всё, кроме паролей и чужих почт; чаты только свои
function publicState(userId) {
  const s = db.state;
  return {
    users: s.users.map(({ credential, email, ...u }) =>
      u.id === userId ? { ...u, email } : { ...u, email: '' },
    ),
    questions: s.questions,
    answers: s.answers,
    helpRequests: s.helpRequests,
    chats: s.chats.filter((c) => c.members.includes(userId)),
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

router.post('/auth/register', asyncRoute(async (req, res) => {
  const email = trimmed(req.body.email).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const parts = trimmed(req.body.name).split(/\s+/).filter(Boolean);

  if (!EMAIL_RE.test(email) || email.length > 254)
    return res.status(400).json({ error: 'EMAIL_INVALID' });
  if (password.length < 8 || password.length > 128)
    return res.status(400).json({ error: 'PASSWORD_LENGTH' });
  if (parts.length < 2 || parts[0].length > 60 || parts.slice(1).join(' ').length > 60 || trimmed(req.body.name).length > 120)
    return res.status(400).json({ error: 'NAME_REQUIRED' });
  if (db.state.users.some((u) => u.email === email))
    return res.status(409).json({ error: 'EMAIL_TAKEN' });

  const id = uid();
  const user = {
    id,
    firstName: parts.shift(),
    lastName: parts.join(' '),
    email,
    credential: await passwordCredential(password),
    direction: '',
    course: 1,
    languages: [],
    interests: [],
    skills: [],
    about: '',
    color: db.state.users.length % 5,
  };
  // Пока вычислялся хэш, другой запрос мог зарегистрировать ту же почту.
  if (db.state.users.some(u => u.email === email))
    return res.status(409).json({ error: 'EMAIL_TAKEN' });
  const state = { ...db.state, users: [...db.state.users, user] };
  res.status(201).json(sessionResponse(id, state));
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const email = trimmed(req.body.email).toLowerCase();
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128)
    return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  const user = db.state.users.find((u) => u.email === email);
  if (!user || !user.credential) return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  const check = await passwordCredential(password, user.credential.salt);
  if (!samePassword(user.credential, check))
    return res.status(401).json({ error: 'BAD_CREDENTIALS' });
  res.json(sessionResponse(user.id));
}));

router.post('/auth/demo', (req, res) => {
  const id = req.body.id;
  if (!DEMO_USERS.includes(id)) return res.status(400).json({ error: 'NOT_FOUND' });
  res.json(sessionResponse(id));
});

router.post('/auth/logout', (req, res) => {
  const sessions = { ...db.sessions };
  delete sessions[getToken(req)];
  commit({ state: db.state, sessions });
  res.json({ ok: true });
});

// каждое действие вызывает те же правила, что и раньше жили в браузере
const actions = {
  addQuestion: (s, me, a) => {
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
    if (help && help.helpers.includes(me)) return s;
    return offerHelp(s, me, text(a.helpId, 100));
  },
  completeHelp: (s, me, a) => completeHelp(s, me, text(a.helpId, 100), text(a.helperId, 100)),
  rateHelp: (s, me, a) => rateHelp(s, me, text(a.helpId, 100), a.value),
  openChat: (s, me, a) => openChat(s, me, text(a.partner, 100)),
  sendMessage: (s, me, a) => sendMessage(s, me, text(a.chatId, 100), text(a.body, 2000)),
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
    const out = action(db.state, me, args);
    // часть функций возвращает { state, id }, остальные просто новый state
    const next = out.state || out;
    if (!validState(next)) return res.status(400).json({ error: 'INVALID_DATA' });
    commit({ state: next, sessions: db.sessions });
    res.json({ id: out.id, me, state: publicState(me) });
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
