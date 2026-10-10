import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import authRoutes from './routes/auth.js';
import itemRoutes from './routes/items.js';
import recordRoutes from './routes/records.js';
import appRoutes from './routes/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const dist = path.join(__dirname, '..', 'dist');
const HELLO = 'Привет, это сервер моего сайта';

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.vary('Authorization');
  if (req.method === 'POST' && req.path.endsWith('/logout') && req.body == null) {
    req.body = {};
  }
  if (['POST', 'PATCH'].includes(req.method) &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
    return res.status(400).json({ error: 'Ожидается JSON-объект' });
  }
  next();
});

app.get('/hello', (req, res) => res.send(HELLO));
app.get('/time', (req, res) => res.json({ time: new Date().toISOString() }));
app.get('/random', (req, res) => res.json({ random: Math.floor(Math.random() * 100) + 1 }));

app.get('/api/demo', (req, res) => {
  res.json([
    { id: 1, title: 'Первый элемент', price: 250 },
    { id: 2, title: 'Второй элемент', price: 280 },
    { id: 3, title: 'Третий элемент', price: 180 },
  ]);
});

app.use('/api', authRoutes);
app.use('/api/items', itemRoutes);
app.use('/api', recordRoutes);
app.use('/api/app', appRoutes);

app.use('/app', express.static(path.join(__dirname, 'public')));

// собранный React-сайт раздаём, только если уже был npm run build
if (fs.existsSync(path.join(dist, 'index.html'))) app.use(express.static(dist));
// пока сайт не собран, на главной отвечает сам сервер
app.get('/', (req, res) => res.send(HELLO));

app.use('/api', (req, res) => res.status(404).json({ error: 'Такого адреса нет' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'Некорректный JSON' });
  if (err.type === 'entity.too.large')
    return res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.code === 'STORAGE_UNAVAILABLE')
    return res.status(503).json({ error: 'STORAGE_UNAVAILABLE' });
  console.error(err);
  res.status(500).json({ error: 'Ошибка сервера' });
});

app.listen(PORT, () => console.log(`Сервер запущен: http://localhost:${PORT}`));
