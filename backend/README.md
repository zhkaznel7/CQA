# CQA Backend — этап 6

Express + PostgreSQL + Prisma, JavaScript ES Modules. Требуется Node.js >= 22.13.0;
Docker использует Node.js 24 LTS. Prisma Client, CLI и PostgreSQL adapter — 7.10.1.
Реализованы Conversations API, Checklists API, Scoring Engine, Evaluations API и Appeals API.
Интеграция AI использует согласованный HTTP-контракт или явный локальный mock.
Реальный AI-сервис пока не проверен. Frontend и AI-модель не реализованы.

Адаптация перед AI HTTP-вызовом: строковое время сохраняется, числовое передаётся
строкой без пересчёта единиц, известные роли нормализуются только по регистру/пробелам.
Отсутствующее время и неизвестная роль дают 422 до вызова AI, без догадок и изменения
данных PostgreSQL. Подробности и результаты 107 тестов: [docs/transcript-adaptation.md](docs/transcript-adaptation.md).

## Подготовка тестовой базы в Windows PowerShell

Полный набор тестов требует запущенного PostgreSQL и отдельной базы `cqa_test`.
`npm.cmd test` сам базу не создаёт. Сообщение `Database cqa_test does not exist`
означает, что сервер доступен, но тестовая база на этом адресе ещё не создана.

Тесты загружают `.env` через `--env-file-if-exists=.env`. Значение `DATABASE_URL`
текущего процесса PowerShell имеет приоритет над `.env`. Если DATABASE_URL отсутствует,
используется существующая конфигурация `PGHOST`, `PGPORT`, `POSTGRES_*`.
Не выводите полный URL с паролем в терминал или отчёты.

Если эффективный `DATABASE_URL` уже указывает на `cqa_test`, выполните:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd run db:test:prepare
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить тестовую базу' }
npm.cmd test
```

`db:test:prepare` проверяет, что имя базы в URL — **строго `cqa_test`**.
Команда подключается к служебной базе `postgres`, создаёт `cqa_test` только при её
отсутствии и запускает `prisma migrate deploy` с проверенным URL тестовой базы.
Нужны права подключения к `postgres` и CREATEDB для первого создания; пользователь
должен иметь права на применение миграций в тестовой базе. При повторном запуске
данные сохраняются, применяются только ещё не выполненные миграции. Сброса БД нет.
Команда не изменяет `.env`, основную базу, пользователей или настройки сервера.

Если `.env` указывает на основную базу, оставьте файл без изменений и задайте тестовый
URL только для текущего PowerShell. В примере замените USER и URL_ENCODED_PASSWORD
своими значениями, а адрес и порт — адресом своего PostgreSQL. Спецсимволы логина
и пароля должны быть URL-encoded:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
$previousDatabaseUrl = $env:DATABASE_URL
try {
    $env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
    npm.cmd run db:test:prepare
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить тестовую базу' }
    npm.cmd test
} finally {
    if ($null -eq $previousDatabaseUrl) {
        Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    } else {
        $env:DATABASE_URL = $previousDatabaseUrl
    }
}
```

Тесты сами создают необходимые фикстуры: официальный seed и запущенный AI для
`npm.cmd test` не требуются. Большинство фикстур откатываются; конкурентные тесты
апелляций сохраняют собственные синтетические записи в тестовой базе.

Проверено на локальном PostgreSQL 18.6, `127.0.0.1:5432/cqa_test`: все семь миграций
применены, полный набор **107/107 успешно, 0 ошибок, 0 пропущено**. Повторная
подготовка базы сохраняет данные и сообщает об отсутствии ожидающих миграций.
Проверка CHECK-ограничений использует SQLSTATE `23514`, поэтому не зависит от языка
сообщений PostgreSQL, включая `Russian_Kazakhstan.1252`.

## Appeals API и пересмотр

Контракт, история и ограничения: [docs/appeals.md](docs/appeals.md).
После `npm.cmd run db:generate` и `npm.cmd run db:migrate` доступны:

- POST /api/appeals — создать PENDING по evaluationId + criterionId + comment.
- GET /api/appeals — пагинация page/pageSize и фильтр status.
- GET /api/appeals/:id — исходные данные, контекст, текущий итог и снимки решения.
- PATCH /api/appeals/:id/decision — CONFIRM или CHANGE с обязательной reason.

criterionId — UUID ChecklistCriterion из `evaluation.data.results[].criterionId`,
не key (`01`) и не ID строки CriterionResult (`results[].id`). CONFIRM сохраняет текущий
итог, CHANGE вызывает существующий calculateScore с учётом уже принятых изменений.
Исходные Evaluation.score/aiResponse и CriterionResult не обновляются.
Статусы БД сохранены: CONFIRM → REJECTED (отклонена апелляция), CHANGE → ACCEPTED.
Для демонстрации reviewer необязателен (default demo-reviewer); аутентификации нет.

После создания оценки из раздела ниже выполните в другом окне PowerShell:

