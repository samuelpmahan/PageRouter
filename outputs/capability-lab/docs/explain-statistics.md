# Linear-model explanations

A fitted model's explanation answers “how did these inputs produce this prediction?” It describes the model's arithmetic; it does not show that an input caused a real-world outcome.

## Explain one saved prediction

`explainLinearRegression({experiment, features, baseline = 'trainingMean'})` accepts an `ml-experiment.v1` linear-regression artifact and one finite feature vector in the artifact's original source-column order. It uses `selectedFeatures.indices` to choose the model inputs and the exact scaler retained in the artifact. It never refits the model or preprocessing.

The default reference is each selected feature's training mean. If the experiment retained a standardizer, those are its stored means. If it did not standardize, the means are computed from retained training rows only. `baseline: 'zero'` uses zero for selected features. An explicit numeric `baseline` must have one value for every original source column, in original order; only the selected columns contribute. Nonselected input values are kept unchanged for the default and zero references, and explicit reference values for nonselected columns do not affect this model.

The result contains the actual prediction from `predictMLModel`, a reference prediction, a contribution for each selected feature, and a reconstructed prediction. For feature `j`, contribution is `rawCoefficient[j] × (input[j] − reference[j])`. The reference prediction plus all signed contributions should equal the actual prediction up to a reported floating-point tolerance. That bound scales with the largest prediction or summand, so large positive and negative contributions that nearly cancel are covered. A positive contribution raises the prediction relative to the reference; a negative contribution lowers it.

When training used standardization, the stored model fits `(rawValue − trainingMean) / trainingScale`. The explanation converts its coefficient back to original units: `rawCoefficient = modelCoefficient / trainingScale`, then adjusts the intercept so the same line is expressed in source values. The fitted scaler is reused without refitting. The reported `sourceIdentity` binds the explanation to the dataset retained in the artifact with its existing fingerprint; the fingerprint is an integrity check, not a security signature or proof that a dataset came from a physical measurement.

## Perturb one or more inputs

`perturbLinearRegression({experiment, features, changes})` accepts the same full raw-schema feature vector and a nonempty object of `{sourceFeatureName: rawUnitDelta}`. For example, `{x: 1}` changes `x` from 4 to 5. It predicts both vectors with the same stored model and scaler, then reports the actual prediction change. The saved artifact and input arrays remain unchanged. A nonselected source field may be changed to demonstrate that the fitted model does not use it; its prediction effect is zero.

A perturbation is a controlled comparison inside this fitted model. It does not predict what would happen if a person, watch, or physical system were changed. Neither coefficients nor contributions establish causation.

## Grounded claims and citations

`buildEvidenceContext({contextId, stateIdentity, modelIdentity, sourceKind, sources, evidence})` makes a bounded copy of structured evidence. `checkExplanationClaims({context, draft})` accepts only claims that repeat an evidence ID's exact value, unit, kind, permitted scope, and citation IDs. A *scope* is the kind of statement a value is allowed to support, such as a model prediction, watch counter, or curated mechanism fact. The allowed scopes are a closed list; each scope also checks its value shape. For example, model predictions and contributions must be numeric or use fixed model-result records, watch rates use exact rationals, and watch role values must match the named component's declared type and unit.

Sources are either curated watch references or local model, dataset, and watch-state identities bound to this context. A curated mechanism fact must exactly match the cited reference's recorded support or limitation. Stale context, model, or state identities; wrong values, units, scopes, or citations; and unsupported universal claims are rejected. The checker renders accepted claims from fixed sentence templates. It rejects arbitrary draft prose, even when that draft also includes a valid claims array, so only the checked rendering should be presented as verified.

The context is limited to 1 MB, 100,000 JSON values, and depth 16; it also limits evidence to 256 records and sources or claims to 64 each. These checks bound copying and validation of caller-provided data. They do not prove that a numeric value in a public context was calculated from the claimed model or watch state. The Workbench context builder is the authority boundary: it retrieves the retained model and actual run state, computes evidence values, and binds them to canonical identities. The checker then validates claims against that supplied context; it does not rerun the model or authenticate the caller. Likewise, a `physical-measured` label is only a caller-supplied string. Without an independent instrument-provenance verifier, physical measurement claims are rejected.

## Checks and limits

Both functions validate the saved `ml-experiment.v1` shape, source identity, feature-name/index mapping, model dimensions, and finite numeric inputs. Source vectors support up to 256 fields; the model may select up to 100. The retained dataset fingerprint is bounded at 4 MiB and the full artifact preflight at 8 MiB, with maximum JSON depth 64 and a 3,000,000-value traversal cap. Cycles, accessors, sparse input vectors, nonfinite numbers, stale dataset fingerprints, malformed scalers, and overflowing perturbations are rejected.

`prepareExplanationFeatures({experiment, features, baseline})` is a shared helper for other explainers. It returns the copied full raw input/reference, selected raw values, one-dimensional model-space input/reference vectors, names, original-schema indices, scales, copied source identity, and reference kind. For training-mean and zero references, nonselected source values are preserved from the input. The helper applies only retained preprocessing; it does not train a scaler.

Plain definitions: a *coefficient* is the model's multiplier for a feature; a *contribution* is that multiplier times the feature's difference from the chosen reference; *standardization* subtracts a training mean and divides by a training scale; a *reference* is the comparison input used to divide the prediction into contributions. Different references produce different contributions while leaving the actual model prediction unchanged.
