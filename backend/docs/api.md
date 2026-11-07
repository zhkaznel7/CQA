# Backend API: контракт для Frontend

Base URL: **http://127.0.0.1:3000**. Ниже полный публичный контракт текущих
Express routes, Zod schemas и serializers. Проверены 14 маршрутов. Примеры JSON сняты
с реального HTTP на синтетических данных в отдельной тестовой PostgreSQL; это не
оценки клиентов. UUID в примерах иллюстративны: получайте актуальные ID из API.

## Навигация и маршруты

| Метод | Полный путь | Назначение | Успех |
| --- | --- | --- | --- |
| GET | /api/health | Проверить HTTP-приложение | 200 |
| GET | /api/conversations | Получить метаданные диалогов | 200 |
| GET | /api/conversations/:id | Получить диалог и транскрипт | 200 |
| POST | /api/conversations/import | Импортировать серверный источник | 200 |
| GET | /api/checklists | Получить версии чек-листов | 200 |
| GET | /api/checklists/:id | Получить конкретную версию и критерии | 200 |
| POST | /api/checklists | Создать новый ключ, версию 1 | 201 |
| PUT | /api/checklists/:id | Создать новую версию последней версии | 201 |
| POST | /api/evaluations | Вызвать AI, проверить и сохранить оценку | 201 / 200 |
| GET | /api/evaluations/:id | Прочитать исходную сохранённую оценку | 200 |
| POST | /api/appeals | Подать апелляцию | 201 |
| GET | /api/appeals | Получить список апелляций | 200 |
| GET | /api/appeals/:id | Получить карточку и актуальный итог | 200 |
| PATCH | /api/appeals/:id/decision | Подтвердить или изменить ответ критерия | 200 |

Других публичных маршрутов сейчас нет: отсутствуют GET списка evaluations,
GET evaluations по conversationId, отдельные scoring/export HTTP API, удаление,
повторное принудительное оценивание и API записи подтверждений N/A.
Экспорт — отдельный [Backend CLI](results-export.md). Не вызывайте AI-порт 8001 из Frontend.

## Общие соглашения

- В :id всегда передаётся внутренний UUID записи, не externalId. Checklist.id — UUID
  конкретной версии; Checklist.key объединяет историю версий.
- Запросы с телом: Content-Type: application/json. Числовые/boolean поля тела —
  настоящие JSON number/boolean, не строки. Даты ответа — ISO UTC strings.
- Обычно ответ одиночного ресурса — {data: object}; health и ошибки имеют другую
  оболочку, POST evaluations также возвращает reused.
- Списки conversations/checklists/appeals используют page (1–100000, default 1),
  pageSize (1–100, default 20). Query-числа передаются строкой URL и приводятся сервером.
  pagination: {page,pageSize,total,totalPages}; totalPages=0 для пустого списка,
  страница за пределами списка возвращает 200 и data=[].
- Порядок списков: createdAt DESC, id DESC. Это пагинация по смещению, поэтому при
  новых записях между запросами содержимое страниц может сдвигаться.
- Неизвестные query-поля запрещены у трёх списков и импорта. Схемы JSON-тел строгие:
  нельзя добавлять score, ID ответа, поля UI или произвольные URL.
  У detail-маршрутов и остальных операций query не валидируется и не используется;
  документированных query-параметров у них нет.
- Авторизации в демо нет. reviewer — текстовая метка, не подтверждённая роль.
  Frontend показывает подачу и рассмотрение как отдельные операции.
- По умолчанию 100 запросов за 60000 ms на IP, включая health; настройки меняются
  окружением. При 429 используйте Retry-After, не запускайте частый polling.
- JSON body по умолчанию до 100kb. CORS разрешает точные origins из CORS_ORIGINS,
  по умолчанию http://localhost:5173 и http://localhost:3000. Origin Frontend
  http://127.0.0.1:5173 отличается от localhost:5173 и требует настройки.
  Cookies/Bearer-токен для демонстрации не нужны; credentials: 'include' не задавайте.

## Ошибки: единый формат

Каждый неуспешный ответ содержит error.code и error.message. error.details —
необязательный массив; его форма зависит от ошибки. UI должен опираться на HTTP
status/code и показывать безопасное message; не разбирать английский текст.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "",
        "code": "unrecognized_keys"
      }
    ]
  }
}
```

В VALIDATION_ERROR details содержит только {path,code}, без исходных значений.
При адаптации транскрипта — {turnIndex,field}; при INVALID_REVIEW_VALUE — {code}.
Ошибки не содержат стеков, секретов или ответов внешнего API.

Ниже — общие ошибки middleware; они дополняют ошибки каждого маршрута, а не означают,
что любая операция использует каждый статус.

| HTTP | code | Когда |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Ошибка схемы запроса/параметров |
| 400 | INVALID_JSON | Не удалось разобрать JSON body |
| 400 | DATABASE_CONSTRAINT | Нарушение ограничения БД на операциях записи |
| 403 | CORS_ORIGIN_DENIED | Origin браузера не разрешён; браузер может скрыть body |
| 404 | NOT_FOUND | Неизвестный маршрут/метод |
| 409 | CONFLICT, REFERENCE_CONFLICT, CONCURRENT_MODIFICATION | Конфликт БД при записи |
| 413 | PAYLOAD_TOO_LARGE | Слишком большое JSON-тело |
| 415 | UNSUPPORTED_ENCODING, UNSUPPORTED_CHARSET | Неподдерживаемая кодировка тела |
| 429 | RATE_LIMIT_EXCEEDED | Лимит запросов |
| 503 | DATABASE_UNAVAILABLE | Недоступность БД для маршрутов, использующих БД |
| 500 | INTERNAL_SERVER_ERROR | Непредвиденная ошибка |

P2025 также переводится middleware в 404 NOT_FOUND. Специализированные
*_NOT_FOUND перечислены у маршрутов. 422 используется для доменных проблем
оценивания/пересмотра; ошибки Zod возвращают 400, а не 422.

## Общий fetch-клиент

Копируйте этот блок один раз в модуль API, а нужные функции из разделов ниже —
в тот же модуль. Функции возвращают полную оболочку JSON, не только data.
Для внешнего импорта/AI не задаётся короткий клиентский timeout. Отмена fetch
в браузере не гарантирует отмену серверной обработки.

```javascript
const API_BASE = 'http://127.0.0.1:3000';

async function apiRequest(path, {method = 'GET', body, query, signal} = {}) {
  const url = new URL(path, API_BASE);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method, signal,
    headers: {Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Backend request failed');
    Object.assign(error, {status: response.status, code: payload.error?.code,
      details: payload.error?.details, retryAfter: response.headers.get('Retry-After')});
    throw error;
  }
  return payload;
}
```

## GET /api/health

Проверка доступности HTTP-приложения. URL/query/body: нет.
Успех 200. Специализированных 400/404/409/422/502/503/504 нет;
общие middleware всё равно действуют. Не проверяет PostgreSQL или AI на каждый запрос:
200 не является комплексной проверкой зависимостей.

Успех **HTTP 200**; полный синтетический ответ:

```json
{"status":"ok","service":"cqa-backend"}
```
```javascript
async function getHealth() {
  return apiRequest('/api/health');
}
```

## GET /api/conversations

Список для таблицы диалогов без транскрипта. Body/URL params: нет.

| Query | Обязательно | Правило |
| --- | --- | --- |
| page, pageSize | Нет | Общая пагинация |
| language | Нет | Только RU, KZ, EN, регистр важен |
| channel | Нет | Строка после trim: 1–50 символов, точное совпадение |

Успех 200; 400 VALIDATION_ERROR; 503 DATABASE_UNAVAILABLE.
Фильтр channel не объединяет voice call/voice/call: он ищет сохранённую строку.
Точное совпадение действует и для agent chat/chat.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": [
    {
      "id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "externalId": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "language": "RU",
      "channel": "agent chat",
      "audioUrl": null,
      "createdAt": "2026-11-07T20:32:59.719Z"
    }
  ],
  "pagination": {"page":1,"pageSize":1,"total":31,"totalPages":31}
}
```
```javascript
async function listConversations({page = 1, pageSize = 20, language, channel} = {}) {
  return apiRequest('/api/conversations', {query: {page, pageSize, language, channel}});
}
```

