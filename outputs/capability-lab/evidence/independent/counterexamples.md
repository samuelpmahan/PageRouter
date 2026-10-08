# Independent counterexamples and regression rationale

The verifier changed no product modules. These observations were sent to their owners, and timestamped gate receipts preserve source hashes and failures. Current gate outcomes are recorded separately in `gate-latest.json`.

## Published elimination example

`linalg.rowEchelon({matrix:[[1,2],[2,4]]})` returned `[[2,4],[0,0]]`, while the descriptor expected `[[1,2],[0,0]]`. Partial row pivoting chooses the larger first pivot, so the algorithm result was valid and the example was wrong. The owner corrected the example. The failure is preserved in `gate-2026-10-08T18-44-32-079Z.json` and `gate-2026-10-08T18-45-23-820Z.json`.

## Rank after a zero leading column

`linalg.qr({matrix:[[0,1],[0,0]]})` reported rank zero, although the second column is nonzero and independent. Its rank is one. The regression checks rank and independently reconstructs the matrix from Q and R. The failed run is preserved in `gate-2026-10-08T18-45-23-820Z.json`. The owner replaced the factorization and made QR call its factorization and rank capabilities through declared dependencies.

## Adjacent-seed bootstrap bias

The original bootstrap started a new Xorshift32 stream with `seed + replicate`. On `[0,10]`, seed 1, 1,000 replicates, every replicate's first draw was zero. The observed bootstrap means were `{0:511,5:489,10:0}`, with mean 2.445, and a 95% interval `[0,5]`.

The exact two-observation bootstrap distribution has means 0, 5 and 10 with probabilities 1/4, 1/2 and 1/4, and mean 5. Adjacent small seeds caused systematic missing support. This is a distribution-quality failure even though the computation was reproducible.

The old inference source was observed with SHA-256 `f2e3c3575d50fd575f764b5051eb576bf11ad26c21689774f90b9088e3238173` in the nearby 18:45:23 source snapshot. The distribution probe itself was an independent direct execution recorded in chat, not a saved JSON receipt. That distinction is retained here rather than inventing a missing receipt.

The repaired implementation draws one continuous seeded sample stream. The independent seed-1 probe observed `{0:273,5:486,10:241}`, mean 4.84, and interval `[0,10]`. The quality regression is retained in the reusable gate. Its interval assertion is a deterministic quality probe for this implementation and seed, not a universal guarantee for all finite bootstrap runs.

## Online retained-state feedback

The first `statistics.onlineUpdate` returned `{count:1,mean:1,m2:0,variance:0}`. Passing that result directly as `state` to the second update failed with `SCHEMA_ADDITIONAL_PROPERTY`: `state.variance` was forbidden. A caller naturally retains the prior result when using an online update. The independent gate now runs the complete four-value feedback loop and checks the hand-derived final state `{count:4,mean:2.5,m2:5,variance:1.25}`. Root treated this as a foundation integration blocker and delegated the compatible-schema repair.

The owner accepted an optional finite nonnegative derived variance in the input state, while recomputing the output variance. The fresh independent four-update loop passes without field extraction or mutation.

## Additional independently green extremes

Root supplied three earlier review counterexamples. The independent gate confirms the repaired behavior: input property insertion order does not change any descriptor example; `[5e-324,0]` normalizes to `[1,0]`; and the midpoint quantile of `[-1e308,1e308]` is zero. These are independent green checks; this verifier did not produce their original red observations.

## Verifier corrections, separate from product failures

The extended browser verifier initially supplied an extra string argument to its two-argument check helper. Its new PCA check therefore did not run. That harness error was corrected and the actual interaction was then executed.

Node's Fetch implementation rejected preview port 4190 as a reserved port (`bad port`); the HTTP service and Chromium worked. The retained 4190 source-byte check uses bounded direct HTTP. Root moved the public persistent preview to 4173 for the final run.

The first translated-PCA probe compared different inputs' covariance matrices bit for bit. Translating observations changed a rounded result from 2.6666666666666665 to 2.666666666666666. The corrected mathematical invariant checks the hand value 8/3 with absolute and relative tolerance 1e-10. Identical-input replay and Node/browser parity still require exact canonical equality and hashes. These were verifier limitations, not product numerical failures.
