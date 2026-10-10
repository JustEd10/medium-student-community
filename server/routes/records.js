import { Router } from 'express';
import { items, records, users, counters } from '../data.js';
import { checkToken } from '../auth.js';

const router = Router();

// подставляем название вопроса по item_id (ручной JOIN)
function withTitle(record) {
  const item = items.find((i) => i.id === record.item_id);
  return { ...record, item_title: item ? item.title : null };
}

router.get('/records', (req, res) => {
  const { item_id, author } = req.query;
  let list = records;
  if (item_id) list = list.filter((r) => r.item_id === Number(item_id));
  if (author) list = list.filter((r) => r.author === author);
  res.json(list.map(withTitle));
});

// "Мои записи" - только ответы текущего пользователя
router.get('/records/my', checkToken, (req, res) => {
  const mine = records.filter((r) => r.author === req.user.login);
  res.json(mine.map(withTitle));
});

router.post('/records', checkToken, (req, res) => {
  const item_id = Number(req.body.item_id);
  if (!Number.isSafeInteger(item_id) || item_id < 1 ||
      !['number', 'string'].includes(typeof req.body.item_id) ||
      typeof req.body.body !== 'string')
    return res.status(400).json({ error: 'Нужны номер вопроса и текст ответа' });
  const body = req.body.body.trim();
  const item = items.find((i) => i.id === item_id);
  if (!item) return res.status(400).json({ error: 'Вопроса с таким item_id нет' });
  if (body.length < 5 || body.length > 2000)
    return res.status(400).json({ error: 'Ответ должен быть от 5 до 2000 символов' });

  const record = {
    id: counters.record++,
    item_id,
    author: req.user.login,
    body,
    rating: null,
    createdAt: new Date().toISOString(),
  };
  records.push(record);
  res.status(201).json(withTitle(record));
});

// оценить ответ может только автор вопроса, и не свой собственный ответ
router.patch('/records/:id/rating', checkToken, (req, res) => {
  const record = records.find((r) => r.id === Number(req.params.id));
  if (!record) return res.status(404).json({ error: 'Ответ не найден' });
  const item = items.find((i) => i.id === record.item_id);
  if (!item) return res.status(404).json({ error: 'Вопрос не найден' });
  if (item.author !== req.user.login || record.author === req.user.login) {
    return res.status(403).json({ error: 'Оценить ответ может только автор вопроса' });
  }
  const rating = req.body.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: 'Оценка от 1 до 5' });
  record.rating = rating;
  res.json(withTitle(record));
});

// рейтинг участников по оценкам их ответов
router.get('/rating', (req, res) => {
  const list = users.map((u) => {
    const rated = records.filter((r) => r.author === u.login && r.rating !== null);
    const total = rated.reduce((sum, r) => sum + r.rating, 0);
    return {
      login: u.login,
      total,
      count: rated.length,
      average: rated.length ? +(total / rated.length).toFixed(2) : 0,
    };
  });
  list.sort((a, b) => b.total - a.total || b.count - a.count);
  res.json(list);
});

export default router;
