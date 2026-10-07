# Local PxCube: the same packaging program, one local command

Candidate branch: `codex/local-pages`.
Node 24; no package installation or global hooks needed.

This document describes the downstream local adapter, not the full ecosystem's
entry point. See [build-map.md](build-map.md) for Sam's correction placing
`neat add` and crisp's experiment generation above this packaging path.

```sh
node local/run.mjs dev
```

Open `http://127.0.0.1:4321/`. The launcher contains Hello, MockPxC,
UploadDiscToShelf, ExploreShelf, and the BuildBag scaffold. The two Studio imports and their boundaries
are described in [studio-sandboxes.md](studio-sandboxes.md). Select
MockPxC opens the interactive `mock.shelf` sandbox. Edit its bag name, then
choose Open interactive sandbox to resume it or New test run to create a fresh
`mock.shelf.<iterator>`. Run visible isolation check operates the actual Save
control in numbered test worlds and checks earlier worlds, including your workspace.
Expand the inspection panel or use `window.pxCubeMocks` in that frame's console.

The Work board link is actual neat HTML. Build record contains crisp source and
manifest hashes, output hashes, shared tool hashes and the checked ledger hashes.
Source edits rebuild; a New build ready button offers a reload without interrupting
a person editing a world. Failed apps remain visible beside working ones.

## Roles and current additions

- **neat**: actual vendored standalone CLI validates WorkItems and renders its
  board from a retained ledger snapshot. Packaging does not create human
  acceptance or promotion references. The WorkItem `pcr.pxcube.<id>` target is
  a named work target; this adapter is not claiming a new executable PQL PCR.
- **tidy**: actual vendored CLI checks its lineage manifest. This adapter adds
  `.tidy/pxcube.json` as a PxCube-specific registration file. The local adapter,
  not the upstream tidy CLI, interprets those app snapshots and tracks. This is
  an integration candidate for Muse, not a claim that tidy already had this API.
- **crisp**: Muse's `packageApp` performs manifest, declared-mount, source-hash,
  prefix-lint and build/output checks. The adapter executes that code on fresh
  source copies and retains each `.crisp` receipt. It adds index.html presence,
  unchanged source after build, and actual output-byte hashes.
- **launcher**: the same generator assembles the same static apps for both
  `dev` and `local/ci.mjs`. The local HTTP server only serves those files. The
  workflow assembles its matrix packages through `local/ci.mjs --staged staging`,
  preserving a red job for a failed app while permitting healthy siblings to deploy.

## Local / Pages assembly

Both routes call `build()` in `local/run.mjs`. Local preview runs crisp on fresh
source copies. The workflow's matrix runs crisp independently for each Experience,
then supplies those packages to the same pipeline:

```sh
node local/ci.mjs --staged staging
```

`staging/exp-<id>/` contains the built chunks and `receipt.json`. Assembly verifies
the chunks against that receipt and imports them; it does not run the build again
or replace the producer's timing and testimony. Missing or corrupted packages
stay failed. Source hashes remain provenance, not a promotion or source-freeze gate.

The common pipeline supplies the NTC work/type/build snapshot, `neat.html`,
`pxcube-run.json`, and the receipt accordions. Every successful result links to
`experiences/<id>/receipt.json`. The extended `pxcube-receipt.json` URL remains
available for existing consumers. Independent assembly run IDs differ; the
packages, definitions, and inspectable surfaces must agree for the same inputs.

The workflow publishes an artifact only after the assembler emits `site-ready`.
A partial build can therefore deploy healthy siblings while staying red; a fatal
assembly error cannot publish a stale output directory. Browser-test deployment
policy is unchanged. `local/test/assembly-parity.test.mjs` checks both routes,
failure isolation, receipt links, and absence of duplicate build execution.

First discovery registers an app as Exp. A manifest's `track: clean` cannot
promote itself. Source or shared packaging-tool changes surface as registration
drift, and drifted Clean registrations are displayed in Exp. `node local/run.mjs
register` explicitly refreshes all discovered registrations and returns them to
Exp. It is not promotion. No automatic garbage collection or deletion of old
attempts is enabled.

