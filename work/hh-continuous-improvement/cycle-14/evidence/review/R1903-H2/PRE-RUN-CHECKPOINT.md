# R1903 / H2 pre-run checkpoint

Prepared after native epoch 02 assigned and persisted H2/R1903. This is an independent review of H1's exact two-file checkpoint. H2 may write only under this R1903 scratch directory. No PageRouter source/test/Git changes, build, native action, browser, or separate-lab action is authorized/performed.

## Independent review basis and bounded plan

Reviewed the exact controller/test diff, H1's frozen plan, full result record, contemporaneous pre-red controller/test snapshots, and original red/focused-green capture bytes. H1's original source/test hashes match its recorded pre-change snapshots: controller `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c`; test `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164`. Actual pre-change controller snapshot SHA-256 is `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c`; contemporaneous test snapshot SHA-256 is `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164`.

Current target source pins before this review run: controller `d730252e211af138383e76ca97b1cf39ddc8aabb4426b2d2ba5560cb58772669`; test `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164`. Current PageRouter HEAD/tree remain `06b6da36e326758ccd14cda021bc0a15cfd00817` / `eb7136f80b1bdfd08c771f519a626a1e508bb1a9`; the two source files are modified and the existing untracked `hh-cycle13/` scratch is preserved/out of scope.

Review conclusion expected: the service success-only `after` callback runs after runtime synchronization but before service's final `notify`, so it can atomically update controller identity/draft/community projection and have the tree render the authenticated identity. The outer redirect remains guarded by the route epoch. Failure outcomes do not execute the success callback; no failure/blank retention policy or credential boundary should change. H1's new test should fail pre-change at the final emitted-tree assertion after its preceding authority/draft/route/secret checks and pass after the change. It also covers a new successful synthetic identity, route away/back, and exactly one held login. The current success projection is a bounded correction, not evidence of mounted-DOM behavior.

Exactly two invocations are allowed, with independent raw streams and UTC/exit captures:

1. One focused rerun: outer argv `["bash", "/workspace/scratch/8528bb251845/hh-cycle14/H2/R1903/run-focused.sh"]`; inner argv `["node", "--test", "--test-name-pattern=held successful login projects authenticated email after route reentry", "checkpoint/vendor/hh/src/public-controller.test.mjs"]` from `/workspace/scratch/8528bb251845/PageRouter`.
2. One unchanged original E1902 probe replay against current source: outer argv `["bash", "/workspace/scratch/8528bb251845/hh-cycle14/H2/R1903/run-e1902-replay.sh"]`; inner argv `["node", "--unhandled-rejections=strict", "/workspace/scratch/8528bb251845/hh-cycle14/H2/E1902/probe.mjs"]` from `/workspace/scratch/8528bb251845`.

Expected focused observation: one selected test passes and all nonmatching tests are skipped. Expected replay: assertions pass, output remains JSON with `confirmed_reuse`, one explicit login and no additional writes, all secret-absence booleans true, successful session identity A projected after reentry. No changes to E1902's original probe script, no generated real-account/backend data, and no unmounted-DOM/browser claim. If either invocation hits a first unexpected harness failure, preserve captures and stop without retry, assertion edit, or overwrite.

Prospective captures are `focused.stdout.raw`, `focused.stderr.raw`, `focused.start.utc`, `focused.end.utc`, `focused.exit`, plus corresponding `replay.*` files in this directory. No automatic output rewrite. The exact script hashes and E1902 probe hash are listed in the receipt after checkpoint preparation.

## Frozen harness hashes and original provenance captures

| File | SHA-256 |
|---|---|
| `run-focused.sh` | `c22742762e87a2ddea60a627208a87f6e4841c853854b1090d7a41caa3b7cbb1` |
| `run-e1902-replay.sh` | `00ab9eb3c999a872369bf5d9adb75d8ae700a06ddabae6e49eb53c0fb66b2ca5` |
| Unchanged `../E1902/probe.mjs` | `6b8f640b0031ee0c4c62df7baed4b360dcf912445118f594c245ec4afcea1618` |
| H1 original pre-change controller snapshot | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| H1 contemporaneous pre-red test snapshot | `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164` |
| H1 original RED stdout | `46242f88463d6e9f4042a7746fd6bb0a0f749a9414038236f3954f54e7f72315` |
| H1 original RED stderr | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| H1 original GREEN stdout | `3a85ef2f178eafd780ab0cad4c5a7a5d8ce1e4abc80b24d9f80bd889b1a76f2d` |
| H1 original GREEN stderr | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

H1's original RED ran `2026-10-18T22:19:06.737900805Z`–`22:19:06.912360231Z`, exit 1, and failed only at the predeclared final emitted-tree assertion (actual B, expected A), after preceding assertions passed. H1's original focused GREEN ran `2026-10-18T22:19:30.528910129Z`–`22:19:30.694053137Z`, exit 0, 1 test passed. H1 separately reports 60/60 controller and 14/14 public-site tests passing; this independent rerun does not repeat those full suites.
