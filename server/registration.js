import { Router } from 'express';
import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { passwordCredential, uid } from '../src/domain.js';
import { createRegistrationMailer } from './registration-mailer.js';
const TTL = 600000;
const failure = (status, code) => Object.assign(new Error(code), { status, code });
const digest = (code, salt) => scryptSync(code, salt, 32).toString('hex');
export function createRegistrationRouter({ sql, getData, onVerified, sendMail, mailReady, now = Date.now }) {
  sql.exec(fs.readFileSync(new URL('./migrations/003-registration.sql', import.meta.url), 'utf8'));
  const mailer = createRegistrationMailer();
  const send = sendMail || mailer.sendMail;
  const ready = mailReady || (sendMail ? () => true : mailer.ready);
  const router = Router();
  const run = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(e => {
    if (e.status) res.status(e.status).json({ error: e.code, ...(e.challenge || {}) }); else next(e);
  });
  const clean = () => {
    sql.prepare('DELETE FROM registration_challenges WHERE expires_at <= ?').run(now());
    sql.prepare('DELETE FROM registration_limits WHERE expires_at <= ?').run(now());
  };
  const taken = email => getData().state.users.some(u => u.email?.toLowerCase() === email || u.login?.toLowerCase() === email);
  function limit(email, ip, kind = 'send') {
    // Synchronous reservation before any asynchronous hashing or delivery.
    const caps = kind === 'send' ? [[`email:${email}`, 5], [`ip:${ip}`, 20], ['global', 200]] : [[`verify-ip:${ip}`, 100], ['verify-global', 1000]];
    for (const [key, cap] of caps) if ((sql.prepare('SELECT count FROM registration_limits WHERE key=?').get(key)?.count || 0) >= cap) throw failure(429, 'RATE_LIMITED');
    for (const [key] of caps) sql.prepare('INSERT INTO registration_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now() + 3600000);
  }
  const metadata = row => ({ challengeId: row.id, email: `${row.email[0]}***@${row.email.split('@')[1]}`, expiresAt: row.expires_at, resendAt: row.resend_at });
  async function deliver(row, code) {
    let delivery;
    try { delivery = await send({ email: row.email, code }); }
    catch { sql.prepare('UPDATE registration_challenges SET sending=2 WHERE id=? AND digest=?').run(row.id, row.digest); throw Object.assign(failure(503, 'MAIL_DELIVERY_FAILED'), { challenge: metadata(row) }); }
    sql.prepare('UPDATE registration_challenges SET sending=0 WHERE id=? AND digest=?').run(row.id, row.digest);
    return { ...metadata(row), ...(delivery?.localPreview ? { localPreview: true } : {}) };
  }
  router.get('/registration-status', (req, res) => res.json({ emailVerification: true, mailReady: ready() }));
  router.post('/register', run(async (req, res) => {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const parts = name.split(/\s+/);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw failure(400, 'EMAIL_INVALID');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) throw failure(400, 'PASSWORD_LENGTH');
    if (parts.length < 2 || name.length > 120 || parts[0].length > 60 || parts.slice(1).join(' ').length > 60) throw failure(400, 'NAME_REQUIRED');
    if (body.aiConsent !== true) throw failure(400, 'AI_CONSENT_REQUIRED');
    if (taken(email)) throw failure(409, 'EMAIL_TAKEN');
    if (!ready()) throw failure(503, 'MAIL_NOT_CONFIGURED');
    clean();
    if (sql.prepare('SELECT id FROM registration_challenges WHERE email=?').get(email)) throw failure(429, 'REGISTRATION_PENDING');
    if (sql.prepare('SELECT count(*) AS n FROM registration_challenges').get().n >= 1000) throw failure(429, 'RATE_LIMITED');
    limit(email, req.ip);
    const code = String(randomInt(1000000)).padStart(6, '0');
    const salt = randomBytes(24).toString('hex');
    const row = { id: randomBytes(24).toString('hex'), email, salt, digest: digest(code, salt), expires_at: now() + TTL, resend_at: now() + 60000 };
    // Reserve address before hashing so concurrent requests cannot create duplicate pending records.
    sql.prepare('INSERT INTO registration_challenges(id,email,user_json,digest,salt,expires_at,resend_at) VALUES (?,?,?,?,?,?,?)').run(row.id,email,'{}',row.digest,salt,row.expires_at,row.resend_at);
    const user = { id: uid(), role: 'user', firstName: parts[0], lastName: parts.slice(1).join(' '), email,
      credential: await passwordCredential(body.password), direction: '', course: 1, languages: [], interests: [], skills: [], about: '', color: getData().state.users.length % 5,
      aiConsent: { version: 1, provider: 'gemini', acceptedAt: now(), adultConfirmed: true } };
    sql.prepare('UPDATE registration_challenges SET user_json=? WHERE id=?').run(JSON.stringify(user),row.id);
    res.status(202).json(await deliver(row,code));
  }));
  router.post('/register/resend', run(async (req,res) => {
    clean();
    const row = sql.prepare('SELECT * FROM registration_challenges WHERE id=?').get(String(req.body?.challengeId || ''));
    if (!row) throw failure(400,'CHALLENGE_EXPIRED');
    if (row.attempts >= 5) throw failure(429,'ATTEMPTS_EXHAUSTED');
    if (row.sending === 1 || row.resend_at > now()) throw failure(429,'RESEND_COOLDOWN');
    if (!ready()) throw failure(503,'MAIL_NOT_CONFIGURED');
    limit(row.email,req.ip);
    const code = String(randomInt(1000000)).padStart(6,'0');
    row.digest = digest(code,row.salt); row.resend_at = now() + 60000;
    sql.prepare('UPDATE registration_challenges SET digest=?,resend_at=?,sending=1 WHERE id=?').run(row.digest,row.resend_at,row.id);
    res.status(202).json(await deliver(row,code));
  }));
  router.post('/register/verify', run((req,res) => {
    clean(); limit('',req.ip,'verify');
    const row = sql.prepare('SELECT * FROM registration_challenges WHERE id=?').get(String(req.body?.challengeId || ''));
    if (!row) throw failure(400,'CHALLENGE_EXPIRED');
    if (row.attempts >= 5) throw failure(429,'ATTEMPTS_EXHAUSTED');
    if (row.sending !== 0) throw failure(409,'MAIL_PENDING');
    const code = req.body?.code;
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !timingSafeEqual(Buffer.from(digest(code,row.salt),'hex'),Buffer.from(row.digest,'hex'))) {
      sql.prepare('UPDATE registration_challenges SET attempts=attempts+1 WHERE id=?').run(row.id);
      throw failure(row.attempts === 4 ? 429 : 400,row.attempts === 4 ? 'ATTEMPTS_EXHAUSTED' : 'CODE_INVALID');
    }
    if (taken(row.email)) throw failure(409,'EMAIL_TAKEN');
    const beforeCommit = connection => {
      const result = connection.prepare('DELETE FROM registration_challenges WHERE id=? AND digest=? AND expires_at>? AND attempts<5 AND sending=0').run(row.id,row.digest,now());
      if (result.changes !== 1) throw failure(409,'CHALLENGE_CONSUMED');
    };
    const result = onVerified(JSON.parse(row.user_json),{ beforeCommit });
    res.status(201).json(result);
  }));
  return router;
}
