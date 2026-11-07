# Экспорт по приложению организаторов: JSON 1.0

Источник: `CQA_Student_Guide_Appendix_Results.pdf` (3 страницы, локальный Downloads).
PDF содержит пример и таблицу правил, но не отдельный машиночитаемый JSON Schema.
Проверка этих правил формализована через Zod в `src/modules/exports/results.schema.js`.
Она дополняется проверками набора, исходных ID, транскрипта, доказательств и расчёта.
Приоритетный механизм сдачи — этот Backend CLI. Сравнение с AI-экспортёром и пакет
для его `--scores`: [exporters-compatibility.md](exporters-compatibility.md).

## Контракт

Один UTF-8 JSON-объект: `schema_version="1.0"`, `team_name`, `model={mode,name}`, `results`.
Режим модели: только `local`, `external_api`, `hybrid`; HTTP-транспорт сам по себе не
определяет режим или название модели. Название реальной модели явно указывает оператор.
Экспорт не вызывает AI, не импортирует данные и не создаёт оценок в БД.

В DEV ровно 65 записей; в PROD ровно 10. Источник ID — полный исходный JSON набора,
не случайная выборка из БД. Повторы, пустые ID, неполный manifest и неверный размер
прерывают экспорт. По каждому ID без завершённой оценки записывается error, а не ноль.
Диалоги читаются по `(Conversation.groupId, Conversation.externalId)` и выбранной
версии чек-листа. UUID Backend не подменяет ID организаторов.

После T02 экспорт принимает `--group-id` — реальный ID набора организаторов.
Если флаг не указан, берётся `data.dataset_group_id` исходной официальной оболочки;
для старого DEV-manifest без поля группы допускается только default DEV.
Для prod без группы источника требуется явный флаг. `--dataset prod` — имя split,
а group_id контрольного набора может иметь любое выданное имя, кроме DEV.
DEV допускается только в dev; несовпадение флага и группы manifest отклоняется.
Legacy-записи с `groupId=__legacy__` и совпавшим externalId не используются.
Для них нужно отдельно подтвердить происхождение или импортировать/оценить набор заново;
автоматического переноса старых результатов нет. Официальный JSON 1.0 не меняется;
пакет `--ai-input-dir` дополнительно фиксирует `manifest.group_id`.

Контрольный экспорт после получения и оценивания настоящего набора (из backend):

```powershell
$groupId = Read-Host 'Точный group_id от организаторов'
$inputFile = Read-Host 'Путь к неизменённому JSON ответа организаторов'
$checklistId = Read-Host 'UUID версии, по которой оценена эта группа'
$teamName = Read-Host 'Имя команды'
$modelName = Read-Host 'Фактическая модель'
npm.cmd run export:results -- --dataset prod --group-id $groupId --input $inputFile --checklist $checklistId --team $teamName --model-name $modelName --model-mode external_api
```

Режим модели выбирается фактический. Здесь не создан PROD-набор и не выполнялись
платные вызовы; тесты разделения используют отдельные однозаписные synthetic-фикстуры.

| Внутренний key | criterion_id | Допустимый value |
| --- | --- | --- |
| 01 | contact | true / false; null только для подтверждённого обрезанного DEV-звонка |
| 02 | discovery | true / false / null |
| 03 | identification | true / false / null |
| 04 | consultation | 0, 5, 10, 15, 20 / null |
| 05 | empathy | true / false |
| 06 | dialogue | 0, 4, 7, 10 |
| 07 | closure | true / false / null |
| 08 | critical | true / false |

Успешная запись содержит ровно эти восемь критериев по одному, rationale,
evidence_turns с индексами **от 1** по всему исходному массиву, score.final_score
от 0 до 100 и critical_flag, равный critical.value. Для пропущенного boolean-действия
в evidence_turns включаются все явно проверенные checked_range и индексы цитат+1.
Реплики клиента, бота и system сохраняют места в нумерации.

Используется существующий calculateScore только для сверки сохранённого снимка;
числовой итог копируется из Evaluation.score, новая формула не вводится.
Экспортируются первоначальные автоматические ответы:
апелляции остаются отдельной историей, не выдаются за ответы модели.

Если результат несовместим: `status="error"`, `criteria=[]`, `score=null`, понятный
`error`, исходный conversation_id. По подтверждённому пользователем уточнению организаторов
от 8 ноября 2026 **contact=null разрешён для DEV-звонков** с независимо подтверждённым
отсутствием начала записи. Backend требует dataset=dev, канал voice call/voice/call,
правило recording_start_missing в выбранной версии и неизменяемую запись подтверждения
для этого диалога/чек-листа/критерия. Одного канала или причины, написанной AI, недостаточно.
Для чатов, PROD и неподтверждённых случаев результат остаётся error. Внутренние правила,
score и исходные данные не изменяются. Базовая схема PDF остаётся строгой; расширенная
проверка `resultsSchemaFor` принимает whitelist только проверенных DEV-ID.

