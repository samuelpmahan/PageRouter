# Machine-learning implementation phase

Activate after root watch acceptance and immutable watch snapshot. Read LEARNING-CONTRACT.md and preserve all numerical/watch APIs and tests. Root has accepted watches and source snapshot exists; reuse the exact same workers, no extra agents.

## Ownership

Statistics team: src/ml/data.mjs, src/ml/regression.mjs, src/ml/watch-data.mjs; test/ml/data.test.mjs, regression.test.mjs, regression-independent.test.mjs, watch-data.test.mjs; docs/ml-statistics.md; evidence/ml-statistics/**. XHigh regression/observed watch dataset; Medium grouped splits, train-only preprocessing, metrics, independent regression/leakage fixtures. Publish consumer signatures first.

Linalg team: src/ml/classification.mjs, src/ml/clustering.mjs, src/ml/pca.mjs; matching test/ml/classification.test.mjs, clustering.test.mjs, pca.test.mjs, linalg-independent.test.mjs; docs/ml-linalg.md; evidence/ml-linalg/**. XHigh fitted PCA/k-means; Medium bounded logistic classification and independent cross-review. Both reuse tested primitives and publish model shapes early.

Workbench team: src/ml/index.mjs, ui/ml.mjs, test/ml/integration.test.mjs, scripts/verify-ml.mjs, docs/ml-workbench.md, evidence/ml-workbench/** plus existing owned app/html/styles integration. XHigh experiment integration/genuine traced descriptors/heldout evaluation; Medium full-width ML mode, fit/predict controls, charts and browser evidence. Root wildcard independently checks mathematical truth, grouping/leakage, model explanations later, and fresh ZIP reconstruction now.

## Interface and useful functionality

Publish object-argument functions and JSON models. Suggested stable APIs to agree across owners: fitLinearRegression({features,targets,fitIntercept?}), predictLinearRegression({model,features}); fitLogisticRegression/predictLogisticRegression with analogous inputs plus explicit bounded optimizer config; fitKMeans/predictKMeans; fitPCA/transformPCA; splitByGroup({records,groupBy,testFraction,seed}); fitStandardizer/transformStandardizer; regressionMetrics/classificationMetrics. Consumers must confirm exact signatures/model fields before landing. Separate capability descriptors may wrap different model schemas; do not add unsupported JSON-Schema unions.

The data contract includes sourceKind, featureNames, targetName when supervised, and records with runId, conditionId, features (finite numeric vector), target when applicable. Whole run/condition groups are the split unit. Preserve provenance and explicit feature selection; IDs, target/future fields and hidden configuration do not automatically become features. Known watch hidden-fault/target fields must be rejected if selected; test injection of these fields. Do not claim to detect arbitrary disguised semantic leakage.

Fit preprocessing on training records only; keep its means/scales and apply unchanged to holdout/prediction. Constant features need documented handling (e.g. scale1 plus marked constant column) rather than hidden division by zero. Holdout targets must not change learned parameters. Report degenerate conditions honestly.

Provide useful pure atoms for preprocessing, grouping, prediction, losses and metrics, then actual higher-order training/evaluation compositions. Linear regression uses tested QR/least-squares; logistic uses stable sigmoid and bounded gradient optimization; k-means uses seeded center selection, distances/means and explicit tie/convergence policy; PCA retains training means/directions and checks eigen convergence. Keep iteration/sample/trace budgets explicit. Do not relabel a complete trainer atomic to inflate counts; declare actual lower-level dependencies or retain honest calculation summaries with inspectable calls.

Compare heldout predictions to explicit analytical or constant baselines. For watch calibration, derive observations from actual watch APIs, not hidden-rate feature columns. Fine oscillator counters can be an observable in the teaching model: early observed clock error/rate predicts later observed error. Label these configured synthetic faults, not physical measurements; the analytical rate formula may win. Browser pacing observations are a separate real observed source and require sufficient independent runs before whole-run generalization claims.

Retain literal mathematical fixtures (known linear coefficients, logistic score/probability, cluster centroid/distances, fitted PCA centering). Add grouped heldout and leakage fixtures, seed/changed-data/deterministic replay, invalid shape/finite/no-mutation checks, bounds and nonconvergence behavior. The workbench trains actual models, displays learned parameters and raw heldout outcomes, residual or decision/cluster plots, provenance and limitations. Define feature, fitting, holdout, residual, baseline, sigmoid and principal direction in plain language. Source-copy placeholders are insufficient.

## Advancement

Root accepts ML only after independent mathematics/grouping/leakage and real browser fit/edit/predict/evaluate checks. Source is then frozen and archived before explainability implementation starts. LEARNING-CONTRACT.md explains that next required stage. Full goal remains active until all stages and delegation learning are audited.
