# Публикация в Amvera

Сайт: [medium-bob01.amvera.io](https://medium-bob01.amvera.io/). Приложение `medium`, аккаунт `bob01`, регион `msk0`.

Docker собирает сайт на Node.js 24. Nginx отдаёт содержимое `dist/` на порту 80.

## Обновление сайта

Из папки проекта подготовь файлы для загрузки:

```sh
mkdir -p ../medium-amvera-upload
cp deploy/amvera/Dockerfile ../medium-amvera-upload/Dockerfile
git archive --format=tar.gz --output=../medium-amvera-upload/source.tar.gz HEAD src public index.html package.json package-lock.json vite.config.js postcss.config.js tailwind.config.js
```

1. В Amvera открой «Репозиторий», вкладку Code и нажми «Загрузить данные». Для обновления достаточно `source.tar.gz`. При первой публикации загрузи также `Dockerfile`.
2. В «Конфигурации» выбери окружение и инструмент `docker`, Dockerfile `Dockerfile`, порт 80 и путь постоянного хранилища `/data`. Если эти значения уже сохранены, менять их не нужно.
3. Нажми «Собрать». Дождись статуса «Запущено» и открой сайт по внешнему адресу. Если после сборки приложение остановлено, нажми кнопку запуска.

Архив должен называться `source.tar.gz`: Dockerfile распаковывает его при сборке. Синхронизация с GitHub не подключена, поэтому после изменений архив нужно загрузить заново.

Профили и сообщения сохраняются в браузере посетителя. Для обмена данными между устройствами нужна серверная часть.
