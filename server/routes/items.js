import { Router } from 'express';
import { CATEGORIES } from '../data.js';
import { lesson } from '../store.js';
import { checkToken } from '../auth.js';

const router = Router();
function input(body) {
  if (typeof body.title !== 'string' || (body.body !== undefined && typeof body.body !== 'string'))
    return { error: 'Заголовок и текст должны быть строками' };
  const title = body.title.trim(), text = (body.body || '').trim(), category = body.category;
  if (title.length < 8 || title.length > 180) return { error: 'Заголовок должен быть от 8 до 180 символов' };
  if (text.length > 2000) return { error: 'Текст не длиннее 2000 символов' };
  if (!CATEGORIES.includes(category)) return { error: 'Категория должна быть одной из: ' + CATEGORIES.join(', ') };
  return { title, body: text, category };
}
const idOf = req => /^\d+$/.test(req.params.id) && Number.isSafeInteger(Number(req.params.id)) ? Number(req.params.id) : -1;
router.get('/', (req, res) => {
  if (Object.values(req.query).some(v => typeof v !== 'string')) return res.status(400).json({ error: 'Некорректный фильтр' });
  res.json(lesson.items(req.query));
});
router.get('/:id', (req, res) => {
  const item = lesson.item(idOf(req));
  if (!item) return res.status(404).json({ error: 'Вопрос не найден' });
  res.json({ ...item, answers: lesson.records({ item_id: item.id }) });
});
router.post('/', checkToken, (req, res) => {
  const data = input(req.body);
  if (data.error) return res.status(400).json(data);
  res.status(201).json(lesson.addItem(data, req.user));
});
router.patch('/:id', checkToken, (req, res) => {
  const item = lesson.item(idOf(req));
  if (!item) return res.status(404).json({ error: 'Вопрос не найден' });
  if (item.author !== req.user.login && req.user.role !== 'admin') return res.status(403).json({ error: 'Можно изменять только свои вопросы' });
  const data = input({ ...item, ...req.body });
  if (data.error) return res.status(400).json(data);
  res.json(lesson.updateItem(item.id, data));
});
router.delete('/:id', checkToken, (req, res) => {
  const item = lesson.item(idOf(req));
  if (!item) return res.status(404).json({ error: 'Вопрос не найден' });
  if (item.author !== req.user.login && req.user.role !== 'admin') return res.status(403).json({ error: 'Можно удалять только свои вопросы' });
  lesson.deleteItem(item.id);
  res.json({ ok: true });
});
export default router;
