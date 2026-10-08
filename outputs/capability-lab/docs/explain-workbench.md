# Explain workbench

The Explain API connects a saved model or a retained watch run to a checkable explanation. It reuses the fitted model and recorded state; it does not train a replacement model while explaining a prediction.

## Model explanations

`explainPrediction({ experiment, features, baseline? })` accepts an `ml-experiment.v1` artifact and one numeric feature vector in the original dataset column order. It uses the artifact’s saved feature selection, preprocessing values, and model. The default baseline is the selected features’ training mean. You can instead use `baseline: 'zero'` or pass a full original-schema vector. The result includes the native prediction, attribution details, a roundoff check, identities, and a bounded calculation trace.

The wrapper supports linear regression, logistic regression, k-means, and PCA. *Attribution* means a breakdown of the model’s arithmetic. Linear contributions are signed changes from the reference prediction. Logistic contributions sum to the logit, the score before the sigmoid converts it to a probability. K-means coordinate terms sum to squared distance from the selected center. PCA loadings explain the saved projection score. These calculations do not establish real-world causation.

`perturbPrediction({ experiment, features, changes, baseline? })` applies finite raw-unit deltas by source feature name, then predicts both vectors with the same saved model and scaler. A valid source feature that was not selected may be changed; it has no effect on that fitted model. The result records original and changed vectors, predictions, the prediction delta, and whether each changed field was selected. `modelUnchanged` and `preprocessingRefit` report the wrapper’s immutability checks.

Before using an artifact, the wrapper checks its JSON size, depth and node limits, then calls `replayMLExperiment` and requires a complete canonical match. A *replay* rebuilds the result from the saved dataset and configuration; the exact comparison catches edited coefficients, preprocessing, predictions, trace entries, and other retained fields. The calculation trace records this validation refit. Prediction and counterfactual calls are separate: they use the saved model and scaler and never refit the changed input. Source labels and compact hashes are identity aids, not cryptographic signatures or proof of physical provenance.

## Watch explanations

`explainWatch({ state, componentId?, questionId })` supports these question IDs:

- `selected-component` reports the selected catalog component, its actual retained value, declared role, unit, value kind, and source.
- `energy-path` and `timing-path` show the linked modeled counters and derived hand state. Each also runs a cloned counterexample (power disabled or a changed rate) through the actual watch transition API.
- `current-vs-nominal-rate`, `divider`, and `gear-ratio` expose configured and current rates, retained divider counts, or the teaching gear calculations.
- `tick-boundary` reports only an event range attached to the latest explicit `step` action. An aggregated advance is not guessed to be one selected tick.
- `view-invariance` calls the actual geometry function with assembled and exploded views, then compares the retained state and counters.
- `physical-accuracy` is explicitly unsupported. The teaching state has no instrument readings or caliber-specific tolerance data.

Before any watch answer is built, the wrapper walks the state with limits of depth 64, 100,000 JSON nodes, and 1 MiB, rejects unknown top-level fields, and replays the retained configuration and actions. It compares the complete replayed state, including counters, models, rates, ranges, history-byte receipt, and trace, to the supplied state. A mismatch fails before evidence is produced. The trace records this replay check.

Mechanism source notes remain distinct from simulation values and illustrative geometry. A configured quartz frequency is an example, not a universal specification. Energy booleans are modeled availability, not measured torque or voltage. A geometry change is a view operation and does not advance watch time.

## Evidence and claim checking

`buildExplanationContext(...)` retrieves a context from either a current saved model selector (`{ experiment, features, baseline? }`, or with `changes`) or a current watch selector (`{ state, componentId?, questionId }`). Callers cannot inject evidence facts. Each context binds evidence IDs, values, units, kinds, permitted scopes, citations, and state/model identities.

`checkExplanationClaims({ context, draft, current })` checks a structured draft against the context regenerated from `current`. Pass the current model or watch selector when checking; this catches stale state or artifact changes. A claim must repeat the exact evidence value, unit, kind, allowed scope, and relevant citation. The checker renders accepted claims from fixed templates. Arbitrary provider prose is not verified by a valid claim list. A context serialized and loaded later must be checked with its current selector; the private in-memory context registration is intentionally not serialized.

## Limits and interpretation

The wrapper bounds model artifacts at 8 MiB, JSON depth 64, and 250,000 nodes; watch states are capped at 1 MiB, depth 64, and 100,000 nodes. Explanation traces are capped at 64 KiB. The runtime reports deterministic source/version labels and bounded summaries. It does not claim process-wide memory enforcement, cryptographic identity, live language-model access, physical measurement, or causal inference.

Run the focused wrapper and watch checks with `node --test test/explain/*.test.mjs`. The repository-wide gate is `node scripts/verify-all.mjs`; it discovers the same nested test files and runs at most two test processes at once with the pinned Node runtime. This concurrency limit does not cap operating-system memory use.
