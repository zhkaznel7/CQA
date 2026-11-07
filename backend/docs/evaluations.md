# Evaluations API и интеграция AI — этап 5

## Граница ответственности

Backend получает структурированные ответы и доказательства; только Backend вызывает
calculateScore и вычисляет баллы. Формулы этапа 4 не изменены. Реального AI-провайдера
здесь нет: локальный адаптер формирует явно синтетические результаты без модели/промптов.
Папка ai не изменяется, Git merge/push не выполняются.

## HTTP API Backend

На этапе 6 пересмотр выполняется отдельным [Appeals API](appeals.md). GET оценки и
повторный POST по-прежнему возвращают неизменённый исходный результат. Текущий итог
после всех принятых апелляций доступен в finalScore карточки апелляции.

`POST /api/evaluations`:

```json
{
  "conversationId": "00000000-0000-4000-8000-000000000001",
  "checklistId": "00000000-0000-4000-8000-000000000002"
}
```

Все ID — внутренние UUID PostgreSQL, не externalId организаторов.
Другие поля запроса, включая URL, готовые баллы и подтверждения N/A, отклоняются.
Backend читает диалог и именно выбранную версию, отправляет AI, проверяет ответ,
рассчитывает баллы и атомарно создаёт Evaluation + все CriterionResult.
HTTP-вызов не занимает транзакцию/блокировки БД в течение 100 секунд.
Перед записью под блокировками повторно проверяется неизменность диалога/критериев.

Сокращённый успешный ответ (score и результаты в действительности содержатся полностью):

```json
{
  "reused": false,
  "data": {
    "id": "00000000-0000-4000-8000-000000000003",
    "conversationId": "00000000-0000-4000-8000-000000000001",
    "checklistId": "00000000-0000-4000-8000-000000000002",
    "status": "COMPLETED",
    "provider": "mock",
    "transport": "local",
    "isMock": true,
    "score": { "scoringVersion": "1.0.0", "total": 0, "grossError": false, "maxPoints": 100 },
    "results": [
      {
        "criterionKey": "01", "answer": false, "isNa": false, "naReason": null,
        "rawPoints": 0,
        "explanation": "MOCK: synthetic placeholder, not a real quality assessment.",
        "evidence": [], "checkedRange": { "start": 0, "end": 1 }
      }
    ]
  }
}
```

`GET /api/evaluations/:id` возвращает `{data: ...}` с сохранёнными score, aiResponse
и исходными ответами/доказательствами. Баллы при GET не пересчитываются.
provider — mock/ai, transport — local/http. HTTP mock тоже помечается provider=mock.

Статусы: 201 — новая оценка; 200/reused=true — уже завершённая пара conversationId +
checklistId; 400 — неверный запрос; 404 — запись не найдена; 409 — незавершённая оценка
уже существует или вход изменился во время AI-вызова; 422 — невалидный старый чек-лист
или транскрипт; 502 — недопустимый ответ AI/HTTP-ошибка; 503 — AI/БД недоступны;
504 — timeout AI. Сбой записи откатывает Evaluation и все результаты.

UNIQUE(conversationId, checklistId), блокировки и повторная проверка защищают от
дублирования/перезаписи при параллельных запросах. Два одновременных первых запроса
могут вызвать AI дважды; сохранится одна оценка. Последовательный повтор AI не вызывает.
Для отдельного результата по изменённым правилам создавайте новую версию чек-листа.
Mock-результат той же пары тоже кэшируется: переключение режима не перезаписывает его.

## Согласованный Backend → AI контракт

Локально: `AI_BASE_URL=http://localhost:8001`.
Всегда `POST /v1/evaluations`, `Content-Type: application/json`.
В Docker — `http://ai:8001` или другое имя сервиса через AI_DOCKER_BASE_URL.

```json
{
  "conversation_id": "00000000-0000-4000-8000-000000000001",
  "channel": "chat",
  "language": "RU",
  "transcript": [
    { "turnIndex": 0, "timestamp": "00:00:01.250", "speaker": "operator", "text": "Синтетический диалог" }
  ],
  "checklist": {
    "id": "00000000-0000-4000-8000-000000000002",
    "key": "synthetic-checklist", "version": 1, "name": "Синтетический пример",
    "instructions": [], "sections": [{ "key": "main", "name": "Основная секция" }],
    "criteria": [
      {
        "key": "example", "name": "Пример", "type": "boolean", "description": "Синтетическое описание",
        "sectionKey": "main", "weight": 100, "scaleSteps": [], "allowNa": false, "naCondition": null
      }
    ]
  }
}
```