## GET /api/conversations/:id

Для открытия карточки и доказательств загрузите полный диалог по data[].id списка.
URL: id обязателен, UUID Conversation. Query/body: нет.
Успех 200; 400 VALIDATION_ERROR; 404 CONVERSATION_NOT_FOUND;
503 DATABASE_UNAVAILABLE.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": {
    "id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
    "externalId": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
    "language": "RU",
    "channel": "agent chat",
    "audioUrl": null,
    "transcript": [
      {"text":"Здравствуйте! Чем могу помочь?","speaker":"operator","timestamp":"00:00:01.000","turnIndex":0},
      {"text":"Хочу узнать условия.","speaker":"client","timestamp":"00:00:02.000","turnIndex":1}
    ],
    "createdAt": "2026-11-07T20:32:59.719Z"
  }
}
```

transcript — исходный упорядоченный массив. turnIndex равен позиции от 0.
speaker/text обязательны для импортируемой реплики; дополнительные поля сохраняются.
timestamp/startMs/endMs могут отсутствовать, быть исходной строкой либо неотрицательным
числом; единицы чисел не угадываются. Отсутствующее время не восстанавливается.
Оригинальные значения в PostgreSQL и GET не меняются HTTP-адаптером AI.

```javascript
async function getConversation(id) {
  return apiRequest('/api/conversations/' + encodeURIComponent(id));
}
```

## POST /api/conversations/import

Запустить импорт из источника, настроенного на сервере. URL/query: нет.
Body: {} либо отсутствует; других допустимых полей нет. Frontend не передаёт URL,
токен, массив диалогов, conversation_id или dataset. Это не endpoint загрузки файла.
Источник по умолчанию — синтетический mock; organizers использует только
ORGANIZER_API_URL/ORGANIZER_API_TOKEN из Backend окружения, без redirects.

Запрос:

```json
{}
```
Успех **HTTP 200**; полный синтетический ответ:

```json
{"data":{"received":1,"imported":1,"duplicates":0,"invalid":0,"rejected":[]}}
```

received — число исходных записей; imported — добавленные; duplicates — повторения
в пачке плюс уже сохранённые externalId; invalid — отклонённые записи.
rejected содержит {index,code:"INVALID_RECORD",paths:[...]} с индексом записи от 0.
Первая валидная запись с externalId побеждает; существующие записи не перезаписываются.
Повтор безопасен: imported=0 при том же наборе. Пустой набор и даже все невалидные
записи возвращают 200 с соответствующими счётчиками; проверяйте invalid/rejected.

Официальная оболочка источника {isSuccess:true,data:{total_records,records:[...]}}
адаптируется conversation_id → externalId, audio_url → audioUrl. Также поддерживается
внутренний {conversations:[...]}. В записи обязательны externalId (1–200 после trim),
language RU/KZ/EN, channel (1–50 после trim), transcript (1–10000 реплик).
audioUrl необязателен/null или HTTP(S) URL и не скачивается Backend.
speaker 1–200, text 1–100000, оба не пустые после проверки trim; время — строка
1–200 либо конечное неотрицательное число. Переданный turnIndex обязан совпадать
с позицией. При импорте неизвестные роли могут сохраниться, но AI-адаптер их отклонит.
Лимиты по умолчанию: 500 записей, 2 MiB ответа источника, timeout 10 s.

| HTTP | code | Причина |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Непустое тело или лишние query/поля |
| 502 | UPSTREAM_INVALID_DATA | Неверная/неполная оболочка, количество/лимит записей |
| 502 | UPSTREAM_ERROR | HTTP/сеть/redirect/невалидный JSON источника |
| 502 | UPSTREAM_TOO_LARGE | Ответ источника превышает лимит |
| 503 | IMPORT_NOT_CONFIGURED | organizers выбран без URL |
| 503 | DATABASE_UNAVAILABLE | Недоступность БД |
| 504 | UPSTREAM_TIMEOUT | Истёк timeout источника |

После импорта заново запросите первую страницу списка.

```javascript
async function importConversations() {
  return apiRequest('/api/conversations/import', {method: 'POST', body: {}});
}
```

## GET /api/checklists

Список **всех версий**, а не только последних. URL/body: нет.
Query: page/pageSize и необязательный key (1–100 символов,
regex ^[a-zA-Z0-9][a-zA-Z0-9_-]*$). Других фильтров нет.
Успех 200; 400 VALIDATION_ERROR; 503 DATABASE_UNAVAILABLE.
Строка списка не содержит criteria: за ними нужен GET по id.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": [
    {
      "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "name": "Учебный чек-лист API",
      "version": 1,
      "createdAt": "2026-11-07T20:32:59.844Z",
      "sections": [{"key":"main","name":"Основная секция"}],
      "instructions": [],
      "config": {"sections":[{"key":"main","name":"Основная секция"}],"instructions":[],"schemaVersion":1}
    }
  ],
  "pagination": {"page":1,"pageSize":20,"total":1,"totalPages":1}
}
```

Для выбора последней версии одного key загрузите все страницы отфильтрованного списка
и выберите максимальный version. Не выбирайте версию по имени и не предполагайте, что
на первой странице есть все версии.

```javascript
async function listChecklists({page = 1, pageSize = 20, key} = {}) {
  return apiRequest('/api/checklists', {query: {page, pageSize, key}});
}
```

## GET /api/checklists/:id

