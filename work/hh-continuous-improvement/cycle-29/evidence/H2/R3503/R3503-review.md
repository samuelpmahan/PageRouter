# R3503 — H2 independent review

## Decision: accepted as a review candidate

I reviewed the current two-file worktree diff against base `128876031737d853303bbee9906dd7f8d618094d`, then inspected the actual public controller, renderer, app event delegation, fixture provider, runtime, and seeded fixture profiles. The source hashes frozen before execution are in `R3503-pins.json`; product source remained unchanged during this review.

The controller change is narrowly scoped: `public:random-teacher` now chooses from `runtime.snapshot().demo.publicProfiles` regardless of `journey.matches.items`. The existing deterministic `randomIndex++ % items.length`, empty-pool `no_profiles` result, and `requestNavigation('/public-profile/<id>')` behavior are untouched. The rendered caller remains only the Home tile (`public-site.mjs`); the app forwards its `data-event` to controller dispatch. Directory search still calculates results from runtime profiles filtered by school and query and maps its own result records. No renderer, app, service, fixture, storage, route, or authority source changed.

## Verification

- H1's focused regression was run once independently: 1 test passed, 0 failed, exit 0. Raw stdout/stderr, status, and UTC start/end are in `focused.*`.
- An independent volatile-fixture probe exercised the rendered Home button's actual `data-event` through the real controller and renderer, with a wrapper that delegates every call to the actual fixture provider services. It first narrowed the directory to California + query `Jordan` and confirmed only `demo-jordan` matched. Two Home actions then selected `demo-avery` and `demo-jordan` in the deterministic global two-profile cycle; query, school, and directory matches remained unchanged. A fresh controller's Home action selected `demo-avery`.
- The probe observed only `SchoolData.getStates`, `SchoolData.getCounties`, and `TeacherProfile.openPublicProfile` service calls (two profile reads in the history case); runtime account/profile projection stayed byte-equivalent. It used `storage: null` / volatile memory, with no account/profile writes or storage persistence.
- The probe's first harness run failed only because its expected receipt count omitted the runtime's service-binding composition receipt (actual provider calls were four; runtime receipt count was five). I retained that failed raw and made one harness-only correction to count the composition receipt. The repaired probe passed, exit 0, with empty stderr. Both attempts and their timestamps are retained separately.
- The focused test and repaired probe together cover filtered-history independence, deterministic two-profile cycling, fresh-Home behavior, preserved query/school/results, unchanged runtime account/profile state, and actual port scope. The empty-profile `no_profiles` branch was not dynamically exercised because the real fixture has two seeded profiles and mutating/replacing fixture state was outside the review; the diff confirms its branch is unchanged.

## Review notes and limits

Strengths: the fix removes hidden dependence on prior route history at the exact Home action, uses actual runtime profiles (not a copied seed list), and leaves directory semantics and the existing navigation/read path alone. Regression coverage interacts with the rendered Home and directory controls rather than naming a private helper.

Issues: none found at candidate-review severity. The authored regression doesn't itself assert that school filters remain intact or exercise a fresh controller; the independent probe covered both. It also does not exercise an empty profile pool; that branch is textually unchanged and the fixture cannot naturally present an empty pool without altering the provider.

Declined to judge: browser rendering/accessibility and production behavior were not tested (no browser/server/origin route was available or attempted); no full suite or build was run because this was scoped as one focused regression plus one independent fixture probe. This is an independent review candidate result only—not main-branch acceptance, deployment verification, or human acceptance.
