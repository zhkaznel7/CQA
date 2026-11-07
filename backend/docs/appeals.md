# Appeals API — этап 6

Заявитель создаёт апелляцию; проверяющий отдельной операцией принимает CONFIRM/CHANGE.
Для демонстрации авторизации нет: reviewer — текстовая метка, не проверенная личность;
по умолчанию demo-reviewer. Используются существующие middleware и JSON-ошибки.

## POST /api/appeals

HTTP 201, начальный статус PENDING:

```json
{
  "evaluationId": "00000000-0000-4000-8000-000000000001",
  "criterionId": "00000000-0000-4000-8000-000000000002",
  "comment": "Прошу проверить приветствие по исходным репликам."
}
```

criterionId — UUID ChecklistCriterion из GET оценки `data.results[].criterionId`,
не key и не UUID строки CriterionResult. Backend ищет результат именно в указанной
COMPLETED-оценке. Чужая пара ID — 404; незавершённая оценка — 409.
Комментарий обязателен, до 4000 символов. Для одного результата допустима только одна
PENDING-апелляция (также обеспечено частичным UNIQUE индексом БД). После закрытия можно
создать следующую апелляцию. Исходные ответы/баллы при создании не меняются.

## GET /api/appeals

Параметры: page=1…100000 (default 1), pageSize=1…100 (default 20),
status=PENDING/ACCEPTED/REJECTED (необязателен). Неизвестные параметры запрещены.
Порядок createdAt DESC, id DESC. HTTP 200:

```json
{
  "data": [
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "status": "PENDING", "decision": null,
      "comment": "Прошу проверить приветствие по исходным репликам.",
      "criterion": { "key": "01", "name": "Установление контакта", "type": "boolean" }
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Пример сокращён: также возвращаются evaluationId, criterionId, criterionResultId,
reviewer, reason, createdAt, decidedAt и UUID определения критерия.

## GET /api/appeals/:id

HTTP 200, `{data: ...}`. Карточка содержит поля списка и:

- originalScore — неизменённый Evaluation.score первоначального расчёта.
- finalScore — актуальный пересчёт по последним принятым изменениям каждого критерия.
- beforeScore/afterScore — исторические снимки на момент решения этой апелляции.
- originalResult — исходные answer/isNa/naReason/rawPoints/explanation/evidence/checkedRange.
- currentResult — текущий ответ спорного критерия в формате входа Scoring Engine.
- revisedAnswer/revisedIsNa/revisedNaReason — замена, принятая этой апелляцией.
- evaluation — ID, checklistId, status, provider/transport и полный исходный aiResponse.
- checklist — сохранённая версия с критериями, conversation — исходный контекст,
  включая язык, канал, аудио и транскрипт с неизменёнными timestamp/индексами.
- reviewable/reviewError — наличие данных для безопасного пересчёта.

Если позже принят другой CHANGE, finalScore при повторном чтении учитывает его,
а afterScore старой апелляции остаётся историческим. GET Evaluations API по-прежнему
возвращает исходную оценку и AI-ответ без пересчёта/подмены.

## PATCH /api/appeals/:id/decision

HTTP 200. reason обязателен (1–4000 символов); reviewer необязателен (1–200).
CONFIRM не допускает дополнительных значений:

```json
{ "decision": "CONFIRM", "reason": "Исходный ответ подтверждён доказательствами." }
```

Статус REJECTED означает отклонение апелляции. Текущий итог не меняется. Если критерий
пересматривался раньше, CONFIRM сохраняет последнюю принятую замену, не откатывая её к AI.

CHANGE значения:

```json
{
  "decision": "CHANGE", "value": true,
  "reason": "Приветствие присутствует в исходной реплике.", "reviewer": "demo-reviewer"
}
```

Для scale передаётся числовая ступень сохранённой версии (например 15 для критерия 04).
Для boolean/flag — только true/false, без преобразования строк или 0/1.
Статус CHANGE — ACCEPTED. Грубая ошибка меняет grossError, не числовой итог.

CHANGE на N/A:

```json
{
  "decision": "CHANGE", "isNa": true,
  "naReason": "Запрос не требовал идентификации.",
  "reason": "Применимость независимо проверена по исходному диалогу."
}
```

value отсутствует, naReason обязателен. Нужны allowNa=true и независимое
ApplicabilityConfirmation для диалога/версии/критерия. Клиентские naConditionMet,
evaluationId, criterionId, total, score и evidence в решении запрещены.
Для приветствия v1 N/A запрещён; v2 допускает его только в voice/call с явным
recording_start_missing и независимым подтверждением. Chat отклоняется даже при
наличии подтверждения. Команды подтверждения: [evaluations.md](evaluations.md).

Сокращённый ответ после CHANGE boolean при исходном нулевом mock-результате:

```json
{
  "data": {
    "status": "ACCEPTED", "decision": "CHANGE",
    "originalScore": { "total": 0, "grossError": false },
    "beforeScore": { "total": 0, "grossError": false },
    "afterScore": { "total": 10, "grossError": false },
    "finalScore": { "total": 10, "grossError": false },
    "originalResult": { "answer": false },
    "currentResult": { "criterionKey": "01", "value": true }
  }
}
```

На практике ответ содержит полную карточку и полные результаты calculateScore.

## Транзакции, расчёт и история

Решение блокирует Evaluation, затем Appeal через SELECT FOR UPDATE, повторно проверяет
PENDING, читает сохранённую версию и все исходные ответы. По каждому критерию берётся
последняя ACCEPTED-замена (decidedAt DESC, id DESC). При CHANGE подставляется новое
значение и вызывается **только существующий calculateScore()**. В Appeal сохраняются
решение, причина, reviewer, типизированная замена и beforeScore/afterScore.

Блокировка Evaluation сериализует решения разных критериев: следующий пересчёт видит
уже зафиксированный предыдущий. ReadCommitted после ожидания позволяет перечитать
изменения. updateMany дополнительно ограничен status=PENDING. Старый DB-trigger также
запрещает изменение закрытой апелляции. Повторное решение возвращает 409.
GET карточки использует единый RepeatableRead snapshot. При ошибке вся запись решения
откатывается, включая статус и scoring snapshots.

Evaluation.score/aiResponse и CriterionResult.answer/explanation/evidence/checkedRange
не обновляются. Миграция 007 добавляет nullable audit-поля Appeal и совместимые
ограничения; старые миграции и официальные критерии не изменены.
revisedPoints сохраняет сырую шкалу для совместимости старых SQL views, а не взвешенный
итог. Изменение N/A вызывает перераспределение весов только через Scoring Engine.

## Ошибки и ограничения

| HTTP | Причина |
| --- | --- |
| 400 | Неверный UUID/JSON/параметры, длина, тип/ступень, лишние поля |
| 404 | Оценка, апелляция или результат пары evaluationId+criterionId не найдены |
| 409 | Оценка не завершена, PENDING-дубликат, закрытая апелляция, нет данных для пересчёта |
| 422 | N/A запрещён или независимо не подтверждён |
| 500/503 | Безопасная внутренняя ошибка/недоступность БД; транзакция откатывается |

Старые карточки без типизированных ответов/score snapshot читаются с reviewable=false,
reviewError=EVALUATION_NOT_REVIEWABLE, finalScore=null. Ответы не восстанавливаются
догадками; решение/новая апелляция для такой оценки — 409. Аналогично обрабатываются
неподдерживаемая версия scoring и старая принятая замена без типизированного значения.
Авторизация/проверка личности reviewer для демо не добавлены.

## Проверка PowerShell

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd run db:generate
npm.cmd run db:migrate
$env:AI_MODE = 'mock'
npm.cmd run dev
```

