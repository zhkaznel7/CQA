#!/usr/bin/env python3
"""Compare saved AI HTTP responses with manual labels. Makes no network calls."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def canonical_hash(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def value_label(result):
    if type(result.get("na")) is not bool:
        raise ValueError("na должен быть boolean")
    answer = result.get("answer")
    if result["na"]:
        if answer is not None or not isinstance(result.get("na_reason"), str) or not result["na_reason"].strip():
            raise ValueError("N/A требует answer=null и непустой na_reason")
        return "N/A"
    if "answer" not in result or answer is None:
        raise ValueError("ответ отсутствует")
    if result.get("na_reason") is not None:
        raise ValueError("na_reason должен быть null")
    if type(answer) is bool:
        return "Да" if answer else "Нет"
    if type(answer) in (int, float):
        return str(answer) if type(answer) is int else format(answer, "g")
    raise ValueError("недопустимый тип answer")


def validate_result(result, criterion, transcript):
    value_label(result)
    if result["na"]:
        if not criterion["allowNa"] or criterion["type"] == "flag":
            raise ValueError("N/A не разрешён конфигурацией")
    elif criterion["type"] == "scale":
        if type(result["answer"]) not in (int, float) or result["answer"] not in [s["value"] for s in criterion["scaleSteps"]]:
            raise ValueError("ответ не входит в числовую шкалу")
    elif type(result["answer"]) is not bool:
        raise ValueError("для boolean/flag требуется true или false")
    if not isinstance(result.get("explanation"), str) or not result["explanation"].strip():
        raise ValueError("нет explanation")
    evidence = result.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise ValueError("нет evidence")
    for item in evidence:
        if not isinstance(item, dict):
            raise ValueError("некорректное evidence")
        index, quote = item.get("turnIndex"), item.get("quote")
        if (type(index) is not int or not 0 <= index < len(transcript)
                or not isinstance(quote, str) or not quote.strip()
                or quote not in transcript[index]["text"]):
            raise ValueError("недостоверная цитата или turnIndex")
    if "checked_range" not in result:
        raise ValueError("нет поля checked_range")
    span = result["checked_range"]
    if span is not None:
        if not isinstance(span, dict):
            raise ValueError("некорректный checked_range")
        start, end = span.get("start"), span.get("end")
        if type(start) is not int or type(end) is not int or not 0 <= start <= end < len(transcript):
            raise ValueError("границы checked_range вне транскрипта")
        if any(not start <= item["turnIndex"] <= end for item in evidence):
            raise ValueError("evidence вне checked_range (границы включительные)")


def read_predictions(path, expected_ids):
    path = Path(path)
    paths = sorted(path.glob("*.json")) if path.is_dir() else [path]
    predictions = {}
    for item in paths:
        data = load(item)
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(f"{item}: ожидался объект HTTP-ответа")
            cid = row.get("conversation_id")
            # An HTTP error has no ID in the agreed contract. Save it as <ID>.json.
            if cid is None and "error" in row and item.stem in expected_ids:
                cid = item.stem
            if cid not in expected_ids:
                raise ValueError(f"{item}: неизвестный или отсутствующий conversation_id {cid!r}")
            if cid in predictions:
                raise ValueError(f"{item}: повтор conversation_id {cid}")
            predictions[cid] = row
    return predictions


def compare(labels, predictions, source):
    criteria = {c["key"]: c for c in labels["rubric"]["snapshot"]["criteria"]}
    totals = {key: Counter() for key in criteria}
    confusion = {key: Counter() for key in criteria}
    details, issues = [], []
    for conversation in labels["conversations"]:
        cid = conversation["conversation_id"]
        original = source[cid]
        if canonical_hash(original["transcript"]) != conversation["transcript_sha256"]:
            raise ValueError(f"{cid}: исходный транскрипт изменён")
        prediction = predictions.get(cid)
        problem = None
        if prediction is None:
            problem = "нет сохранённого ответа"
        elif "error" in prediction:
            error = prediction["error"]
            problem = "HTTP-ошибка: " + str(error.get("code", "unknown")) if isinstance(error, dict) else "некорректный объект error"
        elif type(prediction.get("checklist_version")) is not int or prediction["checklist_version"] != labels["rubric"]["version"]:
            problem = "версия чек-листа не совпадает"
        elif not isinstance(prediction.get("results"), list):
            problem = "нет массива results"
        rows = {}
        duplicates = set()
        if not problem:
            for row in prediction["results"]:
                if not isinstance(row, dict) or row.get("criterion_id") not in criteria:
                    issues.append({"conversation_id": cid, "problem": "неизвестный criterion_id или некорректная запись"})
                    continue
                key = row["criterion_id"]
                if key in rows:
                    duplicates.add(key)
                rows[key] = row
        for expected in conversation["results"]:
            key = expected["criterion_id"]
            review = expected["review"]
            group = "approved" if review["status"] == "approved" else "disputed" if review["disputed"] else "draft"
            count = totals[key]
            count[group + "_expected"] += 1
            actual = rows.get(key)
            issue = problem
            if not issue and key in duplicates:
                issue = "повтор criterion_id"
            if not issue and actual is None:
                issue = "пропущен критерий"
            if not issue:
                try:
                    validate_result(actual, criteria[key], original["transcript"])
                    # A missing action needs a range, independently of exact-answer accuracy.
                    if expected["checked_range"] and actual["checked_range"] is None:
                        issues.append({"conversation_id": cid, "criterion_id": key,
                                       "problem": "нет checked_range для отмеченного разметкой пропуска"})
                except ValueError as error:
                    issue = str(error)
            record = {"conversation_id": cid, "language": conversation["language"],
                      "split": conversation["split"], "criterion_id": key, "label_group": group,
                      "expected": value_label(expected),
                      "expected_explanation": expected["explanation"],
                      "review_question": review.get("question")}
            if issue:
                count[group + "_unavailable"] += 1
                record.update(status="unavailable", problem=issue)
            else:
                observed = value_label(actual)
                matched = observed == record["expected"]
                count[group + "_valid"] += 1
                count[group + "_matches"] += int(matched)
                record.update(status="match" if matched else "mismatch", actual=observed,
                              actual_explanation=actual["explanation"], evidence=actual["evidence"],
                              checked_range=actual["checked_range"])
                if expected["na"] != actual["na"]:
                    record["difference_kind"] = "na_applicability"
                elif criteria[key]["type"] == "scale" and not expected["na"]:
                    steps = sorted(s["value"] for s in criteria[key]["scaleSteps"])
                    gap = abs(steps.index(expected["answer"]) - steps.index(actual["answer"]))
                    distance = abs(expected["answer"] - actual["answer"])
                    record.update(scale_steps_apart=gap, scale_absolute_error=distance,
                                  difference_kind="match" if matched else "adjacent_scale" if gap == 1 else "large_scale")
                    if group != "disputed":
                        count[group + "_scale_count"] += 1
                        count[group + "_scale_error_sum"] += distance
                        count[group + "_within_one_step"] += int(gap <= 1)
                else:
                    record["difference_kind"] = "match" if matched else criteria[key]["type"]
                if group != "disputed":
                    confusion[key][record["expected"] + " → " + observed] += 1
            details.append(record)
    return {
        "note": "Сравнение с командной разметкой, не с эталоном организаторов. Спорные pending-метки исключены из показателей совпадения.",
        "criteria": {key: {"name": criteria[key]["name"], **dict(totals[key]),
                           "confusion": dict(confusion[key])} for key in criteria},
        "details": details, "technical_issues": issues
    }


def print_report(report):
    def cell(row, group):
        matches, valid, expected = (row.get(group + suffix, 0) for suffix in ("_matches", "_valid", "_expected"))
        percent = f"{100 * matches / valid:.1f}%" if valid else "—"
        return f"{matches}/{valid} ({percent}), покрытие {valid}/{expected}"
    print(report["note"])
    print("\nКритерий | Одобрено: совпало/проверено | Черновик без спорных | Спорных")
    for key, row in report["criteria"].items():
        print(f"{key} {row['name']} | {cell(row, 'approved')} | {cell(row, 'draft')} | {row.get('disputed_expected', 0)}")
    print("\nБлизость числовых ступеней (N/A и спорные метки исключены):")
    for key, row in report["criteria"].items():
        for group in ("approved", "draft"):
            total = row.get(group + "_scale_count", 0)
            if total:
                mae = row[group + "_scale_error_sum"] / total
                print(f"{key} [{group}] среднее абсолютное расхождение {mae:.2f} по исходной шкале; "
                      f"в пределах одной ступени {row[group + '_within_one_step']}/{total}")
    print("\nРасхождения по критериям (спорные показаны отдельно):")
    for key in report["criteria"]:
        print(f"\n{key}:")
        for row in report["details"]:
            if row["criterion_id"] != key or row["status"] == "match":
                continue
            if row["status"] == "unavailable":
                print(f"  {row['conversation_id']} [{row['label_group']}] — {row['problem']}")
            else:
                print(f"  {row['conversation_id']} [{row['label_group']}] ожидается {row['expected']}, Gemini {row['actual']}")
                print("    Тип расхождения: " + row["difference_kind"])
                print("    Gemini: " + row["actual_explanation"])
                if row["review_question"]:
                    print("    Ревью: " + row["review_question"])
    for issue in report["technical_issues"]:
        print("Техническая проверка:", json.dumps(issue, ensure_ascii=False))



def baseline_comparison(current, baseline):
    before = {(r["conversation_id"], r["criterion_id"]): r for r in baseline["details"]}
    changes = []
    for new in current["details"]:
        old = before[(new["conversation_id"], new["criterion_id"])]
        changes.append({
            "conversation_id": new["conversation_id"], "criterion_id": new["criterion_id"],
            "label_group": new["label_group"], "expected": new["expected"],
            "before": old.get("actual"), "after": new.get("actual"),
            "before_status": old["status"], "after_status": new["status"],
            "before_explanation": old.get("actual_explanation", old.get("problem")),
            "after_explanation": new.get("actual_explanation", new.get("problem"))
        })
    return changes

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", required=True, help="JSON-ответ, массив ответов или папка <conversation_id>.json")
    parser.add_argument("--labels", type=Path, default=HERE / "dev-12.manual.v1.json")
    parser.add_argument("--source", type=Path, default=HERE.parents[1] / "data/dev.json")
    parser.add_argument("--report", type=Path, help="Дополнительно сохранить полный JSON-отчёт")
    parser.add_argument("--ids", help="Выбранные ID диалогов через запятую")
    parser.add_argument("--baseline", type=Path, help="Ответы первого прогона для сравнения до/после")
    args = parser.parse_args()
    labels = load(args.labels)
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != labels["source"]["sha256"]:
        raise ValueError("DEV-файл не совпадает с источником ручной разметки")
    snapshot = labels["rubric"]["snapshot"]
    if canonical_hash(snapshot) != labels["rubric"]["sha256"]:
        raise ValueError("снимок рубрики не совпадает с хешем разметки")
    source = {c["conversation_id"]: c for c in load(args.source)["data"]["records"]}
    expected_ids = {c["conversation_id"] for c in labels["conversations"]}
    if args.ids:
        selected = args.ids.split(",")
        if not selected or len(set(selected)) != len(selected) or not set(selected) <= expected_ids:
            raise ValueError("--ids содержит повторные или неизвестные ID")
        labels = {**labels, "conversations": [c for c in labels["conversations"] if c["conversation_id"] in selected]}
    predictions = read_predictions(args.predictions, expected_ids)
    report = compare(labels, predictions, source)
    report["labels_sha256"] = hashlib.sha256(args.labels.read_bytes()).hexdigest()
    print_report(report)
    if args.baseline:
        baseline = compare(labels, read_predictions(args.baseline, expected_ids), source)
        report["baseline_comparison"] = baseline_comparison(report, baseline)
        print("\nПервый прогон → новый прогон (спорные решения не означают доказанную ошибку):")
        for r in report["baseline_comparison"]:
            print(f"{r['conversation_id']} / {r['criterion_id']} [{r['label_group']}]: "
                  f"{r['before'] or r['before_status']} → {r['after'] or r['after_status']}; "
                  f"черновая разметка {r['expected']}")
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print("Ошибка сравнения: " + str(error), file=sys.stderr)
        sys.exit(1)
