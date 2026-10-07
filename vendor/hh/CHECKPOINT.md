# Written flow and validation checkpoint

Written in the new `nctk-hh` workspace. The initial source checkpoint was exact-ID read back and extracted-manifest verified before application validation. This is a bounded continuation from surviving UI, not the missing rewrite.

## Entry point

`createServiceRuntime(createFixtureProvider({fixture:true,storage:window.sessionStorage}))` → `createController(runtime)` → `controller.initialize(location.hash)` → `TeacherJourney.seek(route,state,capabilities,viewport)` → DOM nodes.

## Actual order

1. Bind the injected provider’s function-valued Parts through the recovered PxC. This creates service functionParts; it does not call school/profile/auth services.
2. The controller loads fixture states explicitly, restores the synthetic session snapshot, parses the route and requests a public profile only for a public route.
3. Pure `project` derives anonymous/authenticated, pending/approved, own-profile unknown/absent/present and request states from already-loaded memory. `seek` returns a declarative tree with form/button event descriptors. Rendering itself invokes no service.
4. School selection clears downstream choices and explicitly calls the next lookup. School-read generations ignore an older response after the selection branch changes.
5. Registration submits the locked synthetic identity and selected fixture school. The provider saves pending state; simulated email failure can still mean pending saved.
6. Simulated approval changes only the pending record, keeping the session anonymous. Demo login is a separate explicit event.
7. Login enables creation of one synthetic profile and wishlist link. Registered school is loaded from the restored snapshot so labels remain correct across reload.
8. A public route reads a public projection. Seed IDs are stable; newly created IDs are only usable in their original tab’s session.
9. Logout removes the synthetic session. Reset deletes disposable tab records, preserves seeds, and invalidates outstanding public and school reads.

## Invocation mapping

| Caller event | Calculation | Input Part’s actual fields | Output Part |
| --- | --- | --- | --- |
| Startup | bind-service-functions | provider Part | service bindings/functionParts |
| State/county/district selection | corresponding SchoolData functionPart | selected parent strings | lookup values |
| Submit demo registration | Registration.registerTeacher | synthetic teacher, fixture school, demo consent | pending_saved/error envelope |
| Simulate approval | Demo.simulateApproval | selected identity | approval_simulated, still anonymous |
| Demo login | Session.login | selected `.test` email, demoAccount:true | logged_in/error envelope |
| Create profile | TeacherProfile.createProfile | Demo display name, synthetic bio, synthetic wishlistUrl | profile_created/error envelope |
| Public navigation | TeacherProfile.openPublicProfile | explicit profileId | public projection/not_found |
| Logout/reset | Session.logout / Demo.reset | empty request | logged_out/reset/error envelope |

`services/CHECKPOINT.md` records the kernel’s address and provenance detail. The kernel handles named input resolution, reservations, result Parts and receipts; the caller supplies provider selection, event timing, route management, mutation guards and stale-read protection.

## Inspection and boundaries

User-visible inspection is the actual responsive UI, profile routes, typed error notices and nine captured desktop/mobile screenshots. A known failure can be retried; unknown outcomes never imply success or auto-retry. Repeated mutations are guarded. Pure projection is tested without creating receipts. Password values never enter stored state or Parts. Content-security policy forbids external network connections, forms, frames and third-party scripts.

HTTP ports remain explicitly unsupported and send no request. Production Python is still the real authorization authority. Profile edits, real login/email, external Amazon/purchase navigation and durable/shared records are outside this slice. Native browser WebMCP validation was unavailable; the registry harness tests names, schemas, valid/invalid inputs and visible-state effects but does not claim native browser support.

The prior scoped go-ahead authorized the validation and owner-private preview publication described here.

## C4 directory correction

The reported screenshots showed an already-created Demo Teacher profile missing from Teachers. The cause was a hard-coded UI seed array plus a seed-only `snapshot.demo.publicProfiles` projection. Profile creation and public reads already worked.

The approved correction reuses that loaded snapshot field. The provider projects immutable seeds plus existing session profile records through its public allowlist, keeping existing IDs and seed precedence. It creates no teacher/profile record, changes no approval policy and adds no port. Teachers navigation refreshes the pure runtime snapshot; `seek` renders the returned records and links each card to its existing public profile ID. Seed cards say “Stable demo profile”; new cards say “This tab only.” No email or phone is projected and no biography is invented for the directory.

Proof scope: pending/approval without a profile stays unchanged; create adds one directory card; the card opens the same public ID; reload and logout preserve it without duplicates; reset restores seeds; repeated snapshot/seek creates no effects; desktop and mobile screenshots show the created card.

## C5 existing PxC DevTools reuse (written before validation)

Sam asked to add the existing component. The copied `pxc-devtools/devtools.mjs`, data helpers and CSS come from the surviving DiscStudio DevTools, with their original-byte hashes in DEVTOOLS_REUSE.json. This is the existing inventory, material browser, actual Part backlink view and execution-receipt UI, with a small read-only/host option rather than a new inspector framework.

