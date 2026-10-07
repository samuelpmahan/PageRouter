# HH fixture service checkpoint

## Written and executed

Implementation: `services/index.mjs` → `runtime.mjs`, `fixture-provider.mjs`, `http-provider.mjs`.

Checkpoint explanations were sent to the parent before execution. The accepted implementation scope included short local tests. Following the authorized existing DevTools adapter, executed `node --test --test-reporter=tap tests/services/services.test.mjs`: **24 passed, 0 failed**. Executed `node tests/services/flow-evidence.mjs`: **12 actual service-flow steps passed**, including same-tab reload, independent fresh-storage isolation, reset, wishlistUrl preservation, directory identity, and side-effect-free read-only DevTools protocol traversal. The precise results are in `tests/services/test-output.tap` and `tests/services/flow-evidence.json`.

No application execution, browser rendering, website publishing, Drive upload, production request, or external communication was performed by this service lane. The integration owner owns those separately.

## Entry point

```js
const provider = createFixtureProvider({fixture: true, storage: window.sessionStorage});
const runtime = createServiceRuntime(provider);
await runtime.ready;
await runtime.invoke('Registration.registerTeacher', safeSyntheticInput);
```

## Actual execution order

1. The explicit fixture provider loads only validated synthetic `.test`/`Demo` state from its per-tab Storage-like backing. Invalid or inaccessible storage is visible and blocks writes; invalid state requires an explicit reset. Immutable seeds have stable public IDs.
2. Runtime records the contract, provider, capabilities, and binding Calculation as real Parts in the recovered kernel. It composes the provider binding, producing one function-valued Part per declared port. Binding does not call the service effects.
3. An event calls `invoke`. Secret-bearing regular inputs are rejected before any request Part is created. Optional raw credentials are reduced to one confirmation boolean outside Parts. Only safe frozen input is addressed.
4. PxC composes the selected service functionPart with named `request` input into the addressed result. Provider exceptions become a sanitized unknown-outcome result before kernel receipts are produced.
5. Registration validates a synthetic identity and an exact lookup row, commits a pending record, then reports simulated mail success/failure. Simulated failure still reports `pending_saved: true`. Case-insensitive duplicate identity never creates a second account.
6. Approval changes registration to approved and does not log in. Explicit demo login selects that same approved identity. Profile creation requires that identity's active demo session, a shape-validated synthetic wishlistUrl string, and refuses a second profile. Validation uses local URL parsing only; no URL is fetched or navigated. No items model is accepted or emitted.
7. A pure public directory index starts with immutable seeds and adds only already-existing session profiles, preserving IDs and record order and removing duplicate IDs with seed precedence. Snapshot directory and public reads share this index and the existing allowlist, without private email/phone. No profile-creation effect, port, storage field or approval-policy filter was added. Pending registrations and approval without a profile produce no new directory entry. New profile IDs survive logout/reload with their per-tab state, disappear on reset, and are absent with independent fresh storage. No claim is made about browser-specific duplicate-tab copying of sessionStorage.
8. Every mutation writes its candidate state before replacing memory, so known failed writes preserve prior state. Reset removes disposable persisted state and restores seed data. Snapshot/inspection only read already-loaded memory, making them suitable inputs to the pure UI seek tree.

## Invocation table

| Calculation Part | Input Parts | Actual arguments | Output Part |
|---|---|---|---|
| hh.calculation.bind-service-functions | hh.provider | `{provider}` | hh.service-bindings, whose values are functionParts |
| hh.service.SchoolData.* | hh.request.N | `{request: parent lookup keys}` | hh.result.N with typed values/result |
| hh.service.Registration.registerTeacher | hh.request.N | `{request: synthetic teacher, exact school, demo/terms flags, confirmation boolean?}` | hh.result.N, pending_saved or typed denial |
| hh.service.Demo.simulateApproval | hh.request.N | `{request: teacherId?}` | hh.result.N, approved registration + unchanged session |
| hh.service.Session.login/logout | hh.request.N | `{request: synthetic email + demo flag}` / empty | hh.result.N, confirmed fixture session |
| hh.service.TeacherProfile.createProfile | hh.request.N | `{request: synthetic displayName/bio/subjects/wishlistUrl}` | hh.result.N, one public profile projection with inert wishlist URL |
| hh.service.TeacherProfile.* reads | hh.request.N | empty or `{profileId}` | hh.result.N, own/public profile projection |
| hh.service.Demo.reset | hh.request.N | empty | hh.result.N, reset journey |

## Shared machinery and inspection

The kernel supplies named-input resolution, address reservation, functionPart execution, immutable receipt records, and output composition provenance. The caller supplies provider selection, safe request data, event timing, repeated-submit guards, stale-read guards, and route handling. `runtime.pxc` exposes the actual Part/PxC graph; `runtime.inspect()` supplies only safe address/kind and receipt binding summaries. `runtime.snapshot()` contains independently modeled registration, session, own-profile state and selected synthetic school for reload-safe UI labels.

`runtime.devtoolsBoard` supplies the existing DevTools component's entries/get/receipts/set/compose protocol in fixture mode. It is a filtered view of actual Parts/receipts, not another board. Provider/binder/binding result and initial binder receipt are omitted. Frozen plain safe request/result data and closed actual service composition edges remain inspectable; unsafe/internal/accessor material is excluded without calling getters. get/entries/receipts perform no composition or mutation, while set/compose reject. HTTP has no board. Existing real function Parts retain callable values for identity/source inspection; the integration owner must omit every live invoke/member/getter/setter/scratch/playground/serialization action in the reused component's readOnly mode. This is not a JavaScript sandbox. No UI composition or execution receipts are fabricated.

## Boundaries and review

- HTTP declares the same ports but every method is unsupported, sends no request, and never falls back to fixture success. Its initial session/registration state is unknown
- Python remains the real backend authority; fixture browser state is user-editable and establishes no production authentication or district-authorization property
- Wishlist link field is a synthetic Amazon-wishlist-shaped wishlistUrl string, shape-validated and displayed inertly. No fetching/navigation, items, prices, quantities, scraping or payments exist. Interim item-array stored state is invalid and requires Demo reset
- Password authentication, real email, profile editing, external wishlist navigation, payment, admin validation, and production database access are absent
- Browser Back/Forward, responsive rendering, repeated events and stale reads are integration-level proof, outside this service test result
- Reciprocal review with the integration owner accepted the service boundary; requested UI refinements were unknown-outcome classification, reset stale-public-read invalidation, and branch-specific lookup retry clearing

The accepted bounded service flow is implemented and locally proven. Browser behavior and publication remain separate evidence levels.
