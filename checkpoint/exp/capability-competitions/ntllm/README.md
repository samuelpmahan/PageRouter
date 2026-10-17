# Name That LLM experiment

This folder contains a standalone, CPU-only Python runner for the approved Name That LLM capability competition. It consumes the official `train.csv` when supplied and emits a `capability-competition-report.v1` JSON file suitable for CapabilityLab.

```sh
python3 checkpoint/exp/capability-competitions/ntllm/run.py \
  --train /path/to/train.csv \
  --output /path/to/name-that-llm-report.json
```

For plumbing checks without official data, run the explicit deterministic synthetic fixture:

```sh
python3 checkpoint/exp/capability-competitions/ntllm/run.py \
  --fixture \
  --output /tmp/name-that-llm-fixture.json
```

The fixture is synthetic, contains only 18 fixed labels across seven prompt groups, and always reports `inconclusive`; its scores are not competition results. If the official file is absent, malformed, missing labels, or lacks enough independent prompt groups for the frozen holdout and three grouped folds, the runner writes a structured `blocked` report and exits with code 2.

The experiment audits IDs/nulls/labels, unions prompt groups linked by normalized exact duplicate text, then applies a label-blind near-duplicate rule using unique word 5-shingle Jaccard similarity of at least 0.95, requiring at least 20 unique shingles. It freezes a seeded approximately 20% component holdout and fits all text features within scikit-learn pipelines on training rows. The audit has a 5,000-row limit and 750,000 candidate-pair limit; exceeding either blocks the run instead of silently skipping pairs. The baseline uses word and character TF-IDF plus a compact style block; the predeclared candidate adds function-word transitions and discourse-marker rates. A two-feature length-only control and within-prompt shuffled-label null are also reported. The report includes heldout predictions, per-class recall, confusion matrices, candidate-minus-baseline balanced-accuracy delta, a paired prompt-group bootstrap interval, paired baseline/candidate grouped development fold scores, provenance hashes, and library versions. Bootstrap draws that omit any of the 18 classes are rejected; if 500 complete-class draws cannot be obtained within the attempt budget, uncertainty is reported as unavailable and the metric gate fails. It contains no full source text and no leaderboard calls.

This is an initial capacity slice. Its `status` remains `inconclusive` and `promotionEligible` remains false until the reported metric and development consistency checks are supplemented by clean-null review and formatting, self-identification, provider-family, and length stress checks. A favorable score is not a research efficacy claim.

Run the local contract and leakage tests with:

```sh
python3 -m unittest discover -s checkpoint/exp/capability-competitions/ntllm -p 'test_*.py' -v
```
