# Crosscheck d953bcec0e96

Checkers: haiku-1, haiku-2, haiku-3. Items: 25 (19 real, 4 gold, 2 controls).
Agreement: accepted, every item has two of three.

## Gold and controls

| checker | gold caught | gold quote on the seeded words, or on the same earlier gap | controls flagged | invalid answers |
|---|---|---|---|---|
| haiku-1 | 4 of 4 | 4 of 4 | 0 of 2 | 0 |
| haiku-2 | 4 of 4 | 4 of 4 | 0 of 2 | 0 |
| haiku-3 | 4 of 4 | 4 of 4 | 0 of 2 | 0 |

Majority caught 4 of 4 gold items.

- gold x0b55df (appended-claim, from extract-safePath/S1), seeded words "and the build runs faster than before": haiku-1 gap "the build runs faster than before"; haiku-2 gap "the build runs faster than before"; haiku-3 gap "the build runs faster than before"
- gold xbd987f (appended-claim, from extract-safePath/S2), seeded words "and no reviewer needs to read the diff": haiku-1 gap "import safePath from ./paths.mjs"; haiku-2 gap "import safePath from ./paths.mjs"; haiku-3 gap "import safePath from ./paths.mjs"
  - haiku-1, haiku-2, haiku-3 quoted the same earlier unchecked claim they found in the unmutated extract-safePath/S2, which comes first in reading order.
- gold x6ed9e1 (dropped-body-check, from extract-safePath/S1), seeded words "body unchanged": haiku-1 gap "with its body unchanged"; haiku-2 gap "with its body unchanged"; haiku-3 gap "with its body unchanged"
- gold xc6ee28 (swapped-json-path, from derive-site-copy-list/S4), seeded words "$.release.siteBuildId": haiku-1 gap "only at $.release.siteBuildId"; haiku-2 gap "only at $.release.siteBuildId"; haiku-3 gap "only at $.release.siteBuildId"

## Real sentences

### extract-safePath

- **S1** covered. Move the function safePath out of src/compiled-patch.mjs into a new file src/paths.mjs, with its body unchanged.
- **S2** gap. src/compiled-patch.mjs, src/project-router.mjs and src/static-compiler.mjs import safePath from ./paths.mjs; nothing else in those three files changes.
  - haiku-1: unchecked "import safePath from ./paths.mjs"
  - haiku-2: unchecked "import safePath from ./paths.mjs"
  - haiku-3: unchecked "import safePath from ./paths.mjs"
- **S3** gap. scripts/assemble.mjs adds paths.mjs to the list of source modules it copies into the site.
  - haiku-1: unchecked "adds paths.mjs to the list of source modules it copies into the site"
  - haiku-2: unchecked "adds paths.mjs to the list of source modules it copies into the site"
  - haiku-3: unchecked "adds paths.mjs to the list of source modules it copies into the site"
- **S4** covered. The built site changes in exactly five places: the three edited modules and data/catalog.json change, and paths.mjs is added.
- **S5** gap. In data/catalog.json only the site build identity changes; no PxCube package, snapshot or delta file changes.
  - haiku-1: unchecked "no PxCube package, snapshot or delta file changes"
  - haiku-2: unchecked "no PxCube package, snapshot or delta file changes"
  - haiku-3: unchecked "no PxCube package, snapshot or delta file changes"

### derive-site-copy-list

- **S1** gap. scripts/assemble.mjs stops listing src files by hand; a new scripts/site-closure.mjs computes them by following index.html references and relative module imports from index.html and sw.js, and returns exactly the ten files the list named.
  - haiku-1: unchecked "stops listing src files by hand"
  - haiku-2: unchecked "stops listing src files by hand"
  - haiku-3: unchecked "stops listing src files by hand"
- **S2** gap. A new scripts/site-imports.test.mjs, added to the npm test list in package.json, fails the build if any relative import in the built site does not resolve to a file.
  - haiku-1: unchecked "added to the npm test list in package.json"
  - haiku-2: unchecked "added to the npm test list in package.json"
  - haiku-3: unchecked "added to the npm test list in package.json"
