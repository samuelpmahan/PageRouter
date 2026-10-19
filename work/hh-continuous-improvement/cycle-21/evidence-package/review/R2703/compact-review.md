# R2703 H2 review

Decision: accepted for the scoped topic-draft recovery change.

The exact pinned diff is limited to controller-held, in-memory draft state and its emitted compose tree. The focused five tests passed, and the independent volatile-fixture/render-tree probe passed: whitespace-only title/body peers are restored; unknown categories remain visibly selected but rejected; 255/10,000 limits plus one remain invalid on repeat; explicit correction creates exactly one topic; teacher-only compose and reset/logout clearing behaved as expected. Rejections do not arm automatic retry, invoke account-service receipts, or write the forum key in memory-only mode.

No browser/server or production endpoint was used. Minor unused `COMMUNITY_CATEGORIES` controller import is non-blocking. The supplied full-suite state remains 283/290 with seven missing-dependency/stale-dist failures and canonical fresh-source build pending; do not call this a full-suite pass.

Qualification: the first volatile-probe attempt failed before executing behavior due to a duplicate-binding SyntaxError. Its original raw stderr file was overwritten by the corrected run and is not retained as a file; the root tool transcript retains the 955-byte error. The successful probe’s timestamps/duration were measured inside the probe; its exit code came from the exec wrapper result.
