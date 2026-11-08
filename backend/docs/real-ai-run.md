# Один контролируемый DEV-прогон с Gemini

В исходном коде нет команды массовой оценки всех 65 DEV с сохранением в PostgreSQL.
`ai/evaluation/run-once.mjs` предназначен для 12 размеченных диалогов и не заменяет
Backend-сохранение. Для финальной сдачи подготовлен `scripts/evaluate-dataset.js`:
он использует существующие conversationService, evaluationService, HTTP AI Client,
calculateScore через сервис оценивания и официальный export-results.js.
Scoring Engine, правила N/A, AI-код и существующие оценки не меняются.

Без `--execute` команда только проверяет план и БД: нет импорта, AI-запросов или экспорта.
С `--execute` сначала импортируется подлинный manifest без перезаписи записей,
потом первый недостающий диалог проходит одну реальную попытку. Только после её
успешного сохранения/чтения начинается оставшийся пакет с конкуренцией не более 2.
Максимум **65 попыток всего**, включая первый тест; автоматических повторов нет.
Для PROD тот же механизм ограничен 10 попытками.

## Приватный ключ и сервис

Все команды ниже выполняются из корня проекта в одном PowerShell. Ключ не нужно
вставлять в команды или присылать в чат. Скрипт ввода сохраняет его в игнорируемый
`backend/.tmp/gemini-api-key.txt`; файл не перезаписывается. Docker передаёт ключ
только AI-сервису через secret-файл. В images, Compose environment и Backend ключа нет.

```powershell
Set-Location C:\Users\zhanel\CQA
. .\backend\scripts\configure-gemini.ps1
$env:GEMINI_MODEL = 'gemini-3.5-flash-lite'
$composeArgs = @('--env-file','backend/.env','-f','backend/compose.yaml','-f','backend/compose.gemini.yaml')
docker compose @composeArgs config --quiet
docker compose @composeArgs build backend ai-real
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
docker compose @composeArgs up -d --no-deps --wait --wait-timeout 60 ai-real
if ($LASTEXITCODE -ne 0) { throw 'Real AI transport did not become healthy' }
docker compose @composeArgs ps
```

Команда не заменяет работающие mock, Backend или PostgreSQL: реальный AI добавляется
отдельным сервисом. `ai-real:8001` доступен внутри Docker-сети. Пакетный worker ниже
использует реальный AI и ту же рабочую БД; основной демонстрационный Backend пока
продолжает работать с mock. Для переключения **основного** Backend на реальный AI
после проверки: `docker compose @composeArgs up -d --no-deps --wait backend`.

Healthcheck отправляет заведомо невалидный POST и ожидает 422 INVALID_CONVERSATION:
провайдер не вызывается, квота не тратится. Healthy подтверждает запуск и HTTP,
а доступность Google подтверждает только первая настоящая оценка из пакета.
Не запускайте `gemini-server.mjs --check`: это был бы дополнительный платный запрос.

## План и ровно один DEV-запуск

```powershell
$checklistId = 'b9129a7c-21dd-465a-abac-3b8624a175ea' # сохранённая официальная v2
$teamName = Read-Host 'Фактическое имя команды'
if ([string]::IsNullOrWhiteSpace($teamName)) { throw 'Team name is required' }
$runArgs = @('node','scripts/evaluate-dataset.js','--input','/app/input/dev.json','--dataset','dev','--checklist',$checklistId,'--database','cqa','--team',$teamName,'--model-name',$env:GEMINI_MODEL,'--run-dir','/app/.tmp/real-runs/dev-real-v2','--concurrency','2','--max-attempts','65')
docker compose @composeArgs run --rm --no-deps backend @runArgs
if ($LASTEXITCODE -ne 0) { throw 'Plan blocked; no AI call was made' }
# Следующая команда выполняет разрешённый один тест и затем один пакет.
docker compose @composeArgs run --rm --no-deps backend @runArgs --execute
```

Если имя рабочей БД изменено в POSTGRES_DB, замените `--database cqa` фактическим
именем. Это явная защита от случайного запуска в локальной cqa_test. Входные данные
монтируются read-only; локальная `.env` с DATABASE_URL=cqa_test в worker не используется.

