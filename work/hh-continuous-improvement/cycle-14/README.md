# HH continuous-improvement cycle 14

This package records the bounded held-login/reentry investigation, the reviewed two-file repair, and one local source build. It is evidence for review, not a release, deployment, or human-acceptance claim.

## Result

During a held successful login, the user can edit a newer email and navigate away and back to login before the request settles. The request correctly authenticates the submitted email A, but the controller's emitted login tree remained at newer draft B after success. The minimal repair places the successful login projection in the existing `service()` after-success hook: after runtime synchronization and before the service's final notification. The route-epoch-guarded redirect remains outside that hook. Failure and draft-retention policy were not changed.

The frozen product checkpoint is exactly:

| Path | SHA-256 |
| --- | --- |
| `checkpoint/vendor/hh/src/public-controller.mjs` | `d730252e211af138383e76ca97b1cf39ddc8aabb4426b2d2ba5560cb58772669` |
| `checkpoint/vendor/hh/src/public-controller.test.mjs` | `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164` |

No renderer, app, runtime, or provider source was changed for this repair.

## Evidence and qualifications

- E1901/H1 and E1902/H2 independently observed the predeclared emitted-tree mismatch. E1901 reached and passed its prior secret-absence, one-login-call, and authority checks before the rendered-email assertion failed. E1902 stopped at that assertion; its later secret and provider-count checks were not reached.
- E1903/H1 preserved the test-first RED and subsequent GREEN. The focused regression passed; the controller suite passed 60/60 and public-site suite 14/14.
- R1903/H2 accepted the exact source/test checkpoint and independently passed the focused regression (1 pass, 0 fail, 0 skipped). Its unchanged E1902 replay confirmed the repaired projection, authority, one explicit login, and zero registration/profile writes, then failed at its old total-provider-call expectation (2 vs 1) because initialization also reads `SchoolData.getStates`. The replay's later secret scan was not reached. No retry or assertion change followed. The worker's incorrect “59 skipped” prose is retained in its raw record; the root qualification records the actual 0 skipped. The worker's unsupported distinct-behavior count is likewise retained raw and not adopted.
- E1904/H1 was one successful canonical local build: `/usr/bin/env BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh`, from `/workspace/scratch/8528bb251845/PageRouter/checkpoint`. It used 1,538 declared inputs, rebuilt 14 PxCube packages, and verified 843 site files with exact compiled equality. Named summaries are build helpers 2/2, targeted HH 134/134, full npm 289/289, and Atlas import closure 1/1. The targeted HH tests overlap the full npm suite; no deduplicated or independent-behavior total is asserted.
- The current receipt binds source digest `b48ad9a809682aab5b6eccd4a1e6d68ce52f61d860b9f0d889433e76118c442f`, site digest `1343fcceb41ec09acd0ff550054c38e3a73bf3f4a5e54361d9fe758596e58628`, and build ID `02862d25fc8675fa79307b9e72f5b5ffb4d71de2fabd21f384ebdca98f1f7781`.

The probes used synthetic fixtures and the controller's delegated-equivalent/emitted render tree, not a mounted browser DOM. There are no browser screenshots, backend or production calls, real accounts, external email, or human acceptance evidence. Random test passwords were ephemeral; no password values are included in this package. The unreached E1902 and replay secret scans are not treated as passes. No second login, registration, or profile write was initiated. The unchanged route authority, geography behavior, captured/foreign route behavior, failure behavior, blank-email behavior, and no-autowrite boundaries remain part of the reviewed two-file scope; see the frozen plans and test captures for the specific controls reached.

Raw captures and worker receipts are copied unchanged. Root envelopes are explicitly separate derived qualifications, not replacements for those originals. Archived runnable probe/build files use inert `.mjs.txt` or `.sh.txt` suffixes; their relative workspace imports are not a portability claim. Native solve bundles are preserved as received. Old-cycle packages, historical site evidence, screenshots, build output bundles, and the separate Lab project are excluded.

## Package navigation

- [NEXT.md](NEXT.md) — current handoff and next gate.
- [continuation.json](continuation.json) — machine-readable handoff.
- [evidence/manifest.json](evidence/manifest.json) — SHA-256 and length inventory.
- [evidence/E1905/result.json](evidence/E1905/result.json) — package result envelope.

