# Written Atlas UI/build flow

Entry: `#/pxcube/atlas` → `shell()` → `atlasView.mount(#view)`.

1. After loading the catalog, the app creates one `createAtlasView({implementationIdentity:catalog.release.atlasIdentity})` controller and one Atlas session. Rendering mounts controls and any retained result, without invoking calculations.
2. Run validates the modest gain/bias controls, then calls `session.run({gain,bias})`. Busy controls prevent duplicate calls and reset races. The runtime owns reference fitting, candidate search, executable byte measurement, probes, counterexample retention, acceptance and final three-piece composition.
3. The controller retains report, operation receipt and error in app memory. Shell navigation calls `unmount()` before replacing the DOM. Completion updates retained state and only paints a currently connected Atlas surface; it never writes into the newly selected project view.
4. Results show the actual reference/accepted programs and measured UTF-8 byte sizes, scoped grid/tolerance, each candidate round with actual probe/reference addresses, full-grid pass/failure counts and feedback pruning. Concrete rejected examples remain expandable. Human acceptance is not promoted.
5. The optional Run original composition action calls `runComposition({gain,bias})`, exposing the original six-node motion/Beta/Boolean fixture calculation. Its scoped policy output replaces the active search result; it is not labeled candidate equivalence. Replay calls the same session's `replay()` on whichever recipe was run most recently, displaying calculation-body executions separately from cache hits. Reset calls only Atlas `reset()`, clearing retained Atlas report/error/receipt. Inspection calls `inspect()` only when opened/downloaded; recipe, result and inspection exports are explicit downloads. Recipe download calls `session.exportRecipe()` and carries the complete DAG, literal source Parts and source implementation identity, with no receipts.
6. Assembly copies Atlas modules and focused renderer, changing only the renderer's source-relative `../exp/atlas/atlas-session.mjs` import to its dist-relative `./exp/atlas/atlas-session.mjs` location. Atlas closure hashes come from actual runtime imports. Source-derived site identity includes Atlas source, renderer and build scripts. The established HH evaluator closure/implementation pin is unchanged.
7. The old PxCube evidence's absolute site path is absent after checkpoint relocation. Assembly reconstructs the shipped `dist/compiled/pxcube` snapshot and verifies its exact prior catalog digest, then preserves those bytes in `build/pxcube-preserved`. It writes explicit relocation provenance and performs no unrelated PxCube rebuild.
8. Publication preparation uses the existing content-addressed compiled archive, recovered exact GitHub deployment materializer blob `01d7b9c691f8ded9d0235f4d615f39fe0a6a936f`, and separately supplied source-checkpoint URL. Root supplies the new authoritative checkpoint and publishes after review. This lane never publishes.

| UI action | Actual invocation | Input | Retained output |
|---|---|---|---|
| Mount | `atlasView.mount(element)` | DOM surface | Controls and prior report/error; no calculation |
| Run search | `session.run({gain,bias})` | Validated numeric controls; runtime default tolerance | Live scoped report/rounds/Parts/recipe |
| Run original composition | `session.runComposition({gain,bias})` | Validated numeric controls against the fixed original observed fixture | Scoped motion probes, Beta posterior and Boolean policy output |
| Replay/cache check | `session.replay()` | Retained session's final recipe | Actual execution/cache receipt |
| Inspect | `session.inspect()` | Atlas session | JSON-safe Part inputs/producers/cache |
| Reset Atlas | `session.reset()` | Atlas-local state | Empty Atlas state; same controller |

Validation checkpoint acknowledged by root before application execution. Final combined Node suite passed 74/74; assembly build passed; Atlas and repaired HH built-import checks passed 2/2. Real headless Chromium on the iPhone viewport passed 14/14 smoke checks, including search, concrete failure inspection, replay, navigation persistence, reset, original composition, changed-model rejection, no page overflow and no page errors. Ephemeral captures/results are outside canonical source; a verification summary is retained.
