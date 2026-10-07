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

From a fresh checkout, enter `checkpoint/` and use Node 24 and Python 3.
Run `npm ci --ignore-scripts`, `npm test`, and `npm run build` as a basic source
check. Its README documents the full build, PxCube, browser, and preview commands.
The checkpoint is candidate 0.0.0; it does not claim human acceptance.

The root Pages workflow continues to run `deploy-materialize.py` against the
unchanged root `artifact.json` and `compiled-artifact.part*` files. Adding source
does not change the compiled output. The `parallel-compressing-bootstrap` branch
contains later Bazel experiments and is not part of this deployed checkpoint.

The checkpoint's `dist/README.md` and `dist/SOURCE-CHECKPOINT.json` are older
embedded records. They are retained byte for byte as part of the source archive.
The active deployment identity comes from the root `artifact.json` and the
served `data/catalog.json`, which both identify the site build above.
