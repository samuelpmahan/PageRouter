# Independent acceptance coverage

Fixtures are defined independently in `work/capability-lab/verification/fixtures.json`. Correct output, broad coverage, trace depth and useful browser behavior are separate checks. A test count cannot substitute for one of these checks.

| Contract family | Independent check | Evidence state |
| --- | --- | --- |
| Descriptive moments | Hand-derived mean/variance, large-offset cancellation, finite/empty/sample singleton rejection | PASS |
| Quantiles and ranks | Type-7 interpolation, even median; average/dense ties and permutation invariance | PASS |
| Weighted and online | Unequal weights, zero/negative total, hand online moments and natural output-to-state feedback loop | PASS after compatible state-schema repair |
| Covariance/correlation/standardization | Signed paired covariance, perfect anticorrelation, constants and mismatched pairs | PASS |
| Empirical distributions | Hand CDF equality/endpoints, inclusive last histogram edge and count conservation | PASS |
| Deterministic resampling/confidence | Same seed repeat, changed seed, retained parameters, constant-data interval and analytical two-value support | PASS after continuous-stream repair |
| Robust and group/paired summaries | Hand median/IQR, unequal-group Welch degrees of freedom, constant paired sign reversal | PASS |
| Vector/matrix arithmetic | Hand vector/matrix examples, dimensions, overflow/nonfinite rejection, frozen input and property-order reversal | PASS |
| Projections/transforms | Independently computed projection residual, rotation length, affine origin translation | PASS |
| Solve/rank/determinant/inverse | Pivot-required and singular fixtures; scaling by 1e-12/1e12; inverse reconstruction | PASS |
| Factorizations/least squares | Independent QR/LU/Cholesky reconstruction, hand factors, zero-leading-column rank, residual orthogonality | PASS after QR/example repairs |
| Eigen/PCA prerequisites | Independent eigen residuals and orthonormality; symmetric-input rejection | PASS |
| Three composition levels | Registry-derived order and all-and-only direct declared calls on every descriptor example | PASS; actual maximum order 4 |
| Cross-domain recipes | Five real cross-domain recipes; hand shifted PCA/reconstruction, noisy regression/changed outcomes, constants/nonconvergence | PASS |
| Runtime contract | Duplicate/unknown/cycle, invalid input/output, undeclared/uncalled dependency, immutable input and synchronous execution | PASS |
| Canonical replay | Exact canonical value plus hash; changed inputs and result/input/version/seed/canonical/hash/trace tamper | PASS |
| Browser usefulness | Visible search/selection → editable input/run → explanation/graph/trace → changed numerical result/replay; PCA scatter/strength and histogram bars; mobile | PASS on final persistent http://127.0.0.1:4173; 13 checked flows and no page/console errors |
| Source evidence | SHA-256 source snapshots; served bytes match local files; source files unchanged across gate and browser run | PASS; runtime identity itself remains a declared source/version label |
| Resources | Low configurable depth/call/value/trace limits and resampling work bounds; bounded metadata; exact managed Node/Chromium/service PID trees | PASS for limit rejection and observed snapshots; no OS hard limit or lifetime peak claim |

Foundation advancement is the root's decision after these gates. Watches, ML and explainability are later gates, not established by foundation checks.

Latest independent mathematical receipt is `gate-latest.json`; timestamped red and green receipts remain alongside it. It covers all 69 descriptors, with 38 atoms and genuine orders through 4. Those counts describe the snapshot; the behavioral family coverage and actual traces above establish the foundation evidence.

`counterexamples.md` distinguishes independently reproduced product failures, supplied earlier-review counterexamples, and corrected verifier assumptions. Cross-input numerical invariants use explicit tolerances; identical-input replay compares canonical values exactly.

Final browser receipt: `browser-2026-10-08T18-54-03-545Z.json` (also `browser-latest.json`). Its managed process scope is root's service PID 27734 plus the verifier Node process and Chromium descendants. Combined RSS was 642,818,048 bytes when loaded and 786,190,336 bytes after interactions, below the 2,147,483,648-byte budget at both snapshots. Codex infrastructure was excluded. This establishes two current observations, not an operating-system hard limit or lifetime peak bound.

The final PCA screenshot is `browser-2026-10-08T18-54-03-545Z-pca-visual.png`. It shows actual shifted input, component-score geometry, explained component strength and dependency structure. Final trace, regression result, histogram and mobile screenshots are retained with the same timestamp.

Independent recommendation: the foundation gate passes and can advance to watches under root judgment. The natural online feedback blocker is repaired and verified. No watch, ML or AI acceptance is implied.
