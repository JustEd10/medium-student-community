import { Router } from 'express';
import { db, commit } from './store.js';
import { getToken } from './auth.js';
import { generateUniversityAnswer, providerConfigured, ragError } from './rag.js';

export function assistantUser(req) {
  const session = db.sessions[getToken(req)];
  if (!session || session.expiresAt <= Date.now()) return null;
  return db.state.users.find(u => u.id === session.userId && u.credential && u.deletedAt == null && u.bannedAt == null) || null;
}
const attempts = new Map();
const pending = new Map();
let active = 0;
function consume(userId) {
  const now = Date.now();
  for (const [id, entry] of attempts) if (entry.until <= now) attempts.delete(id);
  const entry = attempts.get(userId) || { count: 0, until: now + 300000 };
  if (entry.count >= 5 || active >= 2) throw ragError('AI_BUSY', 429);
  entry.count += 1;
  attempts.set(userId, entry);
}
function saveResponse(questionId, response) {
  const question = db.state.questions.find(q => q.id === questionId && q.deletedAt == null);
  if (!question || !db.state.users.some(u => u.id === question.authorId && u.deletedAt == null && u.bannedAt == null)) return false;
  commit({ ...db, state: { ...db.state, questions: db.state.questions.map(q => q.id === questionId ? { ...q, aiResponse: response } : q) } });
  return true;
}
export function answerPublishedQuestion(questionId, userId) {
  if (pending.has(questionId)) return pending.get(questionId);
  const question = db.state.questions.find(q => q.id === questionId && q.deletedAt == null);
  if (!question) return Promise.reject(ragError('NOT_FOUND', 404));
  const user = db.state.users.find(u => u.id === userId && u.credential && u.deletedAt == null && u.bannedAt == null);
  if (!user || (question.authorId !== userId && user.role !== 'admin')) return Promise.reject(ragError('AI_NOT_ALLOWED', 403));
  if (question.aiResponse?.status === 'ready') return Promise.resolve(question.aiResponse);
  try { consume(userId); } catch (err) { return Promise.reject(err); }
  active += 1;
  const job = (async () => {
    try {
      saveResponse(questionId, { status: 'pending', createdAt: Date.now() });
      if (!providerConfigured()) throw ragError('AI_NOT_CONFIGURED');
      const response = { ...await generateUniversityAnswer(`${question.title}\n${question.body}`), status: 'ready' };
      saveResponse(questionId, response);
      return response;
    } catch (err) {
      // Provider responses, credentials and request bodies never enter logs or public errors.
      try { saveResponse(questionId, { status: 'error', error: ['AI_NOT_CONFIGURED', 'AI_BUSY'].includes(err.message) ? err.message : 'AI_UNAVAILABLE', createdAt: Date.now() }); } catch { /* storage errors are reported by next request */ }
      throw err.status ? err : ragError('AI_UNAVAILABLE');
    } finally { active -= 1; pending.delete(questionId); }
  })();
  pending.set(questionId, job);
  return job;
}
export function startAutomaticAnswer(questionId, userId) {
  // Publication succeeds independently of provider availability.
  setImmediate(() => { answerPublishedQuestion(questionId, userId).catch(() => {}); });
}
export function createAssistantRouter() {
  // A process restart interrupted these requests; allow an explicit retry.
  if (db.state.questions.some(q => q.aiResponse?.status === 'pending')) {
    commit({ ...db, state: { ...db.state, questions: db.state.questions.map(q => q.aiResponse?.status === 'pending'
      ? { ...q, aiResponse: { status: 'error', error: 'AI_UNAVAILABLE', createdAt: Date.now() } } : q) } });
  }
  const router = Router();
  router.get('/status', (req, res) => res.json({ configured: providerConfigured(), university: 'РЭУ им. Г.В. Плеханова' }));
  router.post('/', async (req, res) => {
    const user = assistantUser(req);
    if (!user) return res.status(401).json({ error: 'AUTH_REQUIRED' });
    try {
      if (typeof req.body.questionId === 'string') {
        const answer = await answerPublishedQuestion(req.body.questionId, user.id);
        if (!assistantUser(req)) return res.status(401).json({ error: 'AUTH_REQUIRED' });
        return res.json({ answer });
      }
      if (typeof req.body.question !== 'string' || req.body.question.trim().length < 8 || req.body.question.length > 2200) throw ragError('AI_INVALID_QUESTION', 400);
      consume(user.id);
      if (!providerConfigured()) throw ragError('AI_NOT_CONFIGURED');
      active += 1;
      let answer;
      try { answer = await generateUniversityAnswer(req.body.question); } finally { active -= 1; }
      if (!assistantUser(req)) return res.status(401).json({ error: 'AUTH_REQUIRED' });
      res.json({ answer });
    } catch (err) {
      const error = ['AI_NOT_CONFIGURED', 'AI_BUSY', 'AI_INVALID_QUESTION', 'AI_NOT_ALLOWED', 'NOT_FOUND'].includes(err.message) ? err.message : 'AI_UNAVAILABLE';
      res.status(err.status || 503).json({ error });
    }
  });
  return router;
}
