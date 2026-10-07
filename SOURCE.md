# Source for the deployed PageRouter build

The complete materialized source checkpoint is in [`checkpoint/`](checkpoint/README.md).
It contains all 2,081 logical files from the authoritative Drive archive,
including source, pinned vendor snapshots, build scripts, tests, evidence, and
the matching 709-file `dist/` output. The original path, size, and SHA-256 of
each file are in [`SOURCE-ARCHIVE-MANIFEST.json`](SOURCE-ARCHIVE-MANIFEST.json).

- Deployed site build ID: `f300f36921420180b22cf20670700a08adaf3c523ac332f1c93653c4143aa765`
- Source archive: [Drive checkpoint](https://drive.google.com/file/d/1ZwS98quJQwjeyEz3w4nWPXetILYr9qbm/view), 32,555,727 bytes, SHA-256 `2d58add7477bc1b9cb18cce9297f6851f21fcf4d051afcd9bda5e849f6e8ce3b`
- Main before source publication: `ea5d7c6dbe99522adc8bdae687c885ac143fabb7`
- Original source attribution and boundaries: [`SOURCE-CHECKPOINT.json`](SOURCE-CHECKPOINT.json)

From a fresh checkout, enter `checkpoint/` and run `bash ci/bazel/run.sh`
with Node 24.19.0, Python 3, npm and Bazel 7.4.1. This compiles current source
in isolated Bazel staging and verifies fresh output before publication.
See [build instructions](checkpoint/README.md). The checkpoint is candidate 0.0.0;
it does not claim human acceptance.

The root Pages workflow now builds source with Bazel, validates pull requests,
and deploys successful main builds. `artifact.json`, `deploy-materialize.py` and
`compiled-artifact.part*` remain as historical transport for separate later
cleanup; they are no longer deployment inputs. Later application experiments
on `parallel-compressing-bootstrap` are not imported by this build change.

The original archive manifest describes imported bytes. Current checked-out
source and fresh site output identities are in `bazel-bin/site.receipt.json`.

The checkpoint's `dist/README.md` and `dist/SOURCE-CHECKPOINT.json` are older
embedded records. They are retained byte for byte as part of the source archive.
The active deployment identity comes from the freshly served `data/catalog.json`
and its corresponding Bazel build receipt. The build ID above identifies the
historical imported deployment.
