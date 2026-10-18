# E1804 build checkpoint — not executed

## Written in

- Wrapper: `run-captured.mjs`
- Original prospective command record: `prospective-command.json`
- This checkpoint has only been prepared. The build has **not** been executed.

## Entry point

From `/workspace/scratch/8528bb251845`, the exact wrapper invocation is:

```text
/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node /workspace/scratch/8528bb251845/hh-cycle13/H1/E1804/run-captured.mjs
```

The wrapper invokes this child command from `/workspace/scratch/8528bb251845/PageRouter/checkpoint`:

```text
env BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh
```

The canonical command bytes are retained in `prospective-command.json` before any execution. The wrapper hashes that file and stores the hash in `exit.json`.

## Actual flow on a future admitted run

1. Read and validate the saved command record; compute its SHA-256.
2. Refuse to start if any of the five capture targets (`stdout.raw`, `stderr.raw`, `exit.json`, `start.utc`, `end.utc`) already exists.
3. Create stdout/stderr capture files exclusively, record a UTC start time, and spawn `/usr/bin/env` with the exact saved argv/cwd. Child stdout/stderr are inherited directly by file descriptors; no `tee`, transformation, or concurrent transcript is used.
4. Record the observed process `status`, `signal`, and spawn error (if any), then record UTC end time. A nonzero result is surfaced as the wrapper's process exit; there is no retry path.
5. After exit only, inspect the produced source-build receipt/log and copy only `bazel-bin/site.receipt.json` and `bazel-bin/site.log` byte-for-byte into the E1804 packet, using exclusive destinations. Do not copy `site.evidence`, PNGs, or `.dist` output.

## Build behavior and limits

`ci/bazel/run.sh` changes cwd to the checkpoint, installs pinned build dependencies into private tools via `ci/bazel/bootstrap.py`, verifies the configured Bazel version, runs bounded build-helper tests, and runs Bazel `//:site` under the declared output root. The Bazel build driver copies declared sources/tools into isolated staging, rebuilds fast-check/PxCube/HH PageRouter, assembles and tests the fresh site, verifies output against its receipt, and produces `bazel-bin/site.site`, `site.receipt.json`, `site.log`, and `site.evidence`. The Pages workflow uses the same source build; its deployment job is separate and gated to successful non-PR main runs. This local build command does not invoke the deploy job.

No browser QA, production service, account, Git, package, or deployment operation is included in this packet. The site receipt and log are not copied until after the admitted command exits.

## Frozen input identity

| Source | SHA-256 |
|---|---|
| `vendor/hh/src/public-controller.mjs` | `308c876e8bbfeb20a3e8ee92a4065549f5ca815bec0aa6979bf39c61fa4dc07c` |
| `vendor/hh/src/public-site.mjs` | `5f1135c95fdb3baefb64e49d755e45a87b9eb1b17ff363ed91eb5b516812031b` |
| `vendor/hh/src/public-controller.test.mjs` | `f426710f6ae9c3012f5eba2aa0d50b3aaca8b4e76a4119dd3ffca58d08e13d4f` |

The child build's own current source digest, output file identity, and site build ID will come from the freshly emitted `site.receipt.json`; no site identity is claimed before it exists and is inspected.
