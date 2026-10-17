#!/usr/bin/env python3
"""Bounded WR cut-recovery feasibility runner for NFL Big Data Bowl CSVs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import numbers
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import scipy
import sklearn
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


SCHEMA = "capability-competition-report.v1"
EXPERIMENT = "nfl-wr-cut-recovery"
CONFIG = {
    "sample_rate_hz": 10,
    "minimum_cut_angle_degrees": 45.0,
    "entry_speed_min_yards_per_second": 2.0,
    "post_cut_heading_tolerance_degrees": 20.0,
    "speed_window_frames_each_side": 3,
    "cut_transition_span_frames": 1,
    "robustness_cut_shifts_frames": [-1, 0, 1],
    "ridge_alpha": 1.0,
    "cohorts": {"train": [2023, 2024], "holdout": [2025]},
    "random_seed": 731,
}

REQUIRED = {
    "players.csv": {"nfl_id", "nfl_position", "draft_year"},
    "combine_results.csv": {"nfl_id", "draft_year", "forty", "ten_yd_split", "short_shuttle", "three_cone"},
    "combine_tracking.csv": {"nfl_id", "event_id", "draft_year", "entity_type", "drill_type", "drill_name", "attempt", "time", "x", "y", "s", "dir"},
    "player_play.csv": {"nfl_id", "game_id", "play_id", "lined_up_position", "route_ran", "team_coverage_man_zone", "cushion", "pass_result", "play_nullified_by_penalty", "separation_at_pass_forward"},
    "games.csv": {"game_id", "season", "season_type"},
}
TEST_COLUMNS = ["forty", "ten_yd_split", "short_shuttle", "three_cone"]
FEATURES = ["cushion", *TEST_COLUMNS]
WR_ALIGNMENT_LABELS = {"WR", "X", "Z", "SLOT", "SL", "WIDE", "FLANKER"}
MAN_LABELS = {"MAN", "MAN_COVERAGE"}
KNOWN_ALIGNMENTS = WR_ALIGNMENT_LABELS | {"RB", "TE", "FB", "OL", "QB", "HB", "UNKNOWN", "NAN", ""}
KNOWN_COVERAGES = MAN_LABELS | {"ZONE", "ZONE_COVERAGE", "MIXED", "UNKNOWN", "NAN", ""}


class ConfigurationError(ValueError):
    """Input data cannot support the requested bounded measurement."""


def _wrapped_angle(a: float, b: float) -> float:
    return abs((float(a) - float(b) + 180.0) % 360.0 - 180.0)


def _window_ratio(speeds: np.ndarray, cut_index: int) -> tuple[float, list[int], list[int], float, float]:
    width = CONFIG["speed_window_frames_each_side"]
    pre = list(range(cut_index - width, cut_index))
    post = list(range(cut_index + 1, cut_index + width + 1))
    if min(pre, default=0) < 0 or max(post, default=0) >= len(speeds):
        raise ConfigurationError("insufficient pre/post windows")
    entry = float(np.median(speeds[pre]))
    recovery = float(np.median(speeds[post]))
    if not math.isfinite(entry) or not math.isfinite(recovery):
        raise ConfigurationError("non-finite speed window")
    if entry <= 0.0:
        raise ConfigurationError("zero or negative entry-speed denominator")
    if entry < CONFIG["entry_speed_min_yards_per_second"]:
        raise ConfigurationError("entry speed below configured minimum")
    return recovery / entry, pre, post, entry, recovery


def detect_cut_recovery(rows: pd.DataFrame, nfl_id: str, event_id: str, attempt: int) -> dict:
    """Measure first eligible sustained heading cut and return auditable sample ordinals."""
    if rows.empty:
        raise ConfigurationError("no trajectory frames")
    data = rows.copy()
    data["time_label"] = data["time"].astype(str)
    numeric_time = pd.to_numeric(data["time"], errors="coerce")
    if numeric_time.notna().all():
        data["time_seconds"] = numeric_time.astype(float)
    else:
        parsed = pd.to_datetime(data["time"], errors="coerce", utc=True)
        if parsed.isna().any():
            raise ConfigurationError("missing or unparseable trajectory timestamps")
        data["time_seconds"] = parsed.astype("int64").astype(float) / 1e9
    data = data.sort_values("time_seconds", kind="stable").reset_index(drop=True)
    for column in ("s", "dir"):
        data[column] = pd.to_numeric(data[column], errors="coerce")
    if data[["time_seconds", "s", "dir"]].isna().any().any() or not np.isfinite(data[["time_seconds", "s", "dir"]].to_numpy()).all():
        raise ConfigurationError("missing or non-finite trajectory samples")
    times = data["time_seconds"].to_numpy(dtype=float)
    labels = data["time_label"].to_list()
    speeds = data["s"].to_numpy(dtype=float)
    directions = data["dir"].to_numpy(dtype=float) % 360.0
    if np.any(speeds < 0.0):
        raise ConfigurationError("negative reported speed sample")
    if len(np.unique(times)) != len(times):
        raise ConfigurationError("duplicate frames (duplicate timestamps)")
    if len(times) > 1 and not np.allclose(np.diff(times), 1.0 / CONFIG["sample_rate_hz"], atol=1e-6, rtol=0.0):
        raise ConfigurationError("gapped or irregular 10 Hz frames")

    # The heading must turn across the center sample and remain on the new
    # heading for the next sample. The first qualifying cut is the attempt's
    # single measured event; no reaction-time interpretation is made.
    rejected_candidate: ConfigurationError | None = None
    for cut in range(1, len(data) - CONFIG["speed_window_frames_each_side"]):
        heading_change = _wrapped_angle(directions[cut - 1], directions[cut])
        if heading_change < CONFIG["minimum_cut_angle_degrees"]:
            continue
        if _wrapped_angle(directions[cut], directions[cut + 1]) > CONFIG["post_cut_heading_tolerance_degrees"]:
            continue
        try:
            ratio, pre, post, entry, recovery = _window_ratio(speeds, cut)
        except ConfigurationError as exc:
            rejected_candidate = exc
            continue
        variants = []
        for shift in CONFIG["robustness_cut_shifts_frames"]:
            try:
                variants.append(_window_ratio(speeds, cut + shift)[0])
            except ConfigurationError:
                continue
        position_diagnostic = {"status": "unverified; x/y unavailable", "independent_validation": False}
        if {"x", "y"}.issubset(data.columns):
            xy = data[["x", "y"]].apply(pd.to_numeric, errors="coerce").to_numpy(dtype=float)
            finite_pair = np.isfinite(xy[:-1]).all(axis=1) & np.isfinite(xy[1:]).all(axis=1)
            if finite_pair.any():
                displacement_speed = np.linalg.norm(np.diff(xy, axis=0)[finite_pair], axis=1) / np.diff(times)[finite_pair]
                reported_speed = ((speeds[:-1] + speeds[1:]) / 2.0)[finite_pair]
                absolute_difference = np.abs(displacement_speed - reported_speed)
                relative_difference = absolute_difference / np.maximum(reported_speed, 1e-12)
                position_diagnostic = {
                    "status": "diagnostic only; same-source tracking, not independent validation",
                    "independent_validation": False,
                    "finite_adjacent_pairs": int(finite_pair.sum()),
                    "median_absolute_speed_difference_yards_per_second": float(np.median(absolute_difference)),
                    "median_relative_speed_difference": float(np.median(relative_difference)),
                }
        return {
            "nfl_id": str(nfl_id), "event_id": str(event_id), "attempt": int(attempt),
            "cut_frame_index": int(cut), "cut_time": labels[cut],
            "turn_angle_degrees": float(heading_change),
            "pre_frame_indices": pre, "post_frame_indices": post,
            "pre_time_interval": [labels[pre[0]], labels[pre[-1]]],
            "post_time_interval": [labels[post[0]], labels[post[-1]]],
            "entry_median_speed": entry, "post_median_speed": recovery, "ratio": float(ratio),
            "robustness_cut_shifts_frames": CONFIG["robustness_cut_shifts_frames"],
            "robustness_ratios": [float(v) for v in variants],
            "robustness_ratio_range": [float(min(variants)), float(max(variants))],
            "position_speed_consistency": position_diagnostic,
        }
    if rejected_candidate is not None:
        raise rejected_candidate
    raise ConfigurationError("no sustained cut meeting configured angle and heading criteria")


def validate_unique(frame: pd.DataFrame, keys: list[str], name: str) -> None:
    duplicate = frame.duplicated(keys, keep=False)
    if duplicate.any():
        sample = frame.loc[duplicate, keys].head(3).to_dict("records")
        raise ConfigurationError(f"duplicate {name} join keys {keys}: {sample}")


def _canonical_identifier(value, name: str, table: str) -> str:
    if pd.isna(value):
        raise ConfigurationError(f"null {name} join key in {table}")
    if isinstance(value, numbers.Integral):
        return str(int(value))
    if isinstance(value, numbers.Real):
        number = float(value)
        if not math.isfinite(number):
            raise ConfigurationError(f"non-finite {name} join key in {table}")
        if number.is_integer():
            return str(int(number))
    label = str(value).strip()
    if label.endswith(".0"):
        try:
            numeric = float(label)
            if math.isfinite(numeric) and numeric.is_integer():
                return str(int(numeric))
        except ValueError:
            pass
    return label


def _normalize_key_column(frame: pd.DataFrame, column: str, table: str) -> pd.DataFrame:
    frame[column] = frame[column].map(lambda value: _canonical_identifier(value, column, table))
    return frame


def _require_non_null(frame: pd.DataFrame, columns: list[str], table: str) -> None:
    for column in columns:
        if frame[column].isna().any():
            raise ConfigurationError(f"null {column} join key in {table}")


def split_by_cohort(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Keep drafted rookies in their draft-year regular season; 2025 is held out."""
    train = frame[frame["draft_year"].isin(CONFIG["cohorts"]["train"]) & (frame["season"] == frame["draft_year"])].copy()
    holdout = frame[frame["draft_year"].isin(CONFIG["cohorts"]["holdout"]) & (frame["season"] == frame["draft_year"])].copy()
    return train, holdout


