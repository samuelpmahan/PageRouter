# Called shots

A change is announced before it is built, in sentences a person can read and
clauses a program can check. After the build, `grade.mjs` checks every clause
against the baseline and the candidate and prints exactly where the ball went:
files, line ranges, statements, JSON paths. No model grades a shot.

Like calling a pool shot: "8 ball, that corner pocket, off A into B." Not
"that's where I was aiming."

## Rules

1. **Called before the break.** `shoot.sh call` logs the shot's sha256 and the
   time in `called/events.jsonl` before the change is built. A shot whose hash
   is not in the log is never made.
2. **Ball, pocket and path.** Clauses name the exact object (symbol, file, JSON
   path), where it ends up, and the route there. The right result by an
   uncalled route is a miss.
3. **Exactly, never at least.** Set clauses list everything that changes. An
   extra change is a foul, not a bonus.
4. **Not already in the pocket.** Graded against itself, the baseline must miss
   at least one clause. The report lists the clauses that were already true.
5. **Every sentence has a clause, every clause has a sentence.** Each clause's
   `covers` names the sentences it checks. A sentence nothing checks, or a
   clause of unknown kind, is rejected before grading.

## Shot file

```json
{
  "schema": "called-shot@0",
  "id": "extract-safePath",
  "sourceRoot": "checkpoint",
  "call":    [{ "id": "S1", "text": "Move safePath ... body unchanged." }],
  "clauses": [{ "id": "C1", "covers": ["S1"], "kind": "ast.moved", "symbol": "safePath",
                "from": "src/compiled-patch.mjs", "to": "src/paths.mjs", "body": "identical" }]
}
```

`sourceRoot` is the directory source paths are relative to, inside the
repository (`checkpoint` when absent; `.` for the repository root). Site paths
are relative to the built site.

| kind | checks |
|---|---|
| `ast.moved` | top-level function `symbol` is declared in `from` on the baseline and not in `to`; on the candidate it is in `to` and not in `from`; with `body: identical`, the declaration text is unchanged |
| `ast.onlyImportsChanged` | in each of `files`, every top-level statement other than imports, comments and the `except` declarations is identical |
| `source.changedExactly` | the source files `modified`, `added` and `removed` are exactly these |
| `site.changedExactly` | the built site's files `modified`, `added` and `removed` are exactly these |
| `json.changedPathsExactly` | in `file` (site, or source with `in: source`), exactly these JSON paths differ |
| `text.onlyLinesAdded` | in each of `files`, every baseline line survives in order and exactly `lines` lines are added |
| `crudlint.findingsChangedExactly` | running the crudlint predicate set over `src` dirs, exactly the `added` and `removed` findings (`{rule, file}`) change; findings are matched by rule, file and snippet, so moved lines are not changes |

Syntax trees come from tree-sitter (JavaScript, TypeScript, TSX), run as
WebAssembly, so nothing native is compiled.

## Commands

From `checkpoint/`:

```sh
bash ci/shots/shoot.sh call  my-change.shot.json                          # before changing anything
bash ci/shots/shoot.sh grade ci/shots/called/my-change.shot.json BASE     # after: builds BASE and the working tree
node --test ci/shots/test/*.test.mjs                                      # grader tests (run in CI)
```

`grade` exits 0 only when the shot is made, prints the report and writes
`called/<id>.grade.json`. BASE must have the declared build clock (7d0f607 or
later), or site clauses would count clock bytes as changes.

## crudlint predicate set

`crudlint.mjs` runs ast-grep rules in `crudlint/` (crudlint's layout:
`sgconfig.yml`, `rules/`, `utils/`, `rule-tests/`) and emits crudlint's
finding shape: `{rule, layer, tool, file, line, endLine, message, caseIds,
snippet}`. The shipped set is empty: cases are described per project, each as
a predicate. It supports `role: detector` and `requires:`; rules using
crudlint's grouping (`group`, `collapse`) are refused rather than reported
hit by hit.

## Crosscheck

The grader proves the clauses. It cannot tell whether a sentence promises
more than its clauses check, and a person believes the whole sentence once a
shot is made. `crosscheck.mjs` asks independent checkers exactly that, in
Atlas's cross-verification form (`exp/atlas/cross-language.mjs`):

- **Case.** `batch.json`: one item per sentence with the clauses that cover
  it, plus seeded gold items with a known gap (an uncheckable claim appended,
  `body: identical` dropped from an `ast.moved` clause, a JSON clause pointed
  at another path) and controls that are covered. Content-addressed `case_id`.
  Nothing in the batch marks which items are gold; `key.json` holds that.
- **Observations.** One file per checker, `kompozed.shots.crosscheck-observation.v1`:
  for every item, `covered`, or `gap` with a verbatim quote of the first
  unchecked words. A quote that is not a substring of the sentence is no answer.
- **Comparison.** The observations are composed through a PxC FunctionalGuarantee
  (`vendor/hh/services/pxc.mjs`) into `/crosscheck/agreement`: two of three
  decide each item, and the first difference is named by path. `report.md`
  shows every checker's quote; gold catch rate and control false alarms are
  scored per checker.

Checkers answer from `crosscheck/prompt.md` and the batch only, each in its
own directory, without the key. They judge coverage, never whether a shot was
made.

```sh
node ci/shots/crosscheck.mjs batch   DIR ci/shots/called/*.shot.json     # batch.json and key.json
node ci/shots/crosscheck.mjs compare DIR ci/shots/called/*.shot.json     # after DIR/<checker>-<n>.json exist
```

The first run, `called/crosscheck-2026-10-12/`, used three Haiku checkers on
the first four shots: 4 of 4 gold caught by each, 0 of 2 controls flagged, verdicts
unanimous on all 25 items. 13 of 19 real sentences had a gap, all of them descriptive
claims the clauses do not check (what an import says, what a workflow step
runs, "because" explanations).

## Records

`called/` holds every shot, its call event and its grade. The first two:

- `extract-safePath`: graded against the declared-clock prototype, before
  7d0f607. The naive move passed every build stage and test and still missed
  C3 and C4: the hand-kept copy list did not ship `paths.mjs`, so the router
  failed to load. Commit 1ceef5c removed that trap.
- `derive-site-copy-list`: commit 1ceef5c, graded made.

Files in `called/` are part of the change that adds them, so a shot lists its
own record files in `source.changedExactly`.
