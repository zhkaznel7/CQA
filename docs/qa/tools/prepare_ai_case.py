"""Print one QA request for the AI adapter. No network access."""
import argparse
import json
from pathlib import Path

from export_dev_labels import RUBRIC_SHA256, canonical_hash

# These are synthetic inputs. Keep expected decisions in the QA journal, outside the request.
CASES = {
    "T05": ("RU", "03", [
        ("client", "Где посмотреть публичные тарифы?"),
        ("operator", "Откройте раздел «Тарифы» на сайте."),
    ]),
    "T06": ("RU", "03", [
        ("client", "Сообщите остаток на моём счёте."),
        ("operator", "На вашем счёте 100 условных единиц."),
    ]),
    "T07": ("RU", "01", [
        ("client", "Где найти тариф?"),
        ("bot", "Здравствуйте! Я виртуальный помощник."),
        ("operator", "Откройте раздел «Тарифы» на сайте."),
    ]),
    "T10-RU": ("RU", "01", [
        ("client", "Где посмотреть тарифы?"),
        ("operator", "Здравствуйте! Меня зовут Дана. Тарифы есть на сайте."),
    ]),
    "T10-KZ": ("KZ", "01", [
        ("client", "Тарифтерді қайдан көре аламын?"),
        ("operator", "Сәлеметсіз бе! Менің атым Дана. Тарифтер сайтта бар."),
    ]),
    "T10-EN": ("EN", "01", [
        ("client", "Where can I see the rates?"),
        ("operator", "Hello! My name is Dana. You can find the rates on our website."),
    ]),
}


def make_request(case, rubric):
    if canonical_hash(rubric) != RUBRIC_SHA256:
        raise ValueError("Ожидается официальный чек-лист v1 из QA-калибровки")
    language, key, turns = CASES[case]
    criterion = next(c for c in rubric["criteria"] if c["key"] == key)
    return {
        "conversation_id": case, "channel": "agent chat", "language": language,
        "transcript": [
            {"turnIndex": i, "timestamp": f"00:{i*5:02d}", "speaker": speaker, "text": text}
            for i, (speaker, text) in enumerate(turns)
        ],
        "checklist": {**rubric, "id": f"qa-v1-c{key}", "version": 1, "criteria": [criterion]},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("case", choices=CASES)
    parser.add_argument("--rubric", type=Path, required=True)
    args = parser.parse_args()
    try:
        request = make_request(args.case, json.loads(args.rubric.read_bytes()))
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"{error}\n")
    print(json.dumps(request, ensure_ascii=False, indent=2))