Редактор продолжает поддерживать произвольные критерии. Конфигурация с другими
ключами/типами/весами/шкалами не маскируется под официальный чек-лист при экспорте.

## Реальные результаты: PowerShell

Укажите URL нужной БД в текущем PowerShell. Известный checklist UUID должен ссылаться
на версию, по которой уже сохранены оценки. Здесь имена команды/модели — placeholders,
их необходимо заменить фактическими; сам экспорт не проверяет историческую идентичность
внешней модели по HTTP. Не используйте название Gemini для mock-оценок.

```powershell
Set-Location C:\Users\zhanel\CQA\backend
$checklistId = Read-Host 'UUID оценённой версии чек-листа'
npm.cmd run export:results -- --dataset dev --input ../data/dev.json --checklist $checklistId --team 'ФАКТИЧЕСКОЕ_ИМЯ_КОМАНДЫ' --model-name 'ФАКТИЧЕСКАЯ_МОДЕЛЬ' --model-mode external_api
# Только после получения исходного контрольного набора:
npm.cmd run export:results -- --dataset prod --input ../data/prod.json --checklist $checklistId --team 'ФАКТИЧЕСКОЕ_ИМЯ_КОМАНДЫ' --model-name 'ФАКТИЧЕСКАЯ_МОДЕЛЬ' --model-mode external_api
```

Выход по умолчанию: корневые `results/dev/results.json` и `results/prod/results.json`.
Запись атомарна: временный файл + link без перезаписи. Существующий файл вызывает
ошибку; старый экспорт не удаляется. Для повторной проверки задайте новый `--output`
внутри `results/` или `backend/.tmp/`. Вывод CLI содержит только агрегированные счётчики.
Файл может содержать error-записи; exit=0 означает корректный формат, а не отсутствие
ошибок оценивания — проверьте счётчик error перед сдачей.

`results/.gitignore` защищает все результирующие JSON от случайного добавления.
Публикация — отдельное ручное действие после проверки содержимого и разрешённого
организаторами момента. В этой работе commit/push не выполнялись.

## Mock-проверка

```powershell
npm.cmd run export:results -- --dataset dev --input ../data/dev.json --checklist $checklistId --team 'AUDIT SYNTHETIC NOT FOR SUBMISSION' --allow-mock
```

Нужно явное `--allow-mock`; имя фиксируется как `CQA mock (synthetic; not Gemini)`.
Перемаркировать mock в реальную модель или смешать его с реальными результатами нельзя.
Выход по умолчанию — `backend/.tmp/exports/dev.mock.json`. Занять mock-файлом официальные
пути `results/dev/results.json` и `results/prod/results.json` запрещено.

## Совместимость с AI --scores

Опциональный `--ai-input-dir .tmp/НОВЫЙ_КАТАЛОГ` создаёт responses.json,
backend-scores.json и manifest.json из того же read-only снимка PostgreSQL, что и
основной файл. Каталог должен быть новым и находиться внутри backend/.tmp; файлы
не перезаписываются. Пример:

```powershell
npm.cmd run export:results -- --dataset dev --input ../data/dev.json --checklist $checklistId --team 'AUDIT SYNTHETIC NOT FOR SUBMISSION' --allow-mock --output .tmp/comparison.mock.json --ai-input-dir .tmp/ai-export-inputs
```

Это входы для сравнения, не второй официальный экспортёр. `--responses` AI-скрипта
должен указывать на **responses.json**, а `--scores` — на **backend-scores.json**.
Не передавайте весь каталог пакета как --responses: в нём есть JSON других типов.
Основные paths сдачи по-прежнему формирует только Backend.

Docker: Compose монтирует `../results` в `/app/results`; образ содержит writable-каталоги
для пользователя node. Mock-экспорт остаётся в `/app/.tmp/exports/`, а официальный
экспорт попадает на хост только при явном запуске CLI. Входной dataset следует передать
в нужный контейнер отдельно; `.env` и исходные клиентские наборы в image не включены.

## Проверенный статус

На отдельной локальной PostgreSQL и отдельном Docker-стеке все 65 DEV импортированы,
оценены HTTP mock и экспортированы: 65 ok, 0 error, исходные ID сохранены. Это synthetic
проверка формата, не результаты Gemini и не файлы сдачи. PROD с реальными 10 ID не
предоставлен; проверена только синтетическая десятиэлементная фикстура. Подробности —
[technical-audit.md](technical-audit.md).
