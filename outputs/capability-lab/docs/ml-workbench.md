# Machine-learning workbench

The ML wrapper is [src/ml/index.mjs](../src/ml/index.mjs). It fits a grouped experiment, retains the raw input and fitted parameters, predicts new rows with the same preprocessing, evaluates supplied outcomes, and can replay the complete saved experiment.

## Input and split

`runMLExperiment({ dataset, algorithm, featureNames?, targetName?, groupBy?, testFraction?, seed?, standardize?, modelConfig? })` accepts a dataset shaped like:

```js
{
  schema: 'ml-dataset.v1',
  sourceKind: 'declared-source-label',
  featureNames: ['earlyObservedRate'],
  targetName: 'futureClockErrorSeconds',
  records: [
    { runId: 'run-a', conditionId: 'condition-a', features: [4.1], target: 0.75 }
  ]
}
```

`sourceKind` is a caller-provided label. The wrapper stores a content fingerprint to detect accidental changes, but the fingerprint is a non-cryptographic FNV-1a checksum and does not authenticate who produced the data.

The default split is 80% training and 20% holdout groups with seed `0`. A group is kept intact: records linked by `runId`, `conditionId`, or the selected `groupBy` field stay on one side. `split` retains both record lists, their source indexes, group identifiers, the seed, and the realized fraction. Repeated samples from one run or condition therefore do not appear on both sides.

Feature columns are selected by name. With no `featureNames`, every declared feature is requested, so a name recognized as an ID, label, target, future value, hidden value, or configured fault fails closed. The guard catches known names, not arbitrary semantic leakage disguised as an ordinary name. The target is read only by supervised fit/evaluation functions and never becomes a feature implicitly.

When `standardize` is true (the default), the wrapper fits each column’s mean and population standard deviation on training rows only. A constant training column gets scale `1` and transforms to zero. The saved `preprocessing` model is applied unchanged to holdout rows and future predictions.

## Algorithms

`linearRegression` uses QR-based least squares and stores an intercept and one coefficient per selected feature. The `training.calculationTrace` contains the real `ml.fitLinearRegression` → `linalg.leastSquares` capability tree. It reports fit rank, residuals, and residual norm. The mean baseline is fit only from training targets.

`logisticRegression` accepts binary targets `0` and `1`. It stores the coefficients, intercept, probability threshold, learning configuration, loss, iteration count, and convergence flag. Its bounded training trace records actual initial and final score, loss, and gradient calculations, with counts for omitted middle iterations. A `converged: false` model remains visibly marked; the wrapper does not describe it as converged.

`kMeans` fits seeded centers, retains assignments, centroids, inertia, and the distance/tie/empty-cluster policies. The training trace summarizes actual distance and mean calls by stage. Cluster numbers are fit-specific labels; they do not carry class meaning.

`pca` fits the sample covariance and retained training means, then stores the leading eigen-directions and explained-variance ratios. It rejects an unconverged eigensystem. The trace identifies the actual covariance, mean, and eigen operations. Future rows are projected with the saved training means and directions; their values never refit those parameters.

For linear regression, logistic regression, k-means, and PCA, `experiment.model` is the fitted model. `training.prediction` and `holdout.prediction` use each algorithm’s native result shape:

- regression: `{ predictions }`
- logistic regression: `{ scores, probabilities, labels }`
- k-means: `{ assignments, distances, squaredDistances }`
- PCA: `{ projected }`

Supervised `metrics` use regression errors or a classification confusion matrix and macro scores. Unsupervised metrics are `null`; k-means still exposes heldout distances and PCA exposes heldout projections. Regression and classification include a constant baseline whose parameter comes from training data. Synthetic watch regression also includes the analytic rate baseline.

## Watch calibration example

`buildWatchCalibrationDataset({ conditions?, earlySeconds?, horizonSeconds?, seed? })` constructs rows by calling the real watch transport. Its `sourceKind` is `synthetic-watch`. Each feature is an early observed mechanical rate calculated from retained beat counts and powered operating time. The target is later displayed time minus the logical horizon. Raw early and horizon counts/times remain in each record’s `observations` field.

Configured mechanical rates are retained only in provenance, not in the feature vector. They define a simulated teaching fault, not a measurement of a physical watch. The analytical baseline computes `(earlyObservedMechanicalHz / nominalMechanicalHz - 1) * horizonSeconds`. Since the watch displays discrete counts, the observed target may differ by a step-sized remainder. The analytical baseline can outperform the fitted regression; that is a useful comparison, not a failed experiment.

## Prediction, evaluation, replay, and limits

`predictMLModel({ experiment, records })` accepts new rows with the original feature schema and does not require or read target labels. It returns the algorithm’s native prediction object. `evaluateMLExperiment({ experiment, records })` applies the retained model and preprocessing, then compares predictions with supplied targets; it also returns the evaluated records, metrics, baseline comparisons, and a bounded call ledger. Neither function refits a model, scaler, mean baseline, or majority baseline.

`replayMLExperiment({ experiment })` rebuilds the run from the retained dataset and normalized configuration. It returns both canonical states, a `matches` flag, and mismatch paths. The comparison covers the full model, preprocessing, split, raw holdout records, predictions, metrics, baselines, and trace. A matching replay demonstrates deterministic reconstruction with the current code; it does not authenticate the original data source.

Application bounds are 10,000 rows, 100 features, 60,000 feature values, a 4 MiB input dataset, an 8 MiB retained experiment, and a main wrapper ledger capped at 64 calls and 16 KiB. PCA, logistic training, k-means, the capability runtime, and watch transport also enforce their own narrower limits. These are application-level limits, not a guarantee about total browser process memory.

## Terms

- A **feature** is a measured or declared input column used to make a prediction.
- **Training** is the data used to fit model parameters.
- A **holdout** is a whole set of groups withheld from fitting and used to check predictions.
- A **residual** is actual value minus predicted value.
- A **baseline** is a simple reference predictor, such as the training mean.
- The logistic **sigmoid** maps a score to a value between zero and one; that value is interpreted as a model probability.
- A PCA **principal direction** is a unit vector along a direction of variance in the training data.
