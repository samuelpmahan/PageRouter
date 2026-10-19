# H2 / E3402 — read-only source review

Verdict: confirmed_reuse. The reported gap is present in the current canonical-source checkout (HEAD `6e58a206bb30deb967f81cfe6214d6ffb581a84b`; tree clean). No repo files or tests were changed/run.

## Source pins

- `checkpoint/vendor/hh/src/public-controller.mjs:242-270`: `loadLookup` captures the input and school epoch, records retryability only for retryable outcomes whose outcome is not unknown, and stores a school-lookup retry closure. It updates `lookupError`/`lookupRetryable` but does not change `matches.status` or install a directory result retry.
- `public-controller.mjs:306-323`: initialization first navigates, then loads initial school states on non-registration routes; directory initialization can therefore have lookup state independent of its result state.
- `public-controller.mjs:326-365`: navigation increments `schoolEpoch`, clears lookup retry/error state and `lastRetry`, then loads route-specific content.
- `public-controller.mjs:370-405`: selecting a school field clears `lastRetry` and old lookup retry, increments epoch, clears downstream values/options, then invokes the corresponding `SchoolData.get*` read.
- `public-controller.mjs:408-445`: directory result state/retry is separate (`matches.status`; `lastRetry` on directory failure). Successful directory reads clear `lastRetry`.
- `public-controller.mjs:936-940`: generic `public:retry` prioritizes `lastRetry` over `schoolLookupRetry`. Thus a directory result retry can take precedence if both are live; a contextual school-choice action must not dispatch this ambiguous event.
- `checkpoint/vendor/hh/src/public-site.mjs:46-53`: directory renders “Retry search” only for `matches.status === 'error'`; it renders `result.error || j.error` as status but has no control for `lookupError`/`lookupRetryable`. A school lookup failure leaves matches unchanged, so with loaded matches the school error is shown without an actionable retry.
- `public-site.mjs:58-62`: registration does render `Retry school choices` for a retryable lookup error.
- `checkpoint/vendor/hh/src/app.mjs:205-210`: select changes route through `controller.selectSchool`; action buttons are dispatched from their rendered `data-event` by the app's shared event plumbing.
- `checkpoint/vendor/hh/src/public-controller.test.mjs:976-1005`: existing tests cover same-selection recovery and clearing/invalidation after a new selection.
- `public-controller.test.mjs:1007-1018`: navigation invalidates registration lookup retry.
- `public-controller.test.mjs:1069-1079`: the directory case only asserts `canRetry` and directly dispatches generic `public:retry`; it never asserts a rendered recovery control or action-event identity.
- `checkpoint/vendor/hh/src/public-site.test.mjs:90-114`: renderer coverage asserts the registration retry and non-retryable suppression, but no directory school-lookup failure case.

## Expected contract and boundaries

When a retryable `SchoolData.get*` read fails on the directory route while `matches.status` remains `loaded` (or otherwise not `error`), show the lookup error and a contextual “Retry school choices” control. That control must invoke the current selection's safe read, not whichever generic `lastRetry` happens to own `public:retry`. Keep “Retry search” bound to directory-result recovery. Suppress the school retry for non-retryable / unknown-outcome failures. Preserve current selection and epoch binding: changing selection or navigating away invalidates the retry; success clears it. These are read-only lookup retries and must never resubmit registration/profile writes.

Counterexample/ambiguity to guard: a lookup failure can coexist with a later directory result failure while the lookup closure remains current; because dispatch checks `lastRetry` first, wiring a school-choice button to `public:retry` would silently retry directory results instead. Conversely, directory retry must continue to recover directory errors, and a loaded/empty result is not itself a directory error. Existing code already invalidates stale lookup retries on selection/navigation and excludes unsafe outcomes; avoid broad changes to those behaviors.

## Minimal recommendation

Add a narrow, named school-lookup retry event (e.g. `public:retry-school-lookup`) handled by the controller by checking the current `schoolLookupRetry?.epoch === schoolEpoch` and invoking only that closure. Render a directory-specific school-choice retry only while `lookupError` and `lookupRetryable` are current; bind it to that event, not generic `public:retry`. Leave directory result retry and registration behavior unchanged unless the implementation chooses to route the registration control to the same unambiguous event too. Add renderer coverage for loaded matches + retryable lookup failure (present control) and non-retryable failure (no control), plus controller coverage with both retry closures live proving the contextual school retry runs only `SchoolData.get*`, while “Retry search” still runs directory read. No service/port changes needed.
