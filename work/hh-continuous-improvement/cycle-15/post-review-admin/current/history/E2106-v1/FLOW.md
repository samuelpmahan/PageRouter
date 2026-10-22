# E2106 — prospective stage/commit/export flow

**Written in:** `/workspace/scratch/8528bb251845/hh-cycle15/H1/E2106/` — `precommit-gate.mjs`, `verify-staged-allowlist.mjs`, `export-once.mjs`, and `prospective.json`. These are preparation-only files. Nothing has been syntax-checked or executed; no Git index/ref, source, frozen package, or post-review admin content has been changed.

## Entry point

No entrypoint is admitted yet. After H2 accepts R2105, the post-review admin closure is separately indexed, and root reads/adopts the exact plan and hashes, each phase requires a distinct root GO. Commands and current parent/source/package literals are recorded in `prospective.json`; all `<...>` plan/hash/commit arguments are placeholders, not runnable values.

## Execution order if separately authorized

1. **Pre-stage gate.** `node /workspace/scratch/8528bb251845/hh-cycle15/H1/E2106/precommit-gate.mjs <root-admitted-plan-path> <plan-sha256>` checks the pinned branch, local parent/tree, the exact two source hashes, the immutable E2105 manifest/result and every payload's bytes/hash/full mode, exact package inventory, the separately admitted admin manifest and entries, and every planned path's Git mode/SHA-256/blob ID. It compares complete porcelain status with the explicit allowlist and literal 27-path exclusion set. Only those exact old HH13/H2 scratch files may remain as untracked; missing, changed, or extra paths fail closed. A source path must be modified and every planned new package/admin path untracked. Existing staged changes fail. Authored text gets UTF-8/trailing-whitespace diagnostics; raw captures are hash/mode checked and never normalized. The script records any `git diff --check` exit/diagnostics rather than claiming a pass on diagnostic output.
2. **Stage exactly once.** Only after a passing pre-stage gate and separate stage GO, stage using a NUL-delimited literal path list generated from the root-admitted plan: `git add --pathspec-from-file=/workspace/scratch/8528bb251845/hh-cycle15/H1/E2106/stage-paths.nul --pathspec-file-nul`. Do not use a broad `git add` or glob.
3. **Full staged whitespace diagnostic.** Run `git diff --cached --check` once and preserve its true stdout/stderr/exit, including a possible exit 2. A nonzero diagnostic is a stop, not an invitation to normalize raw evidence or weaken checks.
4. **Verify index exactly.** `node /workspace/scratch/8528bb251845/hh-cycle15/H1/E2106/verify-staged-allowlist.mjs <root-admitted-plan-path> <plan-sha256>` requires the exact staged path set, mode, bytes, SHA-256 and Git blob SHA-1 from the admitted plan; verifies index/worktree equality; confirms the explicit 27 excluded paths remain the only untracked exceptions; and fails on any unstaged/other status.
5. **One local commit only.** After root reads the verification result and grants a separate commit GO, commit once with `git commit -m "HH cycle 15: disclose local-only password recovery"`. Do not amend, retry, push, fetch, reset, or force. Record the immutable resulting full commit ID and all raw command outcomes.
6. **One read-only export.** Only after root admits that exact commit and grants export GO, run `node /workspace/scratch/8528bb251845/hh-cycle15/H1/E2106/export-once.mjs <root-admitted-export-plan-path> <plan-sha256> <immutable-40-hex-commit>`. It rechecks parent/tree, exact changed paths, frozen package/admin closures, sources, Git modes and object hashes, then writes a segmented transport under a new exclusive `hh-cycle15/H1/E2106/export/<commit>/`. It reads immutable local Git objects only; it does not contact or authenticate a remote or publish anything.

## Data and shared machinery

The pre-stage and staged verifiers read the same root-admitted plan. The plan must enumerate exact files with repository-relative path, Git mode (`100644`/`100755`), byte length, SHA-256, and Git blob SHA-1; pin branch/parent/tree; identify the frozen cycle-15 manifest/result and accepted admin manifest; and list authored-text paths separately from raw evidence. The exact path list is generated only after R2105 and admin closure exist. Git supplies porcelain/index/tree/blob observations; Node performs hash, byte, mode, schema, and closure checks. The export command accepts only the admitted plan and immutable commit; unique output directories/files use exclusive creation.

## Explicit boundaries and known handling

- The reviewed sources remain exactly `public-site.mjs` `1159a588…6409b7` and `public-site.test.mjs` `12e8b851…66fb1a`. The package remains exactly 105 manifest payload files plus `manifest.json` and E2105 `result.json` (107 total), manifest SHA-256 `ef30d325…68c4f914`; its bytes/modes are frozen.
- The exact excluded untracked set is 21 enumerated HH13 files plus six enumerated H2 E2102 originals. It is not a directory-prefix waiver. Every other changed/staged path is fatal.
- E2104 raw `completed` is preserved; only the separate root envelope contains the native schema correction. No unsupported native rejection is claimed.
- Package evidence remains synthetic source-equivalent emitted-tree evidence, not browser DOM/backend/human acceptance. No retention defect was proven; no real email was sent.
- No current admin folder, allowlist plan, NUL path file, gate run, whitespace run, stage, commit, or export has been created/performed by this E2106 phase. The future admitted plan and path list must be written after R2105 acceptance and reviewed by root before execution.
- The exporter ends by logging `localCommit: commit` (not an undefined local identifier). It remains unexecuted; this is a code inspection statement, not a runtime verification claim.

## Review checkpoint

Please review the actual flow and exact literals before any later syntax check or execution is authorized. Current phase is construction-only and stops here.
