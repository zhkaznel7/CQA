import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("export_results", Path(__file__).with_name("export-results.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        turns = [{"speaker": "client", "text": "Вопрос"},
                 {"speaker": "bot", "text": "Контекст бота"},
                 {"speaker": "operator", "text": "Ответ оператора"},
                 {"speaker": "system", "text": "Закрытие"}]
        self.records = [{"conversation_id": f"prod-{i}", "channel": "agent chat",
                         "transcript": copy.deepcopy(turns)} for i in range(10)]
        self.source = {"data": {"records": self.records}}
        values = [True, None, None, 15, True, 7, True, True]
        rows = [{"criterion_id": f"{i:02}", "answer": value, "na": value is None,
                 "na_reason": "Общее обращение." if value is None else None,
                 "explanation": "Обоснование.", "evidence": [{"turnIndex": 2, "quote": "Ответ оператора"}],
                 "checked_range": None} for i, value in enumerate(values, 1)]
        self.response = {"conversation_id": "prod-0", "checklist_id": "version-id", "checklist_version": 1, "results": rows}
        # A Backend score fixture. The exporter must preserve it, not calculate a score.
        self.scored = {"conversation_id": "prod-0", "checklist_id": "version-id", "checklist_version": 1,
                       "score": {"total": 73.5, "grossError": True, "criteria": [
                           {"key": r["criterion_id"], "value": r["answer"], "isNa": r["na"]} for r in rows]}}

    def convert(self, dataset=None):
        return exporter.convert(self.records[0], self.response, self.scored, exporter.DEFAULT_MAP, dataset=dataset)

    def test_exact_keys_one_based_indices_and_backend_score_preserved(self):
        row = self.convert()
        self.assertEqual(row["status"], "ok")
        self.assertEqual([r["criterion_id"] for r in row["criteria"]], list(exporter.OFFICIAL))
        self.assertEqual(row["criteria"][0]["evidence_turns"], [3])
        self.assertIsNone(row["criteria"][1]["value"])
        self.assertEqual(row["score"], {"final_score": 73.5, "critical_flag": True})
        self.assertEqual(set(row["criteria"][0]), {"criterion_id", "value", "rationale", "evidence_turns"})

    def test_errors_and_missing_assessments_are_not_dropped(self):
        result = exporter.export(self.source, "prod", {"prod-0": self.response}, {"prod-0": self.scored}, "Team", "actual-model")
        self.assertEqual(len(result["results"]), 10)
        self.assertEqual(result["schema_version"], "1.0")
        self.assertEqual(result["model"]["mode"], "external_api")
        self.assertEqual(sum(r["status"] == "error" for r in result["results"]), 9)
        for row in result["results"][1:]:
            self.assertEqual(row["criteria"], [])
            self.assertIsNone(row["score"])
        self.response = {"conversation_id": "prod-0", "error": {"code": "AI_TIMEOUT", "message": "private detail"}}
        error = self.convert()
        self.assertIn("AI_TIMEOUT", error["error"])
        self.assertNotIn("private detail", error["error"])

    def test_each_quote_must_be_inside_inclusive_range(self):
        self.response["results"][0]["checked_range"] = {"start": 0, "end": 1}
        self.assertEqual(self.convert()["status"], "error")
        self.response["results"][0]["checked_range"] = {"start": 2, "end": 2}
        self.assertEqual(self.convert()["criteria"][0]["evidence_turns"], [3])
        self.response["results"][0]["checked_range"] = {"start": 0, "end": 3}
        self.assertEqual(self.convert()["criteria"][0]["evidence_turns"], [1, 2, 3, 4])

    def test_chat_contact_na_is_rejected_not_replaced_by_false(self):
        self.response["results"][0].update(answer=None, na=True, na_reason="Обрезанный звонок")
        row = self.convert()
        self.assertEqual(row["status"], "error")
        self.assertIn("contact", row["error"])

    def contact_na(self):
        self.records[0]["channel"] = "voice call"
        self.records[0]["transcript"][3]["text"] = "Начало записи отсутствует."
        self.response["results"][0].update(
            answer=None, na=True, na_reason="Начало записи отсутствует: приветствие не попало в запись.",
            explanation="Системное событие подтверждает пропущенное начало.",
            evidence=[{"turnIndex": 3, "quote": "Начало записи отсутствует."}])
        self.scored["score"]["criteria"][0].update(value=None, isNa=True)
        self.scored["score"]["total"] = 38.89

    def test_dev_voice_contact_null_keeps_reason_and_backend_score(self):
        self.contact_na()
        row = self.convert(dataset="dev")
        self.assertEqual(row["status"], "ok")
        contact = row["criteria"][0]
        self.assertEqual(contact["criterion_id"], "contact")
        self.assertIsNone(contact["value"])
        self.assertIn("приветствие не попало", contact["rationale"])
        self.assertEqual(contact["evidence_turns"], [4])
        self.assertEqual(row["score"]["final_score"], 38.89)

    def test_dev_export_propagates_voice_exception_but_chat_and_prod_do_not(self):
        self.contact_na()
        records = [copy.deepcopy(self.records[0])]
        for i in range(1, 65):
            records.append({**copy.deepcopy(self.records[1]), "conversation_id": f"dev-{i}"})
        result = exporter.export({"data": {"records": records}}, "dev",
                                 {"prod-0": self.response}, {"prod-0": self.scored}, "Team", "fixture-only")
        self.assertEqual(result["results"][0]["status"], "ok")
        self.assertIsNone(result["results"][0]["criteria"][0]["value"])
        self.assertEqual(len(result["results"]), 65)
        self.assertEqual(self.convert(dataset="prod")["status"], "error")
        self.records[0]["channel"] = "agent chat"
        self.assertEqual(self.convert(dataset="dev")["status"], "error")

    def test_dev_voice_na_still_requires_reason_and_matching_backend_score(self):
        self.contact_na()
        self.response["results"][0]["na_reason"] = ""
        self.assertEqual(self.convert(dataset="dev")["status"], "error")
        self.contact_na()
        self.scored["score"]["criteria"][0].update(value=True, isNa=False)
        self.assertEqual(self.convert(dataset="dev")["status"], "error")

    def test_score_must_match_answers_version_and_critical_flag(self):
        for mutate in [
            lambda s: s.update(checklist_version=2),
            lambda s: s["score"].update(grossError=False),
            lambda s: s["score"]["criteria"][0].update(value=False),
            lambda s: s["score"].update(total=73.555),
            lambda s: s["score"].update(total=True)
        ]:
            scored = copy.deepcopy(self.scored)
            mutate(scored)
            self.assertEqual(exporter.convert(self.records[0], self.response, scored, exporter.DEFAULT_MAP)["status"], "error")
        self.assertEqual(exporter.convert(self.records[0], self.response, None, exporter.DEFAULT_MAP)["status"], "error")

    def test_exact_dataset_sizes_original_ids_and_custom_key_mapping(self):
        with self.assertRaises(ValueError):
            exporter.export(self.source, "dev", {}, {}, "Team", "model")
        self.source["data"]["records"] = self.records[:9]
        with self.assertRaises(ValueError):
            exporter.export(self.source, "prod", {}, {}, "Team", "model")
        with self.assertRaises(ValueError):
            exporter.indexed([self.response, self.response], {"prod-0"}, "responses")
        self.response["results"][0]["criterion_id"] = "custom-contact"
        self.scored["score"]["criteria"][0]["key"] = "custom-contact"
        mapping = {k:v for k,v in exporter.DEFAULT_MAP.items() if k != "01"}
        mapping["custom-contact"] = "contact"
        self.assertEqual(exporter.convert(self.records[0], self.response, self.scored, mapping)["status"], "ok")

    def test_cli_writes_complete_utf8_submission_without_network(self):
        import json
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in [("source.json", self.source), ("responses.json", [self.response]),
                                ("scores.json", [self.scored])]:
                (root / name).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            target = root / "results" / "prod" / "results.json"
            command = [sys.executable, str(Path(__file__).with_name("export-results.py")),
                       "--dataset", "prod", "--source", str(root / "source.json"),
                       "--responses", str(root / "responses.json"), "--scores", str(root / "scores.json"),
                       "--team", "Тестовая команда", "--model", "fixture-only", "--output", str(target)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            saved = json.loads(target.read_text(encoding="utf-8"))
            self.assertEqual(saved["team_name"], "Тестовая команда")
            self.assertEqual(len(saved["results"]), 10)
            self.assertEqual(saved["results"][0]["criteria"][0]["evidence_turns"], [3])
            self.assertEqual(saved["results"][0]["score"]["final_score"], 73.5)


if __name__ == "__main__":
    unittest.main()
