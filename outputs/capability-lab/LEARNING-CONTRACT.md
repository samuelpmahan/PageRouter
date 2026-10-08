# ML and explainability stages (required after watch acceptance)

These stages remain implementation requirements; this document is not achievement evidence. Keep the same three teams and reserve root wildcard for independent checking. Reassign file ownership explicitly at each stage before edits.

## Machine learning

Deliver an interactive track in the existing workbench with at least a numerical predictor, classifier, and complementary unsupervised example. Prefer linear regression via tested QR/least-squares; bounded logistic regression; k-means and/or reusable fitted PCA projection. Each task should expose training configuration, learned parameters, predictions and evaluation. Define jargon in plain language and show actual examples.

Build small pure primitives for train/test group splitting, train-only standardization, prediction, losses and metrics, then compose training/evaluation recipes using the actual numerical foundations. Seed randomized operations, bound work/data and retain training inputs/configuration. Whole run/condition groups must never leak across train/test or preprocessing. Provide an independent leakage failure fixture, not only a claim in documentation.

Use a declared mathematical fixture to check known coefficients, stable logistic probabilities/decision behavior, and cluster distances/centroids. Also consume retained watch timing observations or configured watch-rate faults: distinguish browser observations from synthetic teaching data. Features must be observable and must not include hidden configured fault, target error, future values or heldout labels. Compare heldout errors to explicit analytical/constant baselines; a baseline winning is a useful result.

Preprocessing parameters come from training data and are retained for future prediction. Evaluation shows errors/residuals, confusion or cluster diagnostics as appropriate, grouping and limitations. Repeated samples in a run are not independent runs. Do not invent uncertainty plots from aggregate summaries.

## AI/model explainability

Deliver explanations that can be checked numerically. For linear models, baseline plus feature contributions reconstructs the prediction. For logistic classification, contributions reconstruct the logit (pre-probability score); apply the sigmoid once and do not claim probability is an additive sum. For clustering, per-coordinate squared-distance contributions reconstruct the distance. Fitted PCA explanations tie directions and explained variance to actual parameters.

Offer controlled input perturbation/counterfactual views: show the changed input, actual changed prediction and which stated effect remains valid. A contribution explains model arithmetic, not causation in the physical world. Always distinguish observed, synthetic, inferred and unsupported claims.

Explain a selected watch tick from retained state, source-linked mechanism roles, exact counters and the actual calculation trace. Include why mainspring/battery supplies energy, why the selected oscillator sets timing, how divider/gear ratios affect hands, and why an exploded view or render frame changes no mechanism counters. A natural-language explanation layer may use deterministic evidence templates or an injected provider; every accepted numerical/technical claim must survive the same grounding checker. Provider integration is optional; checked explanations and attribution functionality are required.

The checker must reject unsupported/contradictory claims, wrong units/rates, universality that the generic mechanism does not establish, stale source/state identity, and invented physical measurements. A fabricated provider response must fail. Missing evidence produces a specific limitation, not confident filler. Source facts link primary references and synthetic data stays labelled.

## Full completion

Root independently checks all sections of ACCEPTANCE.md against current code, commands, browser behavior, retained data and evidence. Foundation/watch tests remain green; pure inputs, exact replay and resource limits still hold. Snapshot useful source before starting each next implementation stage, preserve prior deliverables, archive on D and provide opening/reproduction instructions. Only this full audit can justify completing the active goal.
