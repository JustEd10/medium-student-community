import { Router } from 'express';
import { items, records, counters, CATEGORIES } from '../data.js';
import { checkToken } from '../auth.js';

const router = Router();

function withCount(item) {
  return {
    ...item,
    answersCount: records.filter((r) => r.item_id === item.id).length,
    bodyLength: item.body.length,
  };
}

// ?category=Учёба&search=билет&sort=answers&author=alina
router.get('/', (req, res) => {
  const { category, search, sort, author } = req.query;
  let list = items.map(withCount);
  if (category) list = list.filter((i) => i.category === category);
  if (author) list = list.filter((i) => i.author === author);
  if (search) {
    const s = String(search).toLowerCase();
    list = list.filter((i) => (i.title + ' ' + i.body).toLowerCase().includes(s));
  }
  if (sort === 'answers') list.sort((a, b) => b.answersCount - a.answersCount);
  else list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list);
});

router.get('/:id', (req, res) => {
  const item = items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Вопрос не найден' });
  const answers = records.filter((r) => r.item_id === item.id);
  res.json({ ...withCount(item), answers });
});

router.post('/', checkToken, (req, res) => {
  if (typeof req.body.title !== 'string' ||
      (req.body.body !== undefined && typeof req.body.body !== 'string'))
    return res.status(400).json({ error: 'Заголовок и текст должны быть строками' });
  const title = req.body.title.trim();
  const body = (req.body.body || '').trim();
  const category = req.body.category;
  if (title.length < 8 || title.length > 180)
    return res.status(400).json({ error: 'Заголовок должен быть от 8 до 180 символов' });
  if (body.length > 2000) return res.status(400).json({ error: 'Текст не длиннее 2000 символов' });
  if (!CATEGORIES.includes(category)) {
    const error = 'Категория должна быть одной из: ' + CATEGORIES.join(', ');
    return res.status(400).json({ error });
  }

  const item = {
    id: counters.item++,
    title,
    body,
    category,
    author: req.user.login,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  res.status(201).json(withCount(item));
});

router.delete('/:id', checkToken, (req, res) => {
  const id = Number(req.params.id);
  const index = items.findIndex((i) => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Вопрос не найден' });
  // чужие вопросы может удалять только админ
  if (items[index].author !== req.user.login && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Можно удалять только свои вопросы' });
  }
  items.splice(index, 1);
  // вместе с вопросом убираем ответы (идём с конца, чтобы splice не сбивал индексы)
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].item_id === id) records.splice(i, 1);
  }
  res.json({ ok: true });
});

export default router;
