# HH12 H1 / E1703 pre-test review checkpoint

Native assignment: E1703 H1 was admitted and started at epoch 02. This checkpoint is a review pause before running tests. Only `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` was edited; controller, app, provider, build, native records, and Git were not changed. No test command has been run. Await root GO before any test execution.

## Actual test flow

The new test helper wraps the real volatile `createFixtureProvider` service map and holds only the first `TeacherProfile.createProfile` call. It separately counts profile-create calls and injects `transport_failure`, `outcome_unknown`, or no failure for a success control. Each case creates a synthetic account with an in-memory random password, approves/logs in through the actual controller flow, navigates to `#/profile`, and verifies the own profile is absent.

The test types a nonsecret initial `createDraft` through `controller.updateDraft`, dispatches `public:profile-create` with no payload so the controller must read the draft, waits at the held service boundary, then types newer values while the call is pending. `onChange` renders the actual `renderPublicSite` tree throughout. On held failure it asserts exact request classification, latest draft/form field retention, provider profile absence, no automatic call, `canRetry === false`, and `public:retry` returning `nothing_to_retry` without changing call count. A deliberate resubmit dispatches with no payload and must use the latest edits; success must create the profile and clear the draft/form. The ordinary success case is included in the same table. Random credentials are checked absent from controller state, runtime Parts, and storage by the existing `assertCredentialsNotPersisted` helper.

## Delegation and limits

`checkpoint/vendor/hh/src/app.mjs` lines 199–201 provide source evidence that the root's delegated `input` listener calls `controller.updateDraft(target.name, target.value)`. The new regression calls `updateDraft` directly, like the existing controller tests; it does not exercise DOM event delegation in a browser. This is source/controller/render-tree test coverage only, not mounted-browser evidence.

## Source-only expectation qualification before test execution

Root review caught a test expectation error before any run. At `public-controller.mjs` lines 780–795, the controller derives `name`, `bio`, and `wishlistUrl` into local constants before awaiting `service('TeacherProfile.createProfile', ...)`; the success branch then applies those captured values. Therefore, when a request is already successful but held and the draft is edited in flight, the completed profile should reflect the originally submitted values, not those later edits. The success-control expectation now checks the original `submittedDraft`; held failure still leaves current edits in `createDraft`, and an explicit later resubmit reads those latest values. This is a test-expectation correction based on source semantics, not a product defect or test failure.

The pre-correction unexecuted candidate is preserved exactly as `pre-expectation-correction.mjs.txt`, SHA-256 `fd36d5ac06919bbdb9b69b3e0fbbdb3219f9917f80ab682dd6d25deeccff6890`.

## Diff identity

- `git diff --stat`: one file, 115 insertions; no deletions.
- Current test source SHA-256: `f0304a33a0526dd94ba8e031986963d0c5f18e09fd101c7878194d2860c8f604`.
- Unchanged controller SHA-256: `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`.
- After the expectation correction and explicit root GO, focused regression passed 1/1, full controller suite passed 57/57 (prior 56 plus one new test), and public-site suite passed 14/14. Each command's raw stdout/stderr and actual exit status is stored under this E1703 directory with unique run filenames. No test failed; no source/test edits were made after these runs.
- No canonical build, Git action, publication, or deployment occurred. See `result.json` for exact commands, hashes, and output bindings.
