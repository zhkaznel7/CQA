# Локальное объединение Backend, AI и Frontend

Проверка и интеграция: 8 ноября 2026 года. Пользователь разрешил локальный merge;
отдельно согласовал минимальные исправления Frontend. Push не выполнялся.

## Исходные версии и сохранение файлов

| Компонент | Входной commit |
| --- | --- |
| Backend / origin/backend | `1c00f8c2021af58d7214d550916511bf576c694a` |
| origin/codex/ai-mock | `7dc37646c0af04806a78b2a6bb8dacf26352f93b` |
| origin/frontend | `5d66e13bf6b21ca6731cf3c158ef849fd1a905f7` |

Выполнен `git fetch --all --prune`. Обе кандидатные версии отсутствовали в истории
Backend, поэтому повторного merge уже включённой версии не было. Пересекающихся
изменённых путей и конфликтов не обнаружено. AI объединён merge-коммитом
`f22e752f6601f86ca69c900363ceb61aff014d15`, затем объединён Frontend с описанными
ниже интеграционными изменениями. Итоговый merge-коммит доступен через `git log -1`.

Исходные незакоммиченные файлы сохранены на своих местах без добавления в коммит:
`backend/docs/ai-review-7dc3764.md`, `results/.gitignore`, `results/README.md`,
`results/dev/.gitkeep`, `results/prod/.gitkeep`. Их резервные копии и SHA-256 находятся
в игнорируемой `backend/.tmp/team-integration-1794104240169/saved/` и `before.json`.
Приватный `.env` не изменялся. Секреты, node_modules, dist, логи, тестовые настройки
и синтетические результаты в Git не добавлялись.

## Минимальные исправления Frontend

1. `ConversationList.vue`: поле точного `group_id` организаторов; проверка формата;
   сохранение фильтра в запросах и маршруте, сброс страницы при изменении группы.
2. `conversation-catalog.js`: передача группы на каждой странице при объединении
   псевдонимов голосового канала. Без выбранного фильтра интерфейс явно показывает все группы.
3. `EvaluationPanel.vue`: сохранённый `score=null` не вызывает ошибку рендера;
   интерфейс показывает сообщение о несовместимом формате, не заменяет оценку нулём
   и не запускает повторный AI автоматически. Валидный `score.total=null` по-прежнему
   отображается как «не рассчитан»; N/A не превращается в false или 0.
4. `frontend/tests/team-integration.test.js`: пять регрессионных проверок групп,
   пагинации, недопустимого group_id, legacy score и валидного total=null.

На исходной версии три целевые проверки воспроизвели дефекты; после исправлений
они и весь Frontend-набор проходят. Дизайн и существующие API-контракты сохранены.
Scoring Engine, Prisma, официальные критерии и Backend-сервисы не изменялись.

## Общая Docker-конфигурация

В `backend/compose.yaml` добавлен Frontend с production-сборкой Vue/Vite и Nginx.
Новые файлы: `backend/docker/frontend.Dockerfile`, его отдельный `.dockerignore`
и `backend/docker/frontend-nginx.conf`. Backend Dockerfile сохранён.

- Frontend: `http://127.0.0.1:5173/#/`, порт можно изменить через FRONTEND_PORT.
- Frontend передаёт `/api` в `http://backend:3000`; браузеру не нужен адрес AI.
- Backend: `http://127.0.0.1:3000`, AI mock: `http://127.0.0.1:8001`.
- Backend → AI: `http://ai:8001`, HTTP-режим, provenance mock. Gemini-код и ключ
  отсутствуют в mock image; GEMINI_API_KEY в AI-контейнер не передаётся.
- PostgreSQL 18 доступен только в Docker-сети; прежний volume сохранён.
- Все четыре сервиса имеют healthcheck. Frontend работает как `nginx`, rootfs
  read-only, writable tmpfs 16 MiB, лимит памяти 96 MiB. Сумма лимитов — 1120 MiB.
- К CORS добавлены только точные локальные Frontend origins с актуальным портом,
  включая 127.0.0.1; остальные CORS_ORIGINS сохранены. Чужой Origin отклоняется.
- Build context Frontend ограничен allowlist; `.env`, Backend-секреты и временные
  каталоги не входят в image. Runtime содержит только Nginx и статические assets.

## Фактические результаты

| Набор | Успешно | Ошибок | Пропущено |
| --- | ---: | ---: | ---: |
| Backend, полный `npm.cmd test` на отдельной PostgreSQL | 172 | 0 | 0 |
| AI, все Node.js-тесты | 71 | 0 | 0 |
| AI, все Python unittest | 26 | 0 | 0 |
| Frontend, полный Vitest | 22 | 0 | 0 |
| Vue-компоненты с реальным Docker HTTP/Nginx/Backend/AI mock/PostgreSQL | 7 | 0 | 0 |
| **Всего тестов** | **298** | **0** | **0** |

AI-тесты запускались в собственном контейнере Node.js/Python с `--network none`.
Backend-тесты использовали новую `cqa_team_test_1794104444493` с восемью миграциями
и блокировкой внешнего fetch. Для Docker создан отдельный Compose-проект
`cqa-team-1794104540141`, своя база `cqa_team_test`, свой volume и порты 13000/18001/15173.
Производственные данные в интеграционных сценариях не использовались.

В отдельном Docker выполнены 18 HTTP-запросов подготовки/проверки сценария и реальные
запросы семи UI-тестов, включая Origin Frontend. Подтверждены:

