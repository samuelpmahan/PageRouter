# R3403 — independent acceptance review

Decision: accepted.

I reviewed the supplied four-file patch and the checked-out candidate against baseline commit `6e58a206bb30deb967f81cfe6214d6ffb581a84b` / tree `0446ad99d770c61f99ddb1acf8ec53534875dcf1`. The working tree contains exactly the four expected modified files. All four current source SHA-256 values match the H1 E3403 receipt. `review-diff.patch` uses more unified context than a default `git diff`, so the generated diff-file hashes differ; the changed-file hashes and substantive changes match the receipt/patch. `git diff --check` passes. No repository files or Git state were changed by this reviewer.

## Acceptance evidence

The implementation satisfies the E3401 gap and the E3402 boundaries:

- `checkpoint/vendor/hh/src/public-site.mjs:40-46` renders the lookup error by the directory selectors and exposes “Retry school choices” only while both `lookupError` and `lookupRetryable` are set. The control uses `public:retry-school-lookup`; non-retryable failure remains visible without offering a dead action. `:50-56` leaves the result-error retry on `public:retry` and avoids duplicating lookup text in the results card.
- `checkpoint/vendor/hh/src/public-controller.mjs:938-945` gives the named event only the current-epoch school-read closure (otherwise `nothing_to_retry`); generic retry precedence and directory retry remain unchanged.
- `public-controller.mjs:242-269` retains existing safe-outcome gating (`retryable === true` and `outcomeKnown !== false`), captured input/epoch, and epoch invalidation. On successful lookup it clears shared error text only when it still equals the lookup error captured at retry start; a different current directory-results error survives.
- `public-controller.mjs:326-365, 370-405` continues to invalidate lookup retries on navigation and a new school selection. Registration UI/action remains unchanged.
- Added renderer tests at `checkpoint/vendor/hh/src/public-site.test.mjs:127-143` cover retryable-vs-permanent lookup display. Controller regressions at `public-controller.test.mjs:1081-1131` cover rendered event identity, coexistence/ownership of both retries, recovery, and selection invalidation.

I ran one independent narrow integration probe against the actual `createFixtureProvider({fixture:true, storage:null})`, runtime, controller, and renderer. It read the *rendered* button attributes and dispatched the resulting dataset-shaped event values. The probe confirmed, in one sequence: lookup and directory failures coexist; the rendered school-choice action causes exactly one `SchoolData.getCounties` provider call, restores `Demo King`, and preserves the directory error/retry; the rendered directory action then recovers results. It also confirmed selection and route invalidation each reject the stale named event without an extra read. Measured service calls were `SchoolData.getStates: 1` and `SchoolData.getCounties: 2`, runtime receipts rose from 2 to 4, and the before/after fixture account receipt was identical. No registration, profile, session, storage, or account mutation port was called.

Probe command: `node /workspace/scratch/afc0d51965a8/hh28/H2/R3403/probe.mjs`; exit `0`, start/end `2026-10-19T16:18:07Z`, stderr empty. Raw output and timestamps are retained in this directory. The H1 receipt reports the post-correction complete HH suite as 114/114; per instruction I did not rerun the authored suite merely for independence. Its focused post-change attempt had one incorrect fixture literal (`Demo Marin` vs fixture `Demo Alameda`) and was not rerun after correction; the complete suite did run after correction, and the independent probe separately verified the current-selection/retry path.

## Set aside

- No build, package, staging, commit, or publication: outside this acceptance job's authority.
- No browser/server/app-shell automation: direct renderer + controller integration and dataset-shaped dispatch exercise the requested path without crossing the stated boundary.
- No broad test matrix or repeat of H1 tests: the narrow probe targets the independent risk (two simultaneously live retry owners) and invalidation; H1's full-suite evidence is retained.
- No test for two deliberate programmatic dispatches racing the same retry closure: the render removes the button synchronously when the first read starts, and concurrent direct dispatch is not the normal user path. This is not a blocking finding.

## Retained probe artifacts

- `probe.mjs`
- `run.start.utc`, `run.end.utc`, `exit.code`
- `stdout.raw`, `stderr.raw`
- `current-working-tree.diff` (default-context comparison; see patch note above)
