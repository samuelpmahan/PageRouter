# ParallelCompressingBootstrap

The source authority is the f300 canonical archive recorded in
`SOURCE-CHECKPOINT.json`, not the compiled GitHub transport. The explicit source
manifest accounts for all 2,081 canonical paths: 1,292 compiler inputs and 789
excluded/replaced paths. Historical `dist` is comparison evidence, never a
compiler input. All new build machinery lives outside the source-hashed
`scripts`, `src`, and runtime experiment directories.

```sh
bash ci/bazel/run.sh
```

This Linux x86_64 recipe requires Python 3.14.4 for tool acquisition. The pinned
Actions workflow provisions it through an immutable setup-python action. Node
24.21.0 (npm 11.19.0), Bazel 7.4.1 and npm dependencies are acquired with exact
archive/binary hashes and lockfile SRI. Static BusyBox 1.35.0 supplies the
declared `sh`, `mkdir` and `cp` tools required by original crisp build commands.
Its official binary is fixed at SHA256
`6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348`.
Acquisition is the only permitted
network boundary. Local cached byte-identical tools may be supplied through
`PAGEROUTER_NODE_ARCHIVE` and `PAGEROUTER_BAZEL_BINARY`. The source lock is never
rewritten; npm lifecycle scripts are disabled.

After acquisition, the commands are:

```sh
.bootstrap/bazel --batch --output_user_root="$PWD/.bazel-cache" build \
  --enable_bzlmod=false --spawn_strategy=sandboxed \
  --sandbox_default_allow_network=false //:pagerouter_site
.bootstrap/bazel --batch --output_user_root="$PWD/.bazel-cache" test \
  --enable_bzlmod=false --spawn_strategy=sandboxed \
  --sandbox_default_allow_network=false --nocache_test_results \
  --test_output=errors //:pagerouter_verify
```

The custom `PageRouterSourceBuild` action declares its source, recipe and full
Node/npm tool closure. It validates their bytes, stages an empty work tree,
rebuilds the self-hosted fast-check bundle, compiles neat TypeScript, runs the
original PxCube/neat/tidy/crisp lifecycle, assembles the full workbench, and runs
the crisp delta proof that also creates delivered site files. It requires fresh
PxCube build evidence before assembly; shipped-output fallback is unavailable.
It emits `pagerouter_site.site`, `.evidence`, `.receipt.json` and
`.diagnostics.txt`. The separate verification target tests these fresh outputs,
checks receipt identities, runs existing repository tests and exercises the
original delta pipeline. The standalone validator checks every output byte and
demonstrates rejection of a changed digest.

The selected compiler source remains byte-identical to its archive records.
The repository's `.gitignore` and build files are explicit recipe overlays.
The three minted `FunctionalGuarantee/proto/none/*.pxc` files contain exactly
the requested unresolved tuples, with a terminating newline. See
`PROTO-BOUNDARY.md`; no existing JSON-ingestion conversion is asserted.

The bootstrap records exact tool file hashes and host Python identity. Node
shared libraries, the Linux kernel, and the test launcher shell remain host
prerequisites. The recipe makes no claim of a fully hermetic operating-system
toolchain. Raw PxCube lifecycle attempt IDs, clocks and paths are preserved;
canonical receipt serialization is not a claim that repeated site bytes are
identical. Output differences must be measured and explained, not normalized.

The empty-tree build produces 707 files: five Connect Four test modules are
added compared with the 709-file archive, and seven historical publication
files are absent (`.github/workflows/deploy-pages.yml`, `.nojekyll`, `README.md`,
`SOURCE-CHECKPOINT.json`, `data/verification.json`, and the two `examples/*.json`
files). The canonical build scripts do not generate those seven files. A build
over an existing 709-file `dist` retained them and therefore reported 714;
this action deliberately starts empty. It records all 38 changed files rather
than copying historical publication bytes into the compiled result. Existing
runtime source has no references to the absent verification/example files.

The test adapter resolves Bazel tree-artifact runfiles to their declared sibling
output trees and retains strict rejection of internal output symlinks. The
existing delta proof reads an absolute source-build path in PxCube evidence;
verification checks every relocated package receipt/chunk against the fresh
outer site receipt before changing that path only in its private scratch copy.
The delivered evidence bytes and lifecycle receipts remain untouched.

The workflow is restricted to `parallel-compressing-bootstrap`, has read-only
repository permissions and uploads build artifacts. It has no deployment job.