Worker сохраняет первоначальные ответы AI, отметки начала попыток и безопасные коды
ошибок в `backend/.tmp/real-runs/dev-real-v2`. Маркер записывается ДО вызова.
Повтор той же команды не повторит начатый запрос. Не меняйте run-dir для обхода
этой защиты. Если первый тест не прошёл, остальные платные запросы не начинаются.
При отказе провайдера/квоте прекращается выдача новых задач; уже начатых не более двух.
Ошибки отдельного ответа/N/A не превращаются в нулевые оценки.
Независимые подтверждения N/A остаются обязательными: одна na_reason от модели
не создаёт проверенный факт. При AI_NA_UNCONFIRMED потребуется проверить конкретный
критерий/диалог существующим механизмом подтверждения; пакет не ослабляет эту защиту.

Официальный экспорт выполняется после пакета, в том числе после неуспешного первого
теста. Старый results.json сохраняется как `results.before-real.<timestamp>.json`;
новый файл формируется существующим Backend-экспортёром. Итоговый stdout сообщает
ok/error. Ненулевой exit при error означает неполный результат, а не команду к повтору.

```powershell
$dev = Get-Content -Raw -Encoding UTF8 results/dev/results.json | ConvertFrom-Json
$dev.results | Group-Object status | Select-Object Name,Count
$dev.results | Where-Object status -eq error | Select-Object conversation_id,error
```

## PROD только после получения настоящего набора

Сохраните неизменённый ответ организаторов с точной группой и 10 чатами в
`backend/.tmp/real-runs/prod-source.json`. Используйте ту же команду worker,
заменив input на `/app/.tmp/real-runs/prod-source.json`, dataset на prod,
добавив `--group-id ФАКТИЧЕСКИЙ_ID`, run-dir на `/app/.tmp/real-runs/prod-real-v2`
и max-attempts на 10. Сначала план без --execute. PROD-ID нельзя угадывать.

## Финальная публикация — только вручную после проверки

Проверьте team_name, фактическую модель, 65 DEV / 10 PROD исходных ID и ok/error.
Не включайте private diagnostics, error-only backups или `.tmp` в Git.

```powershell
git status --short --branch
git diff --check
git add -- backend/README.md backend/compose.gemini.yaml backend/docker/ai-real.Dockerfile backend/docker/ai-real.Dockerfile.dockerignore backend/docker/start-real-ai.mjs backend/docker/ai-real-healthcheck.mjs backend/scripts/configure-gemini.ps1 backend/scripts/evaluate-dataset.js backend/docs/real-ai-run.md backend/docs/final-submission-status.md results/README.md
git add -f -- results/dev/results.json
if (Test-Path results/prod/results.json) { git add -f -- results/prod/results.json }
git diff --cached --check
git diff --cached --stat
# Только после просмотра staged-изменений:
git commit -m "feat(backend): prepare controlled real AI scoring and submission results"
git push origin backend
```

Наличие только DEV не означает полной сдачи DEV+PROD. Ранее отмеченные подписанные
audio_url в уже отслеживаемом data/dev.json требуют разрешения на публикацию;
в официальных results.json аудиоссылок нет.

## Что проверено при подготовке

Compose overlay проходит config --quiet, оба image успешно собраны. Dry-run внутри
нового Backend worker читает именно Docker-БД cqa: 65 pending, 0 reused, конкуренция 2.
Отрицательный запуск с mock блокируется до импорта и AI. Image без приватного ключа
отказывается стартовать. HTTP healthcheck отдельно проверен с синтетическим ключом
в контейнере с отключённой внешней сетью; это не тест доступа к Google.
Полный платный пакет не выполнялся: настоящего ключа нет. Статус DEV остаётся
0 ok / 65 error; PROD group_id пока неизвестен.

Дополнительно весь worker проверен на **отдельной** базе
`cqa_real_worker_test_1794119796254` с явно синтетическими HTTP-ответами:

- 65 synthetic-диалогов: импорт, 65 сохранений/чтений и экспорт 65 ok / 0 error;
- повтор той же команды: 65 reused, **0 новых попыток**;
- отдельный набор с отказом HTTP 503: **ровно 1 вызов**, smoke не прошёл,
  оставшиеся 64 не запущены, экспорт 0 ok / 65 error.

Все эти файлы и модель помечены OFFLINE SYNTHETIC, выход перенаправлялся только
в `backend/.tmp/real-worker-offline-1794119796254/results`. Они не являются настоящими
DEV-оценками и не попадали в `results/dev/results.json`. Тестовая БД сохранена;
существующие рабочие оценки, PostgreSQL volume и AI-код не изменялись.
