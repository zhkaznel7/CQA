# CQA

## Совместный запуск из ветки backend

Docker Compose запускает Frontend, Backend, PostgreSQL и командный AI mock.
Настройте приватный `backend/.env` по `backend/.env.example`; существующий файл и
пароль PostgreSQL сохраняйте. Gemini и API-ключ для демонстрации не нужны.

```powershell
Set-Location C:\Users\zhanel\CQA
$env:COMPOSE_PARALLEL_LIMIT = '1'
docker compose --env-file backend/.env -f backend/compose.yaml config --quiet
docker compose --env-file backend/.env -f backend/compose.yaml build
docker compose --env-file backend/.env -f backend/compose.yaml up -d --wait --wait-timeout 180
Invoke-RestMethod 'http://127.0.0.1:5173/api/health'
```

Откройте **http://127.0.0.1:5173/#/**. Frontend отправляет `/api` через свой Nginx
в Backend; Backend обращается к mock по `http://ai:8001`. Backend также доступен
на http://127.0.0.1:3000, mock — на http://127.0.0.1:8001. PostgreSQL доступен
только внутри Docker-сети и хранит данные в постоянном volume.

Для списка одной группы укажите точный `group_id` организаторов в поле
«Группа организаторов». DEV — отдельная группа; контрольный идентификатор не
обязан называться PROD. Пустое поле явно означает все группы. Импорт и seed
чек-листа запускаются отдельно: [инструкция Backend](backend/README.md).

Для штатной остановки используйте `docker compose --env-file backend/.env -f
backend/compose.yaml stop`. Не удаляйте PostgreSQL volume. При занятом порте
5173 остановите свой Vite либо задайте свободный `FRONTEND_PORT` в приватном `.env`.

## Локальный запуск фронтенда

Понадобятся Git для клонирования и Node.js с npm. Для этого проекта подойдёт Node.js 24.x начиная с 24.15.0. Для работы с диалогами, оценками и апелляциями нужен запущенный CQA Backend. По умолчанию фронтенд обращается к нему по адресу `http://127.0.0.1:3000`. Сам фронтенд запускается без Docker.

Для разработки без контейнера Frontend используйте объединённую ветку `backend`.

```sh
git clone --branch backend https://github.com/zhkaznel7/CQA.git
cd CQA/frontend
npm ci
npm run dev
```

Открой [CQA в браузере](http://localhost:5173/#/). Оставь терминал открытым на время работы. Если проект уже скачан, открой папку `frontend` и выполни две команды npm из примера. При следующих запусках достаточно `npm run dev`, пока зависимости не изменились.

Если бэкенд доступен по другому адресу, перед запуском задай `CQA_BACKEND_URL` в том же терминале. Пример для PowerShell и порта 4000.

```powershell
$env:CQA_BACKEND_URL = "http://127.0.0.1:4000"
npm run dev
```

[Подробнее о фронтенде, тестах и API](frontend/README.md)