URL: id обязателен, UUID конкретной версии Checklist. Query/body: нет.
Успех 200; 400 VALIDATION_ERROR; 404 CHECKLIST_NOT_FOUND; 503 DATABASE_UNAVAILABLE.
Используйте для редактора, отображения типов/ступеней/весов и выбора версии оценивания.
criteria отсортированы по сохранённому position, затем key.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": {
    "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
    "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
    "name": "Учебный чек-лист API",
    "version": 1,
    "createdAt": "2026-11-07T20:32:59.844Z",
    "sections": [{"key":"main","name":"Основная секция"}],
    "instructions": [],
    "config": {"sections":[{"key":"main","name":"Основная секция"}],"instructions":[],"schemaVersion":1},
    "criteria": [
      {"type":"boolean","weight":60,"allowNa":false,"position":0,"scaleSteps":[],"sectionKey":"main","description":"Учебный boolean-критерий.","naCondition":null,"schemaVersion":1,"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","maxPoints":1},
      {"type":"scale","weight":40,"allowNa":true,"position":1,"scaleSteps":[{"label":"Нет","value":0},{"label":"Частично","value":5},{"label":"Полностью","value":10}],"sectionKey":"main","description":"Учебный scale-критерий.","naCondition":"Подтверждено отсутствие запроса на консультацию.","schemaVersion":1,"id":"7d9bdd8e-7e4b-43f2-9425-b7de0395c5e5","key":"quality","name":"Полнота","maxPoints":10},
      {"type":"flag","weight":0,"allowNa":false,"position":2,"scaleSteps":[],"sectionKey":"main","description":"Учебный flag-критерий.","naCondition":null,"schemaVersion":1,"id":"5477b7bd-919d-48fc-846c-4729aa9634df","key":"violation","name":"Нарушение","maxPoints":0}
    ]
  }
}
```

config дублирует sections/instructions для хранения. Ответ дополнительно содержит
schemaVersion, position, id, maxPoints: это поля чтения. maxPoints определения
критерия — максимум исходной шкалы (boolean 1, flag 0), а не взвешенный максимум scoring.

```javascript
async function getChecklist(id) {
  return apiRequest('/api/checklists/' + encodeURIComponent(id));
}
```

## POST /api/checklists

Создать новый key с version=1. URL/query: нет.

| Body | Обязательно | Ограничения |
| --- | --- | --- |
| key | Да | 1–100; regex ключа выше; уникален как семейство |
| name | Да | Непустой текст, до 200 |
| sections | Да | 1–30 объектов {key,name}; name до 200; ключи уникальны |
| criteria | Да | 1–100 критериев; ключи уникальны; полный набор |
| instructions | Нет | default []; до 40 непустых строк по 1–5000 символов |

Поля критерия:

| Поле | Обязательно/default | Правило |
| --- | --- | --- |
| key | Да | Regex ключа; 1–100 |
| name | Да | Непустой текст 1–200 |
| description | Да | Непустой текст 1–10000 |
| type | Да | boolean / scale / flag |
| weight | Да | Number 0–100, до 2 знаков; для boolean/scale строго >0, flag=0 |
| sectionKey | Да | Ключ существующей секции |
| scaleSteps | Нет, [] | Только scale; 2–50 объектов {value,label} |
| allowNa | Нет, false | Boolean; flag всегда false |
| naCondition | Нет, null | При allowNa=true непустой текст до 2000; иначе только null |
| applicabilityRule | Нет | null либо {kind:"recording_start_missing",channels:["voice","call"]} |

Ступени: value — number 0–1000000, до 4 знаков; label — непустой текст до 1000.
Нужны минимум две уникальные ступени, одна 0, строго возрастающий или убывающий порядок.
Для boolean/flag scaleSteps=[].
Сумма весов ровно 100, flag не добавляет баллы. Все text-поля проверяются на
непустоту; имена/описания не обрезаются и не переформулируются.

applicabilityRule допускается только у boolean с allowNa=true; kind фиксирован,
channels — 1–2 уникальных значения из voice/call. Это конфигурационные алиасы,
не список исходных строк channel. Само правило или текст naCondition **не создают**
подтверждение N/A; подробности ниже.

Синтетический пользовательский пример (не заменяет официальные 8 критериев):

```json
{
  "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
  "name": "Учебный чек-лист API",
  "sections": [
    {
      "key": "main",
      "name": "Основная секция"
    }
  ],
  "criteria": [
    {
      "key": "greeting",
      "name": "Приветствие",
      "description": "Учебный boolean-критерий.",
      "type": "boolean",
      "weight": 60,
      "sectionKey": "main"
    },
    {
      "key": "quality",
      "name": "Полнота",
      "description": "Учебный scale-критерий.",
      "type": "scale",
      "weight": 40,
      "sectionKey": "main",
      "scaleSteps": [
        {
          "value": 0,
          "label": "Нет"
        },
        {
          "value": 5,
          "label": "Частично"
        },
        {
          "value": 10,
          "label": "Полностью"
        }
      ],
      "allowNa": true,
      "naCondition": "Подтверждено отсутствие запроса на консультацию."
    },
    {
      "key": "violation",
      "name": "Нарушение",
      "description": "Учебный flag-критерий.",
      "type": "flag",
      "weight": 0,
      "sectionKey": "main"
    }
  ],
  "instructions": []
}
```
Успех **HTTP 201**; полный синтетический ответ:

```json
{
  "data": {
    "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
    "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
    "name": "Учебный чек-лист API",
    "version": 1,
    "createdAt": "2026-11-07T20:32:59.844Z",
    "sections": [{"key":"main","name":"Основная секция"}],
    "instructions": [],
    "config": {"sections":[{"key":"main","name":"Основная секция"}],"instructions":[],"schemaVersion":1},
    "criteria": [
      {"type":"boolean","weight":60,"allowNa":false,"position":0,"scaleSteps":[],"sectionKey":"main","description":"Учебный boolean-критерий.","naCondition":null,"schemaVersion":1,"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","maxPoints":1},
      {"type":"scale","weight":40,"allowNa":true,"position":1,"scaleSteps":[{"label":"Нет","value":0},{"label":"Частично","value":5},{"label":"Полностью","value":10}],"sectionKey":"main","description":"Учебный scale-критерий.","naCondition":"Подтверждено отсутствие запроса на консультацию.","schemaVersion":1,"id":"7d9bdd8e-7e4b-43f2-9425-b7de0395c5e5","key":"quality","name":"Полнота","maxPoints":10},
      {"type":"flag","weight":0,"allowNa":false,"position":2,"scaleSteps":[],"sectionKey":"main","description":"Учебный flag-критерий.","naCondition":null,"schemaVersion":1,"id":"5477b7bd-919d-48fc-846c-4729aa9634df","key":"violation","name":"Нарушение","maxPoints":0}
    ]
  }
}
```

Ответ 201, Location: /api/checklists/<новый UUID>. Ошибки:
400 VALIDATION_ERROR; 409 CHECKLIST_EXISTS (или общий конфликт БД);
503 DATABASE_UNAVAILABLE. Для изменения существующего key используйте PUT.

Готовый объект для примеров ниже; измените key для нового семейства:

```javascript
const checklistInput = {
  "key": "frontend-demo",
  "name": "Учебный чек-лист API",
  "sections": [
    {
      "key": "main",
      "name": "Основная секция"
    }
  ],
  "criteria": [
    {
      "key": "greeting",
      "name": "Приветствие",
      "description": "Учебный boolean-критерий.",
      "type": "boolean",
      "weight": 60,
      "sectionKey": "main"
    },
    {
      "key": "quality",
      "name": "Полнота",
      "description": "Учебный scale-критерий.",
      "type": "scale",
      "weight": 40,
      "sectionKey": "main",
      "scaleSteps": [
        {
          "value": 0,
          "label": "Нет"
        },
        {
          "value": 5,
          "label": "Частично"
        },
        {
          "value": 10,
          "label": "Полностью"
        }
      ],
      "allowNa": true,
      "naCondition": "Подтверждено отсутствие запроса на консультацию."
    },
    {
      "key": "violation",
      "name": "Нарушение",
      "description": "Учебный flag-критерий.",
      "type": "flag",
      "weight": 0,
      "sectionKey": "main"
    }
  ],
  "instructions": []
};
```
```javascript
async function createChecklist(body) {
  return apiRequest('/api/checklists', {method: 'POST', body});
}
```

## PUT /api/checklists/:id

URL: id обязателен — UUID **последней** версии семейства. Query: нет.
Тело — полная конфигурация POST **без key**: name, sections, criteria обязательны,
instructions необязателен/default []. Это создание нового ресурса, не PATCH;
instructions и состав критериев предыдущей версии автоматически не переносятся.
version/key назначает Backend; прежние критерии/оценки не изменяются.

Запрос:

```json
{
  "name": "Учебный чек-лист API",
  "sections": [
    {
      "key": "main",
      "name": "Основная секция"
    }
  ],
  "criteria": [
    {
      "key": "greeting",
      "name": "Приветствие",
      "description": "Учебный boolean-критерий.",
      "type": "boolean",
      "weight": 60,
      "sectionKey": "main"
    },
    {
      "key": "quality",
      "name": "Полнота",
      "description": "Учебный scale-критерий.",
      "type": "scale",
      "weight": 40,
      "sectionKey": "main",
      "scaleSteps": [
        {
          "value": 0,
          "label": "Нет"
        },
        {
          "value": 5,
          "label": "Частично"
        },
        {
          "value": 10,
          "label": "Полностью"
        }
      ],
      "allowNa": true,
      "naCondition": "Подтверждено отсутствие запроса на консультацию."
    },
    {
      "key": "violation",
      "name": "Нарушение",
      "description": "Учебный flag-критерий.",
      "type": "flag",
      "weight": 0,
      "sectionKey": "main"
    }
  ],
  "instructions": []
}
```
Успех **HTTP 201**; полный синтетический ответ:

```json
{
  "data": {
    "id": "2a7a698f-3df6-4c0a-b9d4-f169c934e95d",
    "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
    "name": "Учебный чек-лист API",
    "version": 2,
    "createdAt": "2026-11-07T20:33:00.155Z",
    "sections": [{"key":"main","name":"Основная секция"}],
    "instructions": [],
    "config": {"sections":[{"key":"main","name":"Основная секция"}],"instructions":[],"schemaVersion":1},
    "criteria": [
      {"type":"boolean","weight":60,"allowNa":false,"position":0,"scaleSteps":[],"sectionKey":"main","description":"Учебный boolean-критерий.","naCondition":null,"schemaVersion":1,"id":"752a5b99-4aee-43b0-ae12-04abcb135630","key":"greeting","name":"Приветствие","maxPoints":1},
      {"type":"scale","weight":40,"allowNa":true,"position":1,"scaleSteps":[{"label":"Нет","value":0},{"label":"Частично","value":5},{"label":"Полностью","value":10}],"sectionKey":"main","description":"Учебный scale-критерий.","naCondition":"Подтверждено отсутствие запроса на консультацию.","schemaVersion":1,"id":"9df343ef-1d97-41ba-9a7f-e34025bfcf49","key":"quality","name":"Полнота","maxPoints":10},
      {"type":"flag","weight":0,"allowNa":false,"position":2,"scaleSteps":[],"sectionKey":"main","description":"Учебный flag-критерий.","naCondition":null,"schemaVersion":1,"id":"4da8cec1-6759-4a60-9fb0-8c84ccb31e01","key":"violation","name":"Нарушение","maxPoints":0}
    ]
  }
}
```

Ответ 201, Location указывает на новый UUID. Ошибки: 400 VALIDATION_ERROR;
404 CHECKLIST_NOT_FOUND; 409 STALE_CHECKLIST_VERSION при устаревшем UUID;
общие конфликты БД; 503 DATABASE_UNAVAILABLE.
При 409 загрузите актуальную версию и предложите пользователю перенести правки;
не повторяйте автоматически PUT на другую версию без проверки.

```javascript
async function createChecklistVersion(id, body) {
  return apiRequest('/api/checklists/' + encodeURIComponent(id), {method: 'PUT', body});
}
```

Из GET нельзя отправлять весь объект обратно: строгая схема отвергнет id, version,
config, createdAt, maxPoints, position, schemaVersion. Используйте явную проекцию:

```javascript
function checklistForWrite(checklist) {
  return {
    name: checklist.name,
    sections: checklist.sections.map(({key, name}) => ({key, name})),
    instructions: [...checklist.instructions],
    criteria: checklist.criteria.map(criterion => ({
      key: criterion.key, name: criterion.name, description: criterion.description,
      type: criterion.type, weight: criterion.weight, sectionKey: criterion.sectionKey,
      scaleSteps: criterion.scaleSteps.map(({value, label}) => ({value, label})),
      allowNa: criterion.allowNa, naCondition: criterion.naCondition,
      ...(criterion.applicabilityRule === undefined ? {} : {applicabilityRule: criterion.applicabilityRule}),
    })),
  };
}
```

## POST /api/evaluations

Синхронный вызов Backend → AI → валидация → scoring → PostgreSQL.
Frontend передаёт только UUID диалога и конкретной версии, не ответы или score.
URL/query: нет. Оба поля обязательны:

```json
{
  "conversationId": "a406b719-8549-4097-9d38-b1766ab3cfc1",
  "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef"
}
```
Успех **HTTP 201**; полный синтетический ответ:

```json
{
  "data": {
    "id": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
    "conversationId": "a406b719-8549-4097-9d38-b1766ab3cfc1",
    "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
    "status": "COMPLETED",
    "provider": "mock",
    "transport": "local",
    "isMock": true,
    "createdAt": "2026-11-07T20:32:59.972Z",
    "completedAt": "2026-11-07T20:33:00.014Z",
    "score": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "aiResponse": {
      "results": [{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"greeting","checked_range":{"end":1,"start":0}},{"na":false,"answer":0,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"quality","checked_range":{"end":1,"start":0}},{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"violation","checked_range":{"end":1,"start":0}}],
      "checklist_id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "conversation_id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "checklist_version": 1
    },
    "results": [
      {"id":"49403464-50e1-41e4-b0c0-e1554afa4227","criterionId":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","criterionKey":"greeting","answer":false,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}},
      {"id":"dbdaeab4-4af0-42af-8a0f-4a44be825beb","criterionId":"7d9bdd8e-7e4b-43f2-9425-b7de0395c5e5","criterionKey":"quality","answer":0,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}},
      {"id":"092db1d8-9b2f-4e37-8f86-1e6603e7db58","criterionId":"5477b7bd-919d-48fc-846c-4729aa9634df","criterionKey":"violation","answer":false,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}}
    ]
  },
  "reused": false
}
```

201 означает новую COMPLETED-оценку, reused=false. Если для пары
conversationId+checklistId уже есть завершённая оценка, ответ 200, reused=true,
с тем же data и без нового AI-вызова. Location всегда /api/evaluations/<UUID>.
Одновременные запросы одной пары объединяются в процессе; БД предотвращает дубли.
Это не очередь: нет 202/taskId или endpoint polling задачи.

Во время ожидания отключите повторное нажатие «Оценить». После успеха сохраните id
оценки в состоянии/URL страницы для повторного GET; отдельного серверного списка
оценок сейчас нет. Для нового расчёта нужна другая версия чек-листа, а не force=true.
Повтор после сетевой ошибки допустим для той же пары: он вернёт сохранённый результат
или выполнит попытку, если результата не было.

| HTTP | code | Причина |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Нет обязательных UUID, неверные типы или лишние поля |
| 404 | CONVERSATION_NOT_FOUND, CHECKLIST_NOT_FOUND | Входные записи не найдены |
| 409 | EVALUATION_EXISTS | Для пары есть незавершённая запись |
| 409 | EVALUATION_INPUT_CHANGED | Во время AI изменились входные данные; загрузите их заново |
| 422 | CHECKLIST_NOT_SCORABLE | Сохранённая версия не имеет корректной scoring-конфигурации |
| 422 | INVALID_TRANSCRIPT | Некорректный/пустой упорядоченный транскрипт |
| 422 | AI_TIMESTAMP_REQUIRED, AI_TIMESTAMP_INVALID | Время отсутствует/не представимо безопасно |
| 422 | AI_SPEAKER_UNSUPPORTED | Роль не входит в operator/client/system/bot |
| 502 | AI_HTTP_ERROR | Неуспешный HTTP AI, кроме 503/504 |
| 502 | AI_RESPONSE_TOO_LARGE, AI_INVALID_JSON, AI_INVALID_RESPONSE | Ответ слишком большой/не соответствует JSON-контракту |
| 502 | AI_IDENTITY_MISMATCH, AI_CRITERIA_MISMATCH | Не та версия/диалог; отсутствует/дублируется/неизвестен критерий |
| 502 | AI_INVALID_RANGE, AI_INVALID_EVIDENCE | Некорректный диапазон/цитата/индекс |
| 502 | AI_MISSING_SUPPORT, AI_MISSING_RANGE | Нет доказательства/обязательного диапазона проверки |
| 502 | AI_INVALID_NA, AI_NA_UNCONFIRMED | Неверное N/A или нет независимого подтверждения |
| 502 | AI_INVALID_ANSWER | Неверный тип или недопустимая ступень |
| 503 | AI_UNAVAILABLE, DATABASE_UNAVAILABLE | Сеть/AI 503 либо недоступность БД |
| 504 | AI_TIMEOUT | Timeout или AI HTTP 504 |

Общие конфликты/ограничения БД также применимы. Для ошибки AI не создаётся фиктивная
успешная оценка. Объяснение AI не является подтверждением применимости.
При адаптации к AI регистр/пробелы известных ролей нормализуются, числовое время
передаётся строкой без пересчёта, timestamp имеет приоритет перед startMs.
Данные GET остаются исходными. HTTP AI по умолчанию ждёт до 100000 ms в Compose.

```javascript
async function evaluateConversation(conversationId, checklistId) {
  return apiRequest('/api/evaluations', {method: 'POST', body: {conversationId, checklistId}});
}
```

## GET /api/evaluations/:id

URL: id обязателен, UUID Evaluation. Query/body: нет.
200 возвращает **исходный** snapshot, включая aiResponse. 400 VALIDATION_ERROR;
404 EVALUATION_NOT_FOUND; 503 DATABASE_UNAVAILABLE.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": {
    "id": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
    "conversationId": "a406b719-8549-4097-9d38-b1766ab3cfc1",
    "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
    "status": "COMPLETED",
    "provider": "mock",
    "transport": "local",
    "isMock": true,
    "createdAt": "2026-11-07T20:32:59.972Z",
    "completedAt": "2026-11-07T20:33:00.014Z",
    "score": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "aiResponse": {
      "results": [{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"greeting","checked_range":{"end":1,"start":0}},{"na":false,"answer":0,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"quality","checked_range":{"end":1,"start":0}},{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"violation","checked_range":{"end":1,"start":0}}],
      "checklist_id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "conversation_id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "checklist_version": 1
    },
    "results": [
      {"id":"49403464-50e1-41e4-b0c0-e1554afa4227","criterionId":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","criterionKey":"greeting","answer":false,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}},
      {"id":"dbdaeab4-4af0-42af-8a0f-4a44be825beb","criterionId":"7d9bdd8e-7e4b-43f2-9425-b7de0395c5e5","criterionKey":"quality","answer":0,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}},
      {"id":"092db1d8-9b2f-4e37-8f86-1e6603e7db58","criterionId":"5477b7bd-919d-48fc-846c-4729aa9634df","criterionKey":"violation","answer":false,"isNa":false,"naReason":null,"rawPoints":0,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","evidence":[],"checkedRange":{"end":1,"start":0}}
    ]
  }
}
```

