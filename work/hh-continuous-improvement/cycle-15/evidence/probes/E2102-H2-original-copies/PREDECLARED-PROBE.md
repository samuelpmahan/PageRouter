# E2102 H2 predeclared probe

Scope: independent, bounded read-only probe of the current volatile fixture provider, public controller, and emitted `renderPublicSite` tree. No source/product edits, Git/native/Lab operations, real backend/email, passwords, reset calls, browser DOM, `FormData` execution, screenshots, or visual QA.

## Source path checked before execution

- `src/app.mjs` constructs the fixture provider and runtime; its delegated `submit` handler calls `reportValidity()`, builds `FormData`, dispatches `data-submit`, and its delegated `input` handler calls `controller.updateDraft(name, value)`.
- The forgot renderer has `required` + `type=email`, starts its input value as `''`, and says reset instructions will be emailed.
- `updateDraft` supports email for login/register/contact but has no forgot-page branch.
- The `public:forgot` controller branch validates the payload and, for a valid address, returns local `remote:false` copy that says no email was sent. It does not appear to invoke a provider service.
- Existing tests cover the route alias, renderer copy/form, and one valid dispatch's `remote:false`; they do not cover forgot draft state or navigation/reentry retention.
- `initialize` explicitly invokes `SchoolData.getStates` before navigating. Provider service deltas will therefore be compared after initialization against the immediately-pre-init baseline, not asserted as a total count.

## One planned flow

Using one fresh `createFixtureProvider({fixture:true})` with volatile in-memory persistence and one controller/runtime instance:

1. Record capabilities and provider-call/runtime receipt baseline.
2. Initialize `#/forgot-password`; capture actual route alias, emitted title/copy/form/input attributes+value, and the exact provider call delta attributable to initialization.
3. Mirror the app's delegated input handler once with a nonsecret synthetic email using `updateDraft('email', value)`; capture return, current route state projection, and a freshly rendered forgot tree.
4. Dispatch one malformed synthetic email payload; capture result and provider-call delta.
5. Dispatch one valid synthetic email payload; capture result/message/remote and provider-call delta.
6. Navigate to `#/login`, then back to `#/forgot-password`; capture the fresh forgot input value and safe draft-state projection.

No loops, retry, rerun, or assertion-driven early abort. If this invocation fails, preserve the failure and stop.

## Predictions before the probe

- The route normalizes to `forgot`; initial emitted input is empty, `required`, and `type=email`; visible copy promises email instructions.
- Initialization adds exactly the explicit `SchoolData.getStates` fixture service call.
- The delegated input-handler target `email` on `forgot` is rejected by `updateDraft` (false); no forgot email draft is added to controller state, so a fresh rendered tree remains empty.
- Malformed forgot payload is rejected locally and adds no provider call. Valid payload returns `ok:true`, `remote:false`, and explicit no-email-sent message, also adding no provider call.
- Navigation/reentry renders the forgot input empty; no retention behavior is established.

## Falsifiers / interpretation bounds

- Any supported forgot draft, accepted `updateDraft`, nonempty fresh tree/reentry value, or persisted controller state falsifies the corresponding retention prediction.
- Any provider service invocation from a forgot dispatch falsifies the no-provider-call prediction. Initialization's `SchoolData.getStates` is separately expected and must not be misattributed.
- Missing promise copy, connected/remote outcome, or omitted explicit no-email-sent message falsifies the copy/capability mismatch prediction.
- Confirmation of the current copy/dispatch mismatch supports only a source-provenance mismatch in this local preview. Email retention being absent is an untested behavior, not by itself a product defect or a user requirement.
- This probe cannot establish browser `reportValidity`/`FormData` runtime behavior, real DOM input behavior, external/backend capability, captured-reference fidelity beyond checked-in emitted source, product intent, or human acceptance.
