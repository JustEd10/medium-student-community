# Медиум

Сайт для иностранных студентов и студентов-мигрантов: знакомства по языкам и интересам, вопросы об университете, помощь с учёбой и личные сообщения. Интерфейс доступен на русском и английском.

[Открыть сайт](https://medium-bob01.amvera.io/) · [Макет в Figma](https://www.figma.com/design/78urA9a9EggvJYdgLotj5L/Untitled?node-id=0-1&t=x3YhCRRbUUCU5oZ9-1)

Фронтенд: React и Vite. Бэкенд: Node.js и Express.

## Запуск

Нужна Node.js 24.

```bash
npm ci
npm run build
npm start
```

Сайт откроется на `http://localhost:3000`. Переменная `PORT` меняет порт, `DATA_DIR` задаёт каталог данных (по умолчанию `server/storage`).

Для разработки запусти в двух терминалах:

```bash
npm run server
npm run dev
```

Проверки: `npm test`.

## API

| Адрес | Назначение |
| --- | --- |
| `GET /hello`, `/time`, `/random` | Приветствие, время и случайное число |
| `GET /api/app/state` | Данные основного сайта |
| `POST /api/app/auth/register`, `/api/app/auth/login` | Регистрация и вход |
| `POST /api/app/auth/demo`, `/api/app/auth/logout` | Демо-вход и выход |
| `POST /api/app/act` | Вопросы, ответы, помощь, сообщения и профиль |
| `/api/items`, `/api/records` | Учебное REST API вопросов и ответов |

```bash
curl http://localhost:3000/hello
curl http://localhost:3000/api/app/state
```

[Полный список методов и примеры запросов](docs/API.md). Учебное задание можно показать на странице `/app/`; она использует отдельные данные и сессии.

## Размещение и материалы

Основной сайт сохраняет данные в JSON-файле. Для Docker и Amvera нужен постоянный каталог `/data` и одна реплика приложения. [Инструкция размещения](deploy/amvera/README.md).

- [Скриншоты сайта и работы API](docs/screenshots/README.md).
- [Сверка с «Отработкой 3»](docs/REVIEW-2026-10-10.md).
- [Отчёт проекта](docs/REPORT.md).
