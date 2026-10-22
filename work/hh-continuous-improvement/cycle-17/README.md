# HH continuous-improvement cycle 17

This is a compact review checkpoint for one renderer-tree navigation-label improvement and its canonical build. It is not a browser accessibility audit, release, deployment, or production-service claim.

## Result at this checkpoint

The initial directory-recovery hypothesis was falsified by two bounded synthetic controller/runtime/render-tree probes. An explicit query can recover from a no-match result; the controlled local read-error path is distinct and can be explicitly retried. No provider capability or directory defect was established, and no directory code was changed.

The independent renderer review found the navigation toggle had no explicit `aria-label` in the emitted tree. H1 added one 19-line renderer regression covering anonymous/authenticated × closed/open states. The pre-change focused run failed on its first case because the emitted attribute was `undefined`; the archived `red-result.json` normalized the JSON field to `null`, while the immutable raw stdout shows `undefined`. This is a renderer-tree observation only—not browser-computed accessible-name, keyboard, screen-reader, human, or broader accessibility evidence.

H1 then added exactly one attribute to the existing toggle. The test source did not change. Actual raw test output: focused 1/1 pass, public-site suite 16/16 pass, controller suite 61/61 pass, all with 0 skipped. The prepared GREEN prospective incorrectly predicted skipped tests for the focused run; it remains preserved unchanged, and the actual Node output governs.

An independent R2303 attempt was amended because its working directory was wrong: it exited 1 before loading the target and registered zero tests. That preserved AMEND is not a product/test failure and is not evidence against the implementation. The separate corrected-cwd R2303B run passed the focused test 1/1, zero skipped; H2 accepted that bounded checkpoint.

The one authorized E2304 canonical build exited 0. Fresh logs report 2 helper tests, 137 targeted HH tests, 292 full-suite tests, and 1 Atlas import-closure test, all passing with 0 failures/skips; 843 output files verified and all 14 PxCube packages succeeded. The 137 targeted tests overlap the 292 full suite and are not additive. The fresh receipt binds renderer SHA-256 `d9c17a350375633a53d0dc256be666bb0c82298c9ffa7b05bc6be08156141bfc`, reports sourceDigest `523de8b0f53f4452ffc4dd0569465e3fa983ac7d9b2558e85fe94c3d5fe896ac`, siteDigest `9c9a030307c94b7889ae7388eb3f806ccfa44a867c66104572df128660064af1`, and siteBuildId `d07d1a28741d968affa168bc3ea904f36bbf1d5d30fb26b437493bc6ddfd53d1`. Its 1,538 source inputs do not include the renderer test file; that test is separately pinned and its test runs are separately captured.

## Evidence limits and chronology

All probes and renderer assertions use synthetic fixtures/controllers and source-equivalent emitted trees. No real user/account, backend, email, mounted browser DOM, keyboard, screen reader, computed accessible name, screenshot, human acceptance, production effect, deployment, or main-branch change is claimed.

E2302's `source-only-prepared-result.json` is a pre-execution status record, not the native execution result. The actual H2 run and its captured raw evidence are separate; do not misread the prepared result's historical outcome as a native failure. E2301/E2302 both falsified a directory recovery defect and surfaced only the same qualified missing-label source observation.

Two E2303 preparation/tool qualifications are retained: the first scratch diff/prospective construction had a marker/path issue later corrected before the authorized RED, and a locator command referenced a nonexistent scratch path. No old raw capture was reconstructed, and neither was a product/test execution. The R2303 wrong-cwd AMEND and its exact raw/prospective are retained separately from accepted R2303B. During E2305 copying, two copy commands used a nonexistent destination locator (`/workspace/scratch/scratchcycle/ignore`) and failed before copying that source; the corrected copy then succeeded. No source, native raw, or already-copied evidence was overwritten by those failed locator attempts.

The E2303 raw RED reports actual `undefined`; `red-result.json` uses JSON `null` because JavaScript `undefined` is not a JSON value. The E2303 GREEN prospective's predicted skip count is also incorrect; the three actual raw test summaries each report zero skipped. Preserve these distinctions instead of normalizing old artifacts.

Only the E2304 original stdout/stderr/UTC/exit/signal files and fresh `site.receipt.json` plus `site.log` are included. The receipt and log retain their original mode `0555`. No site body/tree, `site.evidence`, screenshots, or PNGs are packaged.

Native state, policies, solve bundles/outputs, and root process notes are exact creation-time snapshots. The copied state snapshot was taken while E2305 package preparation was running and is not a live post-finish state. Archived probe/build scripts use inert `.txt` names; do not execute them from this package.

The exact 27 prior HH scratch paths (21 HH13 and 6 HH15 E2102) remain preserved outside this package and excluded. Lab7 is separate and untouched. No Git stage, commit, export, publication, or deployment is performed by this package preparation.

## Navigation

- [NEXT.md](NEXT.md): next bounded investigation and gate.
- [continuation.json](continuation.json): machine-readable handoff.
- [evidence/manifest.json](evidence/manifest.json): exact bytes, SHA-256, and full file modes; excludes itself and E2305 result to avoid circularity.
- [evidence/native/receipts](evidence/native/receipts): exact worker/coordinator actual-result envelopes.
