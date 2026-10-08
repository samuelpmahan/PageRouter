# Independent ML coverage

Current mathematical/API and real-browser gates pass against their recorded source hashes. Root makes the stage acceptance decision separately. AI explanations remain incomplete.

| Requirement | Independent evidence |
| --- | --- |
| Linear fit and prediction | Hand line y=2+3x; fitted intercept/coefficient, extrapolation, residual metrics and train-only mean baseline |
| Classification | Literal logits/probabilities and threshold tie; stable extreme scores; gradient; finite contradictory-label optimum; explicit unfinished optimization |
| Classifier trace truth | Nonzero intercept and L2 penalty: independent logits, binary cross entropy and regularized objective match actual final ledger entries |
| Clustering | Hand centroid/inertia/distances; lowest-index tie; duplicate/empty centroid policy; deterministic seed; bounded unfinished fit |
| Fitted PCA | Shifted training means; hand covariance eigenvalues/variance shares; future rows reuse those means; unfinished eigensolve rejected |
| Whole-group holdout | Shared run and condition IDs form connected groups, including transitive links; no ID crosses the split; one connected group cannot produce an independent holdout |
| Leakage and preprocessing | Holdout-only feature/target injections leave model/scaler/baseline unchanged; known identifier/hidden/future/target feature names rejected |
| Retained artifacts | Mutating original training arrays/config after fit cannot poison models; mutating returned prediction arrays cannot poison later predictions for all four model families |
| Synthetic watch observations | Literal 3.5/3.75/4/4.25 Hz, 5-second observations retain fine cycles 35/1, 75/2, 40/1, 85/2 separately from completed beats; features reconstruct from retained powered time; 30-second targets are -3.75, -1.875, 0, 1.875 |
| Actual watch reuse | Each retained observation agrees with direct accepted watch API execution; changed hidden configured-rate provenance alone cannot change fitted parameters; analytical baseline remains visible |
| Composition and replay | Every published ML descriptor executes declared direct dependencies through real registry ctx.call traces; trainer descriptors are composed; exact receipt replay and complete experiment replay agree; model tampering fails replay |
| Bounds and invalid data | Nonfinite/ragged inputs, sample/iteration/work limits, bounded ledgers, and explicit nonconvergence behavior |
| Useful browser workflow | Actual four-model fit/edit/predict/evaluate controls; learned parameter changes; holdout edits isolated; replay; stale controls cleared; invalid JSON error |
| Useful plots | Cluster training/holdout/new markers differ; displayed centroid coordinates match inverse retained training scaler; PCA1 uses a labeled display-order axis with fitted variance bars; residual/probability plots contain actual predictions |
| Honest browser labels | Source kind is caller-declared; watch observations are synthetic teaching phase readouts; evaluation sharing training group IDs warns that metrics are descriptive |
| Resource evidence | Configured service plus verifier Node/Chromium RSS snapshots about 691 MB loaded and 869 MB exercised, below 2 GiB; these observations do not establish an OS hard limit or lifetime peak |

Primary receipts: `ml-gate-latest.json` and `ml-browser-2026-10-08T19-52-59-449Z.json`. Timestamped receipts preserve earlier failed candidates. The one-component PCA visualization and missing retained fine-cycle readout were repaired by product owners; the watch-load browser timing failure was corrected in the independent harness by waiting for the asynchronous action to finish.

The feature-name guard does not detect arbitrary disguised semantic leakage. FNV hashes provide integrity summaries, not authenticated provenance. Small configured watch conditions demonstrate synthetic calibration; they do not prove physical accuracy or generalization to real watches. Browser pacing remains a separate observed source and is not merged into synthetic watch training. PCA directions within repeated-eigenvalue subspaces need not be unique.

The accepted watch ZIP remains immutable. `fresh-extraction-20261008T193152614025Z.json` records all manifest hashes, zero-dependency verification, fresh HTTP imports/controls and no archive/source modification after reconstruction. ML changes do not replace that historical baseline.