def _measurement_frame(tracking: pd.DataFrame, drill: str, audit: dict) -> pd.DataFrame:
    entity = tracking["entity_type"].astype(str).str.strip().str.upper()
    selected = tracking[(entity == "PLAYER") & (tracking["drill_name"].astype(str) == drill)].copy()
    audit["selected_player_drill_tracking_rows"] = int(len(selected))
    _require_non_null(selected, ["nfl_id", "event_id", "draft_year", "attempt"], "selected combine_tracking")
    found: list[dict] = []
    rejection: dict[str, int] = {}
    keys = ["nfl_id", "event_id", "draft_year", "attempt"]
    for key, rows in selected.groupby(keys, sort=True, dropna=False):
        try:
            result = detect_cut_recovery(rows, nfl_id=key[0], event_id=key[1], attempt=key[3])
            result["draft_year"] = int(key[2])
            found.append(result)
        except ConfigurationError as exc:
            reason = str(exc).split(":")[0]
            rejection[reason] = rejection.get(reason, 0) + 1
    audit["attempts_measured"] = len(found)
    audit["attempt_rejections"] = rejection
    if not found:
        raise ConfigurationError("no eligible attempt measurements for the requested actual drill")
    measurements = pd.DataFrame(found)
    # Keep all valid attempts; the player-level median is the comparable feature.
    player_ratio = measurements.groupby(["nfl_id", "draft_year"], as_index=False).agg(
        cut_recovery_ratio=("ratio", "median"),
        attempt_count=("ratio", "size"),
        repeated_attempt_ratio_min=("ratio", "min"),
        repeated_attempt_ratio_max=("ratio", "max"),
    )
    audit["player_attempts_measured"] = int(player_ratio["nfl_id"].nunique())
    audit["trajectory_measurement_preview"] = measurements.head(50).to_dict("records")
    return player_ratio


