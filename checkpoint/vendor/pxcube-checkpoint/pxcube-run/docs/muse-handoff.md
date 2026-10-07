# To Muse: PxCube consumer and local execution advice

Sam assigned you PxCube; Codex is preparing the Studio consumers and the local
execution path. Inspected PxCube main: `d1de6847e650ce68eabb3d08c668a66cee7de637`.
PnC consumer candidate: `6f7937b`. PnC working branch: `codex/studio-workbench`, previous committed base `9e6a39f`.
Local candidate commits are for review; neither acceptance nor publication is claimed.

Sam's clarified mount rule: **interactive sandboxes use `mock.<id>.*`;
unit/E2E runs use `mock.<id>.<iterator>.*`**. The iterator marks a fresh test
execution. Reopening an interactive sandbox resumes its current state. A new
test iteration keeps the previous run inspectable. Reclaim/overwrite for actual space
pressure, not as the default meaning of Run again. MockPxC supplies test seeds;
tests must still exercise the real application operations and producing links.

## The existing consumer connection

`exp/upload-disc-to-shelf/experience-page.ts` now exports
`mountExperiencePage(experience, {sandbox: 'upload' | 'shelf'})`. Importing it
does not start an app. It consumes that document's existing `index.html` markup;
the caller supplies the actual domain context and owns its lifetime. Use one
document per mounted page. The context, its `pxc`, DevTools and Case runner are
returned together. There is no second application model inside the view.

`experience-fixtures.ts:startSandbox` creates a real local Part store and seeds
an empty Upload context or three explicit Shelf specimens. This is currently a
consumer fixture. Your new MockPxC module returns plain values and is not yet
interchangeable with this Part kernel. The regular
app's persistence adapter is separate and must not receive E2E writes.

`sandbox-cases.ts` drives real DOM controls, then checks actual Parts. Upload
sets a recipe and Saves. Shelf picks a copy, previews explicit turn zero, Keeps,
then picks the kept copy again to create a Bag. Keep closes the inspector: an
initial Case wrongly assumed selection persisted and timed out. The Case was
corrected to operate the real flow; the product behavior was not changed to
satisfy the test.

`window.experienceSandbox` exposes `{experience, pxc, runner, inspect}` in the
mounted document. Its `pxc` is exactly `window.discStudio.pxc`. The host's
`window.experienceWorkbench.instances()` returns each running bridge. Result
compositions retain actual inspected Part objects; exported reports are
observations, not replacement stores. Human review is explicit text referencing
the tested state and stays separate from automated pass/fail.

## Compatibility details that matter

1. This PnC kernel returns Part wrappers from `get`, uses fresh addresses, and
   retains `composition.calculation` and `composition.inputs` as actual Parts.
   `set`, `get`, `entries`, `compose`, and `receipts` are the exercised interface.
   Domain context methods add save/edit/Keep/query/Bag behavior on that store.
2. `exp/part-first-kernel/src/pxc.mjs` recognizes Parts through a module-private
   WeakMap. A different copy of the module or a JSON reconstruction is not an
   interchangeable Part. Create/wrap Parts in the owning realm; let the console
   inspect the instance there. A MessagePort protocol can pass commands/handles
   and snapshots, but cannot honestly pretend structured clones are live Parts.
3. Existing Studio addresses include `ds.px.*`, `fn.*`, and `oc.*`. Your new
   `{MOUNT}.{px|fn|oc|sc}.*` grammar therefore needs an explicit compatibility
   decision for this older consumer. Do not silently rewrite producing addresses
   or claim it already conforms. Separate the world handle from internal names.
4. Default `allow-scripts` gives an opaque-origin iframe. Parent DOM inspection
   is then unavailable, and module imports need compatible delivery/CORS. Do not
   solve this by unconditionally giving every experiment `allow-same-origin`.
   Our existing trusted local page sandbox has shared origin; that is application
   state separation, not isolation of hostile code or CPU/resource usage.
5. Closing a frame currently destroys its realm. To retain old `mock` iterations
   across page/frame closure, the host needs to own their backing/lifecycle or
   preserve a restorable archive with its implementation identity. Keeping a
   screenshot or Case report is not retaining the executable object model.

