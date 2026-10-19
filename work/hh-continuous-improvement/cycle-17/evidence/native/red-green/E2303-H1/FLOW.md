# E2303 navigation-label regression — construction checkpoint

## Mise-en-Plase

**What pre-prep established:** the existing renderer emits the `hh-public-nav-toggle` as a button with visible `☰`, `aria-expanded`, `aria-controls="hh-mobile-nav"`, and `data-event="public:toggle-nav"`; it does not emit an explicit `aria-label`. Existing renderer tests check expanded/hidden behavior, not a stable descriptive label. E2301/E2302 characterized directory recovery as reusable, so this test does not touch directory logic.

**Alignment-critical interpretation:** add a regression for the exact renderer-level naming contract only. It documents an observed missing label attribute, not a browser-computed accessible name or keyboard/accessibility conformance defect.

**Recommendation and alternatives:** keep the test-only first step. Do not change production rendering until root reads this exact test and authorizes the focused RED; then preserve the actual RED and request a separate one-attribute renderer-change GO. No broader accessibility campaign or unrelated menu redesign.

**Scope and non-goals:** one named test in `public-site.test.mjs`, looping over `{anonymous, authenticated} × {closed, open}`. Require `aria-label="Toggle account and site navigation"`, preserving the existing glyph, button tag, expanded state, controls target, event, and target hidden state. No DOM, screen reader, accessibility tree, keyboard event, app/controller/provider/runtime/CSS changes, directory edit, build, Git operation, or publication.

**Acceptance / proof required at The Pass:** the focused pre-fix run should fail specifically because the explicit `aria-label` is absent, not due to a fixture/import/setup failure. After separate root review/GO for one production attribute, the exact test should pass and the relevant public-site suite should pass. Keep raw first-run output; do not weaken assertions or rewrite the archived test.

**Exact actions proposed if fired:** run `bash /workspace/scratch/8528bb251845/hh-cycle17/H1/E2303/run-focused-red-once.sh` once from PageRouter. The wrapper invokes exactly one named Node test and stores raw stdout, stderr, UTC timestamps, and actual exit in `captures/red-01`. On unexpected failure, stop and preserve. On expected RED, return evidence and wait for a separate implementation GO.

**Head Chef's Call requested:** root full-read the exact test, archived source copies, diff, prospective command, and capture wrapper; separately authorize the one focused RED. Following actual RED, separately review/authorize the single renderer attribute.

**Status: HOLD.** Construction is complete; no imports, syntax checks, tests, or product source behavior changes have been run for E2303.

## Change walkthrough

1. The test calls `renderPublicSite` four times: anonymous/closed, anonymous/open, authenticated/closed, and authenticated/open.
2. In every emitted tree it finds the same `hh-public-nav-toggle` and requires a button plus the stable label `Toggle account and site navigation`.
3. It guards existing behavior: the child remains `☰`; `aria-expanded` tracks `navOpen`; `aria-controls` and the target ID remain `hh-mobile-nav`; `data-event` remains `public:toggle-nav`; and `hidden` is the inverse of `navOpen`.
4. No actual UI is mounted and no keyboard or screen-reader behavior is simulated.

| Render case | Expected `aria-expanded` | Expected target `hidden` | Shared label/event |
|---|---:|---:|---|
| Anonymous, closed | `false` | `true` | `Toggle account and site navigation` / `public:toggle-nav` |
| Anonymous, open | `true` | `false` | Same |
| Authenticated, closed | `false` | `true` | Same |
| Authenticated, open | `true` | `false` | Same |

There are no Calculations or Part invocations; this is a pure renderer-tree regression. The caller supplies each synthetic `journey` state; the renderer supplies the emitted tree. The test runner, when separately authorized, reports assertion output to captured stdout/stderr. The test archive and original renderer archive are inert `.txt` copies and are not executable evidence.
