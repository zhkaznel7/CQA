import copy
import unittest
from pathlib import Path
import tempfile
import compare as comparison

HERE = Path(__file__).resolve().parent


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.labels = comparison.load(HERE / "dev-12.manual.v1.json")
        self.source = {c["conversation_id"]: c for c in comparison.load(HERE.parents[1] / "data/dev.json")["data"]["records"]}
        self.predictions = {
            c["conversation_id"]: {
                "conversation_id": c["conversation_id"], "checklist_version": 1,
                "results": [{k: copy.deepcopy(v) for k, v in r.items() if k != "review"} for r in c["results"]]
            } for c in self.labels["conversations"]
        }

    def test_perfect_copy_keeps_draft_disputed_and_approved_separate(self):
        self.labels["conversations"][0]["results"][0]["review"]["status"] = "approved"
        report = comparison.compare(self.labels, self.predictions, self.source)
        self.assertEqual(len(report["details"]), 96)
        self.assertTrue(all(r["status"] == "match" for r in report["details"]))
        self.assertEqual(report["criteria"]["01"]["approved_matches"], 1)
        self.assertEqual(sum(c.get("disputed_expected", 0) for c in report["criteria"].values()), 29)

    def test_mismatch_is_assigned_to_exact_criterion(self):
        self.predictions["p1-ru-001"]["results"][0]["answer"] = False
        report = comparison.compare(self.labels, self.predictions, self.source)
        errors = [r for r in report["details"] if r["status"] == "mismatch"]
        self.assertEqual([(r["conversation_id"], r["criterion_id"]) for r in errors], [("p1-ru-001", "01")])

    def test_bad_citation_missing_reply_and_wrong_version_are_not_semantic_errors(self):
        self.predictions["p1-ru-001"]["results"][0]["evidence"][0]["quote"] = "invented quote"
        del self.predictions["p1-en-006"]
        self.predictions["p1-kz-003"]["checklist_version"] = 2
        report = comparison.compare(self.labels, self.predictions, self.source)
        self.assertEqual(sum(r["status"] == "unavailable" for r in report["details"]), 17)
        self.assertFalse(any(r["status"] == "mismatch" for r in report["details"]))

    def test_duplicate_and_boolean_numeric_types_are_rejected(self):
        rows = self.predictions["p1-ru-001"]["results"]
        rows.append(copy.deepcopy(rows[0]))
        rows[4]["answer"] = 1
        report = comparison.compare(self.labels, self.predictions, self.source)
        errors = [r for r in report["details"] if r["status"] == "unavailable"]
        self.assertEqual({r["criterion_id"] for r in errors}, {"01", "05"})

    def test_missing_omission_range_is_reported_even_with_matching_answer(self):
        self.predictions["p1-en-015"]["results"][0]["checked_range"] = None
        report = comparison.compare(self.labels, self.predictions, self.source)
        self.assertTrue(any(i["conversation_id"] == "p1-en-015" and i["criterion_id"] == "01"
                            for i in report["technical_issues"]))

    def test_reader_handles_error_files_and_rejects_duplicate_conversations(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "p1-ru-001.json").write_text(json.dumps({"error": {"code": "AI_TIMEOUT"}}))
            self.assertIn("p1-ru-001", comparison.read_predictions(path, set(self.predictions)))
            response = self.predictions["p1-ru-001"]
            (path / "duplicate.json").write_text(json.dumps(response))
            with self.assertRaisesRegex(ValueError, "повтор"):
                comparison.read_predictions(path, set(self.predictions))

class ScaleDistanceTests(unittest.TestCase):
    setUp = ComparisonTests.setUp
    def test_adjacent_and_large_scale_gaps_are_separate_from_na(self):
        self.predictions["p1-en-015"]["results"][5]["answer"] = 7
        self.predictions["p1-kz-005"]["results"][5]["answer"] = 10
        self.predictions["p1-ru-025"]["results"][3].update(answer=0, na=False, na_reason=None)
        report = comparison.compare(self.labels, self.predictions, self.source)
        details = {(r["conversation_id"], r["criterion_id"]): r for r in report["details"]}
        self.assertEqual(details[("p1-en-015", "06")]["difference_kind"], "adjacent_scale")
        self.assertEqual(details[("p1-kz-005", "06")]["difference_kind"], "large_scale")
        self.assertEqual(details[("p1-ru-025", "04")]["difference_kind"], "na_applicability")
        self.assertEqual(details[("p1-en-015", "06")]["scale_absolute_error"], 3)





class BaselineTests(unittest.TestCase):
    setUp = ComparisonTests.setUp
    def test_before_after_keeps_actual_answers_and_explanations(self):
        baseline = comparison.compare(self.labels, self.predictions, self.source)
        self.predictions["p1-ru-001"]["results"][0]["answer"] = False
        current = comparison.compare(self.labels, self.predictions, self.source)
        rows = comparison.baseline_comparison(current, baseline)
        changed = [r for r in rows if r["before"] != r["after"]]
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0]["before"], "Да")
        self.assertEqual(changed[0]["after"], "Нет")
        self.assertIn("after_explanation", changed[0])


if __name__ == "__main__":
    unittest.main()
