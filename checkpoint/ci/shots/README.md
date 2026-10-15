# PageRouter's called shots

The grader, crosscheck and rules live in the portable action at
[`actions/called-shot/`](../../../actions/called-shot/README.md). This
directory holds PageRouter's own part:

- `called/`: every shot PageRouter has called, the call log
  (`events.jsonl`), grade records and crosscheck runs.
- `crudlint/`: PageRouter's crudlint predicate set, empty so far.

`called-shots.json` at the repository root tells the action how PageRouter
builds (the CI Bazel target in `checkpoint/`) and which output it checks
(`bazel-bin/site.site`). Shots here default to `checkpoint` as their source
root, and the call records count as source changes, so each shot lists its own
shot file and the call log.

From the repository root:

```sh
node actions/called-shot/bin/called-shots.mjs call  my-change.json
node actions/called-shot/bin/called-shots.mjs grade checkpoint/ci/shots/called/my-change.shot.json
```

Pull requests are graded by the "Grade called shots added by this pull
request" step in `.github/workflows/deploy-pages.yml`.

## Records

- `extract-safePath`: graded against the declared-clock prototype, before
  7d0f607. The naive move passed every build stage and test and still missed
  C3 and C4: the hand-kept copy list did not ship `paths.mjs`, so the router
  failed to load. Commit 1ceef5c removed that trap.
- `derive-site-copy-list` (1ceef5c), `grader-in-ci` (d291a64),
  `crosscheck-pool` (4fe57d2), `baseline-records` (3a492fa): graded made.
- `crosscheck-2026-10-12/`: three Haiku checkers on the first four shots. Each
  caught 4 of 4 gold and flagged 0 of 2 controls; verdicts unanimous on all 25
  items; 13 of 19 real sentences have claims their clauses do not check.
- `portable-action`: moves the grader into `actions/called-shot/`.
