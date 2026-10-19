# E2301 source-equivalent probe flow

## Question and boundary

Determine whether a user can recover from an explicit directory search with zero synthetic matches by editing the query and submitting again, while preserving the selected geographic filters. Distinguish a loaded empty result from a local read failure, and observe the emitted navigation toggle attributes in both states.

This uses one volatile synthetic fixture provider/runtime, `createPublicController`, and `renderPublicSite` emitted trees. It does not create accounts, touch a real service, use browser DOM/native `FormData`/`reportValidity`, fire keyboard events, or establish backend or human behavior. The submit payload is source-equivalent and reconstructed from the currently emitted form values; `app.mjs` delegation is inspected but not executed.

## Observed source and prior coverage

- `public-controller.mjs` loads the directory from `runtime.snapshot().demo.publicProfiles`, marks explicit submissions with `searchPerformed`, persists filters only in the supplied preview storage, and stores a read retry for a failed snapshot read.
- `updateDraft('query', ...)` changes the in-memory query and notifies the renderer without submitting.
- `public-site.mjs` emits the query inside a collapsed `<details>` section. A loaded zero-result search emits “No teachers found” and “Try another school or search term”; a failed read emits a different status and retry button.
- `public-site.mjs` emits a button whose text is `☰`, with `aria-expanded`, `aria-controls`, and `data-event`, but no explicit `aria-label`. `app.mjs` contains an Escape handler for an open navigation menu. This source/tree fact is not a browser-computed accessible-name or keyboard test.
- Existing controller tests cover a matching query, a no-match query, remembering/restoring filters, and directory error/retry separately. Renderer tests cover zero-result guidance, error/loading, and expanded/hidden nav attributes. This probe joins the reachable empty-to-edited-query flow to the emitted input/result trees, provider-call deltas, stored selected filters, and retry distinction; it does not claim those component behaviors are new.
- The captured reference shows an initially blank directory Results region and an expanded mobile menu screenshot. Filtered live results/no-match behavior is unknown. A captured DOM control record reports the legacy menu control as `☰` with an empty `ariaLabel`; that is reference evidence, not a keyboard or computed accessibility-tree test.

## One run

1. Create in-memory storage, a fixture provider/runtime, and a controller whose `onChange` retains only the latest pure renderer tree. Count actual `runtime.invoke` calls.
2. Initialize at `#/directory`; choose the synthetic route `Demo Washington → Demo King → Demo District → Demo Academy` and record the exact setup read ports.
3. Type an impossible synthetic search phrase through `updateDraft`, then source-equivalently submit fields from the emitted form tree. Capture loaded-empty copy/status, selected values, saved filters, and provider-call delta.
4. Type `avery`, verify that typing alone leaves results and remembered filters unchanged, then resubmit current form values. Capture the synthetic `demo-avery` result and retained school selection.
5. Arm the supported local `fail-next` fixture control and submit the same query. Capture the error state/retry affordance, then explicitly retry once and capture recovery. Compare provider-call counts; directory filtering/retry read the fixture snapshot rather than invoking another provider port.
6. Dispatch the controller's existing nav toggle twice; capture closed/open `aria-expanded`, target, and hidden-state attributes. No keyboard event is dispatched.

## Predeclared expected observation and falsifiers

Expected: a loaded empty search shows zero-result guidance; changing only the query preserves the geographic selections and does not silently resubmit; explicit resubmission returns `demo-avery`; filters remain selected and remembered; a controlled read error is distinct from a loaded empty result and offers retry; explicit retry recovers the same synthetic result without additional provider calls. The nav tree pairs `aria-expanded=true/false` with `hidden=false/true` for `hh-mobile-nav`. The toggle has no explicit `aria-label` in the source-emitted tree and shows only `☰`; no actual accessible name is computed here.

Falsifiers: the new query cannot recover the seeded profile; geographic selections are lost; typing itself submits or corrupts stored filters; a loaded empty result is rendered as a read failure or vice versa; the retry cannot restore the same result; provider calls occur unexpectedly during snapshot search/retry; or open/closed toggle state and mobile-nav hidden state disagree. First unexpected result stops the run: preserve original outputs and do not retry or weaken assertions.

## Mise-en-Plase / gate

Recommendation: run this single synthetic characterization once after root reads the exact probe, FLOW, prospective and current pins. No source edit or feature is currently proposed. If the expected behavior is observed, report the existing behavior and the specific source/tree affordance gap as qualified (not a browser accessibility finding); root decides whether a distinct test-only follow-up is worthwhile. If an assertion fails, preserve that first evidence and return for diagnosis before any re-run.

Acceptance at the pass: original stdout/stderr, UTC start/end, and actual exit; structured expected fields for empty→edit→recovered, error→retry, provider-call counts, preserved selection/storage, and nav open/closed attributes. Result must explicitly distinguish source-equivalent submit from native browser execution and source/tree label facts from computed accessibility behavior.

Status: HOLD for root's exact-source review and separate execution GO.
