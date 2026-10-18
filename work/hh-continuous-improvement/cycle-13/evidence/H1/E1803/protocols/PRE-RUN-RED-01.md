# E1803 red-run checkpoint

Prepared before the first regression-test execution. Only the admitted test path is modified; controller and renderer remain unmodified.

## Exact command and original captures

- CWD: `/workspace/scratch/8528bb251845/PageRouter/checkpoint`
- Executable and argv: `["/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node", "--test", "--test-name-pattern=login draft", "vendor/hh/src/public-controller.test.mjs"]`
- Shell-quoted command: `/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node --test --test-name-pattern='login draft' vendor/hh/src/public-controller.test.mjs`
- Prepared UTC: `2026-10-18 20:29:25 UTC`
- Original stdout: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1803-PROPOSAL/red-01.stdout.raw`
- Original stderr: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1803-PROPOSAL/red-01.stderr.raw`
- Original exit: `/workspace/scratch/8528bb251845/hh-cycle13/H1/E1803-PROPOSAL/red-01.exit`
- UTC start/end: `red-01.start.utc`, `red-01.end.utc`
- All five output paths were absent at preflight. Execution will use noclobber and capture streams directly.

## Expected red

The two new `login draft` tests should fail because current `updateDraft('email', ...)` returns false on `#/login`, leaving renderer projection on the session/registration fallback. No controller or renderer change has been made. A failure for any unrelated reason is a harness failure: preserve this version and raw files, then stop for review.

## Source identity before red

| File | SHA-256 |
|---|---|
| `checkpoint/vendor/hh/src/public-controller.mjs` | `fbb5803ae6269b8d4c61b3e4c0e100dfaf18269c823283be192aa66a353be6f2` |
| `checkpoint/vendor/hh/src/public-site.mjs` | `96d930a2e6fc8c712dea5a593105071de217069d8f8313c4d531f0c4cf400ef4` |
| `checkpoint/vendor/hh/src/public-controller.test.mjs` | `d3eb4fb4f8858f41ce5a5bae35ad28ce3aea9e2b65ba9de2b9564c71d1bb5e81` |

The test file hash includes only the new E1803 test helper and red tests. Product source hashes are the root-verified E1803 baseline. PageRouter remains on existing branch `codex/hh-continuous-improvement`; no Git operation was performed.