Контракт data:

| Поле | Использование Frontend |
| --- | --- |
| id, conversationId, checklistId | Связать оценку с диалогом и точной версией |
| status | DRAFT / COMPLETED; GET legacy-записи может вернуть DRAFT |
| provider, transport, isMock | mock/ai, local/http, явная отметка synthetic |
| createdAt, completedAt | Даты; completedAt может быть null |
| score | Исходный Backend scoring snapshot; у legacy/DRAFT возможен null |
| aiResponse | Исходный JSON AI со snake_case, может быть null у старых записей |
| results | Массив типизированных исходных результатов, даже после апелляций |

results[].id — UUID CriterionResult; criterionId — UUID ChecklistCriterion;
criterionKey — стабильный key внутри выбранной версии. answer — boolean/number/null;
isNa — boolean; naReason — string/null; explanation — объяснение AI;
evidence — [{turnIndex,quote}]; checkedRange — {start,end} либо null.
rawPoints — **сырое значение**, а не вес: boolean 0/1, scale значение ступени,
flag 0, N/A null. Для баллов на экране используйте score.criteria[].points/maxPoints,
соединяя по criterionKey ↔ score.criteria[].key.

score содержит scoringVersion, checklistId/Key/Version, applicableWeight,
maxPoints (100 либо 0), total (number/null), grossError, criteria и sections.
У каждого score.criteria есть key, sectionKey, type, value, isNa, naReason, weight,
basePoints, points и maxPoints. У секций key,name,points,maxPoints.
Исходный weight не равен maxPoints после N/A-перераспределения.
total округлён до двух знаков; промежуточные points/maxPoints могут иметь больше знаков.
Для отображения допустимо форматирование числа, вычислять итог заново на Frontend нельзя.
grossError показывайте отдельно: он не обнуляет числовой total.

