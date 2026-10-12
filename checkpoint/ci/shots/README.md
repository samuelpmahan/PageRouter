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

## Records

`called/` holds every shot, its call event and its grade. The first two:

- `extract-safePath`: graded against the declared-clock prototype, before
  7d0f607. The naive move passed every build stage and test and still missed
  C3 and C4: the hand-kept copy list did not ship `paths.mjs`, so the router
  failed to load. Commit 1ceef5c removed that trap.
- `derive-site-copy-list`: commit 1ceef5c, graded made.

Files in `called/` are part of the change that adds them, so a shot lists its
own record files in `source.changedExactly`.
