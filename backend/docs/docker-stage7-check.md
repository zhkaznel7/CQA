# Этап 7: Compose и диагностика Docker Desktop

Исторический отчёт за 7 ноября. Актуальная проверка 8 ноября: Docker-стек работает,
18 проверок прошли — [docker-final-bug003.md](docker-final-bug003.md).

Дата: 2026-11-07. **Контейнерная интеграция пока не проверена: Docker Desktop зависает на старте контейнеров после одного штатного перезапуска.** Повторный перезапуск не выполнялся. Настройки Backend, AI и PostgreSQL после последней инструкции пользователя не изменялись.

## Фактические результаты

| Проверка | Результат |
| --- | --- |
| `docker compose config --quiet` | Успешно, повторно подтверждено после перезапуска |
| Сборка образа Backend | Успешно; исходный Backend Dockerfile сохранён |
| Сборка образа командного AI mock | Успешно |
| `docker desktop restart --timeout 120` | Выполнен один раз, завершился успешно |
| `docker info` после перезапуска | Отвечает: Engine 29.9.2, Linux, 2056450048 байт RAM (около 1.9 GiB), 16 CPU, overlayfs |
| `docker desktop status` | running, SessionID сменился после перезапуска |
| `docker ps -a` и inspect | Все три контейнера `Created`, `Running=false`, `Pid=0`, `OOMKilled=false`, `State.Error` пуст |
| Независимый `node --version` без сети и томов | До перезапуска тоже зависал на операции старта; после перезапуска ожидавший клиент получил EOF |
| Volume | `cqa-stage7-1794067012572_postgres_data` сохранён |
| HTTP `/api/health`, Backend → AI | Не выполнено: процессы контейнеров не стартовали |
| Подключение к PostgreSQL, миграции в контейнерной БД | Не выполнено: PostgreSQL-контейнер не стартовал |
| Сохранение оценки, апелляция, версия, сохранность после рестарта сервисов | Не выполнено: требуется работающий runtime |

Первоначальная ошибка сборки `docker-credential-desktop: executable file not found in %PATH%` устранена добавлением каталога Docker Desktop в PATH текущего процесса. После этого оба образа собраны. Файл `.docker/config.json` и настройки авторизации не изменялись.

## Наблюдаемая неисправность

В журнале `AppData/Local/Docker/log/host/com.docker.backend.exe.log` после перезапуска:

```text
starting grpcfuse fileserver:listening on vsock:4099:
listening on vsock:4099: A socket operation encountered a dead network.
```

Также есть сообщения `sailorforward` о закрытом соединении для проброса 8001. Локальная диагностика `backend/idle.json` показывает работающую VM и девять незавершённых вызовов `/containers/.../start` на момент сбора архива.

Это подтверждает, что запросы старта застревают внутри Docker Desktop до запуска приложений. Ошибка vsock — наблюдаемый признак неисправности внутренней сети/сокетов Desktop; её причинная связь со всеми зависшими стартами и точный первичный дефект пока не установлены. Ошибки бизнес-логики, PostgreSQL или нехватка RAM этими данными не подтверждены. Сами лимиты контейнеров применены: Backend 512 MiB, DB 384 MiB, AI 128 MiB; порт PostgreSQL на хост не опубликован.

Проверены оба именованных канала Docker: текущий `desktop-linux` и `npipe:////./pipe/docker_engine` возвращают один и тот же Engine ID. Контекст не переключался.

## Сохранённая диагностика

Команда `docker desktop diagnose` выполнена **без `--upload`** и успешно создала локальный архив:

```text
C:\Users\zhanel\AppData\Local\Temp\0AA6A6A4-55D3-42BE-9E52-BDC1A21E4A4B\20261107160756.zip
```

Диагностический ID: `0AA6A6A4-55D3-42BE-9E52-BDC1A21E4A4B`. Это ID локального сбора; загрузка в Docker Support не выполнялась. Архив не добавлялся в репозиторий.

Краткий отчёт без переменных окружения и паролей:

```text
backend/.tmp/docker-stage7-1794067012572/docker-diagnostics.json
```

Там же сохранены тестовый env-файл, контрольные SHA-256 и подготовленный HTTP-сценарий. SHA-256 подтверждают неизменность реального `backend/.env`, исходного Backend Dockerfile и всех 14 отслеживаемых AI-файлов — всего 16 файлов.

Остановлены только два процесса нашей зависшей команды `compose up` по проверенным PID/аргументам. Отдельные команды `compose start`, созданные не этим запуском проверки, не завершались. Контейнеры и том не удалялись. `down -v`, prune, сброс Desktop и принудительное удаление контейнеров не выполнялись. Локальная PostgreSQL пользователя не затрагивалась.

## Следующий безопасный шаг

1. Не запускать новые параллельные команды Start/Up; завершить собственные ожидающие команды запуска в Docker Desktop/терминалах.
2. В Docker Desktop → Troubleshoot проверить собранную локальную диагностику. Если требуется обращение в Docker Support, передачу архива пользователь решает отдельно.
3. После сохранения работы можно выполнить обычную перезагрузку Windows для восстановления подсистемы виртуализации/vsock. Автоматическая перезагрузка Windows, переключение WSL/Hyper-V, изменение служб и сброс Docker не выполнялись.
4. После восстановления Docker повторить запуск **того же тестового проекта с тем же env-файлом**, сохранив том и пароль. Проверить состояние `healthy` у db, ai, backend; затем продолжить подготовленные проверки HTTP, оценок, апелляций и версий.

PowerShell после восстановления среды:

```powershell
Set-Location C:\Users\zhanel\CQA
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
}
docker info
docker ps -a
$composeArgs = @(
    'compose', '-p', 'cqa-stage7-1794067012572',
    '--env-file', 'backend/.tmp/docker-stage7-1794067012572/compose-test.env',
    '-f', 'backend/compose.yaml'
)
docker @composeArgs up -d --wait --wait-timeout 180
docker @composeArgs ps
Invoke-RestMethod http://127.0.0.1:3000/api/health
```

Успешную контейнерную интеграцию и готовность Docker-стека к Frontend пока заявлять нельзя. Текущий блокирующий фактор — операция старта контейнеров в Docker Desktop, а не ошибка, полученная из запущенного Backend. Git merge, commit и push не выполнялись.