```javascript
async function getEvaluation(id) {
  return apiRequest('/api/evaluations/' + encodeURIComponent(id));
}
```

## Evidence, checked_range и N/A

В публичных типизированных results поле **checkedRange**, а в aiResponse.results —
**checked_range**. Оба задают включительные start/end от 0 по всему исходному
transcript. evidence.turnIndex также от 0, без фильтрации client/bot/system.
Для UI-номера реплики используйте turnIndex+1, но для поиска — исходный индекс.
Цитата является точной подстрокой text. Отрисовывайте текст безопасным textContent/
обычным JSX, не вставляйте transcript/explanation в innerHTML.

checkedRange означает проверенную область, а не обязательно прямую цитату.
Пустой evidence допустим при наличии диапазона; отрицательный boolean требует
диапазона даже при цитате. Не показывайте отсутствие цитаты как отсутствие проверки.
В официальном экспорте используются отдельные поля evidence_turns с нумерацией от 1;
не переносите этот контракт на REST API.

```javascript
function evidenceText(conversation, result) {
  return {
    quotes: result.evidence.map(({turnIndex, quote}) => ({
      turnIndex, displayNumber: turnIndex + 1, quote,
      text: conversation.transcript[turnIndex].text,
    })),
    checkedTurns: result.checkedRange === null ? [] :
      conversation.transcript.slice(result.checkedRange.start, result.checkedRange.end + 1)
        .map((turn, offset) => ({...turn, displayNumber: result.checkedRange.start + offset + 1})),
  };
}
```

N/A — не false и не 0: answer=null, isNa=true, naReason непустой.
В score.criteria аналогично value=null. Backend исключает N/A и пропорционально
перераспределяет веса; при отсутствии оцениваемых применимых критериев total=null.
UI отображает N/A и причину, а total=null как «Нет применимых критериев», не 0.

allowNa=true недостаточно. Требуется независимое подтверждение для конкретной
пары диалог+версия+ключ критерия. Эти факты вносит доверенный оператор вне публичного
API; Frontend не может передать naConditionMet или reference в POST evaluations.
Для изменения на N/A через апелляцию действуют те же проверки.

В исходной официальной v1 приветствие не допускает N/A. В версии с правилом
recording_start_missing исключение действует только для звонка с подтверждённым
отсутствующим началом записи. voice call/voice/call имеют одинаковую семантику проверки;
исходная строка channel не меняется. Обычный звонок без факта и agent chat/прочие
текстовые каналы исключения не получают.

## POST /api/appeals

Подать апелляцию на критерий COMPLETED-оценки. URL/query: нет.
Обязательные поля: evaluationId UUID, criterionId UUID, comment — строка после trim
1–4000 символов. criterionId берётся из evaluation.results[].criterionId;
это **не** criterionKey и **не** results[].id.

```json
{
  "evaluationId": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
  "criterionId": "6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19",
  "comment": "Прошу проверить приветствие в первой реплике."
}
```
Успех **HTTP 201**; полный синтетический ответ:

