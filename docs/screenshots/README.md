# Скриншоты реализации

Скриншоты сняты Playwright в Chromium после обновления интерфейса и прокрутки чатов от 7 октября 2026 года. Размер окна: 1440 × 900 для ПК и 390 × 844 для телефона. Длинные страницы сняты целиком. На экранах видны демо-профили, вопросы и запросы помощи.

| Экран | ПК | Телефон |
| --- | --- | --- |
| Главная | [Открыть](desktop-home.jpg) | [Открыть](mobile-home.jpg) |
| Знакомства | [Открыть](desktop-people.jpg) | [Открыть](mobile-people.jpg) |
| Профиль | [Открыть](desktop-profile.jpg) | [Открыть](mobile-profile.jpg) |
| Вопросы | [Открыть](desktop-questions.jpg) | [Открыть](mobile-questions.jpg) |
| Ответы и 5 звёзд | [Открыть](desktop-answer-rating.jpg) | [Открыть](mobile-answer-rating.jpg) |
| Рейтинг | [Открыть](desktop-leaderboard.jpg) | [Открыть](mobile-leaderboard.jpg) |
| Помощь с учёбой | [Открыть](desktop-study.jpg) | [Открыть](mobile-study.jpg) |
| Запрос помощи | [Открыть](desktop-help-rating.jpg) | [Открыть](mobile-help-rating.jpg) |
| Переписка | [Открыть](desktop-chat.jpg) | [Открыть](mobile-chat.jpg) |

Источник: [GitHub Actions, запуск 37683050939](https://github.com/JustEd10/medium-student-community/actions/runs/37683050939), коммит `139fd03ae8d65a0514b6e2c8338ce72d0b864926`. В CI прошли 33 браузерных сценария в Chromium, Firefox и WebKit; проверены также английские версии шести изменённых страниц при ширине 1440, 768, 390 и 320 пикселей.

Гостевые экраны телефона: [главная](mobile-guest-home.jpg), [вопрос с кнопкой возврата](mobile-guest-answer.jpg).

Отдельный [тест длинной переписки](desktop-long-chat.jpg) использует 60 сообщений и 35 дополнительных диалогов в изолированном браузере. Это тестовые данные для проверки прокрутки.