`.pxcube/runs/<attempt>` retains exact tool/app source snapshots, crisp receipts,
failures, ledger snapshots, logs and the final site. `.pxcube/latest.json` is only
a pointer. Runs and generated images stay local and are ignored by Git.
Packaging shell commands execute trusted repository builds; iframe tokens do not
sandbox the build process. This first adapter accepts only a single top-level
outDir: the pre-hardening crisp hasher excludes directory names, not nested paths.

## Logical seed versus allocated mount

`experience.json` declares the logical seed `shelf`. The app's reference
`shelf.px.discs` is checked by crisp. At runtime `openInteractive(id)` binds that
seed to `mock.<id>`, and `createTestRun(id)` creates `mock.<id>.<iterator>`.
For example, `mock.shelf.px.discs` is in the continuing workspace and
`mock.shelf.2.px.discs` is in its second isolated test run. These are allocated
instances; the manifest still declares the logical seed using its single name.

`local/mock-mounts.mjs` clones the exported MockPxC seed and routes a handle's
qualified reads only inside that handle. Stored inner addresses remain `px`,
`fn`, `oc`, or `sc`; the mock's write operation replaces a whole `sc.<name>`
value and records before/after material. `resolveWorldValue` is one small
extraction from Muse's resolver, so owned instances use the same longest-dotted-key
rule as the original fixtures. The original fixture worlds remain unchanged.

The smoke app retains JSON worlds, seed snapshots, seed source identity, and
write history in localStorage. Back/reopen and page reload restore those values;
reopening an interactive sandbox does not reseed or write it, and a new test
iterator never overwrites its predecessor or copies incidental workspace edits. Storage quota failure leaves
previous state intact. A second owner with stale storage is refused, rather than
silently overwriting another owner's updates.
New snapshots record `kind: interactive` without an iteration field, or
`kind: test` with one. Older snapshots retain their exact material and display
“purpose unrecorded”; a number alone is not evidence of how an earlier run was
used. This demo opts into a trusted same-origin frame to use browser storage. These
handles separate application state; they are not hostile-code security boundaries.

MockPxC still returns plain fixture values, including static `fn` samples. Its
write history is a mock change log, not a P&C Calculation receipt. It does not
implement Studio's Part wrappers, composition or effects interfaces. JSON retention
here is not preservation of cross-realm JavaScript object identity.

## Generated-run retention

`.pxcube/runs/` is generated packaging scratch, not source or Git evidence. To
reclaim local disk safely, inspect the fixed scoped plan first:

```sh
node local/prune-generated-runs.mjs --dry-run
node local/prune-generated-runs.mjs --apply --keep 3
```

The utility refuses paths outside this repository's `.pxcube/runs`, accepts
only run-directory IDs made by `local/run.mjs`, never follows symlinks, and
always keeps `latest.json`'s target plus the requested newest runs. Its default
is dry-run; `--apply` is required for deletion. It does not touch source,
committed evidence, package cache, or any worktree.

## Checks and evidence

```sh
node --test local/test/*.test.mjs
node local/ci.mjs
```

The six crisp fixtures are used directly by the adapter tests. `leaky`, `drift`
and `unknown-world` in d1de6847 are copies of hello, so the tests visibly add the
specific bad prefix, source change, or missing world before invoking the real
CLI. They are not represented as negative fixtures that already failed unchanged.
The existing `crisp/test/helpers.mjs` computes a doubled crisp/bin path; these
checks call the actual CLI path without changing Muse's in-progress suite.

`evidence/local-pages/` retains the original packaging evidence. The address-kind
refinement has fresh evidence in `evidence/sandbox-kinds/`: five focused owner
tests and 23 browser checks, with the exact source hashes tested. The browser check serves the exact artifact under both a local root and a
Pages-style `/PxCube/` prefix without special CORS headers. It tests the actual
controls, mount values, retained iterations, frame closure and full page reload.
It is repeatable with Playwright plus Chromium; set PLAYWRIGHT_MODULE and CHROME_BIN
only when using a preinstalled runtime outside this repo. No browser is launched
by the ordinary dev command.
