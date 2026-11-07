"""Check evidence in one saved AI response against the transcript sent for evaluation."""
import argparse
import json
from pathlib import Path


def check_rows(rows, transcript):
    if not isinstance(rows, list) or not rows:
        raise ValueError("В ответе отсутствуют строки критериев")
    if not isinstance(transcript, list) or not transcript:
        raise ValueError("Пустой транскрипт")
    for i, turn in enumerate(transcript):
        if not isinstance(turn, dict) or not isinstance(turn.get("text"), str):
            raise ValueError(f"Некорректная реплика {i}")
        index = turn.get("turnIndex", i)
        if type(index) is not int or index != i:
            raise ValueError(f"Индекс реплики расходится с позицией {i}")
    quotes = 0
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Некорректная строка критерия")
        key = row.get("criterion_id", "?")
        span = row["checked_range"]
        if span is not None:
            if not isinstance(span, dict):
                raise ValueError(f"c{key}: некорректный диапазон")
            start, end = span.get("start"), span.get("end")
            if type(start) is not int or type(end) is not int or not 0 <= start <= end < len(transcript):
                raise ValueError(f"c{key}: границы диапазона недопустимы")
        evidence = row.get("evidence")
        if not isinstance(evidence, list) or (not evidence and span is None):
            raise ValueError(f"c{key}: отсутствует источник доказательства")
        for item in evidence:
            if not isinstance(item, dict):
                raise ValueError(f"c{key}: некорректное доказательство")
            i, quote = item.get("turnIndex"), item.get("quote")
            if type(i) is not int or not 0 <= i < len(transcript):
                raise ValueError(f"c{key}: индекс реплики недопустим")
            if not isinstance(quote, str) or not quote.strip() or quote not in transcript[i]["text"]:
                raise ValueError(f"c{key}: цитата не найдена дословно в реплике {i}")
            if span is not None and not start <= i <= end:
                raise ValueError(f"c{key}: реплика {i} вне диапазона [{start}, {end}]")
            quotes += 1
    return quotes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Исходный JSON-запрос адаптера")
    source.add_argument("--dev", type=Path, help="DEV с data.records")
    parser.add_argument("--id", help="ID диалога для DEV или сверки с запросом")
    parser.add_argument("--response", type=Path, required=True)
    args = parser.parse_args()
    try:
        response = json.loads(args.response.read_bytes())
        if args.input:
            request = json.loads(args.input.read_bytes())
            cid, transcript = request["conversation_id"], request["transcript"]
            if args.id and args.id != cid:
                raise ValueError("ID не совпадает с исходным запросом")
        else:
            cid = args.id or (response.get("conversation_id") if isinstance(response, dict) else None)
            if not cid:
                raise ValueError("Для массива результатов с DEV требуется --id")
            records = json.loads(args.dev.read_bytes())["data"]["records"]
            matches = [r for r in records if r["conversation_id"] == cid]
            if len(matches) != 1:
                raise ValueError("В DEV требуется ровно один диалог с этим ID")
            transcript = matches[0]["transcript"]
        if isinstance(response, dict):
            if response.get("conversation_id") != cid:
                raise ValueError("Ответ относится к другому диалогу")
            response = response["results"]
        count = check_rows(response, transcript)
    except (ValueError, KeyError, OSError, TypeError) as error:
        parser.exit(1, f"Ошибка: {error}\n")
    print(f"{cid}: проверено критериев {len(response)}, дословных цитат {count}.")


if __name__ == "__main__":
    main()
