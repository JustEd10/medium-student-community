# Актуальные скриншоты (10.10.2026)

Сняты с исправленной локальной версии `http://127.0.0.1:4183/`. Использованы вымышленные демо-профили и отдельный каталог данных. Для основного сайта задан экран ПК 1440 × 900 и телефона 390 × 844; часть снимков показывает всю страницу. Размер изображения может отличаться от размера окна из-за полосы прокрутки и полного захвата страницы.

[Галерея всех снимков](current/index.html) · [Вывод реальных запросов curl](current/api-curl.txt)

## Сайт и учебная страница

| Страница | ПК | Телефон |
| --- | --- | --- |
| Главная | [Открыть](current/desktop-home.jpg) | [Открыть](current/mobile-home.jpg) |
| Вход | [Открыть](current/desktop-login.jpg) | [Открыть](current/mobile-login.jpg) |
| Знакомства | [Открыть](current/desktop-people.jpg) | [Открыть](current/mobile-people.jpg) |
| Карточка студента | [Открыть](current/desktop-person.jpg) | [Открыть](current/mobile-person.jpg) |
| Редактирование профиля | [Открыть](current/desktop-profile.jpg) | [Открыть](current/mobile-profile.jpg) |
| Вопросы | [Открыть](current/desktop-questions.jpg) | [Открыть](current/mobile-questions.jpg) |
| Ответы и пять звёзд | [Открыть](current/desktop-question.jpg) | [Открыть](current/mobile-question.jpg) |
| Рейтинг | [Открыть](current/desktop-rating.jpg) | [Открыть](current/mobile-rating.jpg) |
| Помощь с учёбой | [Открыть](current/desktop-study.jpg) | [Открыть](current/mobile-study.jpg) |
| Публикация запроса | [Открыть](current/desktop-study-form.jpg) | [Открыть](current/mobile-study-form.jpg) |
| Переписка | [Открыть](current/desktop-chats.jpg) | [Открыть](current/mobile-chat.jpg) |
| Учебная страница: список с сервера | [Открыть](current/lesson-desktop-list.jpg) | [Открыть](current/lesson-mobile-list.jpg) |
| Учебная страница: «Мои записи» | [Открыть](current/lesson-desktop-my-records.jpg) | [Открыть](current/lesson-mobile-my-records.jpg) |
| Учебная страница: демо-массив | [Открыть](current/lesson-desktop-demo.jpg) | [Открыть](current/lesson-mobile-demo.jpg) |

Дополнительно: [учебная страница после входа](current/lesson-desktop-login.jpg), [список мобильных диалогов](current/mobile-chats-list.jpg), [поле сообщения при шести строках](current/mobile-chat-draft.jpg).

## API через curl

Это снимки страницы с сохранённым выводом реально выполненных команд curl. Полный текст команд и ответов лежит в `api-curl.txt`; случайные токены скрыты.

- [Приветствие, время, случайное число и массив](current/api-curl-1-server.jpg).
- [Список вопросов и один вопрос](current/api-curl-2-items.jpg).
- [Вход и создание вопроса](current/api-curl-3-login.jpg).
- [Связь ответа с вопросом и «Мои записи»](current/api-curl-4-records.jpg).
- [Удаление вопроса](current/api-curl-5-delete.jpg).

Сценарий интерфейса: открыть `/app/`, войти как `user / qwerty`, ответить на вопрос о разговорном клубе. После отправки ответ виден в общем списке и в разделе «Мои записи». Пример создан только в локальной учебной версии. Данные этого API сбрасываются при перезапуске.

Предыдущие изображения не входят в этот комплект; исходный архив разработчика сохранён отдельно.
