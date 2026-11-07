#!/usr/bin/env python3
"""Export saved AI assessments and Backend scores to organizer JSON 1.0."""
import argparse
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
OFFICIAL = {
    "contact": ("boolean", False, None),
    "discovery": ("boolean", True, None),
    "identification": ("boolean", True, None),
    "consultation": ("scale", True, [0, 5, 10, 15, 20]),
    "empathy": ("boolean", False, None),
    "dialogue": ("scale", False, [0, 4, 7, 10]),
    "closure": ("boolean", True, None),
    "critical": ("boolean", False, None),
}
DEFAULT_MAP = dict(zip([f"{i:02}" for i in range(1, 9)], OFFICIAL))


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def indexed(entries, ids, label):
    result = {}
    if not isinstance(entries, list):
        raise ValueError(label + ": нужен массив")
    for item in entries:
        cid = item.get("conversation_id") if isinstance(item, dict) else None
        if cid not in ids or cid in result:
            raise ValueError(label + ": неизвестный или повторный conversation_id")
        result[cid] = item
    return result


def read_responses(path, ids):
    path = Path(path)
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    entries = []
    for file in files:
        data = load(file)
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            if isinstance(row, dict) and "error" in row and "conversation_id" not in row and file.stem in ids:
                row = {**row, "conversation_id": file.stem}
            entries.append(row)
    return indexed(entries, ids, "AI responses")


def validate_source(source, dataset):
    records = source.get("data", {}).get("records")
    if not isinstance(records, list) or len(records) != (65 if dataset == "dev" else 10):
        raise ValueError("Нужно 65 исходных записей для dev или 10 для prod")
    ids = [c.get("conversation_id") for c in records]
    if any(not isinstance(cid, str) or not cid.strip() for cid in ids) or len(set(ids)) != len(ids):
        raise ValueError("Исходные conversation_id должны быть непустыми и уникальными")
    if dataset == "prod" and any(c.get("channel") != "agent chat" for c in records):
        raise ValueError("Контрольный набор должен содержать только чаты")
    if any(not isinstance(c.get("transcript"), list) or not c["transcript"] for c in records):
        raise ValueError("Нужен исходный непустой массив transcript")
    return records


def error_row(cid, reason):
    return {"conversation_id": cid, "status": "error", "criteria": [], "score": None, "error": reason}


def same_value(left, right):
    if type(left) in (int, float) and type(right) in (int, float):
        return left == right
    return type(left) is type(right) and left == right


