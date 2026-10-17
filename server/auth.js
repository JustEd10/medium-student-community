import { lesson } from './store.js';

export function getToken(req) {
  const header = req.headers.authorization || '';
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] || '';
}

export function checkToken(req, res, next) {
  const user = lesson.userForToken(getToken(req));
  if (!user)
    return res.status(401).json({ error: 'Нужен токен, сначала войди через POST /api/login' });
  req.user = user;
  next();
}