Передаётся фактическая конфигурация, без жёстко заданного количества критериев.
Типы — только boolean/scale/flag. Строковый timestamp передаётся без изменений,
числовой сериализуется строкой без пересчёта единиц и без Date-парсинга. Если timestamp
отсутствует/null, допускается реальный startMs; отсутствие обоих источников даёт
422 AI_TIMESTAMP_REQUIRED до HTTP. Неизвестная роль даёт 422 AI_SPEAKER_UNSUPPORTED;
нормализуются только регистр/внешние пробелы известных operator/client/system/bot.
Исходный транскрипт в БД не изменяется. Подробности: [transcript-adaptation.md](transcript-adaptation.md).

Ответ AI:

```json
{
  "conversation_id": "00000000-0000-4000-8000-000000000001",
  "checklist_id": "00000000-0000-4000-8000-000000000002",
  "checklist_version": 1,
  "results": [
    {
      "criterion_id": "example", "answer": false, "na": false, "na_reason": null,
      "explanation": "Синтетический пример: действие не найдено в проверенном диапазоне.",
      "evidence": [], "checked_range": { "start": 0, "end": 0 }
    }
  ]
}
```

**criterion_id — точный key критерия**, а не внутренний UUID ChecklistCriterion:
в согласованном запросе передаётся key. Backend самостоятельно сопоставляет key с UUID.
Boolean/flag answer — boolean, scale answer — одна из объявленных ступеней.
При N/A answer=null, na=true и непустой na_reason; при обычном ответе na_reason=null.
Баллы/total от AI не принимаются, неизвестные поля ответа запрещены.

evidence — массив `{turnIndex,quote}`: индекс с нуля, quote — непустая точная подстрока
реплики, без нормализации регистра/пробелов. checked_range — null либо `{start,end}`
с включительными границами. Если диапазон указан, все цитаты должны находиться внутри.
При отсутствии цитат диапазон обязателен. Для применимого boolean=false он обязателен
даже при наличии цитаты: пропущенное действие проверяется по checked_range.
Отсутствие диапазона в таком ответе даёт 502 AI_MISSING_RANGE без записи результата.
Смысл explanation Backend автоматически не доказывает.

Одновременные запросы одной пары диалог/версия в одном Backend-процессе используют
один вызов AI. После ошибки запись in-flight удаляется, повтор разрешён. Уникальное
ограничение БД и транзакции остаются защитой между разными процессами.

## N/A: независимая проверка и дополнение о звонках

AI не может самостоятельно подтвердить применимость N/A. В БД есть append-only
ApplicabilityConfirmation: conversationId + checklistId + criterionKey, rule,
confirmedBy и reference. Это положительное подтверждение оператора/доверенной интеграции,
привязанное к конкретной версии. Публичного HTTP API записи подтверждений нет.
Не создавайте подтверждение только на основании фразы AI: нужно отдельно проверить
диалог/исходное аудио или использовать надёжные метаданные организаторов.

Для исходной формулировки 03 «Идентификация» Backend также умеет независимо подтвердить
узкий сценарий публичной навигации по исходному транскрипту, без ручной строки в БД.
Правило `identity-applicability.js` проверяет весь диалог и только известные полные
RU-инструкции самостоятельного поиска отчёта/тарифа. Оно не использует externalId,
ответ/причину AI или утверждение клиента об авторизации. Защищённые действия, реальные
значения, неизвестные роли/поля и нераспознанные реплики автоматически не подтверждаются.
Подробности, регрессия p1-ru-027 и ограничения: [identity-na-p1-ru-027.md](identity-na-p1-ru-027.md).

Для остальных текстовых условий и нераспознанных случаев остаются rule=verified_condition
и независимое решение проверяющего. Если подтверждения нет, Backend возвращает AI_NA_UNCONFIRMED (502), а не принимает
неоднозначный N/A автоматически. Подтверждение не заставляет AI выбирать N/A:
оно только разрешает проверить такой ответ.

Исходный PDF запрещает N/A для приветствия в v1. Эта версия и её seed не изменены.
По переданному пользователем дополнению от организаторов создаётся отдельная v2:

```json
{
  "key": "01", "allowNa": true,
  "naCondition": "N/A разрешён только для звонков (voice/call), у которых начало записи отсутствует и это независимо подтверждено. Для чатов N/A запрещён.",
  "applicabilityRule": { "kind": "recording_start_missing", "channels": ["voice", "call"] }
}
```

Это фрагмент версии Backend, не дополнительный формат AI-запроса.
AI получает стандартные allowNa/naCondition и channel; полное условие прописано в
naCondition. Backend дополнительно проверяет машиночитаемую политику выбранной версии.
Для приветствия нужны **все** условия: v2/версия с явной политикой, канал voice call,
voice или call (известные алиасы списка политики), подтверждение rule=recording_start_missing для этой
пары диалога/версии/критерия. Chat отклоняется даже при наличии подтверждения.
Обычное verified_condition не заменяет доказательство отсутствующего начала записи.

