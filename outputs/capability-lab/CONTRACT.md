# Capability Lab: goal contract

The user authorizes autonomous implementation in this order: statistics and linear algebra atoms/compositions; tick contracts and three watches; machine learning; AI explainability. Preserve the full goal across turns. The root coordinates and verifies; product code is delegated. No edits to existing PageRouter or sealed handoffs.

## Product and interface

Deliver a dependency-free Node 20+ ES-module library and interactive browser workbench here. Reuse the existing Node binary; no npm install, broad builds, or dependency copies. Modules must work in Node and browser without Node-only imports. Large generated evidence/staging belongs under /mnt/d/somefile/capability-lab/; small user-facing results belong here.

Each domain's src/<domain>/index.mjs exports named pure functions plus `capabilities`, an array of descriptors. Descriptor fields: `id` (domain.name), `title`, `description`, `kind` (atomic or composed), `dependsOn` (IDs), `inputSchema`, `outputSchema`, `examples` ({input, expected}), `run(input, ctx)`, and optional `formula`, `caveats`, `units`. JSON Schema uses type, properties, required, items, minItems, maxItems, minimum, maximum, enum and additionalProperties. All public run inputs are objects. Examples must be independently checkable, never produced by the implementation being tested.

An atomic descriptor has no dependencies. A composed descriptor genuinely calls lower-level capabilities through `ctx.call(id, input)` and declares every direct dependency; the runtime records those calls. Named direct functions may compose named functions for standalone library use. Descriptors must not conceal their computation by relabeling a complete algorithm atomic solely to inflate counts.

The registry derives order: atoms are order 0; each composed node is 1 + max(dependency order). Unknown IDs, duplicate IDs, cycles, invalid inputs, undeclared calls and uncalled declared dependencies fail clearly. Execution produces result, nested call trace, source/version identity and deterministic replay evidence. Equality tests compare canonical results as well as hashes. A hash is an integrity aid, not proof of mathematical correctness.

Display the user's declared order-value rule as a learning preference: order 0 has value 1; each higher order has the sum of all earlier order values (1,1,2,4,...). This is a declared priority, not a measured benefit or a claim about function counts. Show actual dependencies and enabled applications beside it.

Numbers are finite IEEE-754 doubles; document tolerances, empty/singleton behavior, quantile convention, sample/population denominators, degeneracy and singularity. Reject NaN/Infinity and shape mismatch rather than inventing values. Never mutate input. Seed every randomized operation and retain its parameters.

## Team ownership

Statistics: src/statistics/**, test/statistics/**, ui/statistics.mjs, catalog/statistics.json, docs/statistics.md, evidence/statistics/**.
Linear algebra: src/linalg/**, test/linalg/**, ui/linalg.mjs, catalog/linalg.json, docs/linalg.md, evidence/linalg/**.
Composition/workbench: src/runtime/**, src/composed/**, test/runtime/**, test/composed/**, ui/app.mjs, ui/style.css, index.html, serve.mjs, catalog/composed.json, docs/workbench.md, scripts/**.
Root: CONTRACT.md, PLAN.md, PROGRESS.md, docs/team-* and final coordination/acceptance receipts only.

Each of three teams has exactly a gpt-6.1-sol Medium orchestrator, a gpt-6-luna XHigh worker, and a gpt-6-luna Medium worker. Sols generate/refine/delegate, review and integrate; they do not write product code. Assign disjoint ownership to workers. They are not alone and must preserve others' edits. Do not spawn additional agents. Root reserves one wildcard seat for independent review or integration investigations.

Every Sol writes docs/team-<domain>-delegation.jsonl: timestamp, task, owner, predicted complexity, reason for model choice, expected evidence; then observed outcome, rework/blocked time when known, and one concrete next-delegation adjustment. Learn from evidence rather than claiming model training. Each report states what the user can do, what changed the model, wrong assumptions, decisions and unchecked claims.

## Foundation acceptance and scope

Build broad useful atoms: statistics should span descriptive moments, quantiles/ranks, weighted/online statistics, covariance/correlation, standardized values, empirical distributions, deterministic resampling, confidence/robust summaries and paired/group comparisons. Linear algebra should span vector/matrix arithmetic, norms/distances, projections, transforms, elimination/solve, rank/determinants/inverse, factorizations, least squares and symmetric eigen/PCA prerequisites. Choose correct bounded algorithms; expose assumptions and useful failures.

Satisfactory foundations require both domains covering these families, independent mathematical fixtures and invariants, at least three genuine composition levels, and cross-domain recipes a user can execute and inspect. Examples include standardized multivariate analysis, regression diagnostics and principal-component analysis composed from declared primitives. Exact counts are evidence, not the completion criterion. Browser workbench needs editable input, result, explanation, dependency graph/order, trace, and meaningful visual views rather than just a JSON dump.

Advance only after the root independently verifies those properties. Then reassign the same teams to the tick/watch plan in ../story-data/watch-capstone-plan.json and watch-model-design.json. Implement all three watches, labelled and explodable, using the verified statistics/transforms; shared logical elapsed time, distinct tick meanings, exact bounded counters, pause/step/reset/replay, state-bound labels and separate energy/timing explanations.

After the watch gate, implement ML over retained observations with whole-run heldout splits, fitting/preprocessing isolated from test data, analytical baselines, deterministic training and displayed residuals/errors. Then implement explainability: evidence retrieval, state/parameter-linked numerical claims, feature/attribution views appropriate to the fitted models, counterexamples and unsupported-claim rejection. AI explanations must remain checked against calculations and sources, with real uncertainty shown.

## Evidence and resource limits

Write test rationale by behavior/failure, independent expected values, invalid-input and mutation probes, and actual red/green evidence. Grade: from this directory the pinned Node binary runs `--test` (default recursive discovery). Node 24.19.0 treats an explicit `test/` argument as a module path and fails on this nested layout; the root reproduced that behavior. Integration grader also checks dependency graph and executes every descriptor example, traces compositions, changes inputs and replays. Preserve failed evidence and fixes.

Investigations are reusable scripts. No high-frequency quartz event flood: compact exact ranges plus bounded expansion. Bound buffers and caches explicitly. Check actual disk/RAM before heavy jobs; never delete unrelated files or silently discard replay events. Archive useful candidates early and verify in parallel; later corrections use new versions.
