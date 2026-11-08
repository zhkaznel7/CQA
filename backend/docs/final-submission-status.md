# Финальная подготовка результатов: 8 ноября 2026

Проверен Backend `2363781` в ветке `backend`. Docker Engine 29.9.2, все четыре
основных сервиса healthy; GET `/api/health` — HTTP 200. В рабочей PostgreSQL `cqa`
применены восемь миграций. Проверка не вызывала Gemini и не меняла записи БД.
Контрольные суммы всех семи рабочих таблиц до и после экспорта совпали.

## Что фактически есть

| Источник | Диалоги | Сохранённые оценки | Настоящие AI-оценки |
| --- | ---: | ---: | ---: |
| Рабочая Docker PostgreSQL | 9 | 8 mock | 0 |
| Локальная cqa_test, отдельная от Docker | 20 | 20 mock | 0 |
| Исходный официальный DEV | 65 | 0 соответствующих реальных оценок в рабочей БД | 0 |

В Docker-группе DEV есть три демонстрационных mock-ID; ещё шесть диалогов имеют
legacy-группу. Ни один из них не подменяет исходные 65 DEV-ID. DRAFT-оценок нет.
Число прошлых неуспешных запросов к Gemini неизвестно: отклонённые запросы не
сохраняются как Evaluation. **65 error в экспорте означают отсутствие завершённых
результатов, а не 65 выполненных платных запросов с ошибками.**

DEV API доступен: один GET по точной подписанной ссылке из официального PDF вернул
HTTP 200, группу DEV, 65 записей. Их ID, язык, канал и транскрипты совпали с
`data/dev.json`. Подписанный URL сохранён только в игнорируемой приватной папке.
Ответ содержит dataset_group_id, total_records, records; контрольный group_id в нём
не объявлен. В конфигурации и исходных наборах контрольная группа также отсутствует.
Идентификаторы PROD не угадывались; запросы по вымышленным группам не выполнялись.

## Файлы и проверки

- `results/dev/results.json`: JSON 1.0, 65 уникальных исходных ID, **0 ok / 65 error**.
  Каждая ошибка содержит criteria=[], score=null и причину. Mock-оценки исключены.
- `results/prod/results.json`: не создан, поскольку нет исходных десяти ID.
- `results/submission-diagnostics.json`: приватный локальный отчёт с полным списком
  65 необработанных ID; не является третьим файлом официальной сдачи.
- DEV прошёл Zod-формализацию всех трёх страниц официального приложения, сверку
  количества, уникальности, порядка и совпадения ID со свежим ответом организаторов.
  В PDF нет отдельного машиночитаемого JSON Schema.
- Проверять реальные evidence и числовые score пока не на чем: успешных записей нет.
  Для error корректны только пустые criteria и score=null.
- Узкая проверка экспортёра: **19/19 тестов**, без Gemini и без нового общего аудита.

Имя команды не найдено в конфигурации. По разрешению пользователя временно записано
`REPLACE_WITH_ACTUAL_TEAM_NAME`. `model.name=UNCONFIGURED (no real AI evaluations)`
не выдаёт mock за Gemini. `model.mode=external_api` предварительно отражает планируемую
реальную интеграцию; после настоящего прогона нужно указать фактически использованную
модель и режим. **С этими временными метаданными файл ещё не готов к финальной сдаче.**

## Срочные действия

1. Уточнить фактическое имя команды и выданный организаторами контрольный group_id.
2. Настроить настоящий AI-сервис с ключом только в приватном окружении и согласовать
   число разрешённых попыток. Текущий Compose намеренно запускает mock и не подходит
   для получения настоящих оценок. Смена только model.name ничего не исправляет.
3. Импортировать реальные наборы через организаторский источник и сохранить оценки
   по конкретной официальной версии чек-листа. Контрольная группа изолируется по
   фактическому group_id; DEV и контрольные записи не смешиваются.
4. Повторить Backend-экспорт с фактическими метаданными; проверить количество ok/error.
   Если часть ответов отклонена валидацией, сохранить предусмотренные PDF error-записи.
5. Проверить содержимое обоих JSON, затем отдельно разрешить commit/push.

## PowerShell

Проверка рабочего стека и текущего файла:

