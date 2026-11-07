"""Export the QA calibration tables for ai/evaluation/compare.py (no network calls)."""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

CALIBRATION = Path(__file__).resolve().parents[1] / "calibration.md"
DEV_SHA256 = "7311f19010932804b1fd3391d50a311dd8699a04e8441e756ae94a8b51c0b455"
RUBRIC_SHA256 = "32fb8a23cf32229c689edb3147eb434e252a01ec357d81406400905f405f0cfa"
# Current exclusions and QA/AI decisions are recorded in calibration.md.
EXCLUDED = {
    ("p1-ru-008", "06"): "Как трактовать переспрос клиента?",
    ("p4-ru-003", "07"): "Была ли возможность завершить звонок?",
    ("p1-kz-008", "07"): "Установлена ли возможность ответить после благодарности клиента?",
    ("p1-kz-015", "04"): "Достаточно ли обещания передать вопрос на проверку?",
}

TEAM_REVIEWED = {("p1-kz-008", "02"), ("p1-kz-008", "05"),
                 ("p1-en-008", "04"), ("p1-en-015", "05")}


def canonical_hash(value):
    serialized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode()).hexdigest()


def reference_ranges(text, turn_count):
    spans = []
    for segment in text.split(","):
        match = re.fullmatch(r"(\d+)(?:–(\d+))?", segment.strip())
        if not match:
            raise ValueError(f"Не удалось прочитать ссылку на реплику: {segment}")
        start = int(match[1])
        end = int(match[2] or match[1])
        if not 0 <= start <= end < turn_count:
            raise ValueError(f"Ссылка за пределами транскрипта: {segment}")
        spans.append({"start": start, "end": end})
    return spans


def answer_value(label, criterion):
    if label == "N/A" and criterion["allowNa"]:
        return None
    if criterion["type"] == "scale":
        for step in criterion["scaleSteps"]:
            if str(step["value"]) == label:
                return step["value"]
    elif label in {"Да", "Нет"}:
        return label == "Да"
    raise ValueError(f"Недопустимая метка {label} для {criterion['key']}")


def build_export(source_bytes, rubric, markdown):
    if hashlib.sha256(source_bytes).hexdigest() != DEV_SHA256 or canonical_hash(rubric) != RUBRIC_SHA256:
        raise ValueError("Версия DEV или чек-листа отличается от версии калибровки")
    records = json.loads(source_bytes)["data"]["records"]
    source = {r["conversation_id"]: r for r in records}
    if len(source) != len(records):
        raise ValueError("В DEV есть повторные ID")
    criteria = {c["key"]: c for c in rubric["criteria"]}
    conversations = []
    seen = set()
    excluded = set()
    for block in re.split(r"(?m)^#{2,3} ", markdown):
        heading = re.match(r"(p\d+-[a-z]+-\d+) · (RU|KZ|EN) ·", block)
        if not heading:
            continue
        cid, language = heading.groups()
        if cid in seen or cid not in source or source[cid]["language"] != language:
            raise ValueError(f"Неоднозначный диалог или язык: {cid}")
        seen.add(cid)
        transcript = source[cid]["transcript"]
        results = []
        for line in block.splitlines():
            if not re.match(r"^\| \d{2} \|", line):
                continue
            key, label, references, explanation = (s.strip() for s in line.strip("|").split("|"))
            value = answer_value(label, criteria[key])
            spans = reference_ranges(references, len(transcript))
            question = EXCLUDED.get((cid, key))
            if question:
                excluded.add((cid, key))
            checked_range = None
            if key == "01" and value is False:
                first_operator = next(i for i, turn in enumerate(transcript) if turn["speaker"] == "operator")
                if not any(span["start"] <= first_operator <= span["end"] for span in spans):
                    raise ValueError(f"Первая реплика оператора отсутствует в ссылках c1: {cid}")
                checked_range = {"start": first_operator, "end": first_operator}
            elif key == "07" and value is False:
                checked_range = spans[-1]
            results.append({
                "criterion_id": key, "answer": value, "na": value is None,
                "na_reason": explanation if value is None else None, "explanation": explanation,
                "reference_ranges": spans,
                "checked_range": checked_range,
                "review": {"status": "approved" if (cid, key) in TEAM_REVIEWED else "pending", "disputed": bool(question), "question": question},
            })
        if [r["criterion_id"] for r in results] != list(criteria):
            raise ValueError(f"Неполный, повторный или переставленный критерий: {cid}")
        conversations.append({
            "conversation_id": cid, "language": language, "channel": source[cid]["channel"],
            "split": "qa-dev", "transcript_sha256": canonical_hash(transcript), "results": results,
        })
    if Counter(c["language"] for c in conversations) != {"RU": 5, "KZ": 5, "EN": 5} or excluded != set(EXCLUDED):
        raise ValueError("Неверный состав калибровки или исключений")
    return {
        "schema_version": 1, "status": "draft_pending_tester_review",
        "source": {"path": "data/dev.json", "sha256": DEV_SHA256},
        "rubric": {"key": rubric["key"], "version": 1, "sha256": RUBRIC_SHA256, "snapshot": rubric},
        "conversations": conversations,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", type=Path, required=True)
    parser.add_argument("--rubric", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        labels = build_export(args.dev.read_bytes(), json.loads(args.rubric.read_bytes()), CALIBRATION.read_text(encoding="utf-8"))
        with args.output.open("x", encoding="utf-8") as target:
            json.dump(labels, target, ensure_ascii=False, indent=2)
            target.write("\n")
        print(f"15 диалогов, 120 меток, отложено пар: {len(EXCLUDED)}.")
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"{error}\n")