def _read_inputs(data_dir: Path) -> tuple[dict[str, pd.DataFrame], dict[str, str]]:
    frames: dict[str, pd.DataFrame] = {}
    hashes: dict[str, str] = {}
    for name, required in REQUIRED.items():
        path = data_dir / name
        if not path.is_file():
            raise ConfigurationError(f"required input missing: {path}")
        raw = path.read_bytes()
        hashes[name] = hashlib.sha256(raw).hexdigest()
        try:
            frame = pd.read_csv(path)
        except Exception as exc:
            raise ConfigurationError(f"could not read {name}: {exc}") from exc
        missing = required - set(frame.columns)
        if missing:
            raise ConfigurationError(f"{name} missing required columns: {sorted(missing)}")
        frames[name] = frame
    return frames, hashes


def _fixture_inputs() -> dict[str, pd.DataFrame]:
    """Deterministic plumbing fixture, explicitly synthetic and not empirical."""
    rng = np.random.default_rng(CONFIG["random_seed"])
    players, combines, tracks, plays, games = [], [], [], [], []
    for year in (2023, 2024, 2025):
        game_id = year * 10
        games.append({"game_id": game_id, "season": year, "season_type": "REG"})
        for idx in range(10):
            pid = year * 100 + idx
            talent = (idx - 4.5) / 4
            players.append({"nfl_id": pid, "nfl_position": "WR", "draft_year": year})
            combines.append({"nfl_id": pid, "draft_year": year,
                             "forty": 4.55 - 0.06 * talent + rng.normal(0, .02),
                             "ten_yd_split": 1.58 - .025 * talent,
                             "short_shuttle": 4.2 - .04 * talent,
                             "three_cone": 7.05 - .06 * talent})
            dirs = [0, 0, 0, 0, 0, 55, 55, 55, 55, 55, 55]
            base = 7.2 + .5 * talent
            speeds = [base] * 5 + [base * (.65 + .2 * (talent + 1) / 2)] * 6
            for frame, (speed, direction) in enumerate(zip(speeds, dirs)):
                tracks.append({"nfl_id": pid, "event_id": f"{pid}-event", "draft_year": year,
                               "entity_type": "PLAYER", "drill_type": "COMBINE", "drill_name": "fixture drill",
                               "attempt": 1, "time": frame / 10, "x": frame * .7, "y": 0,
                               "s": speed, "dir": direction})
            # Four separate plays preserve within-player grouping and yield a stable player target.
            for play_no in range(4):
                plays.append({"nfl_id": pid, "game_id": game_id, "play_id": idx * 10 + play_no,
                              "lined_up_position": "WR", "route_ran": "OUT", "team_coverage_man_zone": "MAN",
                              "cushion": 5.0 + .1 * play_no + rng.normal(0, .1),
                              "pass_result": "C" if play_no % 2 == 0 else "I",
                              "play_nullified_by_penalty": "N",
                              "separation_at_pass_forward": 1.8 + .55 * talent + rng.normal(0, .12)})
    return {"players.csv": pd.DataFrame(players), "combine_results.csv": pd.DataFrame(combines),
            "combine_tracking.csv": pd.DataFrame(tracks), "player_play.csv": pd.DataFrame(plays),
            "games.csv": pd.DataFrame(games)}