```powershell
Set-Location C:\Users\zhanel\CQA
docker compose --env-file backend/.env -f backend/compose.yaml ps
Invoke-RestMethod http://127.0.0.1:3000/api/health
$dev = Get-Content -Raw -Encoding UTF8 results/dev/results.json | ConvertFrom-Json
$dev.results | Group-Object status | Select-Object Name,Count
$dev.results | Where-Object status -eq error | Select-Object conversation_id,error
node --test backend/tests/export-results.test.js
```

После настройки **IMPORT_SOURCE=organizers** и фиксированного ORGANIZER_API_URL
в приватной конфигурации Backend (текущий mock этого не делает):

```powershell
$groupId = Read-Host 'Точный контрольный group_id от организаторов'
if ($groupId -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$' -or $groupId -eq 'DEV') {
  throw 'Нужен действительный контрольный ID, а не DEV'
}
$body = @{ group_id = $groupId } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/conversations/import -ContentType application/json -Body $body
Invoke-RestMethod ("http://127.0.0.1:3000/api/conversations?group_id=" + [uri]::EscapeDataString($groupId))
```

Backend не имеет экспортного HTTP endpoint. После **реального** оценивания используйте
CLI внутри рабочего контейнера: локальная `.env` сейчас указывает на cqa_test,
поэтому локальный `npm run export:results` читал бы другую БД.

Сначала сохраните неизменённый официальный контрольный ответ в приватный файл
`backend/.tmp/prod-source.json`. Он должен содержать фактическую группу и ровно 10
записей. Затем, после появления реальных оценок:

```powershell
$teamName = Read-Host 'Фактическое имя команды'
$modelName = Read-Host 'Фактически использованная модель'
$checklistId = Read-Host 'UUID версии с сохранёнными оценками'
docker cp backend/.tmp/prod-source.json cqa-backend-1:/app/.tmp/final-submission-prod.json
docker exec cqa-backend-1 node scripts/export-results.js --dataset prod --group-id $groupId --input /app/.tmp/final-submission-prod.json --checklist $checklistId --team $teamName --model-name $modelName --model-mode external_api
```

Для нового DEV-экспорта сохраните нынешний error-only файл, не удаляя его:

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
Move-Item -LiteralPath results/dev/results.json -Destination "results/dev/results.error-only.$stamp.json"
docker cp data/dev.json cqa-backend-1:/app/.tmp/final-submission-dev.json
docker exec cqa-backend-1 node scripts/export-results.js --dataset dev --input /app/.tmp/final-submission-dev.json --checklist $checklistId --team $teamName --model-name $modelName --model-mode external_api
```

`external_api` применим только к действительно использованной внешней модели;
для другого фактического режима укажите local или hybrid. CLI не перезаписывает
существующие файлы. Старый экспорт сохраните также перед повторным PROD-экспортом.
Если реальная версия чек-листа другая, получите её UUID из `/api/checklists`;
в выполненной диагностике использовалась официальная v2
`b9129a7c-21dd-465a-abac-3b8624a175ea`.

Перед публикацией проверьте метаданные, количества 65/10 и реальные причины error.
Файлы JSON специально игнорируются Git. Только **после проверки и отдельного
разрешения на публикацию** добавляйте явные два пути; не добавляйте всю папку:

```powershell
git status --short --branch
git add -f -- results/dev/results.json results/prod/results.json
git diff --cached --check
git diff --cached --stat
# Commit/push — отдельное действие после просмотра и разрешения.
```

Не публикуйте диагностический отчёт, error-only backup, `.env`, backend/.tmp,
подписанную ссылку организаторов и synthetic mock-результаты. Доступность файлов
только локально не является сдачей: после разрешённой публикации нужен успешный push.

Новых секретов в подготовленных файлах не найдено; `.env` и backend/.tmp игнорируются.
Однако уже отслеживаемый `data/dev.json` содержит пять подписанных audio_url из
официального источника. Исходный файл не менялся. Перед публикацией уточните,
разрешено ли оставлять эти ссылки в открытом репозитории; в results.json их нет.
`git diff --check` пройден. Commit/push не выполнялись.

## Подготовленный реальный прогон

Добавлены отдельный Compose overlay, secret-file запуск Gemini и пакетный Backend
worker: [real-ai-run.md](real-ai-run.md). Образы собраны, read-only план видит все
65 исходных DEV и рабочую cqa. Ключ по-прежнему отсутствует, поэтому настоящий
AI-тест и массовое оценивание не выполнялись. Error-only файл сохранён без изменений.