## Runnable local integration

PxCube branch `codex/local-pages`, based on your d1de6847, now runs:

```sh
node local/run.mjs dev
```

It serves port 4321. The same build() function is used by local/ci.mjs for Pages.
A workflow change is prepared but unpushed and unrun in GitHub. The actual neat
and tidy CLIs are vendored from Sam's repositories with commit and source hashes.
The launcher includes the actual neat board and retained build record.

The adapter creates fresh app/tool source snapshots, invokes your packageApp,
requires index.html, checks source did not change during the build, and hashes
output bytes. Failed apps are retained and visible; working siblings still ship.
Each attempt keeps its sources, checked ledgers, crisp receipts, failures and
site. No app is promoted by packaging. A new .tidy/pxcube.json integration registry
contains the registration snapshots; your standalone tidy currently only validates
its lineage manifest, so app registration interpretation is explicitly in the
adapter. Source and shared-tool drift remain visible, including for Clean entries.

The MockPxC demo uses the actual exported seeds, and a small resolver extraction
adds resolveWorldValue(value, address) so owned worlds use your existing dotted-key
algorithm. local/mock-mounts.mjs opens a stable mock.<id> interactive world or
allocates a fresh mock.<id>.<iterator> test run, and retains seed,
value and write history across reloads via a storage adapter. Qualified reads
are confined to the selected handle; inner stored names have no mount prefix.
The manifest still declares the logical seed shelf: this separates declaration
from an allocated runtime instance without pretending your scanner accepts dotted
manifest mounts. Whole sc.<name> values are editable in this first smoke surface.

The demo explicitly requests a trusted same-origin frame for localStorage. It is
an app-state sandbox, not a hostile-code boundary. Its mock write log is not a
P&C receipt. Studio's separate host preserves prior iframe contexts on New
iteration, but those live Part objects survive only while its host page stays open.
No plain-value/Part-wrapper adapter or cross-realm serialization is claimed yet.

## Findings for your hardening pass

- leaky, drift, unknown-world are currently copies of hello. Our tests explicitly
  add their intended negative condition and invoke your actual CLI. Unmodified,
  those three fixtures are valid; their names alone are not tests.
- crisp/test/helpers.mjs resolves ROOT to crisp/ and then appends crisp/bin/crisp,
  yielding a doubled path. Our harness avoids it without editing your test work.
- An old dist can satisfy the current output enumeration after a no-op build.
  Fresh snapshots prevent this in the adapter. We also require index.html and
  retain output content hashes instead of filenames alone.
- Current hashing excludes directory names, not nested paths. The adapter accepts
  only a single top-level outDir and reports the constraint. This is a bounded
  workaround, not a silent nested-path interpretation.
- App source hashes do not cover a build's shared tool/seed imports. The adapter
  hashes the copied tool tree as well and includes it in registration drift.
- The persisted-prefix scanner is explicitly heuristic; check/package success
  does not prove every dynamic runtime address is valid or writes are isolated.
- The packager timeout kills its shell. It does not yet demonstrate cleanup of
  every descendant build process. The local wrapper does not solve that for you.
- neat's current target vocabulary expects an fn/tick/pcr identity. The adapter
  names the intended packaging work target, without relabeling disk effects as
  a pure fn or claiming an executable PQL definition already exists.

The useful next shared seam is the backend contract for Studio's named Part
objects and composition links. The consumer already exposes its exact instance,
Cases and DevTools together. Preserve that identity instead of placing a cloned
value model behind an inspector that looks equivalent.

Local evidence: PxCube evidence/local-pages, and PnC
.neat/ds/experiences/evidence/sandbox-consumer. Browser checks exercise actual
controls; passing them is not Sam's human review or tidy promotion.

Address refinement: `openInteractive(id, world)` and `createTestRun(id, world)`
replace the ambiguous `create`. Snapshots explicitly record their kind; older
numbered snapshots remain unclassified and retain their original data. Interactive
handles reject reads into a nested test mount even though the text prefix matches.
