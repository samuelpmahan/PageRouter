# Frozen baseline for parallel agents

Every agent starts from one tagged commit and proves, before touching anything,
that its environment builds the same site. A difference found after that point
is the agent's change, not the machine.

## The check

```sh
cd checkpoint
bash ci/freeze/verify-baseline.sh
```

This runs the same Bazel target as GitHub Actions (`ci/bazel/run.sh`), then
compares a stable digest of `bazel-bin/site.site` against `baseline.json`.

Why a stable digest and not `siteBuildId`: the build is reproducible in content
but not in bytes. The pinned PxCube packager writes wall-clock fields
(`packagedAt`, `runId`, `durationMs`), and those cascade into the compiled
snapshot and the catalog. Two cold builds of the same commit differed in 34 of
829 files for exactly these reasons and no others. `stable-digest.mjs` masks
those fields only, re-hashes the compiled snapshot by masked file content, and
hashes everything else byte for byte. It never edits the site. The masking
lives here rather than in the packager because the packager is pinned vendor
code; a fixed build clock in PxCube would remove the need for it.

## Path to success when the build fails

`ci/bazel/run.sh` fails at one of these points. Fix the first one that fails.

1. **`Use Node v24.19.0`** (bootstrap). The exact version is required. Use
   nvm or fnm. If nodejs.org is unreachable, the npm registry carries the same
   binary: `npm pack node-linux-x64@24.19.0` and put its `bin/` first on PATH.
2. **`npm ci` fails** (bootstrap). Network or registry access; the lockfile is
   authoritative. Delete `.bazel-tools/` and retry once.
3. **`Use Bazel 7.4.1`**. Download the pinned binary and check it against the
   SHA-256 in `.github/workflows/deploy-pages.yml`, then `BAZEL=/path/to/bazel`.
4. **`build-helpers.test.mjs` fails**. A build-tooling regression in
   `ci/bazel/`; nothing about the site has run yet.
5. **`bazel build //:site` fails**. Open `bazel-bin/site.log`. The log prints
   stage names in order: self-host fast-check, compile PxCube/neat and
   crisp-package every experience, assemble, verify crisp equality, HH
   regressions, `npm test` against fresh output, built Atlas import closure.
   The last stage printed is the one that failed.
6. **Sandbox errors** (namespaces unavailable, for example inside some
   containers). Bazel falls back to processwrapper staging; if it does not,
   run on a host or VM that permits Linux namespaces.
7. **`verify-output.mjs` fails**. The output does not match its own receipt,
   which points at a corrupted cache. Rebuild with a fresh
   `PAGEROUTER_BAZEL_OUTPUT_ROOT`.
8. **`BASELINE MISMATCH`**. The build succeeded but the site differs. Run
   `node ci/freeze/stable-digest.mjs bazel-bin/site.site --files` here and on a
   known-good build, and diff the records. On a clean checkout of the tag this
   means the environment differs; record it before any agent starts.

Windows: the build needs Linux (bash, Linux sandboxing, host `sh`/`cp`). Run it
in WSL2 with the toolchain above installed inside WSL, not with Windows Node.

## Path to the frozen, tagged commit

1. Land the commit on `main` and wait for the Actions build to pass.
2. Tag that exact commit, annotated, with the stable digest in the message:

   ```sh
   git tag -a baseline/pagerouter-2026-10-12 <commit> \
     -m "stableDigest c216d9aa0e76de11b07d9cd7538f4fcd1efac74719dc129113285b3506db3c20"
   git push origin baseline/pagerouter-2026-10-12
   ```

   Tags are never moved. A new baseline gets a new tag and a new `baseline.json`.
3. Each agent, local or cloud, starts with:

   ```sh
   git clone --depth 1 --branch baseline/pagerouter-2026-10-12 \
     https://github.com/samuelpmahan/PageRouter agent-<name>
   cd agent-<name>/checkpoint
   bash ci/freeze/verify-baseline.sh
   ```

   One full clone per agent. Agents never share a working tree or a Bazel
   output root.
4. An agent that reports anything first records `git rev-parse HEAD` and the
   `BASELINE OK` line. Without both, its results are not comparable.

## Files

- `baseline.json`: expected stable digest, toolchain, and the evidence for it.
- `stable-digest.mjs`: computes the stable digest of a built site.
- `verify-baseline.sh`: builds, then compares against the baseline.
