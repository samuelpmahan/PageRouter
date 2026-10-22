# HH11 H1/E1603 test-flow checkpoint

## Written in

One table-driven regression has been added only to `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` (current SHA-256 `e11885f0f55e56094bed3e865d9acfcb57fc995097d5be627f9ebed3631d89a3`). It has not been executed, syntax-checked, rendered, or published. The controller (`fbb5803a…`) and renderer (`96d930a2…`) remain unchanged; current worktree diff is limited to that one test file.

## Entry point

The added test is named `held registration completion on login preserves transaction classification without replay`.

After root authorizes testing, planned commands from `/workspace/scratch/8528bb251845/PageRouter` are:

```sh
node --test --test-concurrency=2 --test-name-pattern='held registration completion on login preserves transaction classification without replay' checkpoint/vendor/hh/src/public-controller.test.mjs
node --test --test-concurrency=2 checkpoint/vendor/hh/src/public-controller.test.mjs
node --test --test-concurrency=2 checkpoint/vendor/hh/src/public-site.test.mjs
```

The focused command exercises only the new test. The next runs the entire controller suite; the last is the bounded relevant nonstyle renderer suite. No canonical build, style suite, or browser smoke is included.

## Numbered walkthrough

1. The test iterates one three-row scenario table: known `transport_failure`, `outcome_unknown`, and provider success. Each row gets a fresh `registrationFailureSetup`, which supplies the real fixture provider and runtime, memory-only storage, actual controller, actual `renderPublicSite` callback, and a gate on `Registration.registerTeacher`.
2. It creates a synthetic `.example.test` identity and password via `randomUUID()` at runtime, prepares the existing valid Demo Washington → Demo King → Demo District → Demo Academy registration form, accepts terms, and dispatches the real `public:register` event.
3. Once the existing gate reports the registration provider call has started, the test confirms one call is held and moves the same controller to `#/login`. It asserts the current rendered page is login, the login form exists, and its submit control is enabled before releasing the provider.
4. It releases the original provider request and captures completion-phase route/form availability, enabled state, controller request status, result success/error classification, fixture registration status, retry availability, and registration call count. It does not assert global feedback text, kind, styling, or visibility policy.
5. Known and unknown failures must retain the provider's respective code and outcome-known classification, leave fixture registration absent, and expose no safe retry. A `public:retry` dispatch must return `nothing_to_retry` without a second registration call. Success must return `pending_saved`, leave the fixture registration pending, and also make no retry available.
6. Before a separate invalid-login dispatch changes the current request/outcome fields, the test checks the password against controller state, runtime snapshot, runtime inspection, actual PxC Part values, volatile storage, and actual rendered tree. It then sends `public:login` with invalid values, verifies the existing `validation_failed` path on the current login form, checks submit remains enabled, and confirms no registration write was added. Password absence is checked again afterward.

## Invocation table

| Scenario | Controller call and provider gate | Expected transaction classification |
|---|---|---|
| Known failure | `public:register` → hold `Registration.registerTeacher` → navigate login → release | result `transport_failure`, `outcomeKnown: true`, request `failed`, provider registration `none`, retry unavailable |
| Unknown outcome | `public:register` → hold `Registration.registerTeacher` → navigate login → release | result `outcome_unknown`, `outcomeKnown: false`, request `outcome_unknown`, provider registration `none`, retry unavailable |
| Success control | `public:register` → hold `Registration.registerTeacher` → navigate login → release | result `pending_saved`, request `completed`, provider registration `pending` |

Each row then performs the distinct login local-validation control after the completion snapshot. The provider path is the existing fixture service through the real service-binding Calculation/Parts; the test only supplies the held gate and selected failure code.

## Shared machinery

The existing `registrationFailureSetup` gate pauses only the selected registration provider call and increments its `registrationCalls` counter. The existing `prepareRegistrationDraft` drives actual school lookup selection and delegated non-secret drafts. Existing controller/runtime logic owns request lifecycle, navigation, credential boundary behavior, runtime synchronization, Parts, snapshot, and rendering. No product code or provider behavior is changed.

## Inspection

The test inspects actual controller route, rendered root page identity, login form and submit node, provider result and snapshot, controller status, runtime inspection, actual PxC values, memory storage, and rendered tree. It never inspects or freezes the wording or presentation policy of global `journey.outcome` feedback. No stdout is expected from the test itself; any failure should not print generated secrets.

## Explicit boundaries

- This is an expected-first-pass behavior-only compatibility regression, not a red-before-fix exercise, defect correction, or UI acceptance claim.
- Only the test file may change. Controller, app, renderer, runtime, previous fixes, source build, and Git refs stay frozen.
- The test uses volatile local fixtures only; no real provider/backend/account, network, Python runtime, browser, or production authority.
- E1601/H1 and E1602/H2 observed global success/failure feedback, but unintended behavior and mounted-browser reachability remain unestablished.
- Preserve the prospective command record, raw stdout/stderr, actual exits, source hashes, and completion-phase values. Stop at the first actual failure and do not overwrite or rerun until root-scoped diagnosis.

## Review

This explains the actual added test and its three provider paths. Await root checkpoint GO before executing any command above.
