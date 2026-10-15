# Frozen baseline for parallel agents

Every agent starts from one tagged commit and proves, before touching anything,
that its environment builds the same site. A difference found after that point
is the agent's change, not the machine.

## The check

```sh
cd checkpoint
bash ci/freeze/verify-baseline.sh
```

This runs the same Bazel target as GitHub Actions (`ci/bazel/run.sh`) and
requires the built site to be byte-identical to the baseline: the same
`siteBuildId`, which is the hash of every file's hash.

The build is reproducible because its one varying input, the clock, is
declared. `source-date-epoch.txt` holds a fixed time (whole seconds since
1970); the driver passes it to every step as `SOURCE_DATE_EPOCH`. PxCube's
packager, run ids and tidy registry write that time instead of the wall clock,
the run id (also the service-worker cache name) ends in a digest of the build
inputs, and wall-clock durations are left out of shipped receipts. Two cold
builds on different filesystems produce identical bytes.

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
8. **`BASELINE MISMATCH`**. The build succeeded but the bytes differ. Compare
   `siteFiles` in `bazel-bin/site.receipt.json` with a known-good build's
   receipt to list the differing files. On a clean checkout of the tag this
   means the environment differs; record it before any agent starts.

Windows: the build needs Linux (bash, Linux sandboxing, host `sh`/`cp`). Run it
in WSL2 with the toolchain above installed inside WSL, not with Windows Node.

## Path to the frozen, tagged commit

1. Land the commit on `main` and wait for the Actions build to pass. Its
   `siteBuildId` must equal `baseline.json`.
2. Tag that exact commit, annotated, with the stable digest in the message:

   ```sh
   git tag -a baseline/pagerouter-<date> <commit> -m "siteBuildId <from baseline.json>"
   git push origin baseline/pagerouter-<date>
   ```

   Tags are never moved. A new baseline gets a new tag and a new `baseline.json`.
3. Each agent, local or cloud, starts with:

   ```sh
   git clone --depth 1 --branch baseline/pagerouter-<date> \
     https://github.com/samuelpmahan/PageRouter agent-<name>
   cd agent-<name>/checkpoint
   bash ci/freeze/verify-baseline.sh
   ```

   One full clone per agent. Agents never share a working tree or a Bazel
   output root.
4. An agent that reports anything first records `git rev-parse HEAD` and the
   `BASELINE OK` line. Without both, its results are not comparable.

## Files

- `baseline.json`: expected `siteBuildId`, toolchain, and the evidence for it.
- `verify-baseline.sh`: builds, then compares against the baseline.
