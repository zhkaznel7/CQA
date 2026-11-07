# Технический аудит Backend и формата сдачи

Историческое уточнение после аудита: организаторы подтвердили contact=null для
подтверждённых обрезанных DEV-звонков. Актуальная политика и сравнение экспортёров:
[exporters-compatibility.md](exporters-compatibility.md). Прежнее описание этого
ограничения ниже фиксирует состояние на момент аудита.

Дата: 8 ноября 2026. Базовый HEAD: `16d66a03f83f396fb2f9cd3e646b82b4db79d424`.
Исправления находятся в рабочем дереве; merge/commit/push не выполнялись.

**Демонстрационный Backend с mock проверен. Полную готовность к сдаче объявлять нельзя:**
нет реального PROD-набора, подтверждённых результатов фактической модели и файлов сдачи.
Synthetic-проверки не измеряют точность оценки качества диалогов.

## Источники

Полностью прочитаны: `CQA_Hackathon_Student_Guide_v3.pdf` (4 страницы),
`CQA_Student_Guide_Appendix_Results.pdf` (3 страницы) из локального Downloads и
`backend/docs/CQA_Chat_Quality_Checklist 1.pdf` (3 страницы). PDF и их извлечённый
текст не добавлялись в Git. Проверены доступный DEV и агрегированная структура данных,
Prisma schema и все семь SQL-миграций, сервисы, middleware, тесты и Docker.

## Подтверждённые проблемы

| ID / приоритет | Причина и воспроизведение | Исправление |
| --- | --- | --- |
| AUDIT-01 / Critical | Не было механизма обязательного results/dev/results.json и results/prod/results.json | Read-only CLI экспорта, строгая формализация формата PDF, проверка полного manifest/ID/65 или 10 записей, атомарная запись без перезаписи |
| AUDIT-02 / High | Организаторский ответ из гайда `{isSuccess,data:{records}}` возвращал 502: клиент ожидал только `{conversations}` | Адаптер официальной оболочки и полей conversation_id/audio_url; сохранены старый формат, исходные каналы, реплики и время |
| AUDIT-03 / High | Boolean=false с цитатой и checked_range=null принимался, хотя пропущенное действие требует проверенного участка | 502 AI_MISSING_RANGE до записи Evaluation; положительные ответы с цитатой по-прежнему допускают null range |
| AUDIT-04 / Medium | Два одновременных запроса одной оценки вызывали AI дважды: тест воспроизвёл 2 вызова вместо 1 | Объединение in-flight запросов одной пары в одном процессе; после отказа повтор разрешён. Межпроцессную уникальность по-прежнему обеспечивает БД |
| AUDIT-05 / Medium | Prisma 7 adapter P2039/SQLSTATE 23514 давал 500 вместо ошибки ограничений | Безопасное сопоставление SQLSTATE с 400/409/503 без зависимости от языка сообщения и раскрытия деталей БД |
| AUDIT-06 / High, внешнее ограничение | Внутренний contact=N/A допустим для подтверждённого обрезанного звонка, приложение экспорта запрещает contact=null | По уточнению пользователя — status=error, criteria=[], score=null, исходный ID и понятная причина. Исходная оценка и правило N/A не изменены. Требуется уточнение организаторов |

AUDIT-02/03/05 дополнительно воспроизведены на исходном коде из HEAD и сопоставлены
с исправленным вариантом; журнал — `.tmp/audit-1794079621290/reproductions.json`.
AUDIT-04 воспроизведён отдельным тестом на реальных независимых транзакциях PostgreSQL:
первый запуск падал с `2 !== 1`, после исправления проходит.

## Что проверено без изменения алгоритмов

- Все 8 исходных критериев: типы, веса 10/15/20/20/15/15/5 и flag без веса; шкалы
  consultation 0/5/10/15/20, dialogue 0/4/7/10; правила N/A сверены с PDF.
- calculateScore и арифметика дробей не изменялись: перераспределение до 100,
  итоговое half-up округление, 88.13 и пример приложения **85.38**, флаг отдельно.
- BUG-003, agent chat/voice call/voice/call, RU/KZ/EN, исходные timestamp и порядок.
- Некорректные/пустые транскрипты, неизвестные роли, ложные цитаты, индексы,
  checked_range, полнота/дубли результатов и недопустимые значения отклоняются.
