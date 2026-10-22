# H2 / R1603 independent review checkpoint

This is a read-only review of H1's E1603 test-only change. One independent focused run of the new table test is planned using the exact command in `command.txt`; it is not the unchanged E1602 probe, full suite, or canonical build. The run-once wrapper uses no-clobber raw output/exit paths. No product edit or Git/native write is in scope.

## Inputs reviewed

- Cycle contract: `hh-cycle11/regression-brief.md`, `spec.json`, and `run-contract.json`.
- H1 flow: `hh-cycle11/H1/E1603/FLOW-CHECKPOINT.md`; original focused/controller/public-site raw logs, exits, command wrappers, and result.
- Actual diff: exactly one added table-driven test in `checkpoint/vendor/hh/src/public-controller.test.mjs`, SHA-256 `e11885f0f55e56094bed3e865d9acfcb57fc995097d5be627f9ebed3631d89a3`.
- Unchanged controller SHA-256 `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`; unchanged renderer SHA-256 `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4`.

## Review focus and assertions

The single test iterates isolated known-failure, unknown-outcome, and successful-pending scenarios using the existing held `Registration.registerTeacher` fixture helper. In each, it verifies the login route/tree/form and enabled submit before release and after completion; checks result code/success, known-vs-unknown flag, request-status classification, provider registration state, retry availability, and a one-call bound; checks credential non-occurrence in controller/runtime snapshot/inspection/actual PxC Part values/storage/tree before then after a separate invalid-login validation; and verifies validation does not create a registration call. Failed and unknown scenarios explicitly try `public:retry` and require `nothing_to_retry` with call count still one.

The test does not assert global feedback wording, kind, styling, or visibility and does not change controller, app, provider, or renderer behavior. This is compatibility protection, not a defect fix or browser acceptance. `spec.json`'s cycle source/tree/main IDs are parent-provided; H2 does not assert Git state.

## Expected review disposition

Expected-first-pass regression. The claims are tied to observable controller/render-tree/runtime/fixture outcomes and test the behavior without freezing the unresolved global-feedback policy. The focused run is an independent confirmation only. If it exits nonzero, preserve exact failure bytes and stop; do not repair, rerun, or widen.
