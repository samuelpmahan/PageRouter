import unittest
from pathlib import Path
import tempfile

import numpy as np
import pandas as pd

from run import (
    ConfigurationError,
    detect_cut_recovery,
    run,
    validate_unique,
    split_by_cohort,
    _fixture_inputs,
    _read_inputs,
    _report,
    _build_rows,
    _metrics,
    ConfigurationError,
)


def track(speeds, dirs=None):
    dirs = dirs or [0.0] * len(speeds)
    return pd.DataFrame({
        "time": [i / 10 for i in range(len(speeds))],
        "x": [i * 0.7 for i in range(len(speeds))],
        "y": [0.0] * len(speeds),
        "s": speeds,
        "dir": dirs,
    })


class MeasurementTests(unittest.TestCase):
    def test_known_cut_returns_ratio_and_exact_window_ordinals(self):
        # A cut begins at ordinal 5; three speed samples on either side are used.
        directions = [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60]
        rows = track([8, 8, 8, 8, 8, 6, 6, 6, 6, 6, 6], directions)
        result = detect_cut_recovery(rows, nfl_id="p1", event_id="e1", attempt=1)
        self.assertEqual(result["ratio"], 0.75)
        self.assertEqual(result["cut_frame_index"], 5)
        self.assertEqual(result["pre_frame_indices"], [2, 3, 4])
        self.assertEqual(result["post_frame_indices"], [6, 7, 8])
        self.assertEqual(result["turn_angle_degrees"], 60.0)
        self.assertFalse(result["position_speed_consistency"]["independent_validation"])
        self.assertIn("same-source tracking", result["position_speed_consistency"]["status"])

    def test_final_feasible_cut_uses_last_three_post_frames(self):
        rows = track([8, 8, 8, 8, 8, 8, 8, 6, 6, 6, 6], [0, 0, 0, 0, 0, 0, 0, 60, 60, 60, 60])
        result = detect_cut_recovery(rows, nfl_id="p1", event_id="late", attempt=1)
        self.assertEqual(result["cut_frame_index"], 7)
        self.assertEqual(result["pre_frame_indices"], [4, 5, 6])
        self.assertEqual(result["post_frame_indices"], [8, 9, 10])
        self.assertEqual(result["ratio"], 0.75)

    def test_gap_and_zero_entry_speed_are_rejected(self):
        rows = track([8] * 11, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60])
        rows.loc[6, "time"] = 0.65
        with self.assertRaisesRegex(ConfigurationError, "gapped"):
            detect_cut_recovery(rows, nfl_id="p1", event_id="e1", attempt=1)

        rows = track([0] * 5 + [6] * 6, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60])
        with self.assertRaisesRegex(ConfigurationError, "zero"):
            detect_cut_recovery(rows, nfl_id="p1", event_id="e1", attempt=1)

    def test_iso8601_timestamps_preserve_official_labels(self):
        rows = track([8] * 5 + [6] * 6, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60])
        rows["time"] = [f"2024-02-01T12:00:0{i // 10}.{(i % 10) * 100:03d}Z" for i in range(len(rows))]
        result = detect_cut_recovery(rows, nfl_id="1", event_id="e1", attempt=1)
        self.assertEqual(result["cut_frame_index"], 5)
        self.assertEqual(result["cut_time"], rows.loc[5, "time"])
        self.assertEqual(result["pre_time_interval"][0], rows.loc[2, "time"])

    def test_entry_speed_minimum_is_enforced(self):
        rows = track([1.5] * 5 + [1.0] * 6, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60])
        with self.assertRaisesRegex(ConfigurationError, "below configured minimum"):
            detect_cut_recovery(rows, nfl_id="p1", event_id="e1", attempt=1)

    def test_negative_reported_speed_is_rejected(self):
        rows = track([8] * 5 + [-0.1] + [6] * 5, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60])
        with self.assertRaisesRegex(ConfigurationError, "negative reported speed"):
            detect_cut_recovery(rows, nfl_id="p1", event_id="e1", attempt=1)

    def test_duplicate_join_keys_are_rejected(self):
        frame = pd.DataFrame({"nfl_id": [1, 1], "game_id": [10, 10], "play_id": [3, 3]})
        with self.assertRaisesRegex(ConfigurationError, "duplicate"):
            validate_unique(frame, ["nfl_id", "game_id", "play_id"], "player_play")


