# Развёртывание в Amvera

Сайт: [medium-bob01.amvera.io](https://medium-bob01.amvera.io/).

Сайт работает в приложении `medium`, аккаунте `bob01`, регионе `msk0`. Для публикации через Safari в раздел Code загружены `Dockerfile` и `source.tar.gz`, затем запущена сборка. Создан бесплатный внешний HTTPS-домен. Дополнительные реплики и тариф не менялись.

Docker собирает React/Vite на Node.js 24 и отдаёт только `dist/` через Nginx на порту 80. Последний загруженный архив соответствует проверенному коммиту `ac587ab9955c0aa181a3ca810f2ecb129f8c2130`. Все 33 файла архива совпадают с его исходниками. SHA-256 архива: `55ca82d2a2bd6fdf0d7eff3db549ba36cccae852c8d0b6d7371e4d5411cdfb34`. В [GitHub Actions](https://github.com/JustEd10/medium-student-community/actions/runs/37667184941) прошли 7 тестов логики и 30 браузерных тестов production-сборки в Chromium, Firefox и WebKit.

Архив загружен через Safari в коммит Amvera `a9ad40424e5b84b9282ca3368e9f08e498c22805`. После сборки подтверждены статус «Запущено» и 1 из 1 реплик. HTML и 15 файлов — JavaScript, CSS, фон, два логотипа и 10 SVG-иконок — совпадают с локальной production-сборкой и возвращают HTTP 200. На опубликованной версии проверены перемещение подсветки вкладок, полная непрозрачность текста и переход из меню с фокусом на заголовке новой страницы. Результат записан в `deployment-check.json`.

## Повторная публикация через Safari

Подготовь рядом с репозиторием папку с двумя файлами:

```sh
mkdir -p ../medium-amvera-upload
cp deploy/amvera/Dockerfile ../medium-amvera-upload/Dockerfile
git archive --format=tar.gz --output=../medium-amvera-upload/source.tar.gz HEAD src public index.html package.json package-lock.json vite.config.js postcss.config.js tailwind.config.js
```

В Amvera открой «Репозиторий», вкладку Code и нажми «Загрузить данные». Загрузи оба файла, затем открой «Конфигурация» и нажми «Собрать». Архив должен называться `source.tar.gz`: Docker распакует его при сборке. Дождись статуса «Запущено» и проверь внешний HTTPS-адрес.

Чтобы опубликовать изменения из GitHub, снова упакуй исходники и загрузи их через Safari. Автоматическая синхронизация с GitHub пока не подключена.

Профили, сообщения, вопросы и оценки сохраняются в браузере посетителя. Для хранения данных на сервере и переписки между устройствами нужна серверная часть.
