# Called shot

Announce a change before it is built, in sentences a person reads and
clauses a program checks. After the build, the grader checks every clause
against the baseline and the change and prints exactly where the ball went:
files, line ranges, statements, JSON paths. No model grades a shot.

Like calling a pool shot: "8 ball, that corner pocket, off A into B." Not
"that's where I was aiming."

Works in any git repository with a build command that writes an output
directory. Needs Node 20 or later and bash.

## Set up a repository

From the repository root, with this package checked out or installed:

```sh
node <package>/bin/called-shots.mjs init --build "npm run build" --output dist --action-ref <commit of this action>
```

`init` writes, and never overwrites:

- `called-shots.json`: how to build and which output to check
- `called-shots/events.jsonl`: the call log
- `called-shots/predicates/`: an empty crudlint predicate set
- `.github/workflows/called-shots.yml`: grades shots added by each pull request

`called-shots.json`:

| field | meaning |
|---|---|
| `build` | shell command (bash) that builds the output; it gets `CALLED_SHOTS_SIDE` and a private `CALLED_SHOTS_SCRATCH` directory |
| `output` | the directory to check, relative to `workingDirectory`; symlinks are followed |
| `workingDirectory` | where `build` runs (default `.`) |
| `defaultSourceRoot` | what source paths in a shot are relative to, when the shot does not say (default `.`) |
| `calledDir` | where shots and the call log live (default `called-shots`) |
| `predicates` | crudlint predicate set (ast-grep rules), or none |
| `excludeCalledDir` | when true (the `init` default), shot files and log lines are not source changes |

## Call, then grade

```sh
node <package>/bin/called-shots.mjs call  my-change.json                 # before changing anything
node <package>/bin/called-shots.mjs grade called-shots/my-change.shot.json
node <package>/bin/called-shots.mjs pr    --base origin/main             # every shot added since main
```

A shot that missed because the call itself was wrong stays in the record.
Call a corrected shot with a new id, then
`called-shots supersede <old> --by <new> --reason "<why>"` appends a
`shot.superseded` event to the call log. `pr` still grades and reports the old
shot, as a warning, and does not fail on it once the new shot is made in the
same run. Only a later call can supersede.

`call` records the baseline commit (HEAD unless the shot names one), copies
the shot into `calledDir` and logs its sha256 and the time. `grade` builds the
baseline in a detached git worktree and the working tree in place, then grades.
`--candidate <ref>` grades a commit or branch instead of the working tree, and
`--candidate-output <dir>` uses an output already built. Exit status: 0 made,
1 missed, 2 usage error.

## As a GitHub Action

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0            # the baseline commit must be reachable
- uses: actions/setup-node@v4
  with:
    node-version: 24
- uses: samuelpmahan/PageRouter/actions/called-shot@<commit>
  with:
    candidate-output: dist    # optional: skip rebuilding the change
