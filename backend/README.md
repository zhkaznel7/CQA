<<<<<<< HEAD
# CQA Backend — этап 4

Express + PostgreSQL + Prisma, JavaScript ES Modules. Требуется Node.js >= 22.13.0;
Docker использует Node.js 24 LTS. Prisma Client, CLI и PostgreSQL adapter — 7.10.1.
Реализованы Conversations API, Checklists API и независимый Scoring Engine.
AI, Frontend, evaluations API и appeals API не реализованы.

## Scoring Engine

Чистая синхронная функция `calculateScore(checklistVersion, answers)` находится в
`src/modules/scoring/scoring.service.js`. Она принимает версию чек-листа из API или
Prisma-запись с criteria, проверяет полные ответы и возвращает total из 100, вклад каждого
критерия, перераспределённые максимумы, секции и grossError. Сетевых запросов и записи в БД нет.
Контракт, пример, ограничения N/A и округления: [docs/scoring.md](docs/scoring.md).

Unit-тесты работают без `.env`, PostgreSQL, Docker и AI:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd run test:scoring
```

Контрольные результаты: 100, 0, 88.13 и 100. Флаг грубой ошибки не меняет total.
Проверено: 25 scoring unit-тестов и полный набор из 48 тестов на отдельной новой
базе cqa_stage4_test (PostgreSQL 18.6); все прошли.
Неполные ответы, неизвестные критерии, запрещённый N/A и недопустимые ступени — ошибки.
Разрешение N/A в существующей конфигурации называется `allowNa`.
Для N/A нужны `naConditionMet=true` и непустой `naReason`; интерпретация текста диалога
не относится к математическому движку. Миграции и сохранённые оценки не изменены.

## Conversations и Checklists

Контракт, примеры и HTTP-статусы: [docs/api.md](docs/api.md).
Официальная конфигурация: `prisma/seed/official-checklist.json`;
источник и сверка всех трёх страниц: [docs/official-checklist-source.md](docs/official-checklist-source.md).

После настройки локального DATABASE_URL и применения миграций:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed:official
npm.cmd run dev
```

Seed создаёт первую версию официального чек-листа: 8 критериев, веса семи равны 100,
восьмой — флаг без баллов. Повторный seed проверяет совпадение версии и не изменяет её.
PDF является только локальным источником: исключён из Git и Docker build context.

В другом окне PowerShell:

```powershell
$base = 'http://127.0.0.1:3000'
Invoke-RestMethod "$base/api/health"
Invoke-RestMethod "$base/api/conversations/import" -Method Post -ContentType 'application/json' -Body '{}'
$list = Invoke-RestMethod "$base/api/conversations?language=RU&page=1&pageSize=10"
$list | ConvertTo-Json -Depth 10
Invoke-RestMethod "$base/api/conversations/$($list.data[0].id)"
$checklists = Invoke-RestMethod "$base/api/checklists?key=freedom-broker-chat-quality"
Invoke-RestMethod "$base/api/checklists/$($checklists.data[0].id)" | ConvertTo-Json -Depth 20
```

По умолчанию `IMPORT_SOURCE=mock`: импортируются только три синтетических диалога.
Повторный импорт не изменяет записи с тем же externalId, включая их транскрипты.
Результат содержит количество импортированных, дубликатов и некорректных записей.
Для реального источника задайте в `.env` `IMPORT_SOURCE=organizers`, фиксированный
HTTPS `ORGANIZER_API_URL` и при необходимости `ORGANIZER_API_TOKEN` (Bearer).
Публичный запрос не может выбирать URL. Redirects запрещены; действуют timeout,
ограничения размера ответа и количества записей. Приватный URL и токен не логируются.
Ожидаемый формат источника описан в API-документации; реальная ссылка не предполагается.

Создание пользовательского чек-листа из официальной структуры:

```powershell
$payload = Get-Content -Raw -Encoding UTF8 prisma/seed/official-checklist.json | ConvertFrom-Json
$payload.key = 'demo-' + [guid]::NewGuid().ToString('N')
$json = $payload | ConvertTo-Json -Depth 30
$created = Invoke-RestMethod "$base/api/checklists" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
$payload.PSObject.Properties.Remove('key')
$payload.name = 'Новая версия демонстрационного чек-листа'
$json = $payload | ConvertTo-Json -Depth 30
Invoke-RestMethod "$base/api/checklists/$($created.data.id)" -Method Put -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
```

POST и PUT возвращают 201. PUT принимает полную новую конфигурацию без key и создаёт
новую запись. Для добавления/замены критериев измените массив criteria в payload;
переключение типов и шкал не требует изменения кода. Старые версии остаются доступны.

