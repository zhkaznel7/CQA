# Scoring Engine — этап 4

Экспорт: `calculateScore(checklistVersion, answers)` из
`src/modules/scoring/scoring.service.js`. Функция синхронная и детерминированная.
Она не импортирует Prisma, переменные окружения, Express или AI-клиент, не делает
HTTP-запросов и не изменяет входные объекты или сохранённые результаты.
`scoringVersion="1.0.0"` обозначает версию алгоритма, отдельно от версии чек-листа.

## Вход

`checklistVersion` — результат Checklists API GET по UUID либо Prisma Checklist
с `include: { criteria: true }`. Обязательны key, name, положительный version,
секции и полные определения критериев. Для unit-тестов допустим snapshot
`{ ...officialSeed, version: 1 }`; seed-файл сам по себе версии не содержит.
Prisma config разворачивается внутри адаптера без обращения к базе. Критерии из Prisma
упорядочиваются по config.position. Старые config без типа/веса нельзя оценить:
движок не придумывает отсутствующую конфигурацию.

Используются те же ограничения, что в редакторе: сумма весов 100, обычные критерии
с положительным весом, flag с нулевым весом, шкалы с объявленными уникальными ступенями.
Вес содержит до двух десятичных знаков, ступени — до четырёх. Порядок шкалы может
быть возрастающим или убывающим. Максимум берётся из определения шкалы.
Переданный maxPoints проверяется на совпадение со шкалой (boolean=1, flag=0).

Ответы — массив с ровно одной записью на каждый критерий, включая flag:

```js
const answers = [
  { criterionKey: '01', value: true },
  { criterionKey: '02', value: true },
  {
    criterionKey: '03', isNa: true,
    naConditionMet: true,
    naReason: 'запрос не требовал идентификации.'
  },
  { criterionKey: '04', value: 15 },
  { criterionKey: '05', value: true },
  { criterionKey: '06', value: 7 },
  { criterionKey: '07', value: true },
  { criterionKey: '08', value: false }
];
const result = calculateScore(checklistVersion, answers);
// result.total === 88.13
```

В контрольных примерах c1…c8 обозначают официальные ключи `01`…`08`.
Пользовательские ключи не переименовываются. Boolean и flag принимают только
true/false, scale — только число, равное одной из объявленных ступеней.
Поле `isNa` по умолчанию false. Строки "N/A", null, пропущенные значения,
числовые 0/1 вместо boolean, готовые баллы от AI и неизвестные поля не принимаются.

### Применимость N/A

Каноническое поле проекта — **allowNa**, не allowNA. N/A разрешён только если это поле
true, есть условие naCondition, а вызывающий модуль передал naConditionMet=true
и непустой naReason. Для N/A поле value должно отсутствовать. Flag не может быть N/A.
При обычном ответе поля подтверждения N/A должны отсутствовать.

Условия PDF изложены естественным языком. Движок проверяет разрешение и наличие
подтверждения, но не способен доказать соответствие обоснования реальному диалогу.
За подтверждение применимости отвечает будущий вызывающий модуль/проверяющий.
naCondition не исполняется как код. Пропущенный ответ не становится false или N/A:
весь расчёт завершается INCOMPLETE_ANSWERS, чтобы не выдать ложную финальную оценку.

## Расчёт

Пусть W — сумма весов применимых критериев без flag.
Для каждого применимого критерия:

```text
ratio = true ? 1 : 0                    для boolean
ratio = value / maximumDeclaredStep     для scale
basePoints = ratio × weight
maxPoints = weight / W × 100
points = ratio × maxPoints
total = round(sum(points), 2)
```

Перераспределение выполняется между всеми применимыми критериями, не внутри секций.
Для N/A и flag вклад и максимум равны 0. Flag сохраняет своё логическое value;
grossError=true, если хотя бы один flag=true. Штрафов или обнуления итоговой оценки нет.
Если W=0, total=null и общий maxPoints=0. Например, все обычные критерии пользовательского
чек-листа могут быть N/A; флаг при этом по-прежнему возвращается независимо.
Нулевой вес обычного критерия отвергается согласно существующему контракту редактора.

Внутри используются точные дроби BigInt: целые сотые веса и десятитысячные ступеней.
Итог округляется один раз, половины вверх: 88.125 → 88.13.
BigInt не попадает в результат — он полностью JSON-совместим.
criteria.points/maxPoints/basePoints и sections.points/maxPoints — числовое представление
неокруглённых вкладов. Они могут содержать дробные хвосты IEEE-754. Не округляйте их
перед суммированием и не вычисляйте total на Frontend. При форматировании сумм уже
округлённых строк визуальное расхождение на сотую возможно: total авторитетен.

## Выход

```js
{
  scoringVersion: '1.0.0',
  checklistId: 'UUID или null для snapshot без ID',
  checklistKey: 'freedom-broker-chat-quality',
  checklistVersion: 1,
  applicableWeight: 80,
  maxPoints: 100,
  total: 88.13,
  grossError: false,
  criteria: [/* key, sectionKey, type, value, isNa, naReason,
                weight, basePoints, points, maxPoints */],
  sections: [/* key, name, points, maxPoints */]
}
```

Секции содержат вклад в общий результат из 100, а не отдельную нормализацию секции
до 100. Секция, где только flag, только N/A или нет критериев, имеет points=0/maxPoints=0.
В контрольном случае 88.13 максимумы секций: 31.25, 25, 43.75, 0.

## Ошибки и дальнейшее использование

`ScoringError` имеет code и details без исходных текстов диалога:
INVALID_CHECKLIST, INVALID_ANSWERS, UNKNOWN_CRITERION, DUPLICATE_ANSWER,
INCOMPLETE_ANSWERS, NA_NOT_ALLOWED, INVALID_SCALE_VALUE, INVALID_BOOLEAN_VALUE.
На этапе 5 модуль evaluations вызывает движок после проверки AI-контракта и
независимых подтверждений N/A: [evaluations.md](evaluations.md).
Математический движок остаётся независимым от HTTP/БД/AI. Поля результата не следует напрямую записывать в старый
CriterionResult.points: там максимум соответствует сырой шкале (например boolean=1),
а scoring.criteria.points — уже взвешенный и перераспределённый вклад из 100.
Исходный ответ сохранён в criteria.value для явного преобразования будущим сервисом.

Исторические SQL views EvaluationTotals/EffectiveCriterionResult остались без изменений:
они показывают сырые суммы этапа 2, а не новый нормализованный scoring.
На этапе 6 [Appeals API](appeals.md) вызывает эту же функцию с зафиксированной версией
чек-листа и текущими ответами, сохраняет beforeScore/afterScore отдельно в Appeal.
Сам движок ничего не сохраняет и не пересчитывает старые оценки автоматически.

## Проверка в PowerShell

Без PostgreSQL, Docker и `.env`:

```powershell
Set-Location C:\Users\zhanel\CQA\backend
npm.cmd run test:scoring
```

Полный набор тестов требует отдельную мигрированную тестовую БД:

```powershell
$env:DATABASE_URL = 'postgresql://USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/cqa_test'
npm.cmd run db:migrate
npm.cmd test
Remove-Item Env:DATABASE_URL
```

25 scoring-тестов покрывают восемь контрольных случаев, все N/A, неполный ввод,
неверные типы/ступени/веса, несколько секций, дробные веса, формат Prisma,
детерминизм и неизменность замороженных входных snapshot.
Фактически выполнены: 25/25 unit-тестов без БД и 48/48 полного набора на новой
изолированной базе cqa_stage4_test (PostgreSQL 18.6), без ошибок.
