# E2304 canonical build capture — preparation only

## What is pinned

This prospective binds the current two changed product files only: `checkpoint/vendor/hh/src/public-site.mjs` at SHA-256 `d9c17a350375633a53d0dc256be666bb0c82298c9ffa7b05bc6be08156141bfc`, and `checkpoint/vendor/hh/src/public-site.test.mjs` at SHA-256 `264f67b21ad165aab85e71c48d48d9d898ca30725418d7b2eb350f9cc98c74c5`. No additional source change is proposed.

## Actual canonical flow from the previously reviewed runner

The one later-eligible command is `/usr/bin/env BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh`, with working directory `/workspace/scratch/8528bb251845/PageRouter/checkpoint`. The reviewed `ci/bazel/run.sh` changes to the checkpoint build root, runs bootstrap, validates the pinned Node and configured Bazel versions, runs the build-helper tests, invokes Bazel to build `//:site`, then runs `ci/bazel/verify-output.mjs` against the emitted site and receipt. The build and all of those stages remain unrun for E2304.

## Capture wrapper flow

If separately authorized after the current root-state policy gate is satisfied, `run-once.sh` first refuses to overwrite any named raw capture or output file. It changes to the canonical checkpoint directory, records UTC start, runs the canonical command once with original stdout/stderr redirected to exclusive raw files, stores the actual shell exit code, records a possible-signal classification using the shell's `>128` exit convention, and records UTC end. Only on command exit 0 does it copy the newly emitted `bazel-bin/site.receipt.json` and `bazel-bin/site.log` into the exclusive evidence output directory, preserving file modes. The wrapper's signal classification is not independent OS-level signal instrumentation.

The only post-build artifacts intended for retention are those two fresh receipt/log files plus original stdout/stderr/UTC/exit/signal captures. Do not copy historical `site.evidence`, site output trees, screenshots, or PNGs.

## Interpretation boundaries

Prior build reports' named helper/targeted/full-suite groups can overlap; do not sum them as independent tests. The prior cycle's named counts are historical context only, not E2304 predictions or results. Any actual named summary and receipt/log provenance must come from this one fresh run. The canonical build eligibility gate is external to this wrapper and requires accepted R2303 review plus root full-read of this exact wrapper and prospective. This folder is preparation only; no syntax check, import, test, build, or Git operation was run for E2304.