- Уникальность импорта и оценок, версии и исходные ответы защищены ограничениями,
  триггерами и транзакциями. Конкурирующие апелляции и повторные решения проходят
  существующие регрессии; ошибки не сохраняют частичные результаты.
- SQL-параметры отделены от текста запросов; обнаруженные raw-запросы приложения
  имеют статический SQL/типизированные UUID. Подтверждённой SQL Injection не найдено.
- Импорт использует только доверенную серверную HTTPS-настройку; произвольный URL
  из HTTP-запроса и redirects запрещены. Другие URL из диалога Backend не скачивает.
- CORS с точными origins, Helmet, JSON/byte limits, повреждённый JSON, HTTP timeout,
  ошибки AI 502/503/504 и отсутствие fallback проверены. Реальный тест rate limiting
  получил 200/200/429 и проверил security headers на ответе 429.
- Demo-аутентификация не добавлялась. Это аудит MVP, не формальная гарантия отсутствия
  всех уязвимостей и не нагрузочный/внешний penetration test.

Нормализация ответа источника не превращает пустой/обрезанный ответ в успешный импорт:
isSuccess и total_records проверяются. Некорректные отдельные записи проходят прежнюю
Zod-проверку и отчёт rejection без текста клиента или секретного URL.

## Реально выполненные проверки

| Проверка | Результат |
| --- | --- |
| Полный `npm.cmd test` на новой PostgreSQL | **126 passed, 0 failed, 0 skipped** |
| `node --test ai/mock.test.mjs` | **6 passed, 0 failed** |
| Новые автоматические тесты | 17: экспорт 10, источник 4, SQLSTATE 1, in-flight/retry 1, rate limit 1; усилены существующие AI-проверки |
| Реальный DEV через новый HTTP Backend и локальный командный mock | Импорт 65; повтор — 65 дубликатов; 65 Evaluation с HTTP 201 |
| Локальный CLI DEV export | 65 ok, 0 error; UTF-8, все исходные ID и критерии проверены; существующий файл не перезаписан, mock в путь сдачи не допущен |
| Docker config/build/up | Успешно, все 3 сервиса healthy |
| Docker до/после перезапуска | **12 + 6 проверок прошли**, тот же volume, исходные/новые версии и апелляции сохранились |
| Docker DEV import/evaluate/export | Отдельно 65 импортированы, 65 HTTP-оценок, 65 ok synthetic-export |
| Повторный Docker export после restart | Все 65 ok; файл побайтно идентичен предыдущему |

Локальная БД: `cqa_audit_test_1794080119448`, сервер 127.0.0.1:5432. Все семь миграций
применены только к ней. Docker-проект: `cqa-audit-1794080399737`, порты 3300/8301,
база `cqa_audit_docker_test`, новый volume `cqa-audit-1794080399737_postgres_data`.
Основной `cqa` не пересоздавался и остался healthy. Новый тестовый проект остановлен
после проверки; его контейнеры/volume и локальная тестовая БД сохранены.

В Docker проверены node-user, лимиты памяти, приватный порт PostgreSQL, отсутствие .env,
Gemini-кода в образе mock и секретов в image ENV. Backend Dockerfile дополнен только
каталогами экспорта с правами node; Compose — bind-mount каталога results. Проверка
контейнерных файлов не доказывает безопасность всего хоста или администрирования Docker.

Frontend: прочитаны API-helper, экран диалога, список апелляций и Vite proxy из доступной
`origin/frontend` (`1a56eb4`). Их GET-контракт соответствует Backend; localhost:5173/CORS
и JSON-ответы проверены. В текущей рабочей копии Frontend представлен только README,
поэтому реальный браузерный UI и его редактор/кнопки оценки не прогонялись. Frontend не менялся.

## Экспорт и блокеры сдачи

Формат основан на всех трёх страницах приложения. Отдельной официальной машинной схемы
в PDF нет; Zod формализует указанные там поля/типы, а процедурные проверки контролируют
ID, counts, transcript, evidence и score. Это не утверждение о прогоне через отдельно
выданный JSON Schema-файл, которого в материалах нет.

**DEV:** все 65 доступны и проверены на mock, включая реальные форматы пяти звонков.
Тестовые файлы имеют имя/метаданные synthetic и находятся в игнорируемой `.tmp/` или
тестовом контейнере. Это не качество модели и не официальные результаты команды.

**PROD:** реальный набор с 10 ID не найден. Проверен только синтетический manifest из
10 записей. `results/prod/results.json` не создавался. `results/dev/results.json` тоже
не создавался: реальные оценки и фактические сведения команды/модели не подменялись.
Подготовлены структура results/, защита от случайного Git-add и CLI.

