# Model explanations

These helpers explain predictions from saved models. They reuse retained feature selection and preprocessing, so the explanation refers to the same model input as prediction. A feature contribution describes model arithmetic; it does not establish real-world causation.

## Logistic regression

`explainLogisticRegression({experiment, features, baseline?})` explains one prediction from a saved `ml-experiment.v1` logistic-regression artifact. `features` is one finite row in the dataset's original feature order, including columns that the fitted model did not select. The helper maps selected columns using the retained names and indices, then applies the saved standardizer. It never fits or changes a scaler or model.

The default reference is `baseline: 'trainingMean'`. If preprocessing is retained, that reference uses the saved standardizer means. If preprocessing is absent, it computes selected-column means from the retained training rows. You can choose `baseline: 'zero'`, or pass a full raw source-schema vector as the baseline. The explicit vector must have the same length and feature order as `features`; its selected columns become the reference values. This makes the reference and its provenance visible instead of silently treating zero as a training average.

Each selected feature reports its original source index, raw input and reference values, model coefficient, raw-unit coefficient, raw and standardized differences, and signed `logitContribution`. A *contribution* is how much one selected feature changes this model's score relative to the chosen reference. The contribution unit is the *logit*: the score before converting it to a probability. The model *intercept* is its starting score at zero model inputs; it is not automatically the default reference score. Contributions add to the baseline logit to reconstruct the actual predicted logit. The output also reports the actual probability, threshold, and class label from the saved prediction path. The sigmoid is applied once to that final score. Probability changes are not additive feature contributions.

For feature `j`, the raw-unit contribution is

```text
(modelCoefficient[j] / retainedScale[j]) × (rawInput[j] - rawReference[j])
```

With no standardizer, the retained scale is one. The baseline logit includes the model intercept and the transformed reference values. The reported reconstruction residual is checked against an explicit floating-point bound: `64 × Number.EPSILON × (featureCount + 2) × max(1, |actualLogit|, |reconstructedLogit|, |baselineLogit| + sum(|contributions|))`. An explanation is rejected if it exceeds that bound.

`perturbLogisticRegression({experiment, features, changes, baseline?})` performs a *counterfactual*: it replaces one or more selected raw feature values and evaluates what the same fitted model predicts. For example, `{changes: {earlyRate: 4.2}}` means set `earlyRate` to `4.2`; a UI that asks for a delta must add that delta first. Unknown and unselected feature names are rejected by this direct model helper. The result contains the old and changed values, actual before/after logit, probability, threshold and label, and their score/probability deltas. Both predictions use the same saved model and preprocessing. No model or experiment field is mutated.

The explanation result has `kind: 'logisticPredictionExplanation'` and contains `experimentIdentity`, selected feature names/indices, `baseline`, `input`, `prediction`, `contributions`, `reconstruction`, and `trace`. The counterfactual result has `kind: 'logisticCounterfactual'` and contains `before`, `after`, `effect`, `changes`, and both before/after explanations. The direct `changes` map uses replacement values; a workbench control that asks for deltas converts them to replacements before calling it.

The public Workbench `perturbPrediction` adapter has a broader raw-row interface: it accepts deltas for any known source feature, preserves changes to unselected fields in the returned raw row, and lets those fields have zero prediction effect. It converts selected-field deltas to replacement values before calling this direct helper. The direct helper remains replacement-only and selected-feature-only.

The model identity is a compact FNV-1a 32-bit fingerprint of the fitted model, scaler, and feature selection; the source identity is copied from the saved dataset artifact. These fingerprints support comparison and replay, not cryptographic authenticity. Results retain fresh JSON copies of identities, names, indices, and contribution rows. A compact trace records calls to the retained feature-preparation helper and shared `predictMLModel` function, plus the local logit reconstruction. Trace bytes are measured from serialized JSON and capped at 32 KiB.

All input values must be finite. Source schemas are limited to 256 features and selected model features to 100. Canonical input and output traversal also stops at 100,000 JSON value nodes or 100,000 array/object entries, with a maximum depth of 32; the byte limits are 8 MiB for input and 1 MiB for output. Traces are capped at 32 KiB and 4,096 nodes/entries. These are strict limits for this classifier explanation path, including numeric-heavy artifacts. The serializer counts UTF-8 bytes as it walks, before joining a complete string; it also checks escaped string sizes before calling `JSON.stringify`. Counterfactual changes are limited to the selected feature count. Extreme finite values can still overflow a coefficient, raw difference, contribution, or logit; those cases are rejected rather than clamped. L2 regularization affects how logistic coefficients were fitted, but prediction and feature contributions use only the saved coefficients and intercept. See the [classifier implementation rationale](../evidence/explain-linalg/classification-rationale.md) for the reference, reconstruction, and trace choices.

## K-means

