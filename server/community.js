import crypto from 'node:crypto';
import fs from 'node:fs';
import { Router } from 'express';
import { db, commit, getBackupStatus } from './store.js';
import { getToken } from './auth.js';
import { passwordCredential } from '../src/domain.js';
import { loadKnowledge, validateKnowledgeOverride } from './knowledge-store.js';
const baseChunks = JSON.parse(fs.readFileSync(new URL('./knowledge/reu.json', import.meta.url))).chunks;
const active = u => u && u.credential && u.deletedAt == null && u.bannedAt == null;
const str = (v, max, min = 1) => { if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw Object.assign(new Error('INVALID_DATA'), { status: 400 }); return v.trim(); };
const save = state => commit({ state, sessions: db.sessions });
export function appendModerationLog(state, actor, action, target, reason = '') {
  return { ...state, moderationLog: [...(state.moderationLog || []), { id: crypto.randomUUID(), actorId: typeof actor === 'string' ? actor : actor.id, action, target, reason, createdAt: Date.now() }] };
}
function visibleTarget(kind, id) {
  const s = db.state;
  const authorVisible = id => active(s.users.find(u => u.id === id));
  if (kind === 'user') return s.users.find(u => u.id === id && active(u));
  const list = { question: s.questions, answer: s.answers, help: s.helpRequests }[kind];
  return list?.find(x => x.id === id && x.deletedAt == null && authorVisible(x.authorId) && (kind !== 'answer' || visibleTarget('question', x.questionId)));
}
function submit(collection, actorId, data, key) {
  const list = db.state[collection] || [];
  const previous = list.find(x => x.authorId === actorId && x.key === key && x.status === 'open');
  if (previous) return previous;
  if (list.filter(x => x.authorId === actorId && x.createdAt > Date.now() - 3600000).length >= 10) throw Object.assign(new Error('RATE_LIMIT'), { status: 429 });
  const item = { ...data, id: crypto.randomUUID(), authorId: actorId, key, createdAt: Date.now(), status: 'open' };
  save({ ...db.state, [collection]: [...list, item] });
  return item;
}
export function createCommunityRouter() {
  const router = Router();
  const attempts = new Map();
  router.post('/appeals/authenticated', async (req, res, next) => {
    try {
      const identity = str(req.body.identity, 254).toLowerCase();
      const password = req.body.password;
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Object.assign(new Error('INVALID_DATA'), { status: 400 });
      const reason = str(req.body.reason, 2000, 5);
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
      const address = req.ip;
      const rate = attempts.get(address) || { count: 0, until: now + 900000 };
      if (rate.count >= 8 || attempts.size > 10000) return res.status(429).json({ error: 'RATE_LIMIT' });
      rate.count++; attempts.set(address, rate);
      const user = db.state.users.find(u => u.deletedAt == null && (u.email?.toLowerCase() === identity || u.login?.toLowerCase() === identity));
      const credential = user?.credential;
      const check = await passwordCredential(password, credential?.salt || Array(16).fill(0));
      if (credential && Buffer.from(credential.hash).length === Buffer.from(check.hash).length && crypto.timingSafeEqual(Buffer.from(credential.hash), Buffer.from(check.hash))) {
        const current = db.state.users.find(u => u.id === user.id && u.credential === credential && u.deletedAt == null && u.bannedAt != null);
        if (current) { try { submit('appeals', user.id, { reason }, `ban:${current.bannedAt}`); } catch (err) { if (err.status !== 429) throw err; } }
      }
      res.status(202).json({ message: 'Если данные верны и аккаунт заблокирован, апелляция передана администратору.' });
    } catch (err) { next(err); }
  });
  router.use((req, res, next) => {
    const session = db.sessions[getToken(req)];
    const user = session && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now() && db.state.users.find(u => u.id === session.userId && active(u));
    if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    req.communityUser = user; next();
  });
  router.post('/reports', (req, res) => {
    const kind = str(req.body.kind, 20); const targetId = str(req.body.id, 120); const reason = str(req.body.reason, 2000, 5);
    if (!visibleTarget(kind, targetId)) return res.status(404).json({ error: 'NOT_FOUND' });
    const item = submit('reports', req.communityUser.id, { kind, targetId, reason }, `${kind}:${targetId}`);
    res.status(201).json({ id: item.id, status: item.status });
  });
  router.post('/ai-feedback', (req, res) => {
    const reason = str(req.body.reason, 2000, 5);
    const question = str(req.body.question, 4000); const answer = str(req.body.answer, 12000);
    const questionId = req.body.questionId == null ? null : str(req.body.questionId, 120);
    if (questionId && !visibleTarget('question', questionId)) return res.status(404).json({ error: 'NOT_FOUND' });
    const key = crypto.createHash('sha256').update(`${questionId || ''}\n${question}\n${answer}`).digest('hex');
    const item = submit('aiFeedback', req.communityUser.id, { questionId, question, answer, reason }, key);
    res.status(201).json({ id: item.id, status: item.status });
  });
  router.use((req, res, next) => req.communityUser.role === 'admin' ? next() : res.status(403).json({ error: 'ADMIN_REQUIRED' }));
  router.get('/admin', (req, res) => res.json({ reports: db.state.reports || [], aiFeedback: db.state.aiFeedback || [], appeals: db.state.appeals || [], moderationLog: db.state.moderationLog || [], backups: getBackupStatus(), directory: loadKnowledge(baseChunks, db.state) }));
  router.patch('/admin/:collection/:id', (req, res) => {
    const collection = req.params.collection;
    if (!['reports', 'aiFeedback', 'appeals'].includes(collection)) return res.status(404).json({ error: 'NOT_FOUND' });
    const status = req.body.status;
    if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ error: 'INVALID_STATUS' });
    const reason = str(req.body.reason, 2000, 5);
    const list = db.state[collection] || [];
    if (!list.some(x => x.id === req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const item = list.find(x => x.id === req.params.id);
    if (item.status !== 'open') return res.status(409).json({ error: 'ALREADY_REVIEWED' });
    let state = { ...db.state, [collection]: list.map(x => x.id === item.id ? { ...x, status, decision: reason, reviewerId: req.communityUser.id, reviewedAt: Date.now() } : x) };
    state = appendModerationLog(state, req.communityUser, `${collection}.${status}`, item.id, reason);
    save(state); res.json({ ok: true });
  });
  router.put('/admin/directory/:id', (req, res) => {
    if (!baseChunks.some(x => x.id === req.params.id)) return res.status(404).json({ error: 'NOT_FOUND' });
    let entry;
    try { entry = validateKnowledgeOverride(req.body); } catch { return res.status(400).json({ error: 'INVALID_DIRECTORY' }); }
    save(appendModerationLog({ ...db.state, knowledgeOverrides: { ...(db.state.knowledgeOverrides || {}), [req.params.id]: entry } }, req.communityUser, 'directory.updated', req.params.id, 'Обновлены сведения справочника'));
    res.json({ ok: true });
  });
  router.use((err, req, res, next) => { if (res.headersSent) return next(err); res.status(err.status || 500).json({ error: err.status ? err.message : 'STORAGE_UNAVAILABLE' }); });
  return router;
}
