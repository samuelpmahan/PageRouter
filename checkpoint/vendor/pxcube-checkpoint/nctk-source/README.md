# Clip Factory nctk, first real slice

This is the one active nctk stack for Clip Factory inside `/mnt/d/ClipFactory`. The pinned ChainSpot policy packet supplied exact-byte fingerprint and reuse mechanics; the generic nctk tree supplied the toolkit/policy/capability layout. The active policies here own composition (kompoze), computation (crisp), reuse and x.y.z build rules (tidy), and work phase/provenance (neat).

From this directory, run:

```sh
/mnt/d/ClipFactory/.bootstrap/node-v22.23.3-linux-x64/bin/node toolkit.mjs compile
/mnt/d/ClipFactory/.bootstrap/node-v22.23.3-linux-x64/bin/node toolkit.mjs run
```

The first run verifies three preserved original Drive source parts, assembles their exact original video bytes locally, probes the source, cuts 627–637 seconds, and creates a local HTML review. `work/latest.json` points to the latest report and its actual clip/review files. Generated files stay under `work/`; they are never recipe payloads. `--duration 14` and `--title 'New review title'` change Run Args and View Args independently.

Paths under `parts/` and `calculations/` are the authoring addresses. The compiler discovers their contracts, rejects missing inputs, duplicate producers and cycles, then builds the selected dependency graph. `bases/house-cut.json` is the clean base; `overlays/house-10s.json` supplies the selected parameters. There is no separate Part registry.

`version.json` gives tidy's x.y.z build revision: x changes meaning or Contract, y adds information, z corrects a claim. A source change needs a matching version bump; runtime arguments do not. `work/lifecycle.json` is Neat's derived compatibility index; recipe directory manifests hold authored state. Phase alone is excluded from calculation fingerprints. Editorial acceptance remains separate from technical execution.

## Recipe transport

```sh
node toolkit.mjs package --out /mnt/d/ClipFactory/work/nctk-stage-UNIQUE
python3 transport/root_sync.py --push --dir /mnt/d/ClipFactory/work/nctk-stage-UNIQUE --folder DRIVE_FOLDER_ID --run-dir /mnt/d/ClipFactory/work/nctk-checkpoint-UNIQUE
python3 transport/localci.py --receipt /mnt/d/ClipFactory/work/nctk-checkpoint-UNIQUE/checkpoint-receipt.json --folder DRIVE_FOLDER_ID --test-cmd 'node toolkit.mjs run --fresh'
```

To reproduce later from the already uploaded recipe, call `root_sync.py --pull-id ID --sha256 ZIP_SHA --manifest-sha FILE_MANIFEST_SHA --file-count COUNT --folder FOLDER --run-dir NEW_DIRECTORY`, then pass that new directory's `checkpoint-receipt.json` to LocalCI. This pulls the exact remote ID again without uploading a local stage. Both commands use the same connected-agent Drive request queue; LocalCI's test command needs Node on `PATH` or an absolute Node binary path.

SmartSync's `SYNC-MANIFEST.json` lists included code, contracts, runtime and original-input bindings and excludes generated payloads. The pinned ZIP transport waits for a connected agent to service Drive upload/download queue requests. `--fresh` forces original media download from the three exact Drive IDs, even on this desktop. LocalCI checks the exact remote archive and pristine extraction before executing. The FFmpeg/ffprobe binaries are pinned external runtime dependencies in `runtime.json`; they are present on this desktop, not inside the recipe ZIP. A fresh machine must supply those exact bytes with `NCTK_FFMPEG` and `NCTK_FFPROBE`.

The source is preserved authorized media. This workflow makes no fresh public-acquisition or editorial/publication claim.

## DiscStudio photo-first fixture slice

The Clip Factory route remains the default. Run the six ordered photo-card Ticks with:

```sh
node toolkit.mjs compile --recipe recipes/discstudio-photo-card.json
node toolkit.mjs run --recipe recipes/discstudio-photo-card.json
```