```

The action grades every shot the change adds under `calledDir`, writes each
report to the job summary, annotates the pull request (one notice listing
every made shot, and an error or warning for each missed or superseded shot;
GitHub keeps at most 10 annotations of each level per step), sets outputs
`made` and `shots`, and fails when any shot is missed. Inputs:
`config`, `base`, `candidate-output`, `require-shot`.

When a change adds several shots, each is graded at the last commit that
contains it and no other shot's change: on a straight line, the commit before
the next shot was added; with lanes merged as branches, the head of its own
lane. A later or parallel shot's change is never counted against another
shot. Merge commits are skipped when finding where shots were added, and a
commit with exactly the head's tree reuses the head's output.

## Rules

1. **Called before the break.** A shot whose sha256 is not in the call log is never made.
2. **Ball, pocket and path.** Clauses name the exact object (symbol, file, JSON
   path), where it ends up, and the route there. The right result by an
   uncalled route is a miss.
3. **Exactly, never at least.** Set clauses list everything that changes. An
   extra change is a foul, not a bonus.
4. **Not already in the pocket.** Graded against itself, the baseline must miss
   at least one clause. The report lists the clauses already true.
5. **Every sentence has a clause, every clause has a sentence.** A sentence no
   clause covers, or a clause of unknown kind, is rejected before grading.

Source files are what git counts as the repository: tracked files plus
untracked ones that are not ignored.

## Shot file

```json
{
  "schema": "called-shot@0",
  "id": "extract-safePath",
  "call":    [{ "id": "S1", "text": "Move safePath into src/paths.mjs, body unchanged." }],
  "clauses": [{ "id": "C1", "covers": ["S1"], "kind": "ast.moved", "symbol": "safePath",
                "from": "src/compiled-patch.mjs", "to": "src/paths.mjs", "body": "identical" }]
}
```

| kind | checks |
|---|---|
| `ast.moved` | top-level function `symbol` (a function declaration, or a `const`/`let`/`var` bound to a function or arrow) is declared in `from` and not `to` on the baseline, and in `to` and not `from` on the candidate; with `body: identical`, its text is unchanged, not counting an `export` prefix |
| `ast.onlyImportsChanged` | in each of `files`, every top-level statement other than imports, comments and the declarations of `except` names is identical. In a `const`/`let`/`var` declaration only the excepted declarators drop out, so a change to a neighbor declared in the same statement still misses. It does not check which imports. |
| `source.changedExactly` | the source files `modified`, `added` and `removed` are exactly these |
| `output.changedExactly` | the output files `modified`, `added` and `removed` are exactly these (`site.changedExactly` is the older name) |
| `json.changedPathsExactly` | in `file` (output, or source with `in: source`), exactly these JSON paths differ |
| `json.valueEquals` | in the candidate's `file`, the value at `path` equals `value` |
| `text.onlyLinesAdded` | in each of `files`, every baseline line survives in order and exactly `lines` lines are added |
| `crudlint.findingsChangedExactly` | running the predicate set over `src` dirs, exactly the `added` and `removed` findings (`{rule, file}`) change |

Syntax trees come from tree-sitter (JavaScript, TypeScript, TSX) as
WebAssembly, so nothing native is compiled.

## crudlint predicate set

`lib/crudlint.mjs` runs ast-grep rules in crudlint's layout (`sgconfig.yml`,
`rules/`, `utils/`, `rule-tests/`) and emits crudlint's finding shape:
`{rule, layer, tool, file, line, endLine, message, caseIds, snippet}`. Cases
are described per repository, each as a predicate; the set starts empty.
`role: detector` and `requires:` are supported; crudlint's grouping (`group`,
`collapse`) is refused rather than reported hit by hit.

## Crosscheck

The grader proves clauses; it cannot see a sentence that promises more than
its clauses check. The crosscheck asks independent checkers, in the
cross-verification form of PageRouter's Atlas:

- **Case** (`batch.json`, content-addressed): one item per sentence with its
  clauses, plus seeded gold items with a known gap and controls known to be
  covered. Only `key.json` says which are which.
- **Observations**, one per checker: `covered`, or `gap` with a verbatim quote
  of the first unchecked words. A quote that is not in the sentence is no answer.
- **Comparison**: composed through a PxC FunctionalGuarantee (the kernel is
  pinned byte-identical in `vendor/pxc.mjs`, sha256 `1b280236…`) into
  `/crosscheck/agreement`. Two of three decide each item; the first difference
  is named by path; gold catch rate and control false alarms are scored per checker.

```sh
node <package>/bin/called-shots.mjs crosscheck batch   DIR called-shots/*.shot.json
# give each checker DIR/batch.json and crosscheck/prompt.md, never key.json;
# each writes DIR/<name>-<n>.json
node <package>/bin/called-shots.mjs crosscheck compare DIR called-shots/*.shot.json
```

## As a benchmark

Every called shot is a task with a deterministic verdict: a baseline commit,
sentences saying what should happen, and clauses that decide whether it did.
To compare agents or models on a repository's shots, give each one the
baseline commit and the sentences, let it work on its own branch, then run
`grade <shot> --candidate <branch>` for each. The crosscheck is a benchmark
for checker models in the same way: gold catch rate and control false alarms
are its scores.
