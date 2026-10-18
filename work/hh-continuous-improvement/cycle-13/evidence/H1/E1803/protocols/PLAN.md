# Login Email Draft Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after the native implementation packet is admitted.

**Goal:** Retain a user's login email in the in-memory login-form draft across pending requests and failures without changing registration identity, provider authority, or password privacy.

**Architecture:** Add a controller-owned `journey.loginDraft.email` with `null` as the “no edit yet” sentinel and string values—including `''`—as explicit input. Bind only login-route email input to this field and render it ahead of the existing session/registration fallback. Keep it outside provider/runtime state; clear it only when login succeeds or authority is explicitly reset by successful logout/demo reset.

**Tech Stack:** Existing Node.js ES modules, `node:test`, in-memory fixture provider/runtime, and `renderPublicSite` tree assertions.

**Spec:** `hh-cycle13/brief.txt`, `hh-cycle13/H1/E1801/result.json`, and independent `hh-cycle13/H2/E1802/result.json` (root-admitted finding; do not expand into browser/backend work).

## Global Constraints

- Touch only `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs`, `PageRouter/checkpoint/vendor/hh/src/public-site.mjs`, and `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs`.
- Use the existing `codex/hh-continuous-improvement` branch; no new branch, fetch, reset, force, main, publication, or deployment.
- Login email draft is volatile controller/UI state only; it must not mutate confirmed registration identity or provider session/registration state.
- Password values remain only in transient input/payload and the existing credential boundary; never add them to controller state, Parts, runtime state, storage, receipts, logs, or test output.
- Keep existing login validation, provider call shape, success navigation, auth authority, and no-automatic-login-retry behavior unchanged.
- Keep browser QA explicitly unverified unless root admits a supported browser route separately.

## Review Focus

- Initial fallback: before any login edit, the existing session-email-then-registration-email projection remains unchanged; test with no draft and with each fallback populated.
- Explicit blank: after an input event with `''`, render blank instead of repopulating the fallback; include an assertion after provider completion.
- Mid-request edit: a newer email entered while `Session.login` is held survives the completion render, independent of the submitted payload.
- Authority separation: failed/pending login never authenticates, mutates registration identity, or copies the draft into session email; valid fixture success still authenticates only through the provider result.
- Secret handling: random credentials are absent from controller state, runtime snapshot/inspection, Parts, storage, and rendered tree for failure and success cases.

---

## Files and responsibilities

- Modify `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs`: initialize the nullable login draft, bind route-scoped email input, and clear draft on successful authority transitions only.
- Modify `PageRouter/checkpoint/vendor/hh/src/public-site.mjs`: project an explicitly present draft value—including empty string—before the current session/registration fallback.
- Modify `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs`: add red-first volatile provider/render-tree regression tests using the existing `createFixtureProvider`, `createServiceRuntime`, `renderPublicSite`, deferred service-wrapper, and credential non-retention patterns.

No service/provider/runtime/app changes are proposed. `app.mjs` already delegates named input fields to `controller.updateDraft`; preserve that contract.

### Task 1: Pin login draft behavior in controller/render-tree tests

**Files:**
- Modify: `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs`
- Test command (from `PageRouter/checkpoint`): `node --test vendor/hh/src/public-controller.test.mjs`

**Interfaces:**
- Reuse `controller.updateDraft(name, value)`, `controller.dispatch('public:login', payload)`, `controller.state`, `runtime.snapshot()`, `runtime.inspect()`, `runtime.pxc.entries()`, and the current `renderPublicSite` projection.
- Add a test fixture that wraps only `base.services['Session.login']`, gates each call, then either passes supported `failWith:'transport_failure'` to the real fixture provider or invokes it unchanged for natural `pending_denied`/success outcomes. Do not fake `runtime.invoke` or provider results.

- [ ] **Step 1: Add failing test `login draft retains typed newer and explicit blank email through held failures`**

  Prepare one pending synthetic `.test` teacher through the volatile fixture runtime. On `#/login`, call the same named-field `updateDraft('email', value)` path used by `app.mjs`, capture each submit payload using transient `FormData` semantics, and use a random in-memory UUID password.

  Hold the first login call, assert draft email renders during `busy`, update it to a newer email while held and assert the tree updates, release a known `transport_failure`, then assert the newer email remains rendered, the route stays login, state stays anonymous, and no provider state changed. Assert `public:retry` returns `nothing_to_retry` without increasing `Session.login` call count.

  Start an explicit second login using the pending synthetic identity. While held, call `updateDraft('email', '')`; after the real provider returns `pending_denied`, assert the field remains explicitly blank (not session/registration fallback), the registration remains pending, and session remains anonymous. This test owns the Review Focus cases “explicit blank,” “mid-request edit,” and “authority separation.”