```json
{
  "data": {
    "id": "99fb8515-85bb-41ba-acc9-59736578b29b",
    "evaluationId": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
    "criterionId": "6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19",
    "criterionResultId": "49403464-50e1-41e4-b0c0-e1554afa4227",
    "comment": "Прошу проверить приветствие в первой реплике.",
    "status": "PENDING",
    "decision": null,
    "reviewer": null,
    "reason": null,
    "createdAt": "2026-11-07T20:33:00.055Z",
    "decidedAt": null,
    "criterion": {"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","type":"boolean"},
    "reviewable": true,
    "reviewError": null,
    "originalScore": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "finalScore": {
      "scoringVersion": "1.0.0",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "checklistVersion": 1,
      "applicableWeight": 100,
      "maxPoints": 100,
      "total": 0,
      "grossError": false,
      "criteria": [{"key":"greeting","sectionKey":"main","type":"boolean","value":false,"isNa":false,"naReason":null,"weight":60,"basePoints":0,"points":0,"maxPoints":60},{"key":"quality","sectionKey":"main","type":"scale","value":0,"isNa":false,"naReason":null,"weight":40,"basePoints":0,"points":0,"maxPoints":40},{"key":"violation","sectionKey":"main","type":"flag","value":false,"isNa":false,"naReason":null,"weight":0,"basePoints":0,"points":0,"maxPoints":0}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}]
    },
    "beforeScore": null,
    "afterScore": null,
    "originalResult": {
      "answer": false,
      "isNa": false,
      "naReason": null,
      "rawPoints": 0,
      "explanation": "MOCK: synthetic placeholder, not a real quality assessment.",
      "evidence": [],
      "checkedRange": {"end":1,"start":0}
    },
    "currentResult": {"criterionKey":"greeting","value":false},
    "revisedAnswer": null,
    "revisedIsNa": null,
    "revisedNaReason": null,
    "evaluation": {
      "id": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "status": "COMPLETED",
      "provider": "mock",
      "transport": "local",
      "aiResponse": {"results":[{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"greeting","checked_range":{"end":1,"start":0}},{"na":false,"answer":0,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"quality","checked_range":{"end":1,"start":0}},{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"violation","checked_range":{"end":1,"start":0}}],"checklist_id":"dd6732c5-59fb-48e9-a855-1ae956fc99ef","conversation_id":"a406b719-8549-4097-9d38-b1766ab3cfc1","checklist_version":1}
    },
    "checklist": {
      "name": "Учебный чек-лист API",
      "sections": [{"key":"main","name":"Основная секция"}],
      "criteria": [{"key":"greeting","name":"Приветствие","description":"Учебный boolean-критерий.","type":"boolean","weight":60,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"},{"key":"quality","name":"Полнота","description":"Учебный scale-критерий.","type":"scale","weight":40,"scaleSteps":[{"value":0,"label":"Нет"},{"value":5,"label":"Частично"},{"value":10,"label":"Полностью"}],"allowNa":true,"naCondition":"Подтверждено отсутствие запроса на консультацию.","sectionKey":"main"},{"key":"violation","name":"Нарушение","description":"Учебный flag-критерий.","type":"flag","weight":0,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"}],
      "instructions": [],
      "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "version": 1
    },
    "conversation": {
      "id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "externalId": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "language": "RU",
      "channel": "agent chat",
      "audioUrl": null,
      "transcript": [{"text":"Здравствуйте! Чем могу помочь?","speaker":"operator","timestamp":"00:00:01.000","turnIndex":0},{"text":"Хочу узнать условия.","speaker":"client","timestamp":"00:00:02.000","turnIndex":1}],
      "createdAt": "2026-11-07T20:32:59.719Z"
    }
  }
}
```

201, Location: /api/appeals/<UUID>. Возвращается полная карточка со статусом PENDING;
исходные данные не изменяются. Одна PENDING на результат; после закрытия допустима новая.
Ошибки: 400 VALIDATION_ERROR; 404 EVALUATION_NOT_FOUND или CRITERION_RESULT_NOT_FOUND
(в том числе чужой criterionId); 409 EVALUATION_NOT_COMPLETED,
EVALUATION_NOT_REVIEWABLE, APPEAL_ALREADY_PENDING; общие конфликты БД;
503 DATABASE_UNAVAILABLE.

```javascript
async function createAppeal(evaluationId, criterionId, comment) {
  return apiRequest('/api/appeals', {method: 'POST', body: {evaluationId, criterionId, comment}});
}
```

## GET /api/appeals

Список для очереди проверяющего. URL/body: нет. Query: page/pageSize и необязательный
status строго PENDING / ACCEPTED / REJECTED. Фильтра evaluationId здесь нет;
для небольшой демо-таблицы можно загрузить все страницы и отобрать на клиенте,
не передавая evaluationId в query (он даст 400).
Успех 200; 400 VALIDATION_ERROR; 503 DATABASE_UNAVAILABLE.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": [
    {
      "id": "99fb8515-85bb-41ba-acc9-59736578b29b",
      "evaluationId": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
      "criterionId": "6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19",
      "criterionResultId": "49403464-50e1-41e4-b0c0-e1554afa4227",
      "comment": "Прошу проверить приветствие в первой реплике.",
      "status": "PENDING",
      "decision": null,
      "reviewer": null,
      "reason": null,
      "createdAt": "2026-11-07T20:33:00.055Z",
      "decidedAt": null,
      "criterion": {"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","type":"boolean"}
    }
  ],
  "pagination": {"page":1,"pageSize":1,"total":5,"totalPages":5}
}
```

Список содержит только summary: id, evaluationId, criterionId, criterionResultId,
comment, status, decision, reviewer, reason, createdAt, decidedAt, criterion
({id,key,name,type}). Доказательства/баллы/контекст загрузите через GET карточки.

```javascript
async function listAppeals({page = 1, pageSize = 20, status} = {}) {
  return apiRequest('/api/appeals', {query: {page, pageSize, status}});
}
```

## GET /api/appeals/:id

URL: id обязателен, UUID Appeal. Query/body: нет.
Успех 200; 400 VALIDATION_ERROR; 404 APPEAL_NOT_FOUND
(также EVALUATION_NOT_FOUND при недоступной связанной оценке); 503 DATABASE_UNAVAILABLE.
Пример PENDING-карточки совпадает по форме с полным ответом POST appeals выше;
это фактически тот же serializer. Ниже полный ответ GET той же карточки:

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": {
    "id": "99fb8515-85bb-41ba-acc9-59736578b29b",
    "evaluationId": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
    "criterionId": "6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19",
    "criterionResultId": "49403464-50e1-41e4-b0c0-e1554afa4227",
    "comment": "Прошу проверить приветствие в первой реплике.",
    "status": "PENDING",
    "decision": null,
    "reviewer": null,
    "reason": null,
    "createdAt": "2026-11-07T20:33:00.055Z",
    "decidedAt": null,
    "criterion": {"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","type":"boolean"},
    "reviewable": true,
    "reviewError": null,
    "originalScore": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "finalScore": {
      "scoringVersion": "1.0.0",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "checklistVersion": 1,
      "applicableWeight": 100,
      "maxPoints": 100,
      "total": 0,
      "grossError": false,
      "criteria": [{"key":"greeting","sectionKey":"main","type":"boolean","value":false,"isNa":false,"naReason":null,"weight":60,"basePoints":0,"points":0,"maxPoints":60},{"key":"quality","sectionKey":"main","type":"scale","value":0,"isNa":false,"naReason":null,"weight":40,"basePoints":0,"points":0,"maxPoints":40},{"key":"violation","sectionKey":"main","type":"flag","value":false,"isNa":false,"naReason":null,"weight":0,"basePoints":0,"points":0,"maxPoints":0}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}]
    },
    "beforeScore": null,
    "afterScore": null,
    "originalResult": {
      "answer": false,
      "isNa": false,
      "naReason": null,
      "rawPoints": 0,
      "explanation": "MOCK: synthetic placeholder, not a real quality assessment.",
      "evidence": [],
      "checkedRange": {"end":1,"start":0}
    },
    "currentResult": {"criterionKey":"greeting","value":false},
    "revisedAnswer": null,
    "revisedIsNa": null,
    "revisedNaReason": null,
    "evaluation": {
      "id": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "status": "COMPLETED",
      "provider": "mock",
      "transport": "local",
      "aiResponse": {"results":[{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"greeting","checked_range":{"end":1,"start":0}},{"na":false,"answer":0,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"quality","checked_range":{"end":1,"start":0}},{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"violation","checked_range":{"end":1,"start":0}}],"checklist_id":"dd6732c5-59fb-48e9-a855-1ae956fc99ef","conversation_id":"a406b719-8549-4097-9d38-b1766ab3cfc1","checklist_version":1}
    },
    "checklist": {
      "name": "Учебный чек-лист API",
      "sections": [{"key":"main","name":"Основная секция"}],
      "criteria": [{"key":"greeting","name":"Приветствие","description":"Учебный boolean-критерий.","type":"boolean","weight":60,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"},{"key":"quality","name":"Полнота","description":"Учебный scale-критерий.","type":"scale","weight":40,"scaleSteps":[{"value":0,"label":"Нет"},{"value":5,"label":"Частично"},{"value":10,"label":"Полностью"}],"allowNa":true,"naCondition":"Подтверждено отсутствие запроса на консультацию.","sectionKey":"main"},{"key":"violation","name":"Нарушение","description":"Учебный flag-критерий.","type":"flag","weight":0,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"}],
      "instructions": [],
      "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "version": 1
    },
    "conversation": {
      "id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "externalId": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "language": "RU",
      "channel": "agent chat",
      "audioUrl": null,
      "transcript": [{"text":"Здравствуйте! Чем могу помочь?","speaker":"operator","timestamp":"00:00:01.000","turnIndex":0},{"text":"Хочу узнать условия.","speaker":"client","timestamp":"00:00:02.000","turnIndex":1}],
      "createdAt": "2026-11-07T20:32:59.719Z"
    }
  }
}
```

