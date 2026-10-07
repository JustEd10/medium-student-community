# Развёртывание в Amvera

Сайт: [medium-bob01.amvera.io](https://medium-bob01.amvera.io/).

Приложение: `medium`, аккаунт `bob01`, регион `msk0`. Сайт опубликован через Safari: в Code загружены `Dockerfile` и `source.tar.gz`, затем запущена сборка. Создан бесплатный внешний HTTPS-домен. Дополнительные реплики и тариф не менялись.

Docker собирает React/Vite на Node.js 24 и отдаёт только `dist/` через Nginx на порту 80. Обновлённый архив соответствует коммиту `08fe1775b2d8975f1491b812c95abf32a99ad285`: исправлены URL иконок в production-сборке. Все 32 файла архива сопоставлены с локальными исходниками перед публикацией. SHA-256 архива: `e737bfb1f6471f4e985226a9103b94d3fb5548514adbc85f33a98a816e11e5ca`. В [GitHub Actions](https://github.com/JustEd10/medium-student-community/actions/runs/37602043989) прошли 7 тестов логики и 16 браузерных тестов production-сборки в Chromium и Firefox.

После обновления Amvera показывает **Запущено**, 1 из 1 реплик. HTML, JavaScript, CSS и все 10 SVG-иконок на внешнем HTTPS-адресе совпадают с локальной production-сборкой и возвращают HTTP 200. В Safari проверены звёзды, рейтинг и иконки меню и фильтров. Подробности — в `deployment-check.json`.

## Повторная публикация через Safari

В корне репозитория подготовить отдельную папку с двумя файлами:

```sh
mkdir -p ../medium-amvera-upload
cp deploy/amvera/Dockerfile ../medium-amvera-upload/Dockerfile
git archive --format=tar.gz --output=../medium-amvera-upload/source.tar.gz HEAD src public index.html package.json package-lock.json vite.config.js postcss.config.js tailwind.config.js
```

В приложении Amvera открыть **Репозиторий → Code → Загрузить данные**, загрузить эти два файла, затем **Конфигурация → Собрать**. Dockerfile ожидает именно имя `source.tar.gz`. Содержимое TAR извлекается Docker при сборке. После загрузки нужно дождаться статуса **Запущено** и проверить внешний HTTPS-адрес.

Автоматическая синхронизация с GitHub не подключена: публикация выполнена загрузкой файлов через Safari. Изменения в GitHub нужно повторно упаковать и загрузить.

Профили, сообщения, вопросы и оценки по-прежнему сохраняются в браузере посетителя. Хостинг frontend не добавляет серверную базу данных или переписку между устройствами.