def _fixture_hashes(frames: dict[str, pd.DataFrame]) -> dict[str, str]:
    return {name: hashlib.sha256(frame.to_csv(index=False, lineterminator="\n").encode()).hexdigest()
            for name, frame in frames.items()}


def _build_rows(frames: dict[str, pd.DataFrame], drill: str, route_family: str, audit: dict) -> pd.DataFrame:
    players = frames["players.csv"].copy()
    combine = frames["combine_results.csv"].copy()
    tracking = frames["combine_tracking.csv"].copy()
    plays = frames["player_play.csv"].copy()
    games = frames["games.csv"].copy()
    players = _normalize_key_column(players, "nfl_id", "players")
    combine = _normalize_key_column(combine, "nfl_id", "combine_results")
    plays = _normalize_key_column(plays, "nfl_id", "player_play")
    plays = _normalize_key_column(plays, "game_id", "player_play")
    plays = _normalize_key_column(plays, "play_id", "player_play")
    games = _normalize_key_column(games, "game_id", "games")
    _require_non_null(players, ["draft_year"], "players")
    _require_non_null(combine, ["draft_year"], "combine_results")
    selected_tracking = tracking[
        tracking["entity_type"].astype(str).str.strip().str.upper().eq("PLAYER") &
        tracking["drill_name"].astype(str).eq(drill)
    ].copy()
    selected_tracking = _normalize_key_column(selected_tracking, "nfl_id", "selected combine_tracking")
    selected_tracking = _normalize_key_column(selected_tracking, "event_id", "selected combine_tracking")
    validate_unique(players, ["nfl_id", "draft_year"], "players")
    validate_unique(combine, ["nfl_id", "draft_year"], "combine_results")
    validate_unique(games, ["game_id"], "games")
    validate_unique(plays, ["nfl_id", "game_id", "play_id"], "player_play")

    player_pos = players["nfl_position"].astype(str).str.upper().str.strip()
    audit["non_wr_players_excluded"] = int((player_pos != "WR").sum())
    wr = players[player_pos == "WR"].copy()
    selected_players = set(wr["nfl_id"].astype(str))
    selected_tracking = selected_tracking[selected_tracking["nfl_id"].isin(selected_players)]
    ratios = _measurement_frame(selected_tracking, drill, audit)

    alignment = plays["lined_up_position"].fillna("").astype(str).str.upper().str.strip()
    coverage = plays["team_coverage_man_zone"].fillna("").astype(str).str.upper().str.strip()
    audit["unknown_alignment_labels"] = sorted(set(alignment) - KNOWN_ALIGNMENTS)
    audit["unknown_coverage_labels"] = sorted(set(coverage) - KNOWN_COVERAGES)
    outcome = plays["pass_result"].astype(str).str.upper().isin({"C", "I", "IN"})
    penalty = plays["play_nullified_by_penalty"].astype(str).str.upper().eq("N")
    filtered = plays[(alignment.isin(WR_ALIGNMENT_LABELS)) &
                     (plays["route_ran"].astype(str).str.casefold() == route_family.casefold()) &
                     (coverage.isin(MAN_LABELS)) & outcome & penalty].copy()
    filtered = filtered.merge(games[["game_id", "season", "season_type"]], on="game_id", how="left", validate="many_to_one")
    filtered = filtered.merge(wr[["nfl_id", "draft_year"]], on="nfl_id", how="inner", validate="many_to_one")
    filtered = filtered[filtered["season_type"].astype(str).str.upper().eq("REG")]
    for column in ["separation_at_pass_forward", "cushion"]:
        filtered[column] = pd.to_numeric(filtered[column], errors="coerce")
    filtered = filtered[filtered["separation_at_pass_forward"].notna() & filtered["cushion"].notna()].copy()
    filtered = filtered.merge(combine, on=["nfl_id", "draft_year"], how="left", validate="many_to_one")
    filtered = filtered.merge(ratios, on=["nfl_id", "draft_year"], how="left", validate="many_to_one")
    filtered["nfl_id"] = filtered["nfl_id"].astype(str)
    # Training/evaluation rows remain play-level until the split; every play for
    # a player follows the player's draft-year cohort as one group.
    audit["eligible_play_rows_before_cohort_split"] = int(len(filtered))
    audit["eligible_players_before_cohort_split"] = int(filtered["nfl_id"].nunique())
    audit["eligible_players_without_selected_drill_measurement"] = int(filtered.loc[filtered["cut_recovery_ratio"].isna(), "nfl_id"].nunique())
    # Both models are evaluated on the same players with an actual drill measure;
    # optional Combine tests remain eligible for train-only imputation.
    filtered = filtered[filtered["cut_recovery_ratio"].notna()].copy()
    audit["play_filter_counts"] = {
        "input": int(len(plays)), "route_alignment_man_result_penalty": int(len(plays[(alignment.isin(WR_ALIGNMENT_LABELS)) & (plays["route_ran"].astype(str).str.casefold() == route_family.casefold()) & coverage.isin(MAN_LABELS) & outcome & penalty])),
        "valid_target_and_cushion": int(len(filtered)),
    }
    return filtered