- [ ] **Step 2: Run the focused test to verify the expected red**

  Run from `PageRouter/checkpoint`: `node --test --test-name-pattern='login draft retains typed newer and explicit blank email through held failures' vendor/hh/src/public-controller.test.mjs`.

  Expected before implementation: fail because `updateDraft('email', ...)` returns `false` on `login` and the render projection falls back to old identity. Preserve this red evidence; do not broaden the test to a product redesign.

- [ ] **Step 3: Add failing test `login draft preserves current default and clears after successful authority change`**

  Assert no draft preserves the existing session-email/registration-email fallback order; assert a nonblank login draft overrides that fallback; then authenticate using the seeded approved fixture identity and assert provider-backed authenticated session, expected success navigation, and a cleared/null login draft. Complete successful logout and assert no stale typed draft overrides the existing fallback on the login route. Set a draft again, perform successful fixture `public:reset`, revisit login, and assert the reset draft does not reappear. Use random UUID password values and assert each is absent from `controller.state`, runtime snapshot/inspection, Parts, storage, and rendered tree.

- [ ] **Step 4: Run both focused tests and verify expected red**

  Run from `PageRouter/checkpoint`: `node --test --test-name-pattern='login draft' vendor/hh/src/public-controller.test.mjs`.

  Expected before implementation: the default fallback assertion passes; draft projection/clear assertions fail. Retain exact output and exit status for root review.

### Task 2: Implement the smallest controller/render projection

**Files:**
- Modify: `PageRouter/checkpoint/vendor/hh/src/public-controller.mjs`
- Modify: `PageRouter/checkpoint/vendor/hh/src/public-site.mjs`

**Interfaces:**
- Produce `state.journey.loginDraft = {email: null}` at controller initialization. `null` means “use current session/registration fallback”; any string—including `''`—means the user has explicitly edited the field.
- `updateDraft('email', value)` on route `login` sets `state.journey.loginDraft.email = boundedDraft(value, 254)`, calls the existing `onChange` callback, and returns `true`. Other routes keep their current email-draft behavior.

- [ ] **Step 1: Implement the route-scoped login email draft branch**

  Add the dedicated nullable draft in controller UI state and the login-only email branch in `updateDraft`. Do not write to `state.journey.session`, `state.journey.registration.identity`, runtime snapshot, storage, or any provider/API call from `updateDraft`.

- [ ] **Step 2: Implement explicit-value-first login projection**

  In the login renderer, use `loginDraft.email` whenever it is non-null/non-undefined; otherwise preserve the current `session.email || registration.identity.email || ''` fallback exactly. Do not use truthiness for the draft check, because it would erase explicit blank.

- [ ] **Step 3: Retire the draft only on successful authority transitions**

  On successful `public:login`, successful `public:logout`, and successful fixture `public:reset`, restore `{email: null}`. Do not clear it on validation, transport, auth denial, outcome-unknown failure, pending requests, or route changes. Keep the existing `state.journey.session.email` success assignment and provider authority path unchanged.

### Task 3: Verify and hand off for independent review

**Files:**
- Test only: `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs`
- Source only: the two implementation paths above.

- [ ] **Step 1: Run focused regression tests**

  Run from `PageRouter/checkpoint`: `node --test --test-name-pattern='login draft' vendor/hh/src/public-controller.test.mjs`.

  Expected: both new tests pass; assertions establish the held transport failure, natural pending denial, explicit resubmission/retry count, default and blank rendering, success/session authority, logout cleanup, and credential non-retention.

- [ ] **Step 2: Run the complete HH controller test file**

  Run from `PageRouter/checkpoint`: `node --test vendor/hh/src/public-controller.test.mjs`.

  Expected: all tests pass. Do not run a source build or broader suite until root admits that verification stage.

- [ ] **Step 3: Freeze exact source/test hashes and request H2 review**

  Record only the three allowed product paths and their exact hashes in a proposal checkpoint. H2 reviews the frozen exact diff/hash independently; H1 must not review its own source change. Do not commit or publish without root's later approval.

## Explicit exclusions

- No durable/localStorage/sessionStorage login draft.
- No login email added to registration identity, service/provider state, or extra runtime/receipt fields. The existing `Session.login` request email is expected and remains unchanged.
- No password-draft handling, password persistence, login retry policy, auth/session semantics, copy changes, layout redesign, browser workaround, backend connection, or account/provider mutation.
- No source, test, build, Git, native, or browser action is authorized by this proposal itself.