Критические блокеры сдачи:

1. Получить настоящий PROD и оценить все 10 исходных ID фактически выбранной моделью.
2. Подготовить реальные оценки DEV/PROD и указать действительные team_name/model.name/mode;
   текущие mock-проверки для этого непригодны. Название модели не хранится в старых
   Evaluation и не выводится достоверно из HTTP: оператор должен явно подтвердить
   фактически использованные сведения при экспорте.
3. Проверить export error-count, состав файлов и разрешённый момент публикации.
   В этой задаче запрещены commit/push, поэтому публикация остаётся отдельным действием.

Дополнительные ограничения: contact=N/A остаётся экспортной error-записью до уточнения
организаторов; действительные N/A других критериев требуют независимых подтверждений
для конкретной версии. Для заменённых критериев с несовместимыми с приложением типами,
весами или ключами экспорт не выдумывает новые коды. Экспортирует исходные модельные
ответы; история апелляций остаётся отдельной. Не проверялись точность Gemini, нагрузка
и историческая модельная аттестация. In-flight объединение действует в одном процессе.

**Готовность:** mock-демонстрация исправленного Backend проверена в отдельном Docker-
контуре; основному `cqa` для новых исправлений нужна обычная пересборка. Готовность к
контрольным данным подтверждена на уровне формата, расчёта и сохранения, но не качества
реального AI, наличия PROD или готовых файлов сдачи.

## Изменённые файлы

- `backend/src/modules/conversations/organizer-client.js`, `organizer-payload.js`.
- `backend/src/modules/evaluations/ai-contract.js`, `evaluations.service.js`.
- `backend/src/middleware/error-handler.js`.
- `backend/src/modules/exports/results.schema.js`, `official-results.js`.
- `backend/scripts/export-results.js`, `backend/package.json`.
- `backend/Dockerfile`, `backend/compose.yaml`.
- `backend/tests/ai-client.test.js`, `api.test.js`, `evaluation-retries.test.js`,
  `export-results.test.js`, `http-security.test.js`, `organizer-payload.test.js`.
- `backend/README.md`, `backend/docs/api.md`, `evaluations.md`, `results-export.md`,
  `technical-audit.md`.
- `results/README.md`, `results/.gitignore`, `results/dev/.gitkeep`, `results/prod/.gitkeep`.

Scoring Engine, официальный seed, предыдущие миграции, AI и Frontend не изменялись.

## Повторение: PowerShell

На этой машине сохранён URL новой тестовой БД без вывода пароля:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
$previousDatabaseUrl = $env:DATABASE_URL
try {
    $testEnv = Get-Content '.tmp/audit-1794079621290/database.env' -Raw -Encoding UTF8
    $env:DATABASE_URL = $testEnv.Trim().Substring(13)
    npm.cmd run db:status
    npm.cmd test
} finally {
    if ($null -eq $previousDatabaseUrl) { Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue }
    else { $env:DATABASE_URL = $previousDatabaseUrl }
}
Set-Location ..
node --test ai/mock.test.mjs
```

Для новой установки подготовка cqa_test описана в README (`db:test:prepare`).
Экспорт и его параметры: [results-export.md](results-export.md).

Повторно поднять сохранённый тестовый Docker-проект:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
docker compose -p cqa-audit-1794080399737 --env-file .tmp/audit-1794079621290/compose.env up -d --wait --wait-timeout 120
Invoke-RestMethod http://127.0.0.1:3300/api/health
docker compose -p cqa-audit-1794080399737 --env-file .tmp/audit-1794079621290/compose.env ps
```

Применение уже проверенного рабочего кода к основному Backend, когда будет выбран
момент краткого перезапуска HTTP-сервиса (AI/DB не пересоздаются):

```powershell
Set-Location C:\Users\zhanel\CQA\backend
docker compose up -d --build --no-deps --wait --wait-timeout 120 backend
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Артефакты: `.tmp/audit-1794079621290/` — `verified-tests.log`, `reproductions.json`,
`dev-pipeline.json`, `dev.mock.json`, `checks-before.json`, `checks-after.json`,
`docker-dev-export.json`, `restart-export.json`. Реальные записи из этих файлов не
публиковались. Архив сохраняет данные проверки; одноразовые сценарии защищены от
перезаписи прежних результатов.
