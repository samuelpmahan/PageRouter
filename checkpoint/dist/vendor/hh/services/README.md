# HH Teacher Journey fixture services

Entry imports: `createFixtureProvider`, `createHttpProvider`, `createServiceRuntime`, `HH_PORTS`, `HH_MESSAGES`, `initialJourney`, `FIXTURE_WISHLIST_URL` from `./services/index.mjs`.

```js
const provider = createFixtureProvider({fixture: true, storage: window.sessionStorage});
const runtime = createServiceRuntime(provider);
await runtime.ready;
const states = await runtime.invoke('SchoolData.getStates');
const result = await runtime.invoke('Registration.registerTeacher', {
  teacher: {name: 'Demo Teacher', email: 'new-teacher@fixture.test', phoneNumber: 'DEMO'},
  school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'},
  termsAccepted: true, demoAccount: true,
});
const viewState = runtime.snapshot(); // Pure, already-loaded memory projection. No service invoked.
```

All ports return an immutable `{ok, port, mode, fixture, outcome, data, message, error?}`. Errors carry `{code, message, retryable, outcomeKnown}`. No exceptions or implicit fixture fallback represent HTTP success.

## Inputs and outputs

- SchoolData.getStates(): data.values string[]
- SchoolData.getCounties({state}), getDistricts({state, county}), getSchools({state, county, district}): data.values string[]
- Registration.registerTeacher({teacher:{name,email,phoneNumber}, school:{state,county,district,school}, termsAccepted:true, demoAccount:true, simulateMailFailure?:true}): pending_saved. data.pending_saved stays true if simulated mail fails; data.mail.status is simulated_sent or simulated_failed. Duplicate results are already_pending or registered_email
- Registration.getOwnStatus(): data.registration; current demo identity is the latest registered/selected identity
- Session.getSession(): data.session
- Session.login({email, demoAccount:true}): logged_in only after approval; no password authentication is claimed
- Session.logout(): logged_out
- TeacherProfile.createProfile({displayName, bio, subjects:string[], wishlistUrl:string}): profile_created. Requires authenticated approved teacher, one profile per teacher. wishlistUrl is a required synthetic Amazon-wishlist-shaped URL, such as exported FIXTURE_WISHLIST_URL (`https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW`). Only shape is checked; it is never fetched or navigated. The UI must display it as inert fixture text. No wishlist items model exists
- TeacherProfile.getOwnProfile(): data.ownProfile
- TeacherProfile.openPublicProfile({profileId}): data.profile (public projection only)
- Demo.simulateApproval({teacherId?}): approval_simulated, using current identity by default. Never logs in
- Demo.reset(): reset, preserving immutable seed public profiles and clearing new session-only identities/profiles

Optional runtime.invoke third argument `{credentials:{password,confirmPassword}}` is consumed only as ephemeral confirmation validation at the boundary. The values are never stored, inserted into Parts, or attached to receipts. In demo mode credentials are unnecessary; use the explicit demoAccount flow. Nested credential keys in regular input are rejected without creating Parts. Raw personal details belong only in synthetic demo input: email must end in .test, name must start `Demo `, and phone must be `DEMO` or empty.

Provider metadata: `.mode`, `.fixture`, `.capabilities`, `.diagnostics`, `.snapshot()` and `.services[fullPortName](input)`. Fixture initialization may report storage_unavailable/storage_invalid; it does not silently switch from failed storage to a successful write. For unit tests pass a Storage-like object. Omitted storage uses window.sessionStorage in a browser and ephemeral memory outside it, explicitly marked by `.diagnostics.persistence`.

The pure snapshot's `demo.selectedTeacher` and `demo.selectedSchool` are safe cloned synthetic current-identity details, or null. They survive same-tab reload and let profile forms show the school actually selected during registration; do not substitute a hard-coded school label.

`demo.publicProfiles` is the loaded public-safe directory: immutable seed profiles first, then already-created session profiles in record order. Existing profile IDs are preserved; duplicate IDs are removed with immutable seed precedence, matching openPublicProfile. This is a pure projection, not a new service port or storage mutation. It exposes only the existing public profile allowlist, never teacher email/phone. Pending registrations and approved teachers without a profile add no directory entry; registration/approval rules are unchanged. Seed links are reproducible in fresh tabs; newly created profiles remain tab-only and survive logout/reload until reset.

Wishlist URL shape: https, www.amazon.com, no port/userinfo/query/fragment, and `/hz/wishlist/ls/DEMO-...` with uppercase alphanumeric fixture labels separated by hyphens. Credential-bearing URL inputs are rejected before any Part is recorded. Older interim stored profiles using wishlist item arrays are explicitly invalid and require Demo reset; they are never converted into a purported wishlist link.

Snapshots have separate `session.status` (anonymous/authenticated), `registration.status` (none/pending/approved), `ownProfile.status` (unknown while anonymous, absent/present while authenticated), and `request.status` (idle; the UI owns busy/completed/rejected/failed/outcome_unknown). Pure project/seek functions must only read snapshots/capabilities; effects are invoked exclusively by explicit event handlers. In-flight mutation guards and stale read protection belong to the integration layer.

`createHttpProvider()` implements every port with typed unsupported results. Its snapshot uses unknown session/registration/profile state because no server read has established them. Endpoint declarations preserve the surviving known route names but do not claim parity or execute fetch. Own/public profile reads have the disclosed legacy shared selected-teacher session limitation. Python remains the real authentication/authorization authority. Browser fixture approval proves no production security property.

Failure injection for fixture events: input.failWith can be `transport_failure`, `store_failure`, `outcome_unknown` or `denied` (checked before mutations); registration also accepts simulateMailFailure. This is demo-only and visible in result data. Failed writes preserve the previous memory and storage state. Unknown outcome does not imply success and must never be automatically retried.

The copied real Part/PxC kernel is byte-for-byte from `hh-registration-slice/source/hh_registration_preview/static/pxc.mjs`. Runtime provider binding and every explicit service invocation use that kernel's function-valued Parts and named composition inputs. It is an isolated local experiment, not a new production kernel.

## Existing PxC DevTools adapter

Fixture runtime.devtoolsBoard supplies the existing component's entries/get/receipts/set/compose protocol. Entries and retained receipts reference the actual runtime Parts; no copied board, invented UI composition or execution receipts are created. Visible data is frozen plain safe material; produced Parts are retained only when their actual Calculation/input edges stay inside the visible set. Provider Part, binder Calculation, binding result and initial binder receipt are excluded. Foreign/internal objects, getters and secret-bearing material are excluded without calling them. HTTP runtimes expose null here.

set and compose reject. The integration must mount the existing component with readOnly:true and omit every live invocation, member/getter/setter call, scratch, playground and serialization action. Actual service function Parts remain the real functions, inspectable as source/metadata without reflecting their private closures. This preserves real Part references and is read-only UI inspection, not a JavaScript sandbox. Opening, refreshing, searching and following visible actual composition links must not execute a Calculation or change session/storage.