Поля карточки сверх summary:

| Поле | Смысл |
| --- | --- |
| reviewable, reviewError | Можно ли пересчитать сохранённый snapshot |
| originalScore | Неизменяемый исходный Evaluation.score |
| finalScore | Текущий итог с учётом всех ACCEPTED-изменений этой оценки |
| beforeScore, afterScore | Снимки до/после решения **этой** апелляции; до решения null |
| originalResult | Исходные answer/isNa/naReason/rawPoints/explanation/evidence/checkedRange |
| currentResult | Текущий ответ для scoring: {criterionKey,value} либо {criterionKey,isNa:true,naConditionMet:true,naReason}; отсутствие isNa означает применимый ответ |
| revisedAnswer, revisedIsNa, revisedNaReason | Решение этой апелляции; изначально null |
| evaluation | id, checklistId, status, provider, transport, неизменённый aiResponse |
| checklist | Сохранённая версия scoring-конфигурации, а не последняя версия |
| conversation | Полный исходный диалог с транскриптом |

finalScore может меняться при решениях других апелляций; afterScore этой карточки
остаётся историческим. Для итогового экрана заново читайте карточку, не используйте
GET evaluations как источник пересмотренного итога. Исходные explanation/evidence
остаются в originalResult и aiResponse; причину проверяющего показывайте отдельно.

Legacy без совместимого snapshot читается 200 с reviewable=false,
reviewError=EVALUATION_NOT_REVIEWABLE, finalScore=null, currentResult=null.
Отключите кнопку решения; новая апелляция/решение возвращают 409.
Нельзя подменять originalScore значением finalScore.

```javascript
async function getAppeal(id) {
  return apiRequest('/api/appeals/' + encodeURIComponent(id));
}
```

## PATCH /api/appeals/:id/decision

URL: id обязателен, UUID Appeal в PENDING. Query: нет.
Тело — один из трёх вариантов. Обязательны decision и reason (trim, 1–4000).
reviewer необязателен: trim, 1–200, default demo-reviewer.

Подтвердить текущий результат, без value/isNa/naReason:

```json
{
  "decision": "CONFIRM",
  "reason": "Исходный ответ подтверждён проверкой.",
  "reviewer": "demo-reviewer"
}
```
Изменить boolean/flag или scale (только допустимая ступень сохранённой версии):

```json
{
  "decision": "CHANGE",
  "value": true,
  "reason": "Приветствие подтверждено репликой 0.",
  "reviewer": "demo-reviewer"
}
```
Изменить на N/A (без value и только при выполненных правилах выше):

```json
{
  "decision": "CHANGE",
  "isNa": true,
  "naReason": "Подтверждено отсутствие запроса на консультацию.",
  "reason": "Проверены исходные реплики.",
  "reviewer": "demo-reviewer"
}
```

Для обычного CHANGE value обязателен, тип boolean или конечный неотрицательный number;
isNa необязателен/default false, naReason запрещён. value:null не допускается даже
для N/A: при isNa=true value полностью отсутствует, naReason обязателен (trim 1–5000).
Flag принимает boolean, не число, и не допускает N/A.

Успех **HTTP 200**; полный синтетический ответ:

```json
{
  "data": {
    "id": "99fb8515-85bb-41ba-acc9-59736578b29b",
    "evaluationId": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
    "criterionId": "6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19",
    "criterionResultId": "49403464-50e1-41e4-b0c0-e1554afa4227",
    "comment": "Прошу проверить приветствие в первой реплике.",
    "status": "ACCEPTED",
    "decision": "CHANGE",
    "reviewer": "demo-reviewer",
    "reason": "Приветствие подтверждено репликой 0.",
    "createdAt": "2026-11-07T20:33:00.055Z",
    "decidedAt": "2026-11-08T01:33:00.133Z",
    "criterion": {"id":"6e3e088b-f30b-4ad5-b69d-4f2ce45a7f19","key":"greeting","name":"Приветствие","type":"boolean"},
    "reviewable": true,
    "reviewError": null,
    "originalScore": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "finalScore": {
      "scoringVersion": "1.0.0",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "checklistVersion": 1,
      "applicableWeight": 100,
      "maxPoints": 100,
      "total": 60,
      "grossError": false,
      "criteria": [{"key":"greeting","sectionKey":"main","type":"boolean","value":true,"isNa":false,"naReason":null,"weight":60,"basePoints":60,"points":60,"maxPoints":60},{"key":"quality","sectionKey":"main","type":"scale","value":0,"isNa":false,"naReason":null,"weight":40,"basePoints":0,"points":0,"maxPoints":40},{"key":"violation","sectionKey":"main","type":"flag","value":false,"isNa":false,"naReason":null,"weight":0,"basePoints":0,"points":0,"maxPoints":0}],
      "sections": [{"key":"main","name":"Основная секция","points":60,"maxPoints":100}]
    },
    "beforeScore": {
      "total": 0,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":false,"points":0,"weight":60,"naReason":null,"maxPoints":60,"basePoints":0,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":0,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "afterScore": {
      "total": 60,
      "criteria": [{"key":"greeting","isNa":false,"type":"boolean","value":true,"points":60,"weight":60,"naReason":null,"maxPoints":60,"basePoints":60,"sectionKey":"main"},{"key":"quality","isNa":false,"type":"scale","value":0,"points":0,"weight":40,"naReason":null,"maxPoints":40,"basePoints":0,"sectionKey":"main"},{"key":"violation","isNa":false,"type":"flag","value":false,"points":0,"weight":0,"naReason":null,"maxPoints":0,"basePoints":0,"sectionKey":"main"}],
      "sections": [{"key":"main","name":"Основная секция","points":60,"maxPoints":100}],
      "maxPoints": 100,
      "grossError": false,
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "checklistKey": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "scoringVersion": "1.0.0",
      "applicableWeight": 100,
      "checklistVersion": 1
    },
    "originalResult": {
      "answer": false,
      "isNa": false,
      "naReason": null,
      "rawPoints": 0,
      "explanation": "MOCK: synthetic placeholder, not a real quality assessment.",
      "evidence": [],
      "checkedRange": {"end":1,"start":0}
    },
    "currentResult": {"criterionKey":"greeting","value":true},
    "revisedAnswer": true,
    "revisedIsNa": false,
    "revisedNaReason": null,
    "evaluation": {
      "id": "971aaefc-08b0-402d-9aa2-66b3878b81e6",
      "checklistId": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "status": "COMPLETED",
      "provider": "mock",
      "transport": "local",
      "aiResponse": {"results":[{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"greeting","checked_range":{"end":1,"start":0}},{"na":false,"answer":0,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"quality","checked_range":{"end":1,"start":0}},{"na":false,"answer":false,"evidence":[],"na_reason":null,"explanation":"MOCK: synthetic placeholder, not a real quality assessment.","criterion_id":"violation","checked_range":{"end":1,"start":0}}],"checklist_id":"dd6732c5-59fb-48e9-a855-1ae956fc99ef","conversation_id":"a406b719-8549-4097-9d38-b1766ab3cfc1","checklist_version":1}
    },
    "checklist": {
      "name": "Учебный чек-лист API",
      "sections": [{"key":"main","name":"Основная секция"}],
      "criteria": [{"key":"greeting","name":"Приветствие","description":"Учебный boolean-критерий.","type":"boolean","weight":60,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"},{"key":"quality","name":"Полнота","description":"Учебный scale-критерий.","type":"scale","weight":40,"scaleSteps":[{"value":0,"label":"Нет"},{"value":5,"label":"Частично"},{"value":10,"label":"Полностью"}],"allowNa":true,"naCondition":"Подтверждено отсутствие запроса на консультацию.","sectionKey":"main"},{"key":"violation","name":"Нарушение","description":"Учебный flag-критерий.","type":"flag","weight":0,"scaleSteps":[],"allowNa":false,"naCondition":null,"sectionKey":"main"}],
      "instructions": [],
      "key": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "id": "dd6732c5-59fb-48e9-a855-1ae956fc99ef",
      "version": 1
    },
    "conversation": {
      "id": "a406b719-8549-4097-9d38-b1766ab3cfc1",
      "externalId": "docs-a75b6425-ec1d-4917-a5a1-6f6a5ec2c921",
      "language": "RU",
      "channel": "agent chat",
      "audioUrl": null,
      "transcript": [{"text":"Здравствуйте! Чем могу помочь?","speaker":"operator","timestamp":"00:00:01.000","turnIndex":0},{"text":"Хочу узнать условия.","speaker":"client","timestamp":"00:00:02.000","turnIndex":1}],
      "createdAt": "2026-11-07T20:32:59.719Z"
    }
  }
}
```