- Импорт DEV: 200; повторный импорт: 200, imported=0, duplicates=3.
- Изоляция DEV и синтетической INTEGRATION_TEST-группы с одинаковым externalId.
  Контрольный PROD-набор не создавался; группа организаторов не угадывалась.
- Создание версии чек-листа: POST 201, PUT 201; каждая версия имеет отдельный UUID.
- RU/KZ/EN и `voice call`/`voice`/`call`: POST evaluations 201, c1=N/A, total=38.89.
  Тестовые исходные тексты общие синтетические; это проверка языкового контракта,
  а не смыслового качества ответов для каждого языка.
- Все восемь критериев, boolean/scale/flag, evidence, checked_range и чтение GET 200.
- Повтор той же пары диалог/версия: 200/reused=true, исходный результат сохраняется.
- Сценарий отсутствующего начала без независимого факта: 502 AI_NA_UNCONFIRMED.
- Обычный звонок и чат: c1 применим, синтетический total=35, N/A не включается.
- UI показывает N/A, 38,89, восемь критериев; evidence.turnIndex=0 фокусирует
  первую исходную реплику; включительный диапазон 0..2 подсвечивает три реплики.
- Апелляция: POST 201; решение CHANGE boolean: PATCH 200, finalScore=55.56,
  originalScore=38.89. Пересмотр flag даёт grossError=true при прежних 55.56.
- Frontend читает общий finalScore с учётом двух решений; GET evaluation сохраняет
  первоначальные объяснения, доказательства, значения и score.
- Редактор сохраняет новую v3 через PUT; её оценка сохраняется отдельно, v2 неизменна.
- Legacy score=null из PostgreSQL отображается без рендера фиктивных баллов.
- После штатных stop/up того же тестового Compose сохраняются исходные оценки,
  оба решения, версии v2/v3, finalScore=55.56 и исходные 38.89.

В основном Compose прошли config/build/up и 16 проверок runtime/HTTP/миграций.
Backend, PostgreSQL, AI mock и Frontend healthy. Подтверждено SHA-256 совпадение
76 файлов Backend и 23 production-файлов Frontend с запущенными контейнерами
(стандартная страница Nginx 50x.html не является файлом приложения).
Backend и Frontend используют новые images; Compose сохранил работающий AI image,
поскольку все четыре mock runtime-файла неизменны — их SHA-256 проверены отдельно.

| Основной Docker | Результат |
| --- | --- |
| Frontend HTML и entrypoint JS | 200 |
| Backend health напрямую и через Frontend | 200 |
| Frontend Origin localhost и 127.0.0.1 | 200, точный Access-Control-Allow-Origin |
| Чужой Origin | 403 |
| PATCH preflight | 204 |
| AI mock validator POST `{}` | 422 INVALID_CONVERSATION, ожидаемый healthcheck |
| Prisma | Все 8 миграций применены, ожидающих нет |

Логи новых основных контейнеров проверены на uncaught/Prisma/fatal/emerg; таких
ошибок не найдено. Негативный N/A-сценарий в тестовой системе ожидаемо даёт 502.

## Сохранность основной PostgreSQL

ID контейнера БД и имя volume остались прежними. Совпали контрольные суммы всех
восьми таблиц до и после обновления Compose, а не только количество строк:

| Таблица | Записей до и после |
| --- | ---: |
| Conversation | 9 |
| Checklist | 5 |
| ChecklistCriterion | 40 |
| Evaluation | 8 |
| CriterionResult | 64 |
| Appeal | 5 |
| ApplicabilityConfirmation | 4 |
| _prisma_migrations | 8 |

Основная БД не использовалась для записи тестовых данных. Volumes и существующие
записи не удалялись. Игнорируемые тестовые базы и volumes оставлены для диагностики;
собственные тестовые процессы остановлены после проверки. Основная система оставлена работающей.

## Готовность и ограничения

Единая локальная mock-система готова к демонстрации и последующему просмотру перед
push. Push не выполнялся. Новых несовместимостей Backend ↔ mock не обнаружено.

Не подтверждены реальные ответы нового Gemini, устранение Google 400 INVALID_ARGUMENT
в живом API и качество официального результата: платных запросов не было. Для N/A
по 02 и 04 по-прежнему нужны доверенные факты Backend; новый AI-промпт не заменяет
это требование. Полный новый DEV/PROD-прогон и официальный results.json не формировались;
синтетические результаты не являются официальной сдачей.

UI проверен Vitest/Vue Test Utils/jsdom с реальной HTTP-сетью и статической Docker-сборкой.
Полноценный ручной браузерный просмотр дизайна и воспроизведение организаторского аудио
следует выполнить отдельно. Для точного audio seek нужны надёжные исходные временные
интервалы; неизвестные смещения не придумывались.

Локальные диагностические материалы: `backend/.tmp/team-integration-1794104240169/`.
Их нельзя добавлять в Git: внутри есть приватные тестовые настройки и synthetic fixtures.

## PowerShell

```powershell
Set-Location C:\Users\zhanel\CQA
$env:COMPOSE_PARALLEL_LIMIT = '1'
docker compose --env-file backend/.env -f backend/compose.yaml config --quiet
docker compose --env-file backend/.env -f backend/compose.yaml build
docker compose --env-file backend/.env -f backend/compose.yaml up -d --wait --wait-timeout 180
docker compose --env-file backend/.env -f backend/compose.yaml ps
Invoke-RestMethod 'http://127.0.0.1:5173/api/health'
Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
git status --short --branch
git log -2 --oneline
# Откройте http://127.0.0.1:5173/#/
# Для штатной остановки: docker compose --env-file backend/.env -f backend/compose.yaml stop
```