def convert(record, response, scored, mapping):
    cid = record["conversation_id"]
    if response is None:
        return error_row(cid, "Оценка системы для диалога не получена.")
    if "error" in response:
        code = response["error"].get("code") if isinstance(response["error"], dict) else None
        suffix = " (" + code + ")" if isinstance(code, str) and re.fullmatch("[A-Z_0-9]{1,80}", code) else ""
        return error_row(cid, "Не удалось получить проверенный ответ модели" + suffix + ".")
    try:
        if response.get("conversation_id") != cid:
            raise ValueError("Ответ AI относится к другому диалогу.")
        if (not isinstance(response.get("checklist_id"), str) or not response["checklist_id"].strip() or
            type(response.get("checklist_version")) is not int or response["checklist_version"] < 1):
            raise ValueError("Нет идентификатора версии чек-листа AI.")
        rows = response.get("results")
        if not isinstance(rows, list) or len(rows) != 8:
            raise ValueError("Нужны все восемь критериев.")
        by_code = {}
        transcript = record["transcript"]
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("Некорректный результат критерия.")
            code = mapping.get(row.get("criterion_id"))
            if code is None or code in by_code:
                raise ValueError("Неизвестный или повторный код критерия.")
            kind, allow_na, levels = OFFICIAL[code]
            na, value = row.get("na"), row.get("answer")
            if type(na) is not bool or (na and (value is not None or not allow_na)):
                raise ValueError("N/A не соответствует таблице сдачи для " + code + ".")
            if not na and ((kind == "boolean" and type(value) is not bool) or
                           (kind == "scale" and (type(value) not in (int, float) or value not in levels))):
                raise ValueError("Недопустимый тип или ступень для " + code + ".")
            explanation = row.get("explanation")
            na_reason = row.get("na_reason")
            if not isinstance(explanation, str) or not explanation.strip():
                raise ValueError("Нет обоснования для " + code + ".")
            if na and (not isinstance(na_reason, str) or not na_reason.strip()):
                raise ValueError("Нет причины N/A для " + code + ".")
            if not na and na_reason is not None:
                raise ValueError("Причина N/A у применимого критерия.")
            span = row.get("checked_range")
            if span is not None:
                if (not isinstance(span, dict) or type(span.get("start")) is not int or
                    type(span.get("end")) is not int or not 0 <= span["start"] <= span["end"] < len(transcript)):
                    raise ValueError("Неверный checked_range.")
            evidence = row.get("evidence")
            if not isinstance(evidence, list):
                raise ValueError("Неверный evidence.")
            turns = set()
            for item in evidence:
                if not isinstance(item, dict):
                    raise ValueError("Неверная цитата.")
                index, quote = item.get("turnIndex"), item.get("quote")
                if (type(index) is not int or not 0 <= index < len(transcript) or
                    not isinstance(quote, str) or not quote.strip() or quote not in transcript[index]["text"] or
                    (span is not None and not span["start"] <= index <= span["end"])):
                    raise ValueError("Неподтверждённое доказательство.")
                turns.add(index + 1)
            # Explicit checked ranges are also accepted by the Backend for omissions.
            if span is not None:
                turns.update(range(span["start"] + 1, span["end"] + 2))
            if not turns:
                raise ValueError("Нет доказательств или проверенного участка.")
            rationale = na_reason + " " + explanation if na and na_reason.strip() != explanation.strip() else explanation
            by_code[code] = {"criterion_id": code, "value": value, "rationale": rationale.strip(),
                             "evidence_turns": sorted(turns)}
        if set(by_code) != set(OFFICIAL):
            raise ValueError("Неполный набор критериев.")
        if not isinstance(scored, dict) or scored.get("conversation_id") != cid:
            raise ValueError("Нет сохранённого расчёта Backend.")
        if (scored.get("checklist_id") != response.get("checklist_id") or
            scored.get("checklist_version") != response.get("checklist_version")):
            raise ValueError("Расчёт Backend относится к другой версии чек-листа.")
        score = scored.get("score")
        if not isinstance(score, dict) or not isinstance(score.get("criteria"), list):
            raise ValueError("Нужен полный результат calculateScore из Backend.")
        matched = set()
        source_rows = {r["criterion_id"]: r for r in rows}
        for item in score["criteria"]:
            if not isinstance(item, dict):
                raise ValueError("Неверный результат расчёта Backend.")
            key = item.get("key")
            actual = source_rows.get(key)
            if (actual is None or key in matched or type(item.get("isNa")) is not bool or
                item["isNa"] != actual["na"] or not same_value(item.get("value"), actual["answer"])):
                raise ValueError("Расчёт Backend не соответствует ответам AI.")
            matched.add(key)
        if len(matched) != 8:
            raise ValueError("Неполный расчёт Backend.")
        total, flag = score.get("total"), score.get("grossError")
        if (type(total) not in (int, float) or not 0 <= total <= 100 or
            abs(total * 100 - round(total * 100)) > 0.000001):
            raise ValueError("Итог Backend должен быть числом 0–100 с точностью до двух знаков.")
        if type(flag) is not bool or flag != by_code["critical"]["value"]:
            raise ValueError("Флаг Backend не совпадает с critical.")
        return {"conversation_id": cid, "status": "ok", "criteria": [by_code[k] for k in OFFICIAL],
                "score": {"final_score": total, "critical_flag": flag}}
    except ValueError as error:
        return error_row(cid, str(error))


def export(source, dataset, responses, scores, team, model, mode="external_api", mapping=None):
    records = validate_source(source, dataset)
    mapping = DEFAULT_MAP if mapping is None else mapping
    if not isinstance(mapping, dict) or len(mapping) != 8 or set(mapping.values()) != set(OFFICIAL):
        raise ValueError("Нужно взаимно однозначное сопоставление восьми кодов.")
    if not isinstance(team, str) or not team.strip() or not isinstance(model, str) or not model.strip():
        raise ValueError("Укажите настоящее имя команды и модели.")
    if mode not in ["local", "external_api", "hybrid"]:
        raise ValueError("Недопустимый mode модели")
    return {"schema_version": "1.0", "team_name": team, "model": {"mode": mode, "name": model},
            "results": [convert(c, responses.get(c["conversation_id"]), scores.get(c["conversation_id"]), mapping)
                        for c in records]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, choices=["dev", "prod"])
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--responses", required=True, type=Path)
    parser.add_argument("--scores", required=True, type=Path)
    parser.add_argument("--team", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--mode", default="external_api", choices=["local", "external_api", "hybrid"])
    parser.add_argument("--criterion-map", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = load(args.source)
    records = validate_source(source, args.dataset)
    ids = {c["conversation_id"] for c in records}
    responses = read_responses(args.responses, ids)
    scores = indexed(load(args.scores), ids, "Backend scores")
    result = export(source, args.dataset, responses, scores, args.team, args.model, args.mode,
                    load(args.criterion_map) if args.criterion_map else None)
    output = args.output or HERE.parents[1] / "results" / args.dataset / "results.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(output)
    ok = sum(row["status"] == "ok" for row in result["results"])
    print(f"{output}: {len(result['results'])} диалогов, ok={ok}, error={len(result['results']) - ok}")
    print("Для сдачи необходимо сделать commit и push после проверки файла.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print("Ошибка экспорта: " + str(error), file=sys.stderr)
        sys.exit(1)