Пример операторской команды после реальной независимой проверки:

```powershell
npm.cmd run na:confirm -- --conversation 'UUID_ДИАЛОГА' --checklist 'UUID_ВЕРСИИ_V2' --criterion '01' --rule recording_start_missing --reviewer 'reviewer-id' --reference 'Ссылка на проверенные метаданные/акт проверки начала записи'
```

Команда работает с БД напрямую под доверенными учётными данными администратора.
Она не является системой аутентификации пользователей. Подтверждения не редактируются,
не удаляются и могут быть добавлены для новой версии без изменения прошлой оценки.

## Конфигурация и mock

AI_MODE=http по умолчанию в коде; `.env.example` явно выбирает mock для локального
прототипа. Отсутствующий HTTP-сервис даёт ошибку, не незаметный fallback.
AI_SERVICE_KIND=mock нужно указать и для внешнего HTTP mock, чтобы сохранить isMock=true.
В production любой mock требует AI_ALLOW_MOCK_IN_PRODUCTION=true; иначе запуск запрещён.
AI_BASE_URL допускает только HTTP(S) origin без credentials/path/query/fragment.
Redirects запрещены. Timeout по умолчанию 100000 ms, лимит тела ответа 2097152 bytes.
Сетевые ошибки, тело ошибки провайдера, URL и возможные секреты не выводятся в логи/ответы.

Для явного Docker-прототипа на локальном адаптере:

```powershell
$env:AI_MODE = 'mock'
$env:AI_ALLOW_MOCK_IN_PRODUCTION = 'true'
docker compose up -d --build --wait --wait-timeout 180
```

Для HTTP mock в Docker задайте AI_MODE=http, AI_SERVICE_KIND=mock и
AI_DOCKER_BASE_URL=http://ИМЯ_СЕРВИСА:8001; сервис должен быть подключён к той же сети.
Compose сейчас не создаёт отсутствующий командный mock и не изменяет папку ai.

AI_MOCK_SCENARIO: success, timeout, unavailable, invalid-json, bad-scale, false-quote,
missing, duplicate, na. Настройка только серверная, не поле POST.
Локальный mock поддерживает RU/KZ/EN и динамический набор критериев. По умолчанию
он возвращает false/нулевую ступень/flag=false и объяснение MOCK, не имитируя анализ смысла.
Сценарий na по-прежнему требует независимого подтверждения Backend: допустимого
правила исходного транскрипта либо доверенной записи факта, а не одной фразы mock.
Тесты могут задавать конкретные ответы через overrides адаптера, не через публичный API.

## Хранение и совместимость

Миграция 006 только добавляет nullable поля и новую таблицу; старые оценки не изменяет.
Evaluation.score — зафиксированный результат calculateScore, aiResponse — проверенный
ответ AI по исходному wire-контракту; provider/transport — происхождение.
CriterionResult.answer, checkedRange, naReason сохраняют исходные данные.
CriterionResult.points остаётся сырой шкалой (boolean=0/1, flag=0, scale=ответ),
а не нормализованным вкладом. Flag=true восстанавливается из answer и score.grossError.
Ограничения неизменяемости завершённых оценок продолжают действовать.
У старых записей новые поля null: отсутствовавшие ответы не выдумываются.

## Файлы этапа 5

Новые: `src/ai-client/{ai-config,http-client,index,mock-client}.js`,
`src/modules/evaluations/{ai-contract,applicability,evaluations.routes,evaluations.schema,evaluations.service}.js`,
`prisma/migrations/20261107000600_ai_evaluations/migration.sql`,
`prisma/seed/call-na-amendment.json`, `scripts/{confirm-na,seed-call-na-version}.js`,
`tests/{ai-client,evaluations}.test.js`, `docs/evaluations.md`.

Изменены: `src/app.js`, `src/config/env.js`,
`src/modules/checklists/checklists.schema.js`, `src/modules/scoring/scoring.schema.js`
(только сохранение метаданных применимости; формулы не изменены), `prisma/schema.prisma`,
`package.json`, `.env.example`, `compose.yaml`, README и связанные документы.

## Фактические проверки

На новой изолированной cqa_stage5_verified_test, PostgreSQL 18.6: все шесть миграций,
создание v1/v2, повторный seed v2 и полный набор **71 тест, 71 успешно, 0 ошибок**.
В том числе 11 AI-клиент/контракт тестов, 12 Evaluations API тестов с учётом родительского
теста и 48 регрессионных проверок этапов 1–4.
Проверены реальный локальный HTTP mock и отдельный локальный адаптер; реальная
AI-модель и командный mock из Git не подключались. Docker runtime здесь не проверялся.
Сообщение `Unhandled request error` в прогоне намеренно вызвано тестом сбоя записи:
ожидается HTTP 500 и полный откат, это не падение тестов.