def _fit_predict(train: pd.DataFrame, holdout: pd.DataFrame, candidate: bool) -> np.ndarray:
    feature_columns = FEATURES + (["cut_recovery_ratio"] if candidate else [])
    X_train = train[feature_columns].apply(pd.to_numeric, errors="coerce")
    X_holdout = holdout[feature_columns].apply(pd.to_numeric, errors="coerce")
    y = pd.to_numeric(train["separation_at_pass_forward"], errors="coerce").to_numpy(dtype=float)
    counts = train.groupby("nfl_id")["nfl_id"].transform("count").to_numpy(dtype=float)
    weights = 1.0 / counts
    model = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(), Ridge(alpha=CONFIG["ridge_alpha"]))
    model.fit(X_train, y, ridge__sample_weight=weights)
    return model.predict(X_holdout)


def _player_errors(actual: np.ndarray, pred: np.ndarray, groups: list[str]) -> tuple[np.ndarray, np.ndarray]:
    rows = pd.DataFrame({"group": groups, "abs_error": np.abs(actual - pred), "sq_error": (actual - pred) ** 2})
    grouped = rows.groupby("group", sort=True).agg(abs_error=("abs_error", "mean"), sq_error=("sq_error", "mean"))
    return grouped["abs_error"].to_numpy(dtype=float), grouped["sq_error"].to_numpy(dtype=float)


