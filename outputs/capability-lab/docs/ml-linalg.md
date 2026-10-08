# PCA, clustering, and classification

These browser-safe ES modules fit reusable JSON models from finite numeric rows. A *feature* is one input column, such as a measured rate or temperature. Fitting means learning model parameters from training rows; later prediction uses those stored parameters and does not refit them. The workbench owns grouped holdout splitting and, when enabled, standardization fitted on training rows only.

## Principal component analysis

`fitPCA({features, components?, tolerance?, maxIterations?})` returns a `kind: 'pca'` model with the training `means`, component `directions`, selected `eigenvalues`, `explainedVarianceRatio`, component count, sample count, and `converged: true`. `transformPCA({model, features})` returns `{projected}`. It subtracts the means retained during fitting, then takes each row's dot product with each direction. A holdout row cannot change those means.

PCA first centers each training column, then forms the sample covariance matrix: each entry is the average product of two centered columns using denominator `n - 1`. An *eigenvalue* reports variance along an *eigenvector*, the matching direction in feature space. Directions are retained as rows, ordered from greatest to least eigenvalue. The largest-magnitude coordinate of each direction is made positive; this removes arbitrary sign flips, while equal eigenvalues can still make a direction within a tied subspace non-unique. `explainedVarianceRatio` divides selected eigenvalues by total variance over every feature, even when only some components are returned. If total variance is zero, every selected ratio is zero.

PCA uses the supplied numeric scales. A feature measured in large units can dominate one measured in small units, so standardize only when that is appropriate for the task. The workbench fits its standardizer on training rows, retains that model, and applies it unchanged to holdout and later prediction rows. PCA itself never learns from those later rows.

PCA requires 2–256 training rows, 1–32 features, and at most 8,192 feature values. `tolerance` is in `[0, 1)` and defaults to `1e-12`; `maxIterations` is an integer from 1 through 100,000 and defaults to `min(100000, max(1, 50 × featureCount²))`. A nonconverged Jacobi eigensolve is rejected rather than returned as a fitted model. Inputs and imported models are checked for finite values, dimensions, unit and mutually orthogonal directions, descending eigenvalues, and consistent variance-ratio bounds. Floating-point covariance and eigensolver calculations have finite precision; nearly repeated eigenvalues can change their order or basis under small perturbations.

The `ml.fitPCA` descriptor calls `composed.covarianceMatrix`, `statistics.mean`, `linalg.symmetricEigen`, and `linalg.transpose`; the covariance descriptor in turn calls the statistics covariance primitive. `ml.transformPCA` calls `linalg.vectorSubtract` and `linalg.dot`. `fitPCAWithTrace(input, call?)` returns the same model as `{model, trace}` with grouped source IDs, stages, counts, and compact output summaries. Its JSON-safe trace is capped at 4,096 bytes and does not retain feature rows or eigenvector matrices.

## K-means clustering

`fitKMeans({features, k, seed, maxIterations?, tolerance?})` returns a `kind: 'kmeans'` model containing `centroids`, training `assignments`, `inertia`, iteration and convergence state, the seed, and the full configuration. A *centroid* is the coordinate-wise mean of the rows assigned to one cluster. `predictKMeans({model, features})` returns the nearest-centroid `assignments`, Euclidean `distances`, and their squared Euclidean distances. The cluster number is only a stable identifier; it is not a meaningful class name. *Inertia* is the sum of squared distances from training rows to their assigned centroids.

Initialization is seeded k-means++: it chooses one row, then chooses each next center with probability proportional to the squared distance from that row to its nearest chosen center. When all those distances are zero, it takes the first row not yet selected. Repeated assignment and centroid-mean updates stop when the largest centroid movement is no greater than the absolute Euclidean `tolerance`. Exact distance ties choose the lowest cluster index. Empty clusters retain their previous center. If the iteration limit is reached first, the model returns `converged: false` with the last centers and assignments; prediction remains defined, but the fit is not described as converged. A different seed can produce a different local solution.

K-means requires 2–500 rows, 1–32 features, at most 8,192 feature values, `k` from 1 through `min(16, sampleCount)`, and an unsigned 32-bit seed. `maxIterations` is 1–100 and defaults to 100. `tolerance` is finite and nonnegative and defaults to `1e-6`. Before fitting, the trainer estimates the configured worst-case dependency calls as `3 × [n(k−1) + nkT + nk + kT] + kdT`, where `n` is row count, `d` is feature count, `k` is cluster count, and `T` is the iteration limit. Estimates over 20,000 are rejected before work starts. Here the factor of three accounts for a `linalg.distance` call and its `vectorSubtract` and `norm` children; the final term bounds coordinate means. Nonfinite inputs, distance overflow, squared-distance overflow, or nonfinite inertia are rejected. The data and model are not mutated.

The `ml.fitKMeans` descriptor makes actual `linalg.distance` and `statistics.mean` calls. The distance capability itself composes vector subtraction and Euclidean norm. `ml.predictKMeans` also uses the stored centroids through `linalg.distance`, with at most 8,000 distance evaluations under the input caps. `fitKMeansWithTrace(input, call?)` returns `{model, trace}`. Its JSON-safe trace is capped at 32,768 bytes and groups real distance and mean calls by stage and iteration, with counts and output ranges; a separate bounded iteration summary records maximum centroid movement and empty-cluster count. It omits rows and individual distance lists.

## Classification

Binary logistic regression maps a feature row to a *logit* (a raw score), applies a sigmoid to obtain a probability, then compares that probability with a threshold to choose class 0 or 1. The sigmoid is `1 / (1 + exp(-score))`; the implementation uses sign-specific branches to avoid exponent overflow. `fitLogisticRegression({features, targets, fitIntercept?, learningRate?, maxIterations?, tolerance?, l2?, threshold?})` returns a fitted model; `predictLogisticRegression({model, features})` returns `{scores, probabilities, labels}` and accepts no targets. `fitLogisticRegressionWithTrace(...)` returns `{model, trace}` with initial/final calculation summaries.

Training uses deterministic, zero-initialized full-batch gradient descent on mean binary cross-entropy. *Full-batch* means each update uses every training row. A *gradient* is a vector of how quickly the loss changes as each coefficient changes; each update moves coefficients opposite that vector. Optional L2 regularization adds `l2 / 2 × sum(coefficient²)` to the objective but does not penalize the intercept. This discourages large coefficients; it does not establish that a feature causes the label. The model reports optimizer settings and whether the gradient met the requested tolerance. Reaching the iteration limit is reported as nonconvergence. See [the classifier rationale](../evidence/ml-linalg/classification-rationale.md) for exact optimizer bounds, trace details, and literal probability fixtures.

## Reproduction

Run the focused suites from the project root with the pinned Node binary:

```sh
/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node --test test/ml/pca.test.mjs test/ml/clustering.test.mjs
```

The fit APIs, literal fixtures, and actual green test output are preserved in `evidence/ml-linalg/pca-*` and `evidence/ml-linalg/clustering-*`.
