"""Contract tests for the standalone Name That LLM experiment."""

import json
import math
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import run  # noqa: E402


class ExperimentTests(unittest.TestCase):
    def test_duplicate_texts_union_prompt_groups(self):
        rows = [
            {"id": "a", "prompt_id": "p1", "text": "  HELLO\n world ", "model": run.LABELS[0]},
            {"id": "b", "prompt_id": "p2", "text": "hello world", "model": run.LABELS[1]},
            {"id": "c", "prompt_id": "p3", "text": "different", "model": run.LABELS[0]},
        ]
        group_ids = run.connected_prompt_groups(rows)
        self.assertEqual(group_ids[0], group_ids[1])
        self.assertNotEqual(group_ids[0], group_ids[2])

    def test_near_duplicate_one_token_copy_merges_but_unrelated_text_does_not(self):
        tokens = [f"token{index}" for index in range(300)]
        original = " ".join(tokens)
        edited = tokens.copy()
        edited[150] = "replacementtoken"
        rows = [
            {"id": "near-a", "prompt_id": "near-p1", "text": original, "model": run.LABELS[0]},
            {"id": "near-b", "prompt_id": "near-p2", "text": " ".join(edited), "model": run.LABELS[1]},
            {"id": "other", "prompt_id": "other-p", "text": " ".join(f"other{index}" for index in range(300)), "model": run.LABELS[2]},
        ]
        groups = run.connected_prompt_groups(rows)
        self.assertEqual(groups[0], groups[1])
        self.assertNotEqual(groups[0], groups[2])

    def test_duplicate_components_cannot_cross_frozen_prompt_split(self):
        rows = run._synthetic_rows()
        rows[1]["text"] = "  " + rows[0]["text"].upper() + "  "
        groups = run.connected_prompt_groups(rows)
        self.assertEqual(groups[0], groups[1])
        y = __import__("numpy").asarray([row["model"] for row in rows], dtype=object)
        group_array = __import__("numpy").asarray(groups, dtype=object)
        train, heldout, _ = run._choose_split(y, group_array)
        self.assertFalse(set(group_array[train]) & set(group_array[heldout]))
        self.assertIn(groups[0], set(group_array[train]) | set(group_array[heldout]))

    def test_tfidf_vocabulary_is_fitted_only_on_training_text(self):
        train = ["shared training phrase", "another shared phrase"]
        heldout_only = "heldoutsecretword"
        vectorizer = run._feature_union(candidate=False)
        vectorizer.fit(train)
        word_vectorizer = dict(vectorizer.transformer_list)["word_tfidf"]
        self.assertNotIn(heldout_only, word_vectorizer.vocabulary_)
        fitted_vocabulary = dict(word_vectorizer.vocabulary_)
        vectorizer.transform([heldout_only])
        self.assertEqual(word_vectorizer.vocabulary_, fitted_vocabulary)

    def test_fixture_report_has_contract_and_is_deterministic(self):
        first = run.run_experiment(None, fixture=True)
        second = run.run_experiment(None, fixture=True)
        self.assertEqual(first, second)
        self.assertEqual(first["schema"], "capability-competition-report.v1")
        self.assertEqual(first["experiment"], "name-that-llm")
        self.assertEqual(first["sourceKind"], "synthetic-fixture")
        self.assertEqual(first["provenance"]["sourceKind"], "synthetic-fixture")
        self.assertIn(first["status"], {"completed", "inconclusive"})
        evaluation = first["evaluation"]
        self.assertEqual(evaluation["labels"], run.LABELS)
        self.assertEqual(len(evaluation["actual"]), len(evaluation["baselinePredicted"]))
        self.assertEqual(len(evaluation["actual"]), len(evaluation["candidatePredicted"]))
        self.assertEqual(len(evaluation["actual"]), len(evaluation["groupIds"]))
        self.assertTrue(all(label in run.LABELS for label in evaluation["actual"]))
        self.assertTrue(all(math.isfinite(value) for value in run.numeric_leaves(first)))
        self.assertNotIn("rawText", json.dumps(first))
        self.assertFalse(first["details"]["provisionalCapacityGate"]["promotionEligible"])
        self.assertEqual(first["status"], "inconclusive")
        self.assertEqual(first["details"]["provisionalCapacityGate"]["pendingChecks"], [
            "clean-null-review", "formatting-stress", "self-identification-stress", "provider-family-stress", "length-stress"
        ])
        interval = first["details"]["heldout"]["pairedGroupBootstrap95PercentileInterval"]
        self.assertEqual(interval["availableReplicates"], 500)
        self.assertTrue(math.isfinite(interval["lower"]))
        self.assertEqual(first["details"]["leakageAudit"]["status"], "completed")

    def test_invalid_csv_returns_structured_blocked_report_and_nonzero(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "bad.csv"
            output = Path(directory) / "report.json"
            source.write_text("id,prompt_id,text,model\n1,p,hello,unknown-model\n")
            process = subprocess.run(
                [sys.executable, str(HERE / "run.py"), "--train", str(source), "--output", str(output)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(process.returncode, 0)
            report = json.loads(output.read_text())
            self.assertEqual(report["status"], "blocked")
            self.assertIn("reason", report["details"])
            self.assertNotIn("evaluation", report)

    def test_missing_source_is_blocked_and_does_not_fabricate_results(self):
        report = run.run_experiment(Path("/definitely/missing/train.csv"), fixture=False)
        self.assertEqual(report["status"], "blocked")
        self.assertIn("reason", report["details"])
        self.assertNotIn("evaluation", report)


if __name__ == "__main__":
    unittest.main()
