// Все данные лежат в памяти, после перезапуска сервера сбрасываются

export const CATEGORIES = ['Документы', 'Учёба', 'Кампус', 'Языки', 'События'];

export const users = [
  { login: 'admin', password: '12345', role: 'admin' },
  { login: 'user', password: 'qwerty', role: 'user' },
  { login: 'alina', password: 'alina2026', role: 'user' },
  { login: 'wei', password: 'wei2026', role: 'user' },
];

// token -> login
export const tokens = new Map();

// items = вопросы студентов
export const items = [
  {
    id: 1,
    title: 'Когда можно получить студенческий билет?',
    body: 'Подала документы и уже хожу на занятия. Где узнать о готовности билета?',
    category: 'Документы',
    author: 'alina',
    createdAt: '2026-10-06T10:00:00.000Z',
  },
  {
    id: 2,
    title: 'Где найти расписание занятий?',
    body: 'На сайте много разделов на русском, не могу найти расписание своей группы.',
    category: 'Учёба',
    author: 'user',
    createdAt: '2026-10-06T09:00:00.000Z',
  },
  {
    id: 3,
    title: 'Кто хочет практиковать русский и английский?',
    body: 'Предлагаю встречаться после занятий и общаться на двух языках.',
    category: 'Языки',
    author: 'wei',
    createdAt: '2026-10-06T08:00:00.000Z',
  },
];

// records = ответы на вопросы, хранят только item_id
export const records = [
  {
    id: 1,
    item_id: 1,
    author: 'wei',
    body: 'Наша группа узнавала через куратора, напиши ему или старосте.',
    rating: null,
    createdAt: '2026-10-06T10:05:00.000Z',
  },
  {
    id: 2,
    item_id: 2,
    author: 'alina',
    body: 'Посмотри раздел «Расписание» на сайте университета, выбери факультет и группу.',
    rating: 5,
    createdAt: '2026-10-06T10:10:00.000Z',
  },
];

export const counters = { item: 4, record: 3 };