After normal controller initialization, `mountDevTools(runtime.devtoolsBoard, {label:'Teacher journey',readOnly:true,app:root})` mounts the existing navigation outside the replaceable journey DOM. The existing “PxC DevTools” button works on touch/keyboard. Double-clicking the Teacher journey heading, or Enter/Space on it, opens the same component. Returning to Teacher journey or Escape closes it and restores focus. Opening/refreshing reads entries/receipts only, never calls runtime.invoke, creates a Part or executes a Calculation.

The service adapter exposes actual permitted Part references and their closed service compositions. Provider material, the binder function/result and its provider-containing receipt are omitted. The component read-only option removes scratch, object playground, live calculations/member/getter/setter calls and serialization-to-scratch. The adapter independently rejects writes/compositions. Actual service outcomes remain visible in result material: a kernel “produced” receipt can contain a rejected service result. No UI-execution receipt or skeleton execution is fabricated. The pure TeacherJourney tree continues to render outside PxC and is unchanged by inspection.

Validation will prove existing helper link identity and accessor-safe browsing; fixture façade reachability/read-only behavior; double-click/touch/keyboard opening, refresh without new receipts/storage/network effects, Escape/return focus, responsive actual screenshots and the full existing registration→approval→login→create→directory→public flow. After reciprocal review, an append-only C5 checkpoint will be exact-ID/hash read back before same-private-Site publication.

## C6 no-search usability checkpoint (written before running/rendering)

The existing DevTools component now opens to loaded teachers and named recent activity rather than a flat address inventory. No provider, business operation, storage behavior or Part graph changes.

1. The HH host supplies a pure callback that reads the current safe public profile projection and registration/session labels. The component labels this as loaded state, not execution history. A fresh page explicitly says no demo teacher is registered; a selected teacher without a profile is identified as such. Reloaded public profiles remain inspectable even when their old receipts are gone.
2. Opening reads the existing board/context. The latest non-school service receipt is selected, falling back to the latest actual lookup. Recent buttons show the actual service operation, profile/display name when present in the real result/request, and business outcome. Optional filters/full Part inventory remain under All Parts and filters.
3. Choosing an actual action displays its message, request success/rejection and data first. Adjacent Producer/Input buttons follow the output Part’s existing composition references; kernel produced status is explicitly separate from the business outcome.
4. Choosing a loaded teacher displays its current public projection. A recorded call is associated only by its explicitly declared stable profile ID and actual receipt. Its links are labeled as that recorded call’s links, not a producer for the snapshot. Without a matching retained call, the UI explicitly says history is unavailable; it does not construct a Part, receipt or inferred domain edge.
5. Selecting resets detail scrolling, focuses its title and reveals the inspector on phones. Teacher/activity rows remain clear first-class buttons. Raw object/prototype metadata stays behind a disclosure. Escape/return navigation and read-only guards are unchanged.

Pure new label helpers derive text and receipt selection only. The original service invoke functionParts, sole request input, values and receipts are unchanged. No UI render composition or cross-operation registration/approval/profile dependency is claimed.

Approved proof: no search or internal IDs needed for open→recent activity→teacher→current state→real input/producer links. Fresh and reload states must be truthful. Unit tests, bounded phone/desktop browser checks, existing journey regression and independent no-search reviewer will run after this written checkpoint. Then verified append-only C6 source/checkpoint/current README links will be synced to Drive before same-private-Site publication.

## Bounded style playground

The existing read-only DevTools opens as a pinned overlay and leaves the HH page visible. The app registers fixed style Calculations on the same fixture runtime PxC. Seed and validated bounds Parts feed the local fast-check 4.10.2 bundle; `fc.sample` uses `{seed, numRuns: 6}`. A selection-index Part feeds the selection Calculation, whose output feeds the CSS-variable Calculation. Only four numeric variables are applied to the fixed `#app` root; no user source, selectors or arbitrary CSS runs.

The inspector combines the original service-only read board with a separate style-only read projection, showing actual style Parts, inputs and receipts without broadening the HH service adapter. Keep stores a data-only record in the tab’s dedicated sessionStorage key; restore validates both the fast-check bundle pin and a separate style-source implementation pin before recomputing CSS variables from saved style values. Reset clears only those four variables and the style key. Teacher content, fixture state and existing service receipts remain unchanged. Export downloads exact style values, seed, bounds, selected index, package source/bundle metadata and style implementation pin.

The self-hosted browser bundle is fast-check 4.10.2 (commit `c77afa8277a67250d798c52e61343b8ed5fd268b`) with `pure-rand` 8.4.2. `npm run bundle:fast-check` recreates the browser bundle and provenance from the exact registry lock. The bundle SHA and style-source pin are independently checked by `exp/cooperative/hh-style.test.mjs` and `exp/adversarial/hh-style-variance.test.mjs`.

Focused and aggregate Node tests pass. Local browser rendering was not attempted; live browser QA remains a post-deployment check. The theme change affects accent headings/links and controls using a dark HSL color for readable contrast. Reset restores original CSS rules exactly; no notification colors, teacher content or text data are changed.