It retains a declared derived fixture, explicit crop settings, and prepared WebP as distinct Parts before calling copied v9 DiscStudio `createExperience`, `addDraftPhoto`, `save`, `createBag`, and the native `card-renderer.ts`. `UniformScale` scales the card's alpha content on its fixed 1080x1920 canvas; `XYTransform` applies normalized `dx`/`dy` placement and rejects clipping. The transparent positioned card remains the normal output. Base painter is OFF; the v9 save Part retains the prepared data URL and original/crop identities remain in the nctk graph and receipt.

Set whole-card size and position with `--scale` (0.5–1.5) and normalized `--x`/`--y` or `--dx`/`--dy` deltas. The default values are scale 1 and zero translation. Backgrounds are a separate preview projection: `preview --background PATH` makes a local preview, while `composite --background PATH --out PATH.png` explicitly writes a flattened PNG. Both use the bundled sample park SVG when `--background` is omitted and record the background byte hash in their receipt. Neither command changes the normal transparent card output.

### Fresh-extraction runtime binding

The DiscStudio package intentionally excludes `vendor/discstudio/disc/node_modules/`. Supply Canvas in either supported way before the first run:

```sh
(cd vendor/discstudio/disc && npm ci --ignore-scripts)
node toolkit.mjs run --recipe recipes/discstudio-photo-card.json
```

or bind a host-installed package explicitly:

```sh
NCTK_CANVAS_PACKAGE=/absolute/path/to/@napi-rs/canvas/package.json \
  node toolkit.mjs run --recipe recipes/discstudio-photo-card.json
```

For the explicit binding, the toolkit creates a local symlink only when the copied DiscStudio source has no Canvas package. The link is local runtime state, excluded from package staging. The runtime receipt fingerprints `package.json`; this is reproducible with the declared package path, but not a hermetic dependency claim.

### Rolling Pages artifact publication

The nctk/Drive source package is authoritative. GitHub `samuelpmahan/DiscStudio-demo` is a Pages deployment target. Its workflow extracts the single root `pages-artifact.zip`, verifies `index.html`, `.nojekyll`, and `BUILD_INFO.json`, and uploads those static files. It does not build the historical GitHub source tree.

For each release, run the canonical browser tests and `npm run build` under `vendor/discstudio/disc`, then make a deterministic ZIP of the **contents** of its `dist` directory (paths start at `index.html`, not `dist/index.html`). Sort paths, set every ZIP entry timestamp to 1980-01-01 00:00:00 and file mode to `100644`, and use DEFLATE level 6. Extract the candidate ZIP to a fresh directory and compare every extracted file hash with `dist`; check `BUILD_INFO.json` and retain its build ID and the ZIP SHA-256 in the handoff. Keep the previous ZIP and GitHub commit SHA for rollback.

Publish one rolling commit on GitHub main with fixed parent `b5504d07a3c73ecf578efbe944a6579609d4da4f`. Start its tree from that parent's tree `d1105785e0f4ada8a79bb6bd855653e076364330` and replace only `pages-artifact.zip` and, only when the deployment mechanism itself changes, `.github/workflows/deploy-pages.yml`. Create the binary Git blob with base64 encoding, create the tree, then create a commit with that fixed parent. Before moving main, read its current SHA and commit parent; abort if main is not the previously observed rolling publish commit directly above the fixed parent or if its SHA differs from the release's recorded expected head. Re-read main **immediately** before the force ref update and abort on any drift. Move main to the new commit, then verify the remote ref, fixed parent, exact tree, and successful Pages workflow run. This compare-before-update procedure is required because the connector's ref update does not accept an expected-old-SHA condition; a Git `--force-with-lease` push is preferable when authenticated Git is available. Never replace an intervening human commit. Future releases update the one rolling publish commit rather than stacking deployment history.

