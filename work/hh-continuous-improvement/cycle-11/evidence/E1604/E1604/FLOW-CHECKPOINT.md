# HH11 H1/E1604 canonical-build checkpoint

## Written in

The exact capture wrapper is `run-build.sh`. It has not been executed yet. It records UTC start/end, raw stdout/stderr, the build command's exit, and the wrapper exit in distinct files, with `noclobber` preventing overwrites. The only product source change is the E1603 regression test in `checkpoint/vendor/hh/src/public-controller.test.mjs`; controller and renderer are unchanged.

## Entry point

The prospective invocation is:

```sh
bash /workspace/scratch/8528bb251845/hh-cycle11/H1/E1604/run-build.sh
```

The wrapper runs exactly this command from `/workspace/scratch/8528bb251845/PageRouter/checkpoint`:

```sh
BAZEL=/workspace/scratch/8528bb251845/tools/bazel bash ci/bazel/run.sh
```

## Numbered walkthrough

1. The wrapper records the start UTC timestamp and runs the configured canonical `run.sh` command, capturing its stdout and stderr without a pipeline so the recorded command exit is the script's actual process status.
2. `ci/bazel/run.sh` enters the checkpoint root, runs `ci/bazel/bootstrap.py`, checks the configured Bazel version against `.bazelversion`, runs build-helper tests, builds `//:site` with the configured output root, and invokes `ci/bazel/verify-output.mjs` on the resulting site and receipt.
3. On a Bazel action execution, `build-driver.mjs` copies only declared source inputs into an isolated temporary source tree and tools into a separate tools tree; it hashes each declared source as copied. It runs fast-check self-hosting, compiles PxCube/neat and crisp packages, verifies fresh PxCube package evidence, assembles the site, verifies crisp changed-source/cache/clean equality, then runs targeted HH/controller regressions, the complete declared `npm test` suite, and the built Atlas import test.
4. The driver copies the assembled `dist` site and its build `evidence` into Bazel outputs, hashes emitted site files, and writes `site.receipt.json` with source inputs/source digest, toolchain, site files/site digest, build ID, PxCube package count, and crisp equality. It writes `site.log` from the phase transcript. Bazel may instead report a cache hit; if so, report it explicitly and do not claim the driver’s tests or compilation ran again.
5. The final verifier checks every emitted output file against the receipt, including on a Bazel cache hit. The wrapper records UTC end and both exit values. Only after successful verification will the current `bazel-bin/site.receipt.json` and `bazel-bin/site.log` be copied into E1604; the historical `site.evidence` tree will not be copied.

## Invocation table

| Phase | Actual machinery | Evidence produced |
|---|---|---|
| Prepare/guard | `bootstrap.py`, Bazel version guard, `build-helpers.test.mjs` | raw wrapper stdout/stderr/exit and timestamps |
| Build action | Bazel `//:site` → `build-driver.mjs` | isolated declared inputs; package/build phases; `site.log`; `site.receipt.json` |
| Verify | `verify-output.mjs` | emitted site-file count, build ID and PxCube package count |

The E1603 test file must appear in the actual receipt’s `sourceInputs` with the candidate hash. The controller source hash must remain the accepted unchanged hash. Whether a fresh action ran or Bazel reused a valid candidate receipt will be reported from actual output and receipt.

## Shared machinery

The wrapper supplies only the configured Bazel path and evidence destinations. Bazel owns the `//:site` action and cache. The build driver owns isolated staging, source-input hashing, compilation and test phases, site/evidence packaging, and receipt/log creation. The final verifier owns output digest verification. No second test command, manual source build, browser action, or Git operation is part of E1604.

## Inspection

After a successful run, the exact wrapper records remain under E1604, and only the current receipt/log are copied from `checkpoint/bazel-bin/`. The receipt will be inspected for the exact HH controller/test input hashes and source/site digests, and the build transcript for actual phase counts. If the build fails, preserve its original raw files/exit and stop before repair. If the Bazel action is cached, distinguish output verification from test execution.

## Explicit boundaries

- No source/test change during this build task; no controller edit, test expansion, build repair, Git commit/push, browser attempt, or whole historical `site.evidence` copy.
- The single build command may itself run declared tests only if the Bazel build action executes; no fresh test-execution claim is made for a cache hit.
- No deployment, mounted-browser reachability, production/backend, or human-acceptance claim.

## Review

This is the flow root authorized in the E1604 packet. Execute only the single configured canonical build; preserve the first actual failure and stop if one occurs.
