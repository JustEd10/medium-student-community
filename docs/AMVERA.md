# Развёртывание в Amvera

Сайт: [medium-bob01.amvera.io](https://medium-bob01.amvera.io/).

Сайт работает в приложении `medium`, аккаунте `bob01`, регионе `msk0`. Для публикации через Safari в раздел Code загружены `Dockerfile` и `source.tar.gz`, затем запущена сборка. Создан бесплатный внешний HTTPS-домен. Дополнительные реплики и тариф не менялись.

Docker собирает React/Vite на Node.js 24 и отдаёт только `dist/` через Nginx на порту 80. Обновлённый архив соответствует коммиту `08fe1775b2d8975f1491b812c95abf32a99ad285`: исправлены URL иконок в production-сборке. Перед публикацией проверено, что все 32 файла архива совпадают с локальными исходниками. SHA-256 архива: `e737bfb1f6471f4e985226a9103b94d3fb5548514adbc85f33a98a816e11e5ca`. В [GitHub Actions](https://github.com/JustEd10/medium-student-community/actions/runs/37602043989) прошли 7 тестов логики и 16 браузерных тестов production-сборки в Chromium и Firefox.

После обновления в Amvera стоит статус «Запущено», работает 1 из 1 реплик. HTML, JavaScript, CSS и все 10 SVG-иконок на внешнем HTTPS-адресе совпадают с локальной production-сборкой и возвращают HTTP 200. В Safari проверены звёзды, рейтинг и иконки меню и фильтров. Результат проверки записан в `deployment-check.json`.

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
