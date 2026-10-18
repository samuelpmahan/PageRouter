# HH continuous-improvement cycle 09

Cycle 09 records a bounded registration-validation falsifier and preserves a test-only regression checkpoint. The cycle-08 stale-draft hypothesis was falsified by the current host/controller flow: the delegated host input listener calls `updateDraft` before submit, and source/controller/render-tree probes retained valid non-secret name, email, phone, and school values through mismatched-password and missing-terms validation. A valid synthetic control reached the local pending state. H1 and H2 independently confirmed the controller/render-tree behavior; neither performed a mounted-browser run.

The only product candidate change is two tests in `checkpoint/vendor/hh/src/public-controller.test.mjs` (SHA-256 `d29cf793a619aabb22c2ae13151cc3facc12f9d143a8f167f96d1b22463608c9`). The controller remains unchanged (SHA-256 `8faad923a2e4721f1cc1059f902c54f97759ef32b57d36fe4fa8523205011a0b`). The regression tests exercise the existing `updateDraft` → notify/render path for mismatch and missing terms, assert rendered non-secret identity and selected school retention, verify no registration/provider side effect on invalid input, and ensure dynamically generated password values are absent from state, runtime inspection, Parts, and storage. They pass on existing behavior; this is not a red-before-fix result and not an application behavior correction.

## Candidate and verification

- Repository: PageRouter; branch `codex/hh-continuous-improvement`.
- HEAD: `46d1f32aca87919abceecf8b0c53454173cd574f`; tree: `b80f1408d3c21c23e058989ce79fcfc60a0ba674`.
- Coordinator-provided remote candidate: `220374f7b8fd2818829063fcd4ec045e47e951ee`; main remains `7adf7e74a85c4310a5704a4c42808e85a1a82d71`.
- The sole tracked worktree change is the test file above. No commit, push, merge, main update, publication, or deployment is included.
- H1 E1303: focused tests 2/2, full public-controller tests 51/51, HH core non-style tests 118/118, `git diff --check` exit 0. E1303 output companions are retrospective summary excerpts from tool-returned stdout, not original shell-captured logs.
- H2 R1303 independently reran focused 2/2 and full public-controller 51/51 using captured TAP output; accepted the test-only reuse protection. Its raw logs and exact command/exit records are kept separate.
- H1 E1304 canonical `bash ci/bazel/run.sh`: process exit 0, tee exit 0; build helpers 2/2, targeted HH controller/community 125/125, full fresh-site tests 280/280, built Atlas import 1/1, 14 PxCube packages, 843 verified files. Receipt binds the unchanged controller and exact test candidate. Build ID `831692c8dc830d6528fbaf3b431583809bc24a470fa1fa5661d68dd7d36868a1`; site digest `319f172f8a79194ad2410e9ad389a2a158f433092bcc4684e252a9397c148b91`.

## Evidence and limits

E1301's invalid proposed `success` envelope is preserved only as a **preflight-invalid proposal**; it was never ingested as a native result. The valid E1301 native result is `not_reuse`. E1302's worker payload used `allowed_outcome`; the coordinator preserved that raw payload and mapped it into the required `outcome` field in the native receipt. That was normalization, not an actual native rejection. Native solve records, receipts, acknowledgments, and an explicitly historical E1305-running state snapshot are under `evidence/native/`.

Source inspection establishes the host's delegated input binding, but browser input reachability remains unverified. Local Playwright lacked a browser executable; the supported cloud browser couldn't reach the local fixture server. The server was stopped by process-list readback. Closing the cloud tab was blocked by the browser URL security policy, so tab status is unknown; no workaround or retry was attempted. No screenshot or visual QA, backend/provider network effect, real account/data, or production behavior is claimed. E1304's copied `site.evidence/VERIFICATION.json` is historical material, not current browser evidence. `site.site` was not packaged.

Passwords and confirmations were generated ephemerally at test/probe execution. No credentials are stored in this package, native artifacts, logs, summaries, build receipts, or evidence. See [NEXT.md](NEXT.md) for follow-up proposals, and [evidence/manifest.json](evidence/manifest.json) for package hashes. The manifest excludes its own self-hash.
