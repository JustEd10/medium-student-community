import { Router } from 'express';
import { lesson } from '../store.js';
import { getToken } from '../auth.js';

const router = Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  const session = lesson.login(login, password);
  if (!session) return res.status(401).json({ error: 'Неверный логин или пароль' });
  res.json(session);
});

router.post('/logout', (req, res) => {
  lesson.logout(getToken(req));
  res.json({ ok: true });
});

export default router;
