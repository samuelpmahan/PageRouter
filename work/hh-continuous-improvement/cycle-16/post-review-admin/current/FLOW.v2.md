# E2206 prospective local Git-checkpoint flow

**Written in:** `/workspace/scratch/8528bb251845/hh-cycle16/H1/E2206/` — gate, verifier, exporter, prospective records, and this flow. This v2 corrects the v1 wording while preserving v1 as unrun history. R2205 was independently accepted; the review result is archived under `post-review-admin/current`. The scripts remain unvalidated and unexecuted. During earlier setup, one read-only `git status --short` was invoked; no source/index/ref write was observed. Preserve this as a process-deviation testimony, not a product or native-task failure. No further status invocation is part of this phase.

## Entry points (not yet authorized)

After root separately admits the exact admin closure and plan, and each step receives its own root GO, the prospective commands are:

1. `node /workspace/scratch/8528bb251845/hh-cycle16/H1/E2206/precommit-gate.v1.mjs <root-admitted-plan-path> <plan-sha256>`
2. Stage the exact normal path list using the prepared proposal NUL bytes after root admits the immutable path plan, with explicit file arguments/pathspec file only. No broad `git add`, glob, ignore override, or force-add path is planned.
3. `git diff --cached --check` once as a full staged diagnostic; preserve the real stdout/stderr/exit, including any warnings or exit 2.
4. `node /workspace/scratch/8528bb251845/hh-cycle16/H1/E2206/verify-staged-allowlist.v1.mjs <root-admitted-plan-path> <plan-sha256>`
5. After a distinct commit GO, one local commit with the message `HH cycle 16: characterize local profile edit overlay`.
6. After root has admitted the exact commit/export plan and gives a separate export GO: `node /workspace/scratch/8528bb251845/hh-cycle16/H1/E2206/export-once.v1.mjs <root-admitted-export-plan-path> <plan-sha256> <immutable-40-hex-commit>`.

Arguments in angle brackets are placeholders, not current files or runnable authority. This document does not authorize any command above.

## Flow, in order

1. **Precommit gate.** Bind repository `/workspace/scratch/8528bb251845/PageRouter`, branch `codex/hh-continuous-improvement`, HEAD `1d8f32657922f0f67cbde1719472f688060b4e94`, and tree `519253865a06aa60d651074db893fa0ae6428f07`. Require exactly one changed product source, `checkpoint/vendor/hh/src/public-controller.test.mjs` at SHA-256 `bbc47f37250ffb207b671fb83d3f467123e21b1673ae72f2c32f45dfe759b2d0`. Verify the immutable cycle-16 manifest/result and all 77 payload entries by bytes, SHA-256 and full mode; require exactly 79 frozen package files total. Independently walk the separately indexed `post-review-admin/current` closure against its exact admin manifest. Compare complete ordinary porcelain status with the exact source + package + admin path allowlist and explicit 27-path scratch exclusion set. Every other changed or missing path is fatal. Check only plan-enumerated authored text for strict UTF-8/trailing whitespace and retain the authored `git diff --check` result. Raw captures remain exact and are never normalized. The ordinary cycle-16 evidence paths avoid `bazel-*`; no ignored or general dirty-tree exception is intended.
2. **Stage once.** Use the exact root-admitted NUL path list or explicit argument list after the gate passes and a separate stage GO. Include only the changed test and approved package/admin closure. No broad staging, force-add, globs, cleanup, or `.gitignore` edits.
3. **Full staged diagnostic.** Run `git diff --cached --check` once after staging. Capture original stdout, stderr and exit. Immutable historical logs may produce warnings; an exit 2 is a diagnostic, not clean output. Stop for root review. Do not normalize captures, alter config, bypass hooks, or claim a clean diff.
4. **Staged verifier.** With separate GO, require the staged names to equal the exact admitted plan; validate index records, modes, bytes, SHA-256, Git blob SHA-1, worktree/index equality, base identity, and the exact 27 excluded untracked files. Any additional status is fatal.
5. **One local commit.** Only after root reads the staged diagnostic and verifier result and grants commit GO, commit once on the existing branch. No amend, retry, reset, fetch, push, force-ref, or admin/source rewrite.
6. **Read-only export.** Only after a separate exact-commit plan admission and export GO, read immutable local Git objects. Verify one parent equals the pinned local base, tree/object identity, exact changed paths, exact cycle package closure, independently indexed admin closure, source bytes, Git modes, SHA-256 and Git blob SHA-1. Write an exclusive transport directory under the E2206 scratch root. Segment JSON is capped at 60,000 bytes and the index at 1,000,000 bytes. Export is not remote authentication or publication.

## Inputs and outputs by gate

| Gate | Inputs | Prospective output | Boundary |
| --- | --- | --- | --- |
| Precommit | Root-admitted plan, frozen 79-file cycle package, proposed exact admin manifest, current worktree/index | JSON closure/status/whitespace report | Read-only; no staging |
| Stage + diagnostic | Exact admitted path list | Git index plus preserved full diff-check capture | Separate GO; warnings/exit retained |
| Staged verify | Same root-admitted plan and index | JSON with exact paths, blob hashes, modes, bytes, excluded count | Read-only |
| Local commit | Verified index | One local commit ID/tree/parent | Separate GO; no remote operation |
| Export | Root-admitted exact commit/plan | Exclusive segmented local-object transport | Read-only Git objects; no publish |

## Shared machinery and inspection

Node reads the immutable plan/package, computes file and Git-object hashes, and invokes Git for status/index/tree/object facts. Git remains the source of local branch, status, index, parent, tree, and blob identity. Raw capture bytes and POSIX modes are part of the frozen manifest; the exporter projects executable mode to Git mode without rewriting evidence. This phase has constructed a proposed repository-side admin evidence closure and plan; root must review/admit the immutable plan and provide separate authorization for each future phase.

## Explicit limits

- R2205 was accepted by H2 (native receipt `889478b79a8fbaa0e967070f82fe2fda181a59030de8db576c402d7d1e0228f8`). This phase is only construction after that acceptance; it does not itself admit the plan or authorize validation or Git actions.
- Package freeze is exactly manifest 77 payload files plus manifest and E2205 result, 79 total; SHA-256 manifest `414eec12c7438e78c09ab81970af556b783486bd50d6c98c4ea18c7c28b22f15`.
- Product scope is one regression test; no production behavior change. Test/build success is not browser/backend/human acceptance.
- The exact 27 HH13/HH15 scratch names are a literal inventory in both gate scripts. No prefix-based waiver.
- Native epoch 05/06 and current state/policy are captured-time snapshots, not live state. At epoch 06 (2026-10-19T01:36:52.578981+00:00), H1 was assigned E2206 and H2 remained pinned to R2205; later acceptance does not rewrite that history.
- The H1 E2201 probe used a fresh provider/runtime; H2 E2202's fresh-controller step reused its runtime. E2201 `runtimePartsChanged=false` records only address/kind inventory. E2203 checks selected Part identities/references/values; provider/function internals were not JSON-serialized.
- The site audit rehashed 1,538 source inputs and recomputed metadata for 843 output rows, but retained no output tree; this is not a body-by-body rehash of all site files.
- Earlier phase 1 did not run syntax, tests, build, gate, stage, commit, export, publication, or deployment. One read-only `git status --short` setup invocation is preserved above; no source/index/ref write was observed. This construction is not Git/publication readiness.

## Checkpoint review

Review the exact scripts, prospective pins, admin manifest, proposed 101-path plan, and flow before any syntax validation or Git action. This construction phase ends with the proposal only; no later phase is authorized here.
