#!/usr/bin/env python3
"""CPU-only, leakage-aware Name That LLM experiment runner."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
import scipy
import sklearn
from scipy import sparse
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import confusion_matrix, recall_score
from sklearn.model_selection import GroupShuffleSplit, StratifiedGroupKFold
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import FunctionTransformer
from sklearn.svm import LinearSVC


LABELS = [
    "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra",
    "gemini-3.1-pro-preview", "gemini-3.6-flash", "gemini-3.7-flash", "gemini-3.8-flash",
    "claude-fable-5", "claude-opus-4-6", "claude-opus-4-8", "claude-opus-5",
    "claude-sonnet-5", "qwen3.8-max", "glm-5.3", "glm-5.3-flash", "kimi-k3",
]
SCHEMA = "capability-competition-report.v1"
EXPERIMENT = "name-that-llm"
SEED = 20261016
BOOTSTRAP_REPLICATES = 500
BOOTSTRAP_MAX_ATTEMPTS = 100_000
REQUIRED_COLUMNS = ("id", "prompt_id", "text", "model")
NEAR_DUPLICATE_JACCARD = 0.95
NEAR_DUPLICATE_SHINGLE_SIZE = 5
NEAR_DUPLICATE_MIN_SHINGLES = 20
MAX_SOURCE_ROWS = 5000
MAX_NEAR_DUPLICATE_CANDIDATE_PAIRS = 750_000
FUNCTION_WORDS = (
    "a", "an", "the", "and", "or", "but", "if", "so", "because", "as", "of", "at", "by",
    "for", "from", "in", "into", "on", "onto", "to", "with", "without", "about", "after",
    "before", "between", "through", "under", "over", "i", "we", "you", "they", "it", "he",
    "she", "this", "that", "these", "those", "is", "am", "are", "was", "were", "be", "been",
    "being", "do", "does", "did", "have", "has", "had", "will", "would", "can", "could", "may",
    "might", "must", "should", "not", "no", "yes", "there", "here", "what", "which", "who",
    "when", "where", "why", "how", "all", "any", "each", "some", "such", "than", "then",
)
DISCOURSE_MARKERS = (
    "however", "therefore", "moreover", "furthermore", "nevertheless", "additionally", "first",
    "second", "finally", "for example", "for instance", "in conclusion", "in summary", "on the other hand",
)
TOKEN_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?|\d+|[^\w\s]", re.UNICODE)


class ExperimentBlocked(Exception):
    pass


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _json_hash(value: Any) -> str:
    packed = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return _digest(packed)


def _normalized_text(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).casefold().split())


class DisjointSet:
    def __init__(self, values: Iterable[str]):
        self.parent = {value: value for value in values}

    def find(self, value: str) -> str:
        parent = self.parent[value]
        if parent != value:
            self.parent[value] = self.find(parent)
        return self.parent[value]

    def union(self, left: str, right: str) -> None:
        root_left, root_right = self.find(left), self.find(right)
        if root_left != root_right:
            low, high = sorted((root_left, root_right))
            self.parent[high] = low


def connected_prompt_groups(rows: list[dict[str, str]]) -> list[str]:
    """Union prompt IDs linked by exact or conservative near-duplicate text."""
    return _connected_prompt_groups(rows)[0]


def _connected_prompt_groups(rows: list[dict[str, str]]) -> tuple[list[str], dict[str, int]]:
    """Build label-blind components, with bounded word-shingle near-duplicate matching."""
    if len(rows) > MAX_SOURCE_ROWS:
        raise ExperimentBlocked(f"training data exceeds bounded near-duplicate audit row budget ({MAX_SOURCE_ROWS})")
    prompt_ids = [row["prompt_id"] for row in rows]
    if len(set(prompt_ids)) != len(prompt_ids):
        # IDs can repeat across models; the DSU only needs each prompt once.
        prompt_ids = list(dict.fromkeys(prompt_ids))
    dsu = DisjointSet(prompt_ids)
    first_prompt_for_text: dict[str, str] = {}
    normalized_texts = [_normalized_text(row["text"]) for row in rows]
    exact_connections = 0
    for row, normalized in zip(rows, normalized_texts):
        previous = first_prompt_for_text.get(normalized)
        if previous is None:
            first_prompt_for_text[normalized] = row["prompt_id"]
        else:
            if dsu.find(previous) != dsu.find(row["prompt_id"]):
                exact_connections += 1
            dsu.union(previous, row["prompt_id"])

    shingle_sets = []
    postings: dict[tuple[str, ...], list[int]] = defaultdict(list)
    for index, normalized in enumerate(normalized_texts):
        tokens = re.findall(r"\b\w+\b", normalized, flags=re.UNICODE)
        shingles = {
            tuple(tokens[offset:offset + NEAR_DUPLICATE_SHINGLE_SIZE])
            for offset in range(max(0, len(tokens) - NEAR_DUPLICATE_SHINGLE_SIZE + 1))
        }
        shingle_sets.append(shingles)
        if len(shingles) >= NEAR_DUPLICATE_MIN_SHINGLES:
            for shingle in shingles:
                postings[shingle].append(index)
    shared_counts: dict[int, int] = {}
    for indices in postings.values():
        for left_offset, left in enumerate(indices):
            for right in indices[left_offset + 1:]:
                if rows[left]["prompt_id"] == rows[right]["prompt_id"]:
                    continue
                pair_key = left * len(rows) + right
                if pair_key not in shared_counts:
                    if len(shared_counts) >= MAX_NEAR_DUPLICATE_CANDIDATE_PAIRS:
                        raise ExperimentBlocked(
                            "near-duplicate audit exceeded bounded candidate-pair budget "
                            f"({MAX_NEAR_DUPLICATE_CANDIDATE_PAIRS}); no result was emitted"
                        )
                    shared_counts[pair_key] = 1
                else:
                    shared_counts[pair_key] += 1

    near_connections = 0
    for pair_key, intersection in shared_counts.items():
        left, right = divmod(pair_key, len(rows))
        left_shingles, right_shingles = shingle_sets[left], shingle_sets[right]
        if min(len(left_shingles), len(right_shingles)) < NEAR_DUPLICATE_MIN_SHINGLES:
            continue
        union_size = len(left_shingles) + len(right_shingles) - intersection
        if not union_size or intersection / union_size < NEAR_DUPLICATE_JACCARD:
            continue
        left_prompt, right_prompt = rows[left]["prompt_id"], rows[right]["prompt_id"]
        if dsu.find(left_prompt) != dsu.find(right_prompt):
            near_connections += 1
        dsu.union(left_prompt, right_prompt)

    components: dict[str, list[str]] = defaultdict(list)
    for prompt_id in prompt_ids:
        components[dsu.find(prompt_id)].append(prompt_id)
    names = {
        root: "grp-" + _digest("\n".join(sorted(members)).encode("utf-8"))[:16]
        for root, members in components.items()
    }
    group_ids = [names[dsu.find(row["prompt_id"])] for row in rows]
    return group_ids, {"exactDuplicateConnections": exact_connections, "nearDuplicateConnections": near_connections}


def _validate_frame(frame: pd.DataFrame) -> list[dict[str, str]]:
    missing = [column for column in REQUIRED_COLUMNS if column not in frame.columns]
    if missing:
        raise ExperimentBlocked(f"train.csv is missing required columns: {', '.join(missing)}")
    selected = frame.loc[:, REQUIRED_COLUMNS]
    null_counts = {column: int(selected[column].isna().sum()) for column in REQUIRED_COLUMNS}
    if any(null_counts.values()):
        offenders = ", ".join(f"{column}={count}" for column, count in null_counts.items() if count)
        raise ExperimentBlocked(f"train.csv contains null required values ({offenders})")
    rows = []
    for record in selected.to_dict(orient="records"):
        row = {column: str(record[column]) for column in REQUIRED_COLUMNS}
        if not all(value.strip() for value in row.values()):
            raise ExperimentBlocked("train.csv contains a blank required value")
        rows.append(row)
    ids = [row["id"] for row in rows]
    duplicates = sorted(value for value, count in Counter(ids).items() if count > 1)
    if duplicates:
        raise ExperimentBlocked(f"train.csv contains duplicate id values (count={len(duplicates)})")
    unknown = sorted(set(row["model"] for row in rows) - set(LABELS))
    if unknown:
        raise ExperimentBlocked("train.csv contains unsupported model labels: " + ", ".join(unknown))
    absent = sorted(set(LABELS) - set(row["model"] for row in rows))
    if absent:
        raise ExperimentBlocked("train.csv lacks required model labels: " + ", ".join(absent))
    return rows


def _style_features(texts: Iterable[str]) -> sparse.csr_matrix:
    values = []
    for text in texts:
        tokens = TOKEN_RE.findall(text)
        words = [token.casefold() for token in tokens if any(char.isalpha() for char in token)]
        chars = max(len(text), 1)
        word_count = max(len(words), 1)
        sentences = len(re.findall(r"[.!?]+", text))
        punctuation = sum(not char.isalnum() and not char.isspace() for char in text)
        uppercase = sum(char.isupper() for char in text)
        digits = sum(char.isdigit() for char in text)
        lines = text.count("\n") + 1
        values.append([
            math.log1p(len(text)), math.log1p(len(words)), math.log1p(sentences),
            punctuation / chars, uppercase / chars, digits / chars, lines / chars,
            len(set(words)) / word_count,
        ])
    return sparse.csr_matrix(np.asarray(values, dtype=np.float64))


def _length_features(texts: Iterable[str]) -> sparse.csr_matrix:
    return sparse.csr_matrix(np.asarray([
        [math.log1p(len(text)), math.log1p(len(re.findall(r"\b\w+\b", text)))]
        for text in texts
    ], dtype=np.float64))


def _transition_features(texts: Iterable[str]) -> sparse.csr_matrix:
    word_index = {word: index for index, word in enumerate(FUNCTION_WORDS)}
    pair_index = len(FUNCTION_WORDS)
    marker_index = pair_index + len(FUNCTION_WORDS) ** 2
    output = []
    for text in texts:
        tokens = [token.casefold() for token in TOKEN_RE.findall(text)]
        words = [token for token in tokens if token in word_index]
        counts: Counter[int] = Counter()
        for word in words:
            counts[word_index[word]] += 1
        for left, right in zip(tokens, tokens[1:]):
            if left in word_index and right in word_index:
                counts[pair_index + word_index[left] * len(FUNCTION_WORDS) + word_index[right]] += 1
        lowered = text.casefold()
        for index, marker in enumerate(DISCOURSE_MARKERS):
            marker_count = len(re.findall(r"(?<!\w)" + re.escape(marker) + r"(?!\w)", lowered))
            if marker_count:
                counts[marker_index + index] += marker_count
        denominator = max(len(tokens), 1)
        output.append({index: count / denominator for index, count in counts.items()})
    rows, columns, data = [], [], []
    for row_index, features in enumerate(output):
        for column_index, value in features.items():
            rows.append(row_index)
            columns.append(column_index)
            data.append(value)
    return sparse.csr_matrix((data, (rows, columns)), shape=(len(output), marker_index + len(DISCOURSE_MARKERS)))


def _feature_union(candidate: bool) -> FeatureUnion:
    blocks = [
        ("word_tfidf", TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=35000, sublinear_tf=True)),
        ("char_tfidf", TfidfVectorizer(analyzer="char", ngram_range=(3, 5), min_df=2, max_features=60000, sublinear_tf=True)),
        ("style", FunctionTransformer(_style_features, validate=False, accept_sparse=True)),
    ]
    if candidate:
        blocks.append(("function_transition", FunctionTransformer(_transition_features, validate=False, accept_sparse=True)))
    return FeatureUnion(blocks, n_jobs=1)


def _pipeline(candidate: bool = False) -> Pipeline:
    return Pipeline([
        ("features", _feature_union(candidate)),
        ("classifier", LinearSVC(C=1.0, random_state=SEED, dual="auto", max_iter=10000, tol=1e-3)),
    ])


def _length_pipeline() -> Pipeline:
    return Pipeline([
        ("length", FunctionTransformer(_length_features, validate=False, accept_sparse=True)),
        ("classifier", LinearSVC(C=1.0, random_state=SEED, dual="auto", max_iter=10000, tol=1e-3)),
    ])


def _balanced_accuracy(actual: list[str], predicted: list[str]) -> float:
    present_labels = [label for label in LABELS if label in set(actual)]
    return float(np.mean(recall_score(actual, predicted, labels=present_labels, average=None, zero_division=0)))


def _choose_split(y: np.ndarray, groups: np.ndarray) -> tuple[np.ndarray, np.ndarray, int]:
    support_by_label = {
        label: len(set(groups[y == label])) for label in LABELS
    }
    weak = {label: count for label, count in support_by_label.items() if count < 4}
    if weak:
        detail = ", ".join(f"{label}={count}" for label, count in weak.items())
        raise ExperimentBlocked("insufficient independent prompt groups per class; need at least 4 (" + detail + ")")
    best = None
    for seed in range(SEED, SEED + 512):
        splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=seed)
        train_idx, heldout_idx = next(splitter.split(np.zeros(len(y)), y, groups))
        if set(y[train_idx]) != set(LABELS) or set(y[heldout_idx]) != set(LABELS):
            continue
        dev_support = {label: len(set(groups[train_idx][y[train_idx] == label])) for label in LABELS}
        if min(dev_support.values()) < 3:
            continue
        row_ratio_error = sum(abs(float(np.sum(y[heldout_idx] == label)) / float(np.sum(y == label)) - 0.2) for label in LABELS)
        size_error = abs(len(heldout_idx) / len(y) - 0.2)
        score = row_ratio_error + size_error
        if best is None or score < best[0]:
            best = (score, train_idx, heldout_idx, seed)
    if best is None:
        raise ExperimentBlocked("could not freeze a prompt-group holdout containing all 18 classes and 3 development groups per class")
    return best[1], best[2], best[3]


def _development_folds(texts: list[str], y: np.ndarray, groups: np.ndarray) -> tuple[list[dict[str, Any]], int]:
    for seed in range(SEED, SEED + 512):
        splitter = StratifiedGroupKFold(n_splits=3, shuffle=True, random_state=seed)
        splits = list(splitter.split(texts, y, groups))
        if all(set(y[test_idx]) == set(LABELS) and set(y[train_idx]) == set(LABELS) for train_idx, test_idx in splits):
            scores = []
            for fold, (train_idx, test_idx) in enumerate(splits, start=1):
                fold_text_train = [texts[i] for i in train_idx]
                fold_text_test = [texts[i] for i in test_idx]
                fold_models = {"baseline": _pipeline(candidate=False), "candidate": _pipeline(candidate=True)}
                fold_scores = {}
                for name, model in fold_models.items():
                    model.fit(fold_text_train, y[train_idx])
                    predicted = model.predict(fold_text_test)
                    fold_scores[name] = _balanced_accuracy(y[test_idx].tolist(), predicted.tolist())
                scores.append({
                    "fold": fold,
                    "baselineBalancedAccuracy": fold_scores["baseline"],
                    "candidateBalancedAccuracy": fold_scores["candidate"],
                    "candidateMinusBaseline": fold_scores["candidate"] - fold_scores["baseline"],
                    "testRows": int(len(test_idx)),
                })
            return scores, seed
    raise ExperimentBlocked("three grouped development folds could not include every class; increase independent prompt-group support")


def _group_bootstrap(actual: np.ndarray, base: np.ndarray, candidate: np.ndarray, groups: np.ndarray) -> dict[str, Any]:
    unique_groups = np.asarray(sorted(set(groups)))
    group_rows = {group: np.flatnonzero(groups == group) for group in unique_groups}
    rng = np.random.default_rng(SEED + 17)
    deltas = []
    attempts = 0
    while len(deltas) < BOOTSTRAP_REPLICATES and attempts < BOOTSTRAP_MAX_ATTEMPTS:
        attempts += 1
        sample = rng.choice(unique_groups, size=len(unique_groups), replace=True)
        indices = np.concatenate([group_rows[group] for group in sample])
        if set(actual[indices]) != set(LABELS):
            continue
        deltas.append(_balanced_accuracy(actual[indices].tolist(), candidate[indices].tolist()) - _balanced_accuracy(actual[indices].tolist(), base[indices].tolist()))
    if len(deltas) < BOOTSTRAP_REPLICATES:
        return {
            "requestedReplicates": BOOTSTRAP_REPLICATES,
            "availableReplicates": len(deltas),
            "attempts": attempts,
            "confidence": 0.95,
            "lower": None,
            "upper": None,
            "reason": "insufficient grouped support to obtain complete-18-class bootstrap draws",
        }
    lower, upper = np.percentile(deltas, [2.5, 97.5])
    return {"requestedReplicates": BOOTSTRAP_REPLICATES, "availableReplicates": len(deltas), "attempts": attempts, "confidence": 0.95, "lower": float(lower), "upper": float(upper)}


def _permuted_labels(y: np.ndarray, groups: np.ndarray) -> np.ndarray:
    rng = np.random.default_rng(SEED + 23)
    shuffled = y.copy()
    permutable = 0
    for group in sorted(set(groups)):
        indices = np.flatnonzero(groups == group)
        if len(set(y[indices])) > 1:
            shuffled[indices] = rng.permutation(y[indices])
            permutable += 1
    if permutable == 0 or np.array_equal(shuffled, y):
        raise ExperimentBlocked("within-prompt shuffled-label null is not identifiable: no prompt component has multiple model labels")
    return shuffled


def _confusion(actual: list[str], predicted: list[str]) -> list[list[int]]:
    return confusion_matrix(actual, predicted, labels=LABELS).astype(int).tolist()


def _evaluation_metrics(actual: list[str], predicted: list[str]) -> dict[str, Any]:
    recalls = recall_score(actual, predicted, labels=LABELS, average=None, zero_division=0)
    return {
        "balancedAccuracy": _balanced_accuracy(actual, predicted),
        "perClassRecall": {label: float(value) for label, value in zip(LABELS, recalls)},
        "confusionMatrix": _confusion(actual, predicted),
    }


def _synthetic_rows() -> list[dict[str, str]]:
    rows = []
    prompt_templates = [
        "Explain a practical way to compare two approaches.",
        "Write a short answer that helps a careful reader.",
        "Give a useful example and explain why it works.",
        "Summarize the key steps in a clear response.",
        "Describe one tradeoff and a reasonable next step.",
        "Answer directly, then add a brief explanation.",
        "Offer a concise suggestion with supporting detail.",
    ]
    for prompt_index, prompt in enumerate(prompt_templates):
        for label_index, label in enumerate(LABELS):
            marker = f"synthetic-marker-{label_index:02d}"
            style = "However, this example is concise." if label_index % 2 else "For example, the answer is structured clearly."
            text = f"{prompt} {style} {marker} We can explain it with a concrete detail and a helpful conclusion."
            rows.append({"id": f"synthetic-{prompt_index:02d}-{label_index:02d}", "prompt_id": f"synthetic-prompt-{prompt_index:02d}", "text": text, "model": label})
    return rows


def _blocked_report(source_kind: str, source_hash: str | None, reason: str) -> dict[str, Any]:
    return {
        "schema": SCHEMA,
        "experiment": EXPERIMENT,
        "sourceKind": source_kind,
        "status": "blocked",
        "provenance": {
            "sourceKind": source_kind,
            "sourceSha256": source_hash,
            "seed": SEED,
            "versions": {"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}", "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__, "scikitLearn": sklearn.__version__},
        },
        "details": {"reason": reason},
    }


def numeric_leaves(value: Any) -> list[float]:
    if isinstance(value, dict):
        return [number for child in value.values() for number in numeric_leaves(child)]
    if isinstance(value, list):
        return [number for child in value for number in numeric_leaves(child)]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return [float(value)]
    return []


def run_experiment(train_path: Path | None, fixture: bool = False) -> dict[str, Any]:
    source_kind = "synthetic-fixture" if fixture else "competition-csv"
    source_hash = None
    try:
        if fixture:
            rows = _synthetic_rows()
            source_hash = _json_hash(rows)
        else:
            if train_path is None or not train_path.is_file():
                raise ExperimentBlocked(f"training CSV not found: {train_path if train_path is not None else '<not supplied>'}")
            raw_bytes = train_path.read_bytes()
            source_hash = _digest(raw_bytes)
            try:
                frame = pd.read_csv(train_path, dtype=str, keep_default_na=True)
            except Exception as error:
                raise ExperimentBlocked(f"could not parse training CSV: {type(error).__name__}: {error}") from error
            rows = _validate_frame(frame)
        if not rows:
            raise ExperimentBlocked("training data is empty")
        if fixture:
            # Fixture has the same schema and class audit as official input.
            rows = _validate_frame(pd.DataFrame(rows))
        group_values, duplicate_audit = _connected_prompt_groups(rows)
        groups = np.asarray(group_values, dtype=object)
        y = np.asarray([row["model"] for row in rows], dtype=object)
        texts = [row["text"] for row in rows]
        train_idx, heldout_idx, split_seed = _choose_split(y, groups)
        dev_scores, fold_seed = _development_folds([texts[i] for i in train_idx], y[train_idx], groups[train_idx])

        baseline = _pipeline(candidate=False)
        candidate = _pipeline(candidate=True)
        length_control = _length_pipeline()
        baseline.fit([texts[i] for i in train_idx], y[train_idx])
        candidate.fit([texts[i] for i in train_idx], y[train_idx])
        length_control.fit([texts[i] for i in train_idx], y[train_idx])
        heldout_texts = [texts[i] for i in heldout_idx]
        actual = y[heldout_idx]
        baseline_pred = baseline.predict(heldout_texts)
        candidate_pred = candidate.predict(heldout_texts)
        length_pred = length_control.predict(heldout_texts)

        shuffled_y = _permuted_labels(y[train_idx], groups[train_idx])
        null_model = _pipeline(candidate=True)
        null_model.fit([texts[i] for i in train_idx], shuffled_y)
        null_pred = null_model.predict(heldout_texts)
        baseline_metrics = _evaluation_metrics(actual.tolist(), baseline_pred.tolist())
        candidate_metrics = _evaluation_metrics(actual.tolist(), candidate_pred.tolist())
        length_metrics = _evaluation_metrics(actual.tolist(), length_pred.tolist())
        null_metrics = _evaluation_metrics(actual.tolist(), null_pred.tolist())
        delta = candidate_metrics["balancedAccuracy"] - baseline_metrics["balancedAccuracy"]
        interval = _group_bootstrap(actual, baseline_pred, candidate_pred, groups[heldout_idx])
        dev_fold_deltas = [fold["candidateMinusBaseline"] for fold in dev_scores]
        dev_positive_folds = sum(value > 0 for value in dev_fold_deltas)
        dev_consistency = dev_positive_folds >= 2
        gate_met = delta >= 0.03 and interval["lower"] is not None and interval["lower"] > 0
        capacity_signal = gate_met and dev_consistency
        pending_checks = ["clean-null-review", "formatting-stress", "self-identification-stress", "provider-family-stress", "length-stress"]
        promotion_eligible = False
        status = "inconclusive"

        split_receipt = {
            "seed": split_seed,
            "heldoutFractionTarget": 0.2,
            "trainGroupIds": sorted(set(groups[train_idx])),
            "heldoutGroupIds": sorted(set(groups[heldout_idx])),
            "developmentFoldSeed": fold_seed,
        }
        config = {
            "seed": SEED,
            "learner": "LinearSVC(C=1.0)",
            "baselineFeatures": ["word-tfidf-1-2", "char-tfidf-3-5", "style"],
            "candidateAdditionalFeatures": "function-word-transitions-and-discourse-marker-rates",
            "devFolds": 3,
            "bootstrapReplicates": BOOTSTRAP_REPLICATES,
            "bootstrapMaxAttempts": BOOTSTRAP_MAX_ATTEMPTS,
            "bootstrapRequiresAllLabels": True,
            "splitProtocol": "connected-prompt-components; seeded approximately 20% frozen holdout",
            "nearDuplicateRule": {"tokenShingleSize": NEAR_DUPLICATE_SHINGLE_SIZE, "minimumUniqueShingles": NEAR_DUPLICATE_MIN_SHINGLES, "jaccardThreshold": NEAR_DUPLICATE_JACCARD, "maxRows": MAX_SOURCE_ROWS, "maxCandidatePairs": MAX_NEAR_DUPLICATE_CANDIDATE_PAIRS},
        }
        report = {
            "schema": SCHEMA,
            "experiment": EXPERIMENT,
            "sourceKind": source_kind,
            "status": status,
            "provenance": {
                "sourceKind": source_kind,
                "sourceSha256": source_hash,
                "configSha256": _json_hash(config),
                "splitSha256": _json_hash(split_receipt),
                "seed": SEED,
                "versions": {"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}", "numpy": np.__version__, "pandas": pd.__version__, "scipy": scipy.__version__, "scikitLearn": sklearn.__version__},
            },
            "evaluation": {
                "labels": LABELS,
                "actual": actual.tolist(),
                "baselinePredicted": baseline_pred.tolist(),
                "candidatePredicted": candidate_pred.tolist(),
                "groupIds": groups[heldout_idx].tolist(),
            },
            "details": {
                "config": config,
                "split": {"trainRows": int(len(train_idx)), "heldoutRows": int(len(heldout_idx)), "trainGroups": len(set(groups[train_idx])), "heldoutGroups": len(set(groups[heldout_idx])), "freezeReceiptSha256": _json_hash(split_receipt)},
                "dataAudit": {"rows": len(rows), "promptIds": len(set(row["prompt_id"] for row in rows)), "connectedPromptComponents": len(set(groups)), "duplicateIds": 0, "nullValues": 0, "exactDuplicateConnections": duplicate_audit["exactDuplicateConnections"], "nearDuplicateConnections": duplicate_audit["nearDuplicateConnections"], "modelCounts": {label: int(np.sum(y == label)) for label in LABELS}},
                "developmentCandidateFolds": dev_scores,
                "developmentConsistency": {"positiveFolds": int(dev_positive_folds), "folds": len(dev_fold_deltas), "requiredPositiveFolds": 2, "met": bool(dev_consistency), "candidateMinusBaselineByFold": dev_fold_deltas},
                "heldout": {"baseline": baseline_metrics, "candidate": candidate_metrics, "lengthOnlyControl": length_metrics, "withinPromptShuffledLabelNull": null_metrics, "candidateMinusBaselineBalancedAccuracy": float(delta), "pairedGroupBootstrap95PercentileInterval": interval},
                "leakageAudit": {"exactDuplicateNormalization": "NFKC, casefold, whitespace collapse", "nearDuplicateRule": "label-blind unique word 5-shingle Jaccard >= 0.95; minimum 20 unique shingles", "candidatePairBudget": MAX_NEAR_DUPLICATE_CANDIDATE_PAIRS, "status": "completed"},
                "provisionalCapacityGate": {"requiredDelta": 0.03, "requiredIntervalLowerAbove": 0.0, "metricCriteriaMet": bool(gate_met), "developmentConsistencyMet": bool(dev_consistency), "capacitySignalMet": bool(capacity_signal), "promotionEligible": bool(promotion_eligible), "pendingChecks": pending_checks, "interpretation": "synthetic plumbing only; gate is not a research claim" if fixture else ("metric and development criteria pass; required stress/null checks remain pending" if capacity_signal else "inconclusive; predeclared metric/development criteria not met")},
                "splitReceipt": split_receipt,
            },
        }
        return report
    except ExperimentBlocked as error:
        return _blocked_report(source_kind, source_hash, str(error))
    except Exception as error:
        # Fail closed while keeping the machine-readable report consumable.
        return _blocked_report(source_kind, source_hash, f"experiment failed safely: {type(error).__name__}: {error}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--train", type=Path, help="official train.csv path")
    source.add_argument("--fixture", action="store_true", help="run the small deterministic synthetic plumbing fixture")
    parser.add_argument("--output", type=Path, required=True, help="write a capability-competition-report.v1 JSON report")
    args = parser.parse_args(argv)
    report = run_experiment(args.train, fixture=args.fixture)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "output": str(args.output), "reason": report.get("details", {}).get("reason")}, ensure_ascii=False))
    return 0 if report["status"] in {"completed", "inconclusive"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
