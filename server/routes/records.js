import { Router } from 'express';
import { lesson } from '../store.js';
import { checkToken } from '../auth.js';

const router = Router();
router.get('/records', (req, res) => {
  if (Object.values(req.query).some(v => typeof v !== 'string')) return res.status(400).json({ error: 'Некорректный фильтр' });
  const id = req.query.item_id;
  if (id !== undefined && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))) return res.status(400).json({ error: 'Некорректный номер вопроса' });
  res.json(lesson.records({ ...(id !== undefined ? { item_id: Number(id) } : {}), author: req.query.author }));
});
router.get('/records/my', checkToken, (req, res) => res.json(lesson.records({ author: req.user.login })));
router.post('/records', checkToken, (req, res) => {
  const item_id = Number(req.body.item_id);
  if (!Number.isSafeInteger(item_id) || item_id < 1 || !['number', 'string'].includes(typeof req.body.item_id) || typeof req.body.body !== 'string')
    return res.status(400).json({ error: 'Нужны номер вопроса и текст ответа' });
  if (!lesson.item(item_id)) return res.status(400).json({ error: 'Вопроса с таким item_id нет' });
  const body = req.body.body.trim();
  if (body.length < 5 || body.length > 2000) return res.status(400).json({ error: 'Ответ должен быть от 5 до 2000 символов' });
  res.status(201).json(lesson.addRecord({ item_id, body }, req.user));
});
router.patch('/records/:id/rating', checkToken, (req, res) => {
  const id = /^\d+$/.test(req.params.id) && Number.isSafeInteger(Number(req.params.id)) ? Number(req.params.id) : -1;
  const record = lesson.record(id);
  if (!record) return res.status(404).json({ error: 'Ответ не найден' });
  const item = lesson.item(record.item_id);
  if (item.author !== req.user.login || record.author === req.user.login) return res.status(403).json({ error: 'Оценить ответ может только автор вопроса' });
  if (!Number.isInteger(req.body.rating) || req.body.rating < 1 || req.body.rating > 5) return res.status(400).json({ error: 'Оценка от 1 до 5' });
  res.json(lesson.rateRecord(record.id, req.body.rating));
});
router.get('/rating', (req, res) => res.json(lesson.ranking()));
export default router;
