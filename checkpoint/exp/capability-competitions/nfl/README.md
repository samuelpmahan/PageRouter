# NFL WR cut-recovery feasibility runner

This bounded experiment tests whether a Combine tracking cut-recovery ratio adds predictive value to rookie receiver separation beyond cushion and conventional Combine tests. It compares two fixed Ridge models on drafted rookie regular-season plays: train on draft years 2023–24 and hold out 2025. It retains play rows through fitting, keeps every play from one player in that player's cohort, and gives each player equal total fitting weight. Evaluation arrays retain every eligible play; MAE averages absolute errors within each player and then weights players equally. RMSE is `sqrt(mean_players(mean_plays(error²)))`, also giving each player equal weight.

The runner uses only the five competition CSVs: `players.csv`, `combine_results.csv`, `combine_tracking.csv`, `player_play.csv`, and `games.csv`. See the required columns in `run.py`. Players without a valid measurement for the selected drill are counted and excluded from both model comparisons so the baseline and candidate use the same players. Missing optional Combine test values are imputed using training-fold medians with missingness indicators. Null or duplicate join keys block the run. A missing required file, an absent requested drill, or no eligible attempt produces a blocked report; there is no implicit synthetic fallback.

## Run with competition data

Choose an exact `drill_name` that is present in the tracking file and one exact route-family label present in `route_ran`:

```sh
python run.py --data-dir /path/to/csvs --drill "<actual drill name>" \
  --route-family "<route label>" --output report.json
```

The measurement selects the first sustained heading change of at least 45 degrees, requires the next heading sample to stay within 20 degrees, and uses three consecutive 10 Hz speed samples immediately before and after the cut. The entry median speed must be at least 2 yards per second; any negative reported speed rejects the attempt. Numeric-second fixtures and official ISO8601 timestamps are supported; source timestamp labels are preserved in the report. Missing, duplicated, gapped, irregular, or insufficient frames reject the attempt. The output records the attempt ID, cut sample ordinal/time, measured turn angle, exact pre/post sample ordinals and time bounds, speeds, ratio, ±1-frame segmentation sensitivity, and attempt-level variation. Where x/y positions are available, it reports a displacement-derived speed consistency diagnostic, explicitly marked as same-source tracking and not independent validation. These are speed-recovery measurements only; they make no reaction-time claim.

The play slice is limited to rookie regular seasons, WR player records and WR alignments, the chosen route, man coverage (`MAN` or `MAN_COVERAGE`), pass results `C`, `I`, or `IN`, no nullifying penalty, and non-null separation and cushion. Unknown alignment and coverage labels are reported. This target describes separation at pass on the filtered completed/incomplete pass slice; it is not a complete measure of receiver ability or causal contribution.

## Plumbing fixture and tests

Run the labeled deterministic synthetic fixture explicitly:

```sh
python run.py --fixture --drill "fixture drill" --route-family OUT --output fixture-report.json
python -m unittest -v test_run.py
```

The fixture checks wiring only. It is not competition evidence and must not be used to claim empirical model improvement; it reports `status: inconclusive` even when the synthetic pipeline executes. A report contains the stable `capability-competition-report.v1` schema, input/configuration/split hashes, software versions, audit counts, bounded trajectory previews, play-level predictions with player group IDs, equal-player MAE/RMSE, and a paired player bootstrap interval for candidate-minus-baseline absolute error. An inconclusive status on competition data means too few players remain after filtering for a minimal fit/evaluation.