### Neat work items and DiscStudio LocalCI release

The core authoring tree has one versioned `nctk.json` per managed directory. Tidy checks exact addresses, child inventories, sources, and references before compilation. Neat item states are `Compare`, `Combine`, `Validate`, `Review`, `Merge`, `Merged`, `Park`, and `Reject`. `captureCandidate` writes a machine-checkable checkpoint mapping approved affected managed addresses to Tidy manifest identities and exact contract/script/source-closure hashes. Manifest identities mask Neat-only state, so human review does not invalidate source identity. `openReview` freezes that checkpoint and on-disk evidence; `decideReview` records a named human verdict for its exact candidate and target; `beginMerge` queues the approved candidate. Several child items may wait in Merge for one parent recipe that remains Combine. A rejected verdict moves to Reject, and changing a queued candidate requires reopening Review. The actor name is recorded but not authenticated by Neat; the caller must enforce human authority.

`runMergeQueue(root, recipePath, workItems, source, runtime)` is the bounded integration entry point in `capabilities/merge_release.mjs`. Kompoze validates the canonical tree, compiles the selected recipe/base/overlay/Part/Calculation graph, and proves each selected queued address participates in that graph; conflicts, missing dependencies, and changed candidate files fail. Crisp runs or verifiably reuses the ordered Calculations and writes action receipts, upstream Part content IDs, fingerprints, and output hashes bound to Kompoze's plan. Tidy checks build identity and the declared source Part hash. LocalCI independently rechecks the plan, source bytes, every Crisp action fingerprint and input chain, action receipts, target output bytes, and Tidy identity before recording PASS. Neat accepts only a `neat-promotion-batch@2` receipt, independently repeats those checks, and atomically appends one root `nctk.json` batch journal entry. All included items then read as Merged even if a child manifest mirror write is interrupted. Legacy free-form `@1` receipts cannot promote. A parent Combine item remains Combine until its own later joint Review and promotion.

This path selects already authored addressed files in the one canonical tree; it does not apply a patch, create a Git branch, or update the default recipe. LocalCI verifies exact participation and execution/reuse evidence for the selected graph, while any semantic judgment about the combined feature remains human work. Runtime identities supplied directly to this API are caller assertions; the standard toolkit runtime binds its declared runtime files separately. SmartSync carries only explicitly referenced frozen Review/Merge work-item, checkpoint, and evidence JSON for the selected recipe (regular files, at most 128 KiB each and 2 MiB total); generated attempts and outputs remain excluded. A fresh remote extraction can inspect and build the queued candidates from those inputs. Historical Merged root-journal entries keep receipt digests/paths, but their generated receipt/output files require separate proof transfer or reproduction for a full remote audit. DiscStudio's browser Pages release and the Neat queue integration are separate flows. The existing `toolkit.mjs phase --to LABEL --work-path PATH` command keeps legacy uppercase labels but cannot enter or leave guarded Review/Merge/Merged states. Generated suggestions do not approve transitions.

Substates are open versioned namespaces such as `localci.discstudio-pages@1`, each with observed facts and hash-based evidence references. Neat-only fields are excluded from Crisp calculation fingerprints and Tidy source identity. Neat writes use a short exclusive lock and atomic replacement so concurrent agent writes do not silently overwrite one another. A directory address is its physical position; renames are not identity-preserving. Tidy owns a future explicit relocation transaction that must rewrite addresses, parent inventories, and references before revalidation. Directory-level inherited context and rollups are deferred; no approval or content identity inherits implicitly.

LocalCI's DiscStudio release command records install, test, capture, and build facts under the DiscStudio item while leaving its human state unchanged:

```sh
python3 transport/discstudio_release.py --out /absolute/new/output-directory
```

