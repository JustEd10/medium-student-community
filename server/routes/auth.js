import crypto from 'crypto';
import { Router } from 'express';
import { users, tokens } from '../data.js';
import { getToken } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  const user = users.find((u) => u.login === login && u.password === password);
  if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, user.login);
  res.json({ token, login: user.login, role: user.role });
});

router.post('/logout', (req, res) => {
  tokens.delete(getToken(req));
  res.json({ ok: true });
});

export default router;