`explainKMeans({experiment, features})` explains one row using a saved `ml-experiment.v1` K-means model. `features` is a full finite row in original source-column order. The explainer applies the saved feature selection and scaler, then reruns the retained centroid prediction. The result has `kind: 'kmeansExplanation'` and reports the chosen cluster, every centroid's coordinate terms and distances, the nearest alternative, tie behavior, source identity, and a bounded trace.

For each selected model coordinate, the explanation reports `(input − centroid)²`. These terms sum to **squared Euclidean distance**; the reported `distance` is the square root, in Euclidean units. The margin is `nearest alternative squared distance − chosen squared distance`, so a larger positive margin means the selected center is farther ahead. A one-center model has no alternative and reports a null margin. Exact distance ties follow the model's lowest-cluster-index rule; a tiny negative margin within the reported roundoff tolerance is displayed as zero.

Distances use the saved model's coordinate space. If the experiment retained standardization, they combine standardized model coordinates, while `centroidRaw` reverses the saved scale for display. That raw center does not change the assignment or distance calculation. Without standardization, the distances use selected raw coordinates; if those columns have different physical units, the summed squared distance mixes units. Cluster indices are identifiers, not class labels.

K-means explanations limit each feature name and `sourceIdentity.kind` to 256 UTF-8 bytes. Before building repeated center-coordinate output, they estimate JSON-escaped identifier size and reject estimates over 1 MiB; the completed output is also checked against 1 MiB. Traces are capped at 32 KiB. See [K-means fitting and distance rationale](./ml-linalg.md#k-means-clustering), the [explanation implementation](../src/explain/clustering.mjs), and the [focused test receipt](../evidence/explain-linalg/clustering-green-2026-10-08.log).

## Principal component analysis

`explainPCA({experiment, features})` explains the retained PCA scores for one full finite source-schema row. It reuses the saved feature selection, scaler, PCA means, and component directions. The result has `kind: 'pcaExplanation'` and reports selected input coordinates plus each retained component's loadings, eigenvalue, explained-variance ratio, signed contributions, score reconstruction, effective raw-space center, and trace.

For a selected model-space value `xⱼ`, retained PCA mean `μⱼ`, and direction loading `vᵢⱼ`, the contribution to component `i` is `(xⱼ − μⱼ) × vᵢⱼ`. The contributions sum to the saved component score within a reported floating-point tolerance. This is loading-weighted retained centering: the explainer subtracts the PCA model's fitted means after applying any saved standardizer. `rawEffectiveCenter` reverses that standardizer for display, and `rawLoadings` divide the model-space loading by its retained scale; the score itself is still calculated in model space.

An explained-variance ratio divides that retained eigenvalue by total variance over the complete fitted covariance spectrum. The explanation shows only directions present in the saved model; it does not invent an omitted axis. Eigenvector signs can flip without changing the represented direction, and repeated eigenvalues can make individual directions within a tied subspace non-unique. A loading contribution explains the projection arithmetic, not a cause.

PCA explanations apply the same 256 UTF-8-byte limit to feature names and `sourceIdentity.kind`. Before expanding repeated loading/contribution entries, they estimate JSON-escaped identifier size and reject estimates over 1 MiB; the completed output is checked against 1 MiB. Traces are capped at 32 KiB. See [PCA fitting and variance rationale](./ml-linalg.md#principal-component-analysis), the [explanation implementation](../src/explain/pca.mjs), and the [focused test receipt](../evidence/explain-linalg/pca-green-2026-10-08.log).

## Shared artifact and identity rules

K-means and PCA validate the saved dataset fingerprint, full source-column shape, selected name/index mapping, and retained preprocessing before explanation. Their results copy source identity and output arrays; changing a returned center, direction, feature name, or identity does not mutate the experiment or input row. The source fingerprint supports consistency checks and replay. It is not a cryptographic signature or proof that data came from a physical measurement. The shared artifact validator bounds the retained experiment to 8 MiB and 3,000,000 JSON values. Classifier explanations have their additional, stricter traversal limits described above.

## Logistic hand-checkable example

For intercept `5`, coefficients `[3, -2]`, input `[4, 7]`, and reference `[1, 3]`, the baseline logit is `5 + 3×1 - 2×3 = 2`. The feature contributions are `3×(4−1) = 9` and `−2×(7−3) = −8`, so the predicted logit is `2 + 9 - 8 = 3`. Apply sigmoid to `3` once to get the probability, then compare it with the saved threshold. Raising the first input from `4` to `5` produces logit `6` with the same fitted model.

Run all four model-explanation suites with the pinned Node executable:

```sh
/mnt/c/Users/tenni/Documents/Codex/2026-10-07/yo/work/toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node --test test/explain/classification.test.mjs test/explain/clustering.test.mjs test/explain/pca.test.mjs test/explain/regression.test.mjs
```

The actual classification, K-means, and PCA red/green receipts are retained in `evidence/explain-linalg/` with the corresponding names.
