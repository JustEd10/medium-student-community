import { tokens, users } from './data.js';

export function getToken(req) {
  const header = req.headers.authorization || '';
  return /^Bearer\s+(\S+)$/i.exec(header)?.[1] || '';
}

export function checkToken(req, res, next) {
  const login = tokens.get(getToken(req));
  if (!login)
    return res.status(401).json({ error: 'Нужен токен, сначала войди через POST /api/login' });
  req.user = users.find((u) => u.login === login);
  if (!req.user) return res.status(401).json({ error: 'Пользователь не найден' });
  next();
}