```powershell
$base = 'http://127.0.0.1:3000'
$saved = Invoke-RestMethod "$base/api/evaluations/$($evaluation.data.id)"
$criterion = $saved.data.results | Where-Object criterionKey -eq '01'
$body = @{ evaluationId = $saved.data.id; criterionId = $criterion.criterionId; comment = 'Прошу пересмотреть приветствие' } | ConvertTo-Json
$appeal = Invoke-RestMethod "$base/api/appeals" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
Invoke-RestMethod "$base/api/appeals?status=PENDING&page=1&pageSize=10"
Invoke-RestMethod "$base/api/appeals/$($appeal.data.id)" | ConvertTo-Json -Depth 30
$body = @{ decision = 'CHANGE'; value = $true; reason = 'Приветствие подтверждено исходной репликой'; reviewer = 'demo-reviewer' } | ConvertTo-Json
Invoke-RestMethod "$base/api/appeals/$($appeal.data.id)/decision" -Method Patch -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) | ConvertTo-Json -Depth 30
```

Для N/A передайте CHANGE/isNa=true/naReason без value. Независимые подтверждения
применимости этапа 5 обязательны. Грубая ошибка меняет grossError, не числовой итог.
Повторное решение или дублирующая PENDING-апелляция — 409. Решения разных критериев
одной оценки сериализуются блокировкой Evaluation.

Тесты запускаются только на отдельной мигрированной PostgreSQL:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:test:prepare
npm.cmd run test:appeals
npm.cmd test
Remove-Item Env:DATABASE_URL
```

Функциональные фикстуры откатываются. Конкурентные тесты оставляют собственные
синтетические записи в изолированной БД для проверки двух независимых соединений.
Проверено на cqa_stage6_test (PostgreSQL 18.6): 21 новый тест апелляций, полный
набор 92/92 успешно, 0 ошибок. Все семь миграций применены; исходные оценки сохранены.

## Evaluations и AI-контракт

Полный контракт, исходные JSON-примеры, N/A-политика и список изменений:
[docs/evaluations.md](docs/evaluations.md).

После настройки DATABASE_URL (локальный PostgreSQL) выполните:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd ci
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run db:seed:official
npm.cmd run db:seed:call-na
$env:AI_MODE = 'mock'
npm.cmd run dev
```

`db:seed:official` сохраняет исходную PDF-версию v1. `db:seed:call-na` создаёт отдельную
v2 с переданным командой дополнением организаторов о неполном начале записи звонка.
Команды не переписывают существующие версии; при расхождении seed завершается ошибкой.

В другом окне PowerShell:

```powershell
$base = 'http://127.0.0.1:3000'
Invoke-RestMethod "$base/api/conversations/import" -Method Post -ContentType 'application/json' -Body '{}'
$conversations = Invoke-RestMethod "$base/api/conversations?language=RU&pageSize=1"
$versions = Invoke-RestMethod "$base/api/checklists?key=freedom-broker-chat-quality"
$selected = $versions.data | Sort-Object version -Descending | Select-Object -First 1
$body = @{ conversationId = $conversations.data[0].id; checklistId = $selected.id } | ConvertTo-Json
$evaluation = Invoke-RestMethod "$base/api/evaluations" -Method Post -ContentType 'application/json' -Body $body
$evaluation | ConvertTo-Json -Depth 30
Invoke-RestMethod "$base/api/evaluations/$($evaluation.data.id)" | ConvertTo-Json -Depth 30
```

POST возвращает 201 при создании и 200/reused=true для уже завершённой пары диалог +
версия. Повтор не вызывает AI и не перезаписывает результат. `provider=mock`, `isMock=true`
и `transport=local` явно отмечают синтетическую оценку, не реальный анализ качества.

После получения HTTP mock через Git переключите только конфигурацию:

```powershell
$env:AI_MODE = 'http'
$env:AI_BASE_URL = 'http://localhost:8001'
$env:AI_SERVICE_KIND = 'mock'
npm.cmd run dev
```

Backend обращается к `POST /v1/evaluations`, без redirects, с таймаутом 100 секунд и
лимитом ответа 2 MB. Для реального AI задайте AI_SERVICE_KIND=ai после его подключения.
При ошибке HTTP-клиент не переключается на mock автоматически.
В Docker адрес задаёт AI_DOCKER_BASE_URL, default `http://ai:8001`; сервис ai пока
не добавлен в Compose. Для production mock требуется явное AI_ALLOW_MOCK_IN_PRODUCTION=true.

Unit-проверки клиента не требуют БД:

```powershell
npm.cmd run test:ai
```

Полный набор запускайте на отдельной мигрированной базе с `test` в имени:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:test:prepare
npm.cmd test
Remove-Item Env:DATABASE_URL
```

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
индексы доказательств и историю апелляций. Функциональные фикстуры откатываются
транзакцией; конкурентные проверки оставляют свои синтетические записи в тестовой БД.
Подготовка отдельной базы описана выше. Для проверки только ограничений БД:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:test:prepare
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
`src/modules` содержит API и scoring; `src/ai-client` — HTTP/mock-клиенты,
`src/database` — общий Prisma Client.
Ошибки возвращаются в формате `{ "error": { "code": "...", "message": "..." } }`.
Трассировки ошибок не отправляются клиенту.
`src/database/client.js` экспортирует один Prisma Client с пулом до пяти соединений.
Модели: `prisma/schema.prisma`; миграции: `prisma/migrations`.
Схема и правила чтения итоговых баллов: [docs/database.md](docs/database.md).
## Роль Backend в команде

Участник 1 отвечает за импорт диалогов, HTTP API, хранение результатов, очередь задач и серверную часть апелляций.

При оценке диалога сервер передаёт транскрипт и выбранную версию чек-листа в сервис
[ai](../ai/) по HTTP. Очередь задач относится к будущим этапам. Appeals API использует
ту же функцию scoring с сохранением исходного результата. Папка ai не изменялась.