200 возвращает полную карточку:
CONFIRM → REJECTED (апелляция отклонена, ответ подтверждён);
CHANGE → ACCEPTED (апелляция принята). Сопоставляйте status с decision, чтобы
корректно подписывать кнопки/бейджи. Для CONFIRM beforeScore=afterScore.
Исходный originalScore остаётся прежним; finalScore учитывает изменения всех критериев.
Изменение flag меняет grossError, не числовой total.

| HTTP | code | Когда |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Ошибка формы, отсутствует reason/value/naReason, лишние поля |
| 400 | INVALID_REVIEW_VALUE | Тип/ступень не подходят сохранённому критерию |
| 404 | APPEAL_NOT_FOUND, EVALUATION_NOT_FOUND | Запись/контекст не найдены |
| 409 | APPEAL_ALREADY_DECIDED | Решение уже принято, включая конкурирующий запрос |
| 409 | EVALUATION_NOT_COMPLETED, EVALUATION_NOT_REVIEWABLE | Невозможен пересмотр snapshot |
| 422 | NA_NOT_ALLOWED | Критерий не допускает N/A |
| 422 | NA_CONDITION_UNCONFIRMED | Нет независимого подтверждения в нужной версии |
| 503 | DATABASE_UNAVAILABLE | БД недоступна |

Общие ошибки БД применимы. Все изменения решения атомарны, решения одной оценки
сериализуются, закрытую апелляцию изменить нельзя. После 409 обновите карточку;
не пытайтесь повторно закрыть её автоматически.

```javascript
async function decideAppeal(id, decision) {
  return apiRequest('/api/appeals/' + encodeURIComponent(id) + '/decision', {
    method: 'PATCH', body: decision,
  });
}
```

## Полный сценарий Frontend → Backend

Этот пример использует собственный учебный чек-лист из checklistInput, не редактирует
официальные критерии. Требуются функции выше и уникальный checklistKey для каждого
демо. conversationId можно передать из строки таблицы; иначе пример импортирует
настроенный источник и выбирает первый RU-диалог. При пустом источнике сообщает об этом.
У mock AI исходный итог учебного примера 0; пересмотр приветствия → 60.
В реальном UI решение принимает проверяющий, а не автоматический сценарий.

```javascript
async function frontendScenario({
  checklistKey = 'frontend-' + crypto.randomUUID(),
  conversationId,
} = {}) {
  await getHealth();
  if (!conversationId) {
    await importConversations();
    const page = await listConversations({language: 'RU', pageSize: 1});
    if (!page.data.length) throw new Error('Нет диалогов для демонстрации');
    conversationId = page.data[0].id;
  }
  const conversation = (await getConversation(conversationId)).data;
  const checklist = (await createChecklist({...checklistInput, key: checklistKey})).data;
  const evaluated = await evaluateConversation(conversation.id, checklist.id);
  const original = (await getEvaluation(evaluated.data.id)).data;
  const criterion = original.results.find(result => result.criterionKey === 'greeting');
  const opened = (await createAppeal(original.id, criterion.criterionId,
    'Прошу проверить приветствие в начале диалога.')).data;
  await decideAppeal(opened.id, {decision: 'CHANGE', value: true,
    reason: 'Проверяющий подтвердил приветствие по исходной реплике.'});
  const reviewed = (await getAppeal(opened.id)).data;
  const input = checklistForWrite(checklist);
  input.criteria[0].description += ' Уточнено описание в новой версии.';
  const next = (await createChecklistVersion(checklist.id, input)).data;
  const unchanged = (await getEvaluation(original.id)).data;
  return {evaluationId: original.id, appealId: opened.id,
    originalTotal: unchanged.score.total, finalTotal: reviewed.finalScore.total,
    newChecklistId: next.id, newVersion: next.version};
}
```

Для повторного оценивания новой версии явно вызовите evaluateConversation с next.id;
сохранённый original.id продолжит ссылаться на прежнюю версию. API не мигрирует оценки.
Для выбора официального чек-листа вместо учебного создания используйте
listChecklists({key:'freedom-broker-chat-quality'}) и getChecklist выбранного UUID.

## Запуск через Docker: Windows PowerShell

Compose: backend/compose.yaml. PostgreSQL доступен только в Docker-сети,
Backend вызывает http://ai:8001. Для Frontend нужен только порт 3000.
Требуется работающий Docker Desktop Linux containers. Gemini не запускается.

```powershell
Set-Location C:\Users\zhanel\CQA\backend
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Только для новой конфигурации: задайте приватный POSTGRES_PASSWORD в .env.
# Сохраните параметры уже существующего PostgreSQL volume.
# Добавьте точный Origin Frontend в CORS_ORIGINS без завершающего /.
docker compose config --quiet
docker compose build ai
docker compose build backend
docker compose up -d --wait --wait-timeout 180
docker compose ps
docker compose exec -T backend npm run db:status
docker compose exec -T backend npm run db:seed:official
docker compose exec -T backend npm run db:seed:call-na
Invoke-RestMethod 'http://127.0.0.1:3000/api/health'

```

Миграции применяются при запуске Backend; seed-команды заполняют v1/v2 и не
переписывают уже существующие версии. IMPORT_SOURCE=mock выбирает учебные диалоги;
при organizers администратор задаёт приватные URL/токен на сервере.
При изменении CORS_ORIGINS пересоздайте Backend через docker compose up -d backend.
Менять пароль существующей БД только в .env недостаточно и для запуска не требуется.
Не отправляйте .env Frontend-разработчику и не публикуйте его.
Остановить без удаления данных: docker compose stop; затем docker compose up -d --wait.
Не удаляйте volume. Полные инструкции: [README](../README.md#docker-desktop--powershell).

## Проверка этой документации

Маршруты/поля сверены с src/app.js, routes, Zod schemas, serializers, middleware и
calculateScore. Реальные HTTP-примеры выше сняты на локальном mock и отдельной
PostgreSQL cqa_audit_test_1794080119448; 27 запросов подтвердили все 14 маршрутов,
400/404/409/422 и синтетические AI 502/503/504. Исходный score=0, после апелляции=60.
Все созданные записи откатились транзакцией; пользовательские данные не менялись.

19 JavaScript-блоков извлечены из этого документа и скомпилированы вместе; функции API
и полный сценарий выполнены ещё 26 HTTP-запросами с реальным Express и тестовой БД.
Проверены повторное использование оценки, обработка ошибки fetch, новая версия и
сохранность первоначального итога. Все записи откатились.
Это проверка API-примеров, не повторный полный аудит.
Runtime Docker в этой задаче не пересобирался; команды сверены с существующим Compose.
API-ошибки реального внешнего AI здесь не вызывались.