def _bootstrap_ci(differences: np.ndarray) -> list[float]:
    rng = np.random.default_rng(CONFIG["random_seed"])
    if len(differences) < 2:
        value = float(differences.mean()) if len(differences) else 0.0
        return [value, value]
    draws = rng.choice(differences, size=(5000, len(differences)), replace=True).mean(axis=1)
    return [float(np.quantile(draws, .025)), float(np.quantile(draws, .975))]


def _metrics(actual: np.ndarray, pred: np.ndarray, groups: list[str]) -> dict:
    player_mae, player_mse = _player_errors(actual, pred, groups)
    return {"player_weighted_mae": float(player_mae.mean()), "player_weighted_rmse": float(np.sqrt(player_mse.mean()))}


def _report(frames: dict[str, pd.DataFrame], hashes: dict[str, str], source_kind: str,
            drill: str, route_family: str) -> dict:
    audit: dict = {"input_rows": {name: int(len(frame)) for name, frame in frames.items()}}
    rows = _build_rows(frames, drill, route_family, audit)
    train, holdout = split_by_cohort(rows)
    audit["cohort_rows"] = {"train": int(len(train)), "holdout": int(len(holdout))}
    audit["cohort_players"] = {"train": int(train.nfl_id.nunique()), "holdout": int(holdout.nfl_id.nunique())}
    if train.empty or holdout.empty or train.nfl_id.nunique() < 2 or holdout.nfl_id.nunique() < 2:
        return {"schema": SCHEMA, "experiment": EXPERIMENT, "sourceKind": source_kind, "status": "inconclusive",
                "provenance": _provenance(hashes, drill, route_family), "reason": "need at least two train and two holdout players after filters", "details": audit}
    train = train.copy()
    holdout = holdout.copy()
    baseline_pred = _fit_predict(train, holdout, candidate=False)
    candidate_pred = _fit_predict(train, holdout, candidate=True)
    actual = pd.to_numeric(holdout["separation_at_pass_forward"], errors="coerce").to_numpy(dtype=float)
    groups = holdout["nfl_id"].astype(str).tolist()
    baseline = baseline_pred.astype(float).tolist()
    candidate = candidate_pred.astype(float).tolist()
    baseline_errors, _ = _player_errors(actual, baseline_pred, groups)
    candidate_errors, _ = _player_errors(actual, candidate_pred, groups)
    delta = candidate_errors - baseline_errors
    details = {
        **audit,
        "route_family": route_family,
        "target": "separation_at_pass_forward on each eligible rookie regular-season play",
        "unit_of_analysis": "play-level arrays retain all plays; players stay within draft-year cohorts, and metrics average within-player errors equally",
        "baseline_features": FEATURES,
        "candidate_features": FEATURES + ["cut_recovery_ratio"],
        "optional_combine_test_missing_players_imputed": {column: int(rows[column].isna().groupby(rows["nfl_id"]).any().sum()) for column in TEST_COLUMNS},
        "fit": {"estimator": "Ridge", "alpha": CONFIG["ridge_alpha"], "imputation": "training median with missing indicators", "scaling": "training-fitted StandardScaler", "sample_weight": "inverse eligible play count per player"},
        "baseline_metrics": _metrics(actual, baseline_pred, groups),
        "candidate_metrics": _metrics(actual, candidate_pred, groups),
        "metric_aggregation": {"player_weighted_mae": "mean within-player mean absolute error",
                               "player_weighted_rmse": "sqrt(mean across players of within-player mean squared error)"},
        "paired_player_mae_difference_candidate_minus_baseline": float(delta.mean()),
        "paired_player_bootstrap_95pct_ci": _bootstrap_ci(delta),
        "bootstrap_resamples": 5000,
        "split_hash": hashlib.sha256(json.dumps({"train_ids": sorted(train.nfl_id.unique()), "holdout_ids": sorted(holdout.nfl_id.unique())}, sort_keys=True).encode()).hexdigest(),
    }
    return {"schema": SCHEMA, "experiment": EXPERIMENT, "sourceKind": source_kind, "status": "inconclusive" if source_kind == "synthetic-fixture" else "completed",
            "provenance": _provenance(hashes, drill, route_family),
            "evaluation": {"actual": [float(x) for x in actual], "baselinePredicted": baseline,
                           "candidatePredicted": candidate, "groupIds": groups},
            "details": details}


