# HH cycle 28 — directory school-choice recovery

## Finding and bounded change

H1's E3401 fixture probe confirmed the rendered recovery gap: on the directory route, a retryable school-cascade read failure left directory results loaded, showed the lookup error, and retained a usable controller retry, but the renderer exposed no school-choice retry control. An explicit controller retry recovered the fixture counties. H2's independent E3402 source review confirmed the gap and identified a separate ownership hazard: generic `public:retry` prioritizes a directory-results retry when both retry closures exist.

The accepted bounded change adds a contextual “Retry school choices” action using distinct `public:retry-school-lookup` dispatch. It can invoke only the current school-lookup retry closure; missing or invalidated closures return `nothing_to_retry`. Directory-result “Retry search” remains bound to generic `public:retry`, and the registration retry path is unchanged. Successful lookup recovery clears the shared error only when it still matches the error captured for that lookup, so an unrelated newer directory error is retained. Permanent lookup errors remain visible without a retry action.

## Verification and qualifications

- E3401 used the volatile fixture provider and memory only; it made no browser, server, origin, account, or persistent-storage writes. Its probe and raw streams are included.
- E3401's initial `source_pins` are Git blob SHA-1 identifiers. The final E3403 source pins and E3404 canonical input bindings are SHA-256 values; these different digest types are not interchangeable.
- E3403's pre-fix focused RED was 0/4 pass, 4 fail: two direct missing-control assertion failures and two downstream TypeErrors from absent controls/handlers. The first post-change focused attempt was 3/4 pass; its remaining failure was a bad test fixture literal (`Demo Marin` instead of the existing fixture's `Demo Alameda`). The literal was corrected; root independently verified `fixtures.mjs:6`. No separate pre-correction test-file snapshot was retained; the failed focused raw preserves the wrong literal. That focused command was not rerun. The subsequent full HH source suite passed 114/114.
- R3403's accepted independent review preserves the measurement qualification: the reported `SchoolData.getCounties: 1` spans a replacement school selection plus the stale-event rejection; the stale event itself adds no read. The separate route-invalidation port delta is empty.
- E3404 was the one canonical Bazel source build, run at `2026-10-19T16:20:19Z` and completed at `2026-10-19T16:21:47Z`, exit 0. It verified 843 site files, rebuilt 14 PxCube packages, and emitted site build ID `daf53f62ab1c4ac1235eab69ba82329d3045addd7b820153f6f39af6d9f6ba32`. The exact fresh site receipt and site log are preserved.
- The E3404 log's groups are qualified in `build-count-qualification.json`: 161 targeted HH tests passed, 316 full-suite tests passed, 1 Atlas import-closure test passed, and 2 runner helper tests passed; the targeted HH and full-suite groups overlap and must not be summed. The qualification changes interpretation only; original receipt and raw logs are unchanged.
- ChatGPT's connected browser operation failed with the exact error preserved in `evidence/context.json`. There is no browser DOM, screenshot, visual/accessibility, origin, backend, or production verification claim. No loopback/server workaround was attempted.

## Package and disposition

At package creation (`2026-10-19T16:26:03Z`), native E3405 was in progress. The final proof (the successful canonical build) postdates the implementation and predates this package snapshot. Root package audit is pending; nothing is staged or committed. Root owns the GitHub PR workflow and connected publication.

The repository baseline is commit `6e58a206bb30deb967f81cfe6214d6ffb581a84b`, tree `0446ad99d770c61f99ddb1acf8ec53534875dcf1`, with 5,043 tracked paths. Exactly four tracked HH source/test files are modified. This package adds current-cycle evidence only; it includes no solver bundles, old source snapshots, caches, or prior-cycle evidence copies. `manifest.json` enumerates those four product paths and every new package file except itself with exact size, mode, and SHA-256. Canonical native receipts are included once each.
