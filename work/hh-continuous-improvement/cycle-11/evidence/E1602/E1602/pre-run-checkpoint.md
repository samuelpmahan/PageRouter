# HH11 H2 / E1602 pre-run checkpoint

This is an independent, bounded fixture/controller/render-tree probe. It has not been run. Run only after the parent explicitly gives the ordinary probe GO for E1602.

## Question and competing interpretations

Question: if a held registration failure completes after the current route changes from `/register` to `/login`, does the current login form show stale registration-operation feedback? Global status may be intentional, so visibility alone is not a declared defect. A route-scoped status, absence of stale status, or distinct treatment for unknown outcome would be a falsifier or scope-narrower.

Source-based hypothesis only: `navigate()` clears the shared `journey.outcome` only when a lookup error and `local-error` coexist. A later mutation completion calls `setOutcome('local-error', ...)` without a route check, and `renderPublicSite` passes `journey.outcome` into `login()`, which renders it ahead of the login form. This predicts stale feedback, but actual rendered-tree observations are still required.

## Exact proposed flow

The prepared command is `bash hh-cycle11/H2/E1602/run-once.sh`. Its first run writes the exact Node stdout, stderr, and process exit code to separate, initially absent files. The wrapper refuses to overwrite any of those first-run paths. Do not rerun if any output exists; retain the first result and ask the parent before any follow-up.

`probe.mjs` creates fresh `createFixtureProvider({fixture:true, storage:memoryStorage})` and `createServiceRuntime` instances. It wraps only the fixture `Registration.registerTeacher` port with an in-memory promise gate and synthetic failure result. No HTTP provider, browser, Python runtime, backend, real account, source edit, Git action, or native mutation is involved.

Cases:

1. Known `transport_failure` is held and released while `/register` remains current (same-route/source-route error control).
2. Known `transport_failure` is held, the controller navigates to `/login`, then the provider result is released.
3. `outcome_unknown` is held, the controller navigates to `/login`, then the provider result is released.
4. An empty local login submission on `/login` verifies that the current login form normally renders its own local validation status, without any registration-provider call.

Each registration case uses synthetic `example.test` identity data and a `randomUUID()` password that remains local to the probe. The probe records current route, actual rendered form presence, feedback text/class, request/outcome, supported fixture/non-production capability fields, runtime projection, retry eligibility, registration write count, and whether each generated secret appears in controller state, runtime snapshot/inspection, actual PxC Part values, storage, or the rendered tree. It does not log the secrets. The provider exposes `mode`, `fixture`, and `productionAuthority` as supported fields; any authority beyond those fixture capabilities is reported as `UNKNOWN (not exercised)`, not inferred. The registration call count is checked before any explicit user retry; there is no retry action in the cases. This bounds “no automatic repeat” to the observed invocation window. It is controller plus rendered-tree evidence only; there is no mounted DOM, keyboard/pointer interaction, browser route, or UI-reachability claim.

## Expected decision value

If the two late-failure cases render a status on `/login`, compare that text, kind, route, and source-route control. Treat it as a possible global-feedback design choice unless product intent or a sharper inconsistency is demonstrated. If status is absent or is intentionally transformed, that falsifies the simple source prediction. A reproducible inconsistency is a follow-up finding only—not authorization to modify product source.

## Provenance and source identity

Read-only source SHA-256 values at preparation time:

- `public-controller.mjs`: `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2`
- `app.mjs`: `bde60c7db3393a57c8d1936b149c7ca0181dc90bdb16f846635f4110d6b8a5c3`
- `public-site.mjs`: `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4`
- `services/runtime.mjs`: `1ce3c4510361a2b24df26a3ae09d08093757abee75a5b2ab50353d15ff58b88e`
- `services/fixture-provider.mjs`: `99807675ac53b1944c8838b3251139b62174c43f82276ef64cc919ce15e7d16d`

The dispatch supplied a local-source identity ending `b58a`, but the parent has clarified that this was a pre-run dispatch typo and is not its assertion of current identity. Corrected parent-provided local source commit: `b9eff6a0c4385ed2648e97b30d15366910b7b58b`. Other identities supplied at dispatch: remote `8d09ffb6ced2d1ca7ab59fa80184d0b94cab0f87`, tree `a5c871c0e8b8373bb7010ffce57249f245443846`, main `7adf7e74a85c4310a5704a4c42808e85a1a82d71`. No Git state was inspected or changed by this worker.