- **S3** covered. Source changes are exactly those four files: assemble.mjs and package.json modified, site-closure.mjs and site-imports.test.mjs added.
- **S4** gap. The built site changes in exactly one file, data/catalog.json, and only at $.release.siteBuildId, because scripts/ files are hashed into that identity.
  - haiku-1: unchecked "because scripts/ files are hashed into that identity"
  - haiku-2: unchecked "because scripts/ files are hashed into that identity"
  - haiku-3: unchecked "because scripts/ files are hashed into that identity"

### grader-in-ci

- **S1** gap. A new checkpoint/ci/shots/ holds the deterministic grader (grade.mjs), the script that builds a base commit and the working tree and grades a shot (shoot.sh), its dependency lock, its tests, a README defining the shot format and rules, and the shot records made so far.
  - haiku-1: unchecked "deterministic grader"
  - haiku-2: unchecked "deterministic grader"
  - haiku-3: unchecked "deterministic grader"
- **S2** gap. checkpoint/ci/shots/crudlint.mjs runs a crudlint predicate set (ast-grep rules under ci/shots/crudlint/) and emits crudlint's finding shape; the shipped predicate set is empty.
  - haiku-1: unchecked "runs a crudlint predicate set"
  - haiku-2: unchecked "runs a crudlint predicate set"
  - haiku-3: unchecked "runs a crudlint predicate set"
- **S3** gap. Both copies of deploy-pages.yml gain exactly five lines, one step that installs ci/shots from its lock and runs its tests; no existing line changes.
  - haiku-1: unchecked "one step that installs ci/shots from its lock and runs its tests"
  - haiku-2: unchecked "one step that installs ci/shots from its lock and runs its tests"
  - haiku-3: unchecked "one step that installs ci/shots from its lock and runs its tests"
- **S4** covered. Source changes are exactly 18 files added under checkpoint/ci/shots/ and the two workflow files modified.
- **S5** gap. The built site is byte-identical to the baseline, because Bazel's inputs do not include ci/shots/.
  - haiku-1: unchecked "because Bazel's inputs do not include ci/shots/"
  - haiku-2: unchecked "because Bazel's inputs do not include ci/shots/"
  - haiku-3: unchecked "because Bazel's inputs do not include ci/shots/"

### crosscheck-pool

- **S1** gap. A new checkpoint/ci/shots/crosscheck.mjs builds a crosscheck batch from the called shots, one item per sentence with the clauses that cover it, plus seeded gold items whose answer is known, and composes the checkers' observations into an agreement through a PxC FunctionalGuarantee, in Atlas's case, observation and comparison form.
  - haiku-1: unchecked "builds a crosscheck batch"
  - haiku-2: unchecked "builds a crosscheck batch"
  - haiku-3: unchecked "builds a crosscheck batch from the called shots"
- **S2** gap. checkpoint/ci/shots/crosscheck/prompt.md tells a checker to answer each item covered or gap, and for a gap to quote verbatim the words of the sentence that no clause checks.
  - haiku-1: unchecked "tells a checker to answer each item covered or gap"
  - haiku-2: unchecked "tells a checker to answer each item covered or gap"
  - haiku-3: unchecked "tells a checker to answer each item covered or gap"
- **S3** gap. Three Haiku checkers answer the same batch without seeing each other's answers or the gold key; the batch, the key, their three observations, the comparison and a rendered report are recorded in checkpoint/ci/shots/called/crosscheck-2026-10-12/.
  - haiku-1: unchecked "Three Haiku checkers answer the same batch"
  - haiku-2: unchecked "Three Haiku checkers answer the same batch without seeing each other's answers or the gold key"
  - haiku-3: unchecked "Three Haiku checkers answer the same batch without seeing each other's answers or the gold key"
- **S4** covered. Source changes are exactly: checkpoint/ci/shots/README.md and called/events.jsonl modified; crosscheck.mjs, crosscheck/prompt.md, test/crosscheck.test.mjs, called/crosscheck-pool.shot.json, called/grader-in-ci.grade.json and the seven crosscheck records added; nothing removed.
- **S5** covered. The built site is byte-identical to the baseline.

