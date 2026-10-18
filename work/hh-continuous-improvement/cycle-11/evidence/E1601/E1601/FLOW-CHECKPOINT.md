# HH11 H1/E1601 probe flow checkpoint

## Written in

`probe.mjs` is prepared under the H1/E1601 scratch directory. It has not been executed, rendered, or published. No PageRouter source or test files were changed.

## Entry point

When root authorizes the ordinary probe, the planned entry point is:

```sh
node /workspace/scratch/8528bb251845/hh-cycle11/H1/E1601/probe.mjs
```

## Numbered walkthrough

1. Each case creates the actual HH fixture provider with an in-memory `Map` storage adapter, wraps its existing `Registration.registerTeacher` service with a promise gate, and connects that provider to the existing `createServiceRuntime` and `createPublicController`.
2. The controller's actual `onChange` callback renders `renderPublicSite` into a volatile tree. The script asserts the rendered page ID and expected login/register form at each transition, confirms the login submit control is enabled, and reads `role=status` feedback text; it does not construct replacement application state or use a browser.
3. It initializes `#/register`, selects the known local Demo Washington → Demo King → Demo District → Demo Academy path, accepts preview terms, and generates an in-memory email/password using `randomBytes`. Passwords are passed only as the registration dispatch payload and credential boundary; none are logged or written into the script/output.
4. For the known-failure, unknown-outcome, and success cases, the script starts one actual `public:register` dispatch and waits until the provider wrapper confirms the registration operation is held. It inspects the actual rendered state. The two failure cases navigate to `#/login` before release; the success case is a successful request control after the same navigation.
5. A fourth case releases the known failure while `/register` is still current, inspects the completed registration error, then navigates to `/login` as the pre-existing-error route control.
6. On release, the wrapper forwards the actual request to the actual fixture provider, adding only the selected fixture failure mode when requested. The script awaits the original dispatch, observes the resulting current route/form/feedback/request/outcome projection, and checks registration-write count remains exactly one.
7. Before changing the measured post-completion feedback, it snapshots that actual route/form/status. It then dispatches one deliberately invalid login through the real controller, verifies the current login form's existing local-validation path updates feedback, and confirms this control caused no second registration write.
8. It verifies the generated password is absent from controller state, runtime inspection, serialized PxC Part values, and volatile storage. The synthetic email is nonsecret identity and may legitimately remain in the current session/login projection; it is not treated as a credential leak. Output contains only case labels, outcomes, route/form/feedback observations, and count/absence assertions—never the generated values.

## Invocation table

| Scenario | Actual controller event | Runtime / Part path | Provider result |
|---|---|---|---|
| Same-route existing-error control | `public:register` | `Registration.registerTeacher` through `createServiceRuntime` and the real fixture provider | `transport_failure`; then route to login after completion |
| Late known failure | `public:register`, navigate `#/login`, release | Same real registration path; promise gate pauses the provider call | `transport_failure` |
| Late unknown outcome | `public:register`, navigate `#/login`, release | Same real registration path; promise gate pauses the provider call | `outcome_unknown` |
| Late success control | `public:register`, navigate `#/login`, release | Same real registration path; promise gate pauses the provider call | Fixture success |

School lookup calls during setup use their ordinary read-only fixture ports. No service is replayed automatically by the harness; any automatic registration replay would increase the observed registration count and fail the assertion.

## Shared machinery

The script supplies only ephemeral fixture storage, the promise gate/failure selector, synthetic form values, and the render callback. The existing runtime validates and records the request through its real Parts, passes only credential-confirmation validity across its credential boundary, invokes the fixture provider, and supplies its ordinary result/snapshot. The controller remains responsible for request status, runtime synchronization, outcome feedback, navigation semantics, and the rendering state.

## Inspection

Each observation reports the actual rendered page and expected form identity at each transition, login submit enabled state, status feedback before and after the separate login-validation control, controller request/outcome state, provider result classification, and registration call count. It also reports whether the generated password was absent from retained surfaces. There are no screenshots or mounted-browser claims.

## Explicit boundaries

- Local fixture/controller/render-tree only; no real provider, backend, account, network write, production authority, browser-policy workaround, or Python runtime. No browser is invoked; mounted-browser reachability remains unverified (cycle 10 records an originating-context refusal and no screenshots).
- Feedback may intentionally be global across routes. The probe measures it and does not assume that visible login feedback is a defect.
- The successful registration control mutates only the in-memory fixture provider; its effects are not persisted or used for login/approval.
- No product fix, test edit, Git commit, or publication is part of this probe.
- The script is prospective evidence only until root gives GO. Preserve first raw stdout/stderr/exit exactly when it is eventually run; do not reconstruct or overwrite failures.

## Review

Await root review/GO before running this script.