Пример Invoke-RestMethod с получением criterionId — в [README](../README.md).
Полный набор запускайте на отдельной тестовой PostgreSQL:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:migrate
npm.cmd run test:appeals
npm.cmd test
Remove-Item Env:DATABASE_URL
```

Новые тесты используют синтетические диалоги. Функциональные фикстуры откатываются.
Конкурентные проверки оставляют свои записи в изолированной БД: нужны реальные COMMIT
и две независимые PostgreSQL-сессии. Барьер проверяет разные pg_backend_pid, а не
имитирует параллельность на одном соединении.

## Созданные файлы

- src/modules/appeals/appeals.schema.js — Zod.
- src/modules/appeals/appeal-review.js — текущие ответы и вызов calculateScore.
- src/modules/appeals/appeals.service.js — транзакции, блокировки, история и карточки.
- src/modules/appeals/appeals.routes.js — четыре endpoints.
- prisma/migrations/20261107000700_appeal_decisions/migration.sql — audit-поля и ограничения.
- tests/appeals.test.js и tests/appeals-concurrency.test.js — функциональность и реальные гонки.
- docs/appeals.md — документация.

Изменены schema.prisma, src/app.js, package.json, README и связанные API/DB/scoring документы.

## Фактический результат проверки

На изолированной cqa_stage6_test (PostgreSQL 18.6) применены все 7 миграций.
Выполнены 21 новый тест апелляций и полный набор **92 теста: 92 успешно, 0 ошибок**.
Проверены реальные независимые соединения PostgreSQL, N/A, grossError, несколько
последовательных изменений, повторное решение, откат после записи решения и сохранность
исходных AI-ответов/доказательств. Сценарии AI используют только синтетический mock.
Сообщения `Unhandled request error` ожидаются в тестах намеренной ошибки записи
(проверяется HTTP 500 и откат), это не падения тестов.
