# AI/model explainability implementation phase

Root has accepted ML and its immutable source archive exists. This is the final required implementation stage, not an optional documentation exercise. Preserve all earlier APIs/tests and reuse the same exact teams/workers. Read LEARNING-CONTRACT.md and ACCEPTANCE.md.

## Ownership and interface

Statistics team: src/explain/regression.mjs, src/explain/grounding.mjs; test/explain/regression.test.mjs, grounding.test.mjs, regression-independent.test.mjs; docs/explain-statistics.md; evidence/explain-statistics/**. XHigh additive linear explanation, retained-preprocessing/unit conversion and counterfactual calculations; Medium typed evidence/claim checking and independent numeric/source/citation probes.

Linalg team: src/explain/classification.mjs, src/explain/clustering.mjs, src/explain/pca.mjs; matching tests plus test/explain/linalg-independent.test.mjs; docs/explain-linalg.md; evidence/explain-linalg/**. XHigh logistic score/probability attribution and counterfactual math; Medium nearest-center and PCA loading/projection explanations plus independent review.

Workbench team: src/explain/index.mjs, src/explain/watch.mjs, ui/explain.mjs, test/explain/integration.test.mjs, watch.test.mjs, scripts/verify-explain.mjs, docs/explain-workbench.md, evidence/explain-workbench/** plus existing owned app/html/styles integration. XHigh validated artifact/context retrieval, watch questions, checked provider-draft path and actual explanation trace; Medium readable full-width Explain mode, contribution plots, perturbation controls, evidence/citation inspection and browser acceptance. Root wildcard independently challenges faithfulness/unsupported claims/context identity and final full-goal completion.

Publish exact object APIs/outputs and stable IDs before implementation consumers land. Required public capabilities from src/explain/index.mjs: explainPrediction({experiment,features,baseline?}), perturbPrediction({experiment,features,changes}), explainWatch({state,componentId?,questionId}), buildExplanationContext(...), checkExplanationClaims({context,draft}). Names may be mutually agreed and announced. `experiment` is the saved ml-experiment.v1 artifact, including selectedFeatures indices, preprocessing means/scales, model and sourceIdentity. Raw original-schema features must be selected/transformed with the retained parameters, not refitted.

## Faithful numerical explanations

For linear prediction show baseline input/prediction, each feature's signed contribution, total and any explicitly bounded floating roundoff. Baseline defaults to training means; zero is an optional clearly named reference. Use actual learned coefficients and preprocessing to explain in original feature coordinates. A coefficient or feature contribution is model arithmetic, not proof of real-world causation.

For logistic classification contributions sum to the logit: the score before the sigmoid. Apply sigmoid exactly once; probability is not an additive contribution sum. Show actual threshold/label and positive/negative effects. A changed-input experiment uses the same fitted model and retained scaler; original parameters remain unchanged.

For k-means, per-coordinate squared distances reconstruct total squared distance and explain the chosen versus alternative center; distinguish squared distance from Euclidean distance and handle ties consistently. PCA explains the actual fitted centering, loading-weighted projection and component variance; no fabricated second axis or causal interpretation.

Independent hand fixture: intercept5, coefficients[3,-2], input[4,7], reference[1,3] => baseline2, contributions[9,-8], prediction3; input first feature+1 => prediction6. Cluster[3,4] versus center[0,0] gives squared terms[9,16], total25 and distance5. Define tolerances for legitimate roundoff and test nonzero intercept, preprocessing and l2 cases. Explanations must agree with the real predictor, preserve immutable inputs/artifacts, and replay deterministically.

## Grounding watch and AI explanations

Explain actual selected watch state, not a static generic story: distinct tick meanings, current versus nominal rates, power/timing roles, divider/gear computations, pause/render/explosion invariance and counter ranges. Link facts to the curated primary references in watches/components.mjs. Model state and illustrative geometry must remain distinct. Support defined questions plus an explicit unsupported-question outcome.

Build a bounded evidence context with state/model/data/source identity, evidence IDs, values, units, kind and permitted factual scope. Check incoming draft claims against that context: wrong value/unit, unknown evidence, wrong or irrelevant citation, stale context, false universal quartz frequency/pulse claim, invented physical measurement and unmodelled temperature/friction/hardware accuracy must fail with a useful reason. Caller-declared sourceKind alone does not establish measured physical provenance.

A provider may submit structured claims/drafts; a deterministic provider fixture is enough to exercise the checked path, and optional external adapters may be injected. Do not pretend a live language-model service exists. Arbitrary provider prose must never become 'verified' merely because a separate claims array looks valid: use constrained claim text/templates or clearly retain unverified draft text while rendering accepted claims from their actual evidence. No credential requests or external model dependency is needed for this stage.

## UI and completion gate

Add Explain navigation preserving Foundations/Watches/ML. Reuse the current fitted experiment and watch state, with clearly labelled demo fallback if none exists. User selects a prediction/part/question, inspects contributions and sources, changes an input, and sees the actual changed prediction. Every technical term gets a plain definition; source/trace details can expand. Use meaningful numeric axes/units and honest train-reference assumptions.

Browser tests must interact with actual model/source/perturbation controls, show faithful changes, challenge an unsupported draft and stale identity, inspect watch questions and sources, verify no view action changes mechanism state, and confirm earlier tracks still work. Final root audit checks every requirement in ACCEPTANCE.md, runs full current grade and independent gates, freezes source, archives and freshly reconstructs the delivered artifact. Goal remains active until that audit proves all requirements.