The command runs `npm ci`, tests, capture tests, and the static build in `vendor/discstudio/disc`, then writes a deterministic `pages-artifact.zip` and `release-receipt.json` in that new output directory. It rejects symlinks and nonregular files in `dist`, extracts the ZIP, and verifies every file hash against `dist`, including `BUILD_INFO.json`. Without a connected Drive folder/queue, the receipt records `bridge.status=PENDING` and keeps durable local proof. With an agent servicing the existing Drive request queue, add `--folder DRIVE_FOLDER_ID --queue /absolute/queue/path`; it uploads the ZIP and receipt through the same queue contract as root_sync. This is release evidence, not semantic approval or a GitHub publication command.

### 5.1.0 Stage-set PxC composition

`kompozeStageSet(root, [{ name: 'A', recipePath: 'recipes/a.json' }, { name: 'B', recipePath: 'recipes/b.json' }], { producerBindings: { 'parts/shared': 'calculations/shared-a' } })` compiles two independent recipe/base/overlay Stages in the one Tidy-managed tree. Each Stage keeps its named target. Both must select the same semantic source Part and contract, and a shared Calculation must receive compatible Run Args and View Args. When multiple named Calculations can produce one reachable Part, the PLAN must bind that Part address to exactly one Calculation implementation. Missing, invalid, or unused bindings, cycles, and a selected open Part fail before execution. An unrelated declared Part can remain unstarted. The existing single-recipe `kompoze()` keeps its strict global ambiguity check.

`crispStageSet(root, stageSetPlan, source, runtime)` sends that union DAG through the same Crisp action identity, Tidy eligibility, execution, receipt, and output hashing loop as one recipe. A shared upstream Calculation runs once in the combined PLAN. Stage-set Calculate calls receive only that node’s declared Run/View Args, matching the fingerprint even when Stages have different irrelevant arguments. A later single-Stage PLAN can REUSE its exact prior receipt when its fingerprint and outputs still match. Changing source bytes invalidates the shared result and both dependent targets; selecting an alternate producer changes the upstream output and dependent fingerprints. The result exposes `targets.A` and `targets.B` as named Part outputs plus one ordered action list. This additive API does not change `toolkit.mjs compile/run`, Neat Merge queue behavior, DiscStudio Pages, or default recipes. This first slice requires a single shared source Part and compatible shared arguments. The 6.0.0 DiscStudio proof below starts structural Calculation selection; a general PxCQL parser/compiler and multi-source query planning remain future work.

### 6.0.0 DiscStudio structural Calculation SELECT

`vendor/discstudio/disc/calculation-select.ts` defines the first narrow SELECT contract: `selectCalculation(pxc, queryName, clauses, inputPartAddresses)` receives named addresses of real Parts, checks every named clause against their current values, and requires exactly one match. Each clause names a registered `fn.*` Calculation Part. No match, duplicate clause names, a non-callable Calculation, or multiple matches fails before the caller binds or composes anything. This is ordinary TypeScript predicate code; there is no PxCQL parser, SQL grammar, generic database query, or server runtime in this slice.

`createExperience().save()` calls `disc.facts.resolve` after the Draft is validated and stored as a Part. It selects between two input shapes using the seed Part plus the saved Draft Part:

| Clause | Structural match | Bound Calculation |
| --- | --- | --- |
| `complete-seed-flight-facts` | The seed has nonempty `id`, `manufacturer`, and `name`, plus all four `speed`, `glide`, `turn`, and `fade` fields, each number or `null`; the Draft has a nonempty mold address and valid optional overrides. | `fn.disc.resolveFacts.complete` |
| `sparse-seed-flight-facts` | The same required core facts and Draft mold address; at least one seed flight field is absent, and any present seed field or Draft override is number or `null`. | `fn.disc.resolveFacts.sparse` |

The selected function Part is aliased at `ds.px.binding.<operation>.resolvedFacts` and passed to `pxc.compose`. The `ds.px.resolved.<operation>` output Part's `composition.calculation` is that exact registered Part; its inputs are the exact seed and Draft Parts used by SELECT. The complete resolver inherits the four catalog values. The sparse resolver materializes missing values as `null`. In either case, an absent Draft property inherits, while an explicit Draft `null` overrides a known seed value; per-field source and seed-coverage facts make those cases inspectable.