class CohortTests(unittest.TestCase):
    def test_holdout_season_is_not_present_in_training(self):
        frame = pd.DataFrame({"draft_year": [2023, 2024, 2025], "season": [2023, 2024, 2025]})
        train, holdout = split_by_cohort(frame)
        self.assertEqual(set(train.draft_year), {2023, 2024})
        self.assertEqual(set(holdout.draft_year), {2025})

    def test_synthetic_fixture_is_explicitly_labeled_and_deterministic(self):
        first = run(None, "fixture drill", "OUT", fixture=True)
        second = run(None, "fixture drill", "OUT", fixture=True)
        self.assertEqual(first["schema"], "capability-competition-report.v1")
        self.assertEqual(first["sourceKind"], "synthetic-fixture")
        self.assertEqual(first["status"], "inconclusive")
        self.assertEqual(first["evaluation"], second["evaluation"])
        self.assertEqual(first["details"]["attempts_measured"], 30)
        self.assertEqual(len(first["evaluation"]["actual"]), 40)
        self.assertTrue(first["evaluation"]["groupIds"][0].startswith("2025"))

    def test_missing_real_data_blocks_without_fixture_fallback(self):
        report = run(Path("/tmp/nfl-runner-no-inputs"), "not present", "OUT")
        self.assertEqual(report["status"], "blocked")
        self.assertEqual(report["sourceKind"], "competition-csv")
        self.assertNotIn("evaluation", report)
        self.assertIn("required input missing", report["reason"])

    def test_csv_integer_and_float_identifier_forms_join_canonically(self):
        frames = _fixture_inputs()
        frames["combine_results.csv"]["nfl_id"] = frames["combine_results.csv"]["nfl_id"].astype(float)
        frames["combine_tracking.csv"]["nfl_id"] = frames["combine_tracking.csv"]["nfl_id"].astype(float)
        frames["player_play.csv"]["nfl_id"] = frames["player_play.csv"]["nfl_id"].astype(float)
        frames["player_play.csv"]["game_id"] = frames["player_play.csv"]["game_id"].astype(float)
        with tempfile.TemporaryDirectory() as temp_dir:
            for name, frame in frames.items():
                frame.to_csv(Path(temp_dir) / name, index=False)
            read_frames, hashes = _read_inputs(Path(temp_dir))
            report = _report(read_frames, hashes, "synthetic-fixture", "fixture drill", "OUT")
        self.assertEqual(report["status"], "inconclusive")
        self.assertEqual(report["sourceKind"], "synthetic-fixture")
        self.assertEqual(len(report["evaluation"]["actual"]), 40)

    def test_null_csv_player_identifier_blocks_instead_of_becoming_nan_key(self):
        frames = _fixture_inputs()
        frames["players.csv"].loc[0, "nfl_id"] = float("nan")
        with tempfile.TemporaryDirectory() as temp_dir:
            for name, frame in frames.items():
                frame.to_csv(Path(temp_dir) / name, index=False)
            read_frames, _ = _read_inputs(Path(temp_dir))
            with self.assertRaisesRegex(ConfigurationError, "null nfl_id join key"):
                _build_rows(read_frames, "fixture drill", "OUT", {})

    def test_player_weighted_metric_averages_play_losses_before_rmse(self):
        metric = _metrics(np.array([0.0, 0.0, 0.0]), np.array([0.0, 2.0, 2.0]), ["a", "b", "b"])
        self.assertEqual(metric["player_weighted_mae"], 1.0)
        self.assertAlmostEqual(metric["player_weighted_rmse"], 2 ** 0.5)


if __name__ == "__main__":
    unittest.main()
