# HH continuous-improvement cycle 04

This package records the public-profile stale-read investigation, the adjacent directory microtask race, its bounded controller-state correction, independent review, and canonical source build for PageRouter.

E601 ran four promise-controlled cases: delayed `TeacherProfile.openPublicProfile`, navigate to registration or login, then complete the read successfully or with failure. In all cases route-epoch checks kept the auth route current, `journey.loading` stayed false, and the auth form stayed usable. The profile projection remained internally `loading` with no value while those routes were active; that hidden status was not rendered on the auth routes. E601's report initially swapped its `summary` and `outcome` fields. Both the raw producer report and the explicit normalized receipt are retained. The correction did not change the falsified result.

H2 independently reproduced the four profile-read cases and also ran a directory-search microtask race. It confirmed a stale directory completion can strand `journey.loading=true` and `matches.status='loading'` after navigation to login. The login form remained enabled and dispatch still reached local validation. H1 then independently reproduced the directory race for both login and registration. No auth-form lockout or visible progress message was observed.

E604 adds one reset at the navigation ownership handoff, before route-specific reads start. New directory or school lookups can then claim `journey.loading` for their own work. Existing epoch guards still return before stale completions write state, so an abandoned directory completion does not clear a newer pending school lookup. E604's author report records the focused red/green counts (`32 passed, 1 failed` before the correction; `33/33` afterward). The included `focused-red.log` is explicitly a reconstructed run captured at 2026-10-18T10:35:16Z: it stages only the baseline controller from HEAD alongside the exact cycle-04 test file, whose SHA is recorded in `red-stage.json`. It is not misrepresented as the original E604 stdout. The included focused/all-HH green logs are separately captured against the exact reviewed source freeze. All HH controller/community/site tests passed (`60/60`). R604 independently accepted the exact two-file freeze and exercised the route and overlapping-lookup races without source edits.

E605 ran the canonical build from `checkpoint/` using `BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh`. It passed 107 targeted HH regressions, 262 full-suite tests, and one built Atlas import check. Fresh-output verification covered 843 site files and 14 PxCube packages. The receipt records site build ID `ee631cce67903dafd20228b5090d208fb50aaecedd0d713974ea47b9a3c75ff5`; its two PageRouter product source hashes match R604's accepted checkpoint exactly.

The correction concerns stale controller state only. It does not repair or redesign the auth UI because neither investigation observed auth-form disruption. `matches.status='loading'` remains in the historical hidden directory snapshot after an abandoned request; no fake UI fix or matches redesign was added. Existing captured read-only profile authority, profile ownership, and distinct school geography cascade semantics remain unchanged.

All executed provider operations were synthetic fixture-local operations. This package makes no backend or real teacher-data claim. Browser visual QA, human acceptance, commit, push, main update, and deployment are not claimed. Product source remains exactly two intended dirty files pending root publication authorization.

## Evidence layout

- `evidence/E601/`: original exact four-case H1 falsifier, portable-root copy, raw report, normalized receipt, and output.
- `evidence/E602/`: H2 independent probe, original missing-summary producer report and raw receipt copy, plus the explicit normalized receipt with its required summary. The coordinator retained and normalized E602 rather than rejecting the wrapper.
- `evidence/E603/`: H1 two-route directory microtask repro before correction.
- `evidence/E604/`: original source diff, red/green focused logs, full HH log, and result.
- `evidence/R604/`: H2 independent review and exact adversarial/profile-control probes and outputs.
- `evidence/E605/`: canonical build log, source-build receipt, and result.
- `evidence/E606/`: portable replay smoke outputs and package-state note.
- `evidence/native/`: read-only scheduler snapshot, all available solve records and native bundles, receipts, raw normalization history, and root verification.

Portable probes use `PAGEROUTER_ROOT` to select a PageRouter checkout. The `.original.mjs` files retain the exact originally executed scripts and hashes. The packaged portable scripts only replace hard-coded import locations. Historical E603 and E602 race probes reproduce the pre-fix directory stale state and therefore are expected to fail their old loading assertions against the corrected current source; their retained JSON outputs are the pre-correction evidence. The E601 and R604 portable smoke outputs were rerun against the current reviewed source and match their retained outputs byte for byte. The E602 and E603 portable race probes were rerun against a temporary path-only stage with the baseline controller restored from HEAD; both outputs match their retained pre-fix evidence byte for byte.