The `selectFacts` Tick runs before `oc.create`, depiction rendering, and shelf or bag membership; it consumes only the already validated seed and Draft Parts. After that Tick composes successfully, `ds.px.receipt.select.<operation>` and the `pxc.select.completed` event record the selected clause, canonical and bound Calculation addresses, exact named input addresses, and output address. This receipt means SELECT completed; it does not claim the full save succeeded. The existing save receipt still follows creation, depiction, shelf/bag composition, readback, and persistence. Selection testimony includes addresses only and does not log photo bytes. Existing synchronous `fn.read` remains available for the current preview/resolve path.

Archive restore receives the new registered functions through the existing `knownStore`; the binding Part aliases the same function Part, so restore can replay and verify the resolved-facts composition. This proves shape-based function selection and invocation in the browser PxC save flow. It does not yet provide generic typed dispatch, function overload resolution, a PxCQL source language, arbitrary CRUD generation, a backend, or a proof of the rest of `UploadDiscToShelf`.

### 6.0.1 UploadDiscToShelf commit correction

`createExperience().save(draft, depiction, sources)` now treats the whole existing upload as one local operation. It validates the Draft and photo, selects and runs the facts resolver, creates the Disc and depiction Parts, and appends that Disc to candidate Shelf and Bag Parts. It reads back the Disc and both collections, requiring each candidate collection to equal its previous head plus the one new reference. Before publication it checks that both expected collection heads still match the current heads. This is a local commit guard over the existing append-only Part tree, not a remote compare-and-swap or a general document history layer.

The browser persistence callback attempts the candidate archive before the two in-memory collection heads move. The archive carries the durable `disc.save.completed` receipt as commit metadata; restore binds that receipt at its addressed Part. A successful archive write returns `storage: browser-archive`, while a quota or security failure keeps the completed operation in this tab with `storage: session-memory`. An unexpected write or serialization failure rejects the save, leaves the prior visible heads in place, and leaves the draft photo retryable. The final receipt records previous and new Shelf/Bag heads, exact Disc and art addresses, selected Calculation, readback, and the actual storage outcome; no image bytes enter its event. A failed active-session pointer write produces a durable archive with a separate reopening warning.

Photo preparation, rendering, card output, and the two TypeScript facts clauses remain their existing Calculations. This correction proves one complete browser-local upload and restore path; it does not move structural selection into a generic nctk query language or add a server backend.

## 6.1.0 DiscStudio `seek(t)` projection

`seek(t)` renders one native transparent Card over one vertical frame at an authored instant. It uses the selected storyboard shot's anchor and uniform scale, checks the Card's visible alpha bounds against the frame and manually annotated protected rectangles, then writes a 1080×1920 PNG and a hash-bound receipt. This is a projection over held Card and frame bytes; it does not mutate the Disc, Card, video, or saved Bag.

```sh
node toolkit.mjs seek --recipe recipes/discstudio-photo-card.json \
  --card fixtures/seek/card.png --background fixtures/seek/frame.jpeg \
  --storyboard examples/salamander-one-frame.json --at 1 --out work/seek/frame.png
```

`--card latest` consumes the raw Card from a prior recipe run. The bundled specimen is a real Mint Salamander Card and a vertical screenshot. The separate six-photo showcase demonstrates distinct original disc photos, catalog-selected mold names, and frame-specific placements; its video frames are layout examples, not claims that the discs held on camera have the featured molds. The protected rectangles are human annotations, not automatic scene detection. `seek(t)` selects a half-open shot interval and does not interpolate motion or encode video. SmartSync includes the projection source, tests, specimen, and storyboard in the DiscStudio recipe closure while leaving generated frames under `work/`.