Тесты запускайте только на отдельном PostgreSQL с именем базы, содержащим `test`:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:migrate
npm.cmd test
Remove-Item Env:DATABASE_URL
```

HTTP- и DB-тесты используют синтетические данные и откатывают транзакции. Проверки
внешнего API выполняются через mock fetch, без реального API и реальных клиентов.
Проверено локально на изолированном PostgreSQL 18.6: свежие миграции, повторный seed,
23 API/DB-теста (включая регрессию этапа 2 и реальный отказ соединения БД).
Scoring проверяется отдельно через `test:scoring` и также входит в `npm test`.
Docker runtime в этом окружении недоступен.

## Docker Desktop / PowerShell

Требуется запущенный Docker Desktop с Linux containers и Compose v2.

```powershell
Set-Location C:\Users\zhanel\CQA\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad.exe .env
```

Задайте непустой приватный `POSTGRES_PASSWORD` в `.env`. Для пароля со знаком `$`
используйте одинарные кавычки в `.env`. Не отправляйте этот файл в Git.
`POSTGRES_USER` и `POSTGRES_DB` по умолчанию — `cqa`.
Docker автоматически собирает DATABASE_URL с адресом `db:5432` и кодирует пароль;
локальное значение DATABASE_URL из `.env` в контейнер не передаётся.

```powershell
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 180
docker compose ps
docker compose logs --tail 50 backend
docker compose exec backend npm run db:status
docker compose exec backend npm run db:check
docker compose exec backend npm run db:seed:official
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/health
```

Первая сборка может занять несколько минут. Backend ждёт healthcheck PostgreSQL,
применяет миграции, проверяет соединение и затем открывает HTTP-порт.
Prisma CLI оставлен в runtime dependencies для выполнения миграций в MVP.
Backend работает от пользователя `node`. `.env` не попадает в образ и build context.
Порт PostgreSQL на Windows не опубликован. Backend доступен на `127.0.0.1:3000`;
`PORT` в `.env` меняет внешний порт, при его изменении исправьте URL проверки.
Volume `postgres_data` смонтирован в `/var/lib/postgresql` для PostgreSQL 18.
Будущий сервис AI сможет подключиться к общей сети Compose.

Остановка и запуск с сохранением данных:

```powershell
docker compose down
docker compose up -d --wait
```

Не используйте `docker compose down -v`, если данные нужно сохранить.
POSTGRES_* инициализируют новый volume: изменение пароля в `.env` не меняет пароль
пользователя уже существующей базы.

## Проверка сохранности Docker volume

Создайте отдельную тестовую запись:

```powershell
@'
INSERT INTO "Conversation" (id, "externalId", language, channel, transcript)
VALUES ('00000000-0000-4000-8000-000000000002', '__cqa_volume_probe__', 'EN', 'test', '[]');
'@ | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

docker compose down
docker compose up -d --wait

@'
SELECT id, "externalId" FROM "Conversation" WHERE "externalId" = '__cqa_volume_probe__';
'@ | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Должна вернуться та же запись. После проверки удалите только её:

```powershell
@'
DELETE FROM "Conversation" WHERE id = '00000000-0000-4000-8000-000000000002' AND "externalId" = '__cqa_volume_probe__';
'@ | docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Локальный Node.js и локальный PostgreSQL

PostgreSQL должен быть запущен отдельно; база и пользователь уже созданы.
Compose по умолчанию не предоставляет локальному Node.js доступ к своей базе.
В `.env` задайте DATABASE_URL, например
`postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa`.
Спецсимволы логина и пароля должны быть URL-encoded.

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Отредактируйте DATABASE_URL перед следующими командами.
npm.cmd run db:generate
npm.cmd run db:validate
npm.cmd run db:migrate
npm.cmd run db:check
npm.cmd run dev
```

Обычный запуск без наблюдения за файлами: `npm.cmd start`. Остановка: Ctrl+C.
При остановке сервер завершает HTTP-запросы и вызывает `prisma.$disconnect()`.
HTTP открывается только после успешного подключения к PostgreSQL.

В другом окне PowerShell:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:3000/api/health
```

Ожидаемый ответ: `{"status":"ok","service":"cqa-backend"}`.
Health проверяет HTTP-приложение, без проверки внешних сервисов.

## Миграции и тесты

`db:migrate` применяет готовые миграции, `db:status` показывает их состояние.
`db:migrate:dev -- --name NAME` предназначен для будущих изменений схемы в отдельной
development-базе; Prisma может потребовать права на shadow database.
Не заменяйте миграции командой `db push`: триггеры, CHECK и views описаны в SQL.

Тесты проверяют уникальность, языки, связи версий, диапазоны баллов, N/A,
индексы доказательств и историю апелляций. Все тестовые записи откатываются транзакцией.
Используйте отдельную тестовую базу с применёнными миграциями:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run test:db
Remove-Item Env:DATABASE_URL
```

## Настройки

Переменные и примеры перечислены в `.env.example`; конфигурация проверяется Zod при запуске.
`CORS_ORIGINS` — список разрешённых origins через запятую, без завершающего `/`.
CORS управляет доступом из браузера и не заменяет аутентификацию.
По умолчанию сервер доступен только локально (`HOST=127.0.0.1`).
В Docker `HOST=0.0.0.0` задаётся автоматически.
Лимит JSON — 100 KB; лимит запросов — 100 на IP за минуту, в памяти одного процесса.
`trust proxy` выключен; при будущем развёртывании за proxy настройте доверие к конкретной инфраструктуре.

## Структура

`src/app.js` собирает приложение без открытия порта; `src/server.js` запускает сервер.
`src/config` содержит конфигурацию, `src/routes` — общие маршруты,
`src/middleware` — общую обработку запросов и ошибок.
`src/modules`, `src/ai-client` и `src/database` подготовлены для будущих этапов.
Ошибки возвращаются в формате `{ "error": { "code": "...", "message": "..." } }`.
Трассировки ошибок не отправляются клиенту.
`src/database/client.js` экспортирует один Prisma Client с пулом до пяти соединений.
Модели: `prisma/schema.prisma`; миграции: `prisma/migrations`.
Схема и правила чтения итоговых баллов: [docs/database.md](docs/database.md).
=======
# Backend

Участник 1 отвечает за импорт диалогов, HTTP API, хранение результатов, очередь задач и серверную часть апелляций.

При оценке диалога сервер передаёт транскрипт и выбранную версию чек-листа в модуль [ai](../ai/). Когда проверяющий меняет оценку, сервер использует ту же функцию расчёта баллов и сохраняет исходный и финальный результаты.
>>>>>>> origin/feat/scoring
