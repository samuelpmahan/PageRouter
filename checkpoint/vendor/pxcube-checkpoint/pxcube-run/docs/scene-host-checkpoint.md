# PxCube world-from-scenes checkpoint

Checkpoint: 2026-09-30 01:13 UTC. Local source only; no Git commit, push, public deployment, app launch, raster render, or screenshot.

## Resume first

- Read `local/scene-host.mjs`, `local/scenes/discstudio-photo-card.mjs`, and `docs/chainspot-scene-contracts.md`
- The launcher-facing CreateGraphics dialog is authored in `local/studio-demo/index.html`, `local/studio-demo/app.mjs`, and `local/studio-demo/scene-worlds.css`; `local/studio-demo/build.mjs` copies the generic scene host/module to the packaged app. Its button is hidden outside Create mode and leaves the existing default flow alone
- The dialog composes two in-memory worlds, renders their SVGs, and expands the host's address/receipt summaries; closing the page clears them. It uses the existing preview photo asset and explicitly says it is not a recognized disc photo
- The user-facing code-flow checkpoint predates this UI addition, so send the updated dialog flow for review before building/running/rendering it
- Run the renderer-backed `local/test/discstudio-scene-host.test.mjs` only after the user reviews and accepts the exact photo → save → Card → placement → SVG flow. It previously passed before the last preflight-only host edit, but it has not been rerun against the current tree
- The browser-visible scene inspector has not been built or run, and has no screenshot. Static syntax checks passed; no browser/pixel result is claimed

## Host contract

`createSceneHost({handler}).composeWorld({id,inputs,scenes})` composes scenes over the producer-owned Part-first store returned by the handler. The host does not own a second Part registry. Handler `api` is `pxcube-pxc-handler@1`, version `1`, with `parts@1`, `calculations@1`, `services@1`, `receipts@1`, and `world-dispose@1` capabilities. Scenes use `pxcube-scene-host@1` and declare required provider/world Parts, provider services, Calculation addresses, and provided Parts with world/scene scope.

World inputs are structured-cloned and installed once. IDs are reserved during async creation. Scene dependencies are planned before execution; provider inputs/services, missing Calculations, and output collisions are preflighted. A scene can compose only into declared outputs and use only declared Calculation addresses plus named input/output Parts or inline Parts created by `ctx.part()`. Address bindings preserve the actual Part receipt. Read APIs return cloned value snapshots. Underlying calculation receipts are summarized from the producer's real receipt stream; any failed receipt fails the world. Failed worlds are not published; failure evidence is attached to the thrown error before reverse-order cleanups and one handler disposal. `close()` releases the world ID for a fresh open.

## DiscStudio consumer

The first scene uses the PxCube-pinned Studio producer (`vendor/studio/SOURCE.json`, commit `6f7937bc1eebd22bf3135f50c9edf714b122902a`) via a fresh `createExperience()` per world. `storeOf(world)` and the `discstudio.experience.save` provider service refer to that same world-local `experience.pxc`. Scene inputs are explicit photo data URI, design, preset, and frame Parts.

Invocation order:

1. Existing `experience.save` uses `fn.paintRecipe`, `oc.create`, `fn.read`, `fn.renderDepiction`, `fn.addToShelf`, and `fn.tick` across its existing `specialize`, `depict`, and `retain` Tick boundaries
2. `fn.studio.graphicFields` consumes saved Disc plus resolved facts
3. `fn.studio.graphicArt` consumes saved Disc plus actual retained art
4. `fn.studio.card` consumes fields, art, and preset using the vendored renderer's `composeCard`
5. `fn.pxcube.scenePlacement` is a thin host Calculation that binds design inputs to the existing `composeOverlay`
6. `fn.studio.graphic` calls existing `materializeOverlay` and emits the SVG Part

Baseline uses `bottom-left`; candidate uses `bottom-right`. Inputs and Calculation identities are address-bound. The current test fixture is `local/studio-demo/assets/tee-shot-original.jpg` (Bradley P. Johnson, CC BY 2.0); it is an illustrative tee-shot image, not a disc-photo recognition result or creator acceptance artifact. The scene accepts a replaceable explicit photo Part.

## ChainSpot contract only

`docs/chainspot-scene-contracts.md` preserves S4 Tee identity/provenance, all S5 axis-to-Badge candidates and Run-vs-View separation, and an addressable but unscorable S6 output until an explicit semantic anchor is selected. It changes no CV algorithm/default and does not substitute top, tip, or ground/basket center.

## NCTK Crisp correction

`/workspace/shared/nctk-archaeology/source/policies/crisp.mjs` now passes the same declared `args`/`viewArgs` to every Calculate invocation that `actionIdentity` fingerprints. `tests/stage-set.test.mjs` adds an ordinary-recipe regression proving an undeclared Run Arg cannot affect the output and changing it permits exact receipt REUSE. The NCTK source has no `.git`; the source archive used as baseline is Drive file `1ehwfLPSb8E5d8xU-a2xH_iu8Wec_YArG`, ZIP SHA-256 `87fd67a08877c90e6b87558e5bda9dbeedf1a8f188462b9ccfe73d3443434d4d`. Baseline copies of the two edited files and a unified diff are included beside this checkpoint.

## Verification

- Current static syntax check: `node --check` on the generic scene host, DiscStudio scene module, CreateGraphics app, and app build module — passed
- Current Node-only host + browser-test-helper package tests: 8/8 passed
- Current NCTK `tests/stage-set.test.mjs`: 6/6 passed, including ordinary Crisp argument/fingerprint regression and Stage-set shared-args guard
- Renderer-backed DiscStudio scene test: previously 1/1 passed before the final host preflight change; not rerun after the current host edit because it materializes SVG and the user-facing checkpoint is pending
- Browser app build/launch, PNG rasterization, visual inspection, screenshot, private preview publication, Git commit/push, and public deployment: not run

## Next steps

1. After the user accepts the flow, rerun `node --experimental-strip-types --test local/test/discstudio-scene-host.test.mjs` against this exact tree
2. Build the CreateGraphics package and inspect the dialog's actual baseline/candidate SVGs and receipts in a supported private browser; capture screenshots only after browser access is authorized
3. If using the genuine disc-photo creator flow, replace the illustrative tee-shot fixture with a supplied/licensed disc photo and preserve source attribution; do not claim a creator-reviewed result until it is actually reviewed
4. Keep S6 `UNKNOWN`/`BLOCKED` until the user selects its physical semantic anchor
5. Update this checkpoint with a new unique version on the next meaningful change; never overwrite the canonical NCTK 6.1.0 archive or infer a clean browser/raster pass from Node tests
