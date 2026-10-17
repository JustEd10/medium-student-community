# Медиум

Сайт для иностранных студентов и студентов-мигрантов: знакомства по языкам и интересам, вопросы об университете, помощь с учёбой и личные сообщения. Интерфейс доступен на русском и английском.

[Открыть сайт](https://medium-warsaw-bob01.waw0.amvera.tech/) · [Макет в Figma](https://www.figma.com/design/78urA9a9EggvJYdgLotj5L/Untitled?node-id=0-1&t=x3YhCRRbUUCU5oZ9-1)

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
| `POST /api/app/auth/logout` | Выход |
| `POST /api/app/act` | Вопросы, ответы, помощь, сообщения, профиль и удаление своих публикаций |
| `/api/items`, `/api/records` | Учебное REST API вопросов и ответов |

```bash
curl http://localhost:3000/hello
curl http://localhost:3000/api/app/state
```

[Полный список методов и примеры запросов](docs/API.md). Учебное задание можно показать на странице `/app/`; она использует отдельные данные и сессии.

## База данных

[Схема, связи, транзакции, индексы, перенос данных и восстановление](docs/database/README.md).

```sh
npm run db:verify
npm run db:benchmark
```

[Коллекция Postman для локальной проверки](docs/database/Medium-SQLite.postman_collection.json).

## Размещение и материалы

Основной сайт и учебное API сохраняют данные в SQLite (`DATA_DIR/medium.sqlite`). При первом запуске существующий `db.json` переносится автоматически и остаётся неизменным. Для Docker и Amvera нужен постоянный каталог `/data` и одна реплика приложения. [Инструкция размещения](deploy/amvera/README.md).

- [Скриншоты сайта и работы API](docs/screenshots/README.md).
- [Отчёт проекта](docs/REPORT.md).
