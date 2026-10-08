# Runtime and composed workbench

`src/runtime/index.mjs` is the shared synchronous ESM registry. It has no Node-only imports, so the same descriptor code runs in the browser and Node 20+. Create one with `createRegistry(capabilities, { source, version })`. The registry exposes `list()`, `get(id)`, `graph()`, `orderPreference()`, `execute(id, input, { seed })`, and `replay(receipt)`.

Every input and result is checked against its JSON Schema subset. Inputs must be JSON objects with finite numbers; unsupported schema keywords fail during registry creation instead of being silently ignored. The registry copies and freezes descriptor metadata and execution values, so edits to a caller-owned schema or input cannot change a registered run. A composed capability can call only its declared direct dependencies with `ctx.call`; the runtime checks every child input and result, and rejects a declared dependency that was never called. Runs are synchronous. A Promise, unknown dependency, duplicate ID, cycle, invalid schema, malformed value, or shape error produces a named failure.

`graph()` gives derived order and edges from a dependency to the capability that calls it. `orderPreference()` reports the user's declared learning preference: order 0 has value 1, and each higher order has the sum of all earlier values (`1, 1, 2, 4, …`). These are priorities declared by the user, not measured benefit. The workbench displays the graph and the rule alongside the capabilities.

Each execution returns the result and a nested trace. Every trace node records capability ID, derived order, declared source/version label, input and result canonical JSON, integrity hashes, seed, random draw count, and child calls. Canonical JSON sorts object keys and normalizes negative zero. Replay reruns the saved input and seed, then checks exact canonical result equality, result hash, input evidence, identity label, and nested trace. The hash is portable 64-bit FNV-1a: it detects accidental differences but is not cryptographic proof of correctness. A `source` and `version` value is an explicit label, not a digest of the source code.

`ctx.random()` uses one deterministic stream shared through nested calls and requires an explicit execution seed. An unseeded deterministic capability may still run and replay; a capability that requests a random draw without a seed fails. Operations that accept their own seed as an input, such as bootstrap resampling, retain that seed in the saved input and trace.

The runtime bounds one execution to a maximum call depth of 64 levels including the top-level run, 25,000 total capability calls, 4 MiB per canonical input or result, 128 levels of nested JSON data, and 16 MiB for the exact UTF-8 serialization of the nested trace. These defaults can be changed through `createRegistry(..., { limits })`; exceeding a bound fails with the responsible capability ID. Runs do not keep history in the registry. These are application-level payload bounds, not a process-memory guarantee.

## Cross-domain recipes

`composed.covarianceMatrix` treats rows as observations and columns as features. It transposes the matrix and calls `statistics.covariance` for each feature pair. The default denominator is sample (`n − 1`); `population` selects `n`.

`composed.principalComponents` calls the covariance recipe and `linalg.symmetricEigen`, then refuses an eigensystem whose `converged` field is false. `composed.pcaScores` continues by centering rows with feature means and projecting each row onto the eigenvector columns. The dependency path reaches order 3: covariance atom → covariance matrix → principal directions → scores. For the independent 2D fixture in the descriptor, the sample covariance is `[[2, 0], [0, 0.4]]`; its eigenvalues are `2` and `0.4`, and the scores use the x and y axes in that order.

`composed.standardizedEuclideanProfiles` calls `statistics.zScores` for each feature, then calls `linalg.norm` for each row. Its distances use marginal standard deviations and therefore assume independent features; they are not Mahalanobis distances. A constant feature fails because its z-scores are undefined.

`composed.regressionDiagnostics` calls `linalg.leastSquares`, recomputes predictions with `linalg.matvec`, obtains residuals with `linalg.vectorSubtract`, and summarizes their mean and population variance with statistics capabilities. It requires a full-column-rank design matrix with at least as many rows as columns. Include an intercept column when the model needs one. Residual population variance describes the observed fit; it does not adjust for fitted parameters.

## Test rationale and observed red/green evidence

`test/runtime/runtime.test.mjs` checks behavior at failure boundaries: duplicate or cyclic graphs; unknown dependencies; unsupported schema keys; invalid, non-finite, or mutated inputs; output schema mismatch; undeclared and unused calls; exact nested seeded replay; tampered result, input, identity, and trace evidence; missing seeds for random draws; and call, value-depth, and trace-payload limits. Expected values in the fixtures are hand-computed, including order values `1, 1, 2` and the atom result `2 × 4 = 8`.

The first runtime run failed because `src/runtime/index.mjs` did not exist. After implementation, the suite first reached 8/8; adding a descriptor-mutation probe then produced one targeted failure: changing the caller-owned schema made `test.atom.input.value` incorrectly require a string. The registry now snapshots and freezes metadata, and the final runtime suite passes 10/10.

`test/composed/recipes.test.mjs` checks independently computed 2D PCA covariance/eigenvalues/scores, standardized values and Euclidean distances, a least-squares line with residual diagnostics, malformed shapes, constant-feature failure, explicit rejection of a one-iteration unconverged PCA, and changed-input replay. The recipe suite first failed because the composed module did not exist. Its first implementation passed the PCA and standardized fixtures but the regression test exposed honest QR roundoff (`1.0000000000000002`, `1.9999999999999998` instead of exact integer literals). The test now compares fitted values with a stated `1e-10` tolerance; no computed values are rounded. The final recipe suite passes 6/6.

Focused check command from this directory:

```sh
../../work/toolteam/inventory/runtime-cache/node-v24.19.0-linux-x64/bin/node --test test/runtime/runtime.test.mjs test/composed/recipes.test.mjs
```
