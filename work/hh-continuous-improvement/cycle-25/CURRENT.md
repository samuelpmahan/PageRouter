# HH cycle 25 — moderator reported-items filter

## Baseline and finding

Candidate based on `codex/hh-continuous-improvement` at `a0a98f299ea77d2181fa6013df554af843aa0635` (4,864 tracked files at baseline). Only the four authorized HH community/controller source and test files differ from that baseline; this package records the review/build evidence. No unrelated Lab or older untracked files are claimed or copied.

Actual synthetic volatile-fixture probes confirmed teacher topic/reply reports, moderator list visibility, hide/restore recovery, teacher exclusion of hidden items, stale hidden-topic blocking, and role/owner guards. No authorization or restore defect was reproduced. The bounded usability gap was that a moderator had no consolidated index filter for reported replies; finding them required opening parent topics. E3101’s iterative probe/output custody was overwritten during qualification; the exact earlier version is unavailable and is not reconstructed. Its retained final probe/raw streams are separately qualified in `E3101-custody-qualification.json`.

## Change and exact flow

Added a moderator-only `Reported items` toggle to the existing forum index. It retains a topic when the topic itself or any reply is reported, including hidden items available to moderators. Existing query/category filters remain conjunctive; reported filtering happens before existing sorting and pagination. The controller accepts the actual generic rendered-button event (omitted `enabled` toggles), accepts explicit booleans, rejects other values and non-moderator events, and clears filter state on moderator-role exit. Restore updates existing report state; a parent leaves the filtered list when no report remains. No route, service, storage schema, backend, moderation decision, or authority change.

## Evidence and verification

Baseline RED: two focused tests failed before implementation; a separate actual rendered-button payload regression then exposed and reproduced a wiring failure before its handler correction. GREEN: focused 3/3 and HH source suite 108/108 (focused cases overlap the suite). Independent H2 R3103 review accepted the bounded behavior; two early harness attempts and their raw failures are retained, followed by a passing fixture lifecycle and focused run. Canonical configured build used Node 24.19.0 and pinned Bazel 7.4.1 from `checkpoint/`: targeted HH regression run 155/155, full suite 310/310, built Atlas import closure 1/1, 843 verified files and 14 PxCube packages. The targeted and full-suite counts are separate runs, not additive. Fresh receipt binds all four changed HH source/test files by SHA-256; copied receipt and build log preserve mode `0555`.

One initial build launch used the wrong working directory and stopped before the script (127); its raw record is preserved separately. The single corrected-cwd canonical build succeeded (0). The original four source/test pins remained unchanged during build.

## Boundaries and next guarded step

All behavior evidence is synthetic, local, and source-backed. Browser/DOM/visual/accessibility review was unavailable (`Unknown tool browser.js`); no browser workaround, server, backend, real account, network, production, deployment, or external effect was used. No Git staging or commit has occurred.

Next bounded inspection, only under a new GO: when browser capability is available, verify that the new moderator control is visibly discoverable and operable in the actual rendered interface. Keep the existing role, hidden-item, restore, and pagination constraints; do not expand moderation policy or infer a production queue need from this fixture.

Status: evidence package prepared for root file audit; no publication or canonical branch action taken.