def _provenance(hashes: dict[str, str], drill: str, route_family: str) -> dict:
    return {"input_sha256": hashes, "configuration": {**CONFIG, "drill_name": drill, "route_family": route_family},
            "split_sha256": hashlib.sha256(json.dumps(CONFIG["cohorts"], sort_keys=True).encode()).hexdigest(),
            "library_versions": {"python": sys.version.split()[0], "numpy": np.__version__, "pandas": pd.__version__,
                                 "scikit_learn": sklearn.__version__, "scipy": scipy.__version__}}


def _finite_json(value):
    if isinstance(value, dict):
        return {str(k): _finite_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite_json(v) for v in value]
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if pd.isna(value) if not isinstance(value, (str, bool, int)) else False:
        return None
    return value


def run(data_dir: Path | None, drill: str, route_family: str, fixture: bool = False) -> dict:
    source_kind = "synthetic-fixture" if fixture else "competition-csv"
    hashes: dict[str, str] = {}
    try:
        if fixture:
            frames = _fixture_inputs()
            hashes = _fixture_hashes(frames)
        else:
            if data_dir is None:
                raise ConfigurationError("--data-dir is required unless --fixture is explicit")
            frames, hashes = _read_inputs(data_dir)
        return _finite_json(_report(frames, hashes, source_kind, drill, route_family))
    except ConfigurationError as exc:
        return {"schema": SCHEMA, "experiment": EXPERIMENT, "sourceKind": source_kind, "status": "blocked",
                "provenance": {"input_sha256": hashes, "configuration": {**CONFIG, "drill_name": drill, "route_family": route_family}},
                "reason": str(exc)}
    except (pd.errors.ParserError, pd.errors.MergeError, KeyError, TypeError, ValueError, np.linalg.LinAlgError) as exc:
        return {"schema": SCHEMA, "experiment": EXPERIMENT, "sourceKind": source_kind, "status": "blocked",
                "provenance": {"input_sha256": hashes, "configuration": {**CONFIG, "drill_name": drill, "route_family": route_family}},
                "reason": f"expected data/model failure ({type(exc).__name__}): {exc}"}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, help="directory containing the five official CSV inputs")
    parser.add_argument("--drill", help="exact drill_name as present in combine_tracking.csv")
    parser.add_argument("--route-family", help="one explicitly selected route_ran label")
    parser.add_argument("--output", type=Path, required=True, help="path for the JSON report")
    parser.add_argument("--fixture", action="store_true", help="run deterministic synthetic plumbing data")
    args = parser.parse_args(argv)
    drill = args.drill or ("fixture drill" if args.fixture else None)
    route_family = args.route_family or ("OUT" if args.fixture else None)
    if drill is None or route_family is None:
        parser.error("--drill and --route-family are required for competition CSVs")
    report = run(args.data_dir, drill, route_family, fixture=args.fixture)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(f"{report['status']}: {args.output}")
    return 0 if "evaluation" in report else 2


if __name__ == "__main__":
    raise SystemExit(main())
