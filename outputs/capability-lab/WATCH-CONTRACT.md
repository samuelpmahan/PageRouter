# Watch implementation contract (next authorized phase)

Activate only after root foundation acceptance. Retain all foundation tests and public APIs. Reuse the same Sol/Luna/Luna teams; do not spawn extra seats. Root coordinates; workers write product.

## Ownership and interface

Statistics team: src/watches/mechanisms.mjs, test/watches/mechanisms.test.mjs, catalog/watch-mechanisms.json, docs/watch-mechanisms.md, evidence/watches-mechanisms/**. Mechanical/quartz analytic mechanisms, gear teaching model, sources and state-bound component descriptions.

Linalg team: src/watches/transport.mjs, src/watches/geometry.mjs, test/watches/transport.test.mjs, test/watches/geometry.test.mjs, docs/watch-transport.md, evidence/watch-transport/**. Rational time, common transport, replay, exact software ticks, bounded retention and view transforms.

Workbench team: src/watches/index.mjs, ui/watches.mjs, test/watches/integration.test.mjs, scripts/verify-watches.mjs, docs/watches-workbench.md, evidence/watches-workbench/**; integrate imports/panel in existing owned ui/app.mjs/index.html/style.css. Dynamic watch capability registration is optional if incompatible with foundations; pure libraries plus traceable actual model calculations are required.

Publish exact signatures among owners before landing. Required public surface from src/watches/index.mjs: createWatchRun(config?), applyWatchAction(state,action), replayWatchRun(config,actions), watchStateAt(config,time,energy?), watchGeometry(state,explode,selected?). Parameters and outputs are JSON values; integer-safe counters and explicit rational time {numerator,denominator}. Named aliases may be agreed, but announce them before consumers land. Internal BigInt arithmetic is allowed; exported JSON stays usable in browser/receipts and rejects out-of-range counters.

Default ideal teaching rates: mechanicalHz=4 full oscillations/s (8 beats/s), quartzHz=32768 cycles/s with 15 divider stages and 1-Hz generic motor commands, softwareHz=256 updates/s. These are declared examples, not universal watch specifications. Energy/timing roles follow WATCH-HANDOFF.md and sources in ../story-data/watch-model-design.json.

## Behavior

- A single elapsed logical time controls all models. Counter events use a documented zero-phase/boundary convention; floor of accumulated cycles gives counts. At 60 seconds default counts are 480 mechanical beats, 1966080 quartz cycles, 60 generic motor commands and 15360 software updates.
- Hands obey one second-hand revolution/minute, one minute-hand revolution/hour, one hour-hand revolution/12h, with mechanism-specific visible stepping. Internal rate, visible step and rendered frame are separate quantities.
- Actions include selected-event step (mechanical beat, quartz cycle or motor command, software update), advance declared rational duration, pause/resume, reset and explicit energy toggle. Publish the exact action discriminants with peers. Pausing stops autoplay, manual step remains available. Rendering, selection and explosion add no mechanism events. Parameter changes must be retained as explicit actions or begin a clearly labelled new run.
- Disabling mainspring or battery halts the respective powered progression while common elapsed logical time/other models can advance; retain accrued phase/elapsed operating time. Software logical transport policy remains separately visible. Replay uses the exact initial configuration and ordered actions; compare canonical complete states and events, not only hashes.
- Retain bounded action/event history with explicit count/byte limits, not 32768 expanded records/sec. Compact exact counter ranges can be expanded on demand in a bounded microscope. At quota/write/buffer failure, recording visibly pauses or returns a clear error; never silently drops replay evidence. Declare when a bounded session must be reset/exported.
- Model geometry is original schematic art. An exploded view separates labelled component groups using linalg transform primitives. Every part/leader line uses the same transform; explosion zero restores assembly and changes no mechanism state. Geometry is illustrative unless physically validated.
- Show mainspring/battery energy paths separately from oscillator/timing-control paths. Mechanical escapement is a source-grounded schematic lock/release/impulse model; no unverified exact contact physics. Crystal is a frequency reference, not motor energy.
- Each label binds to actual state or a documented formula; selection reveals role, current value/unit, source and whether it is fact, derived arithmetic, simulation or illustrative geometry.
- Capture raw browser pacing observations in a bounded buffer and analyze with statistics primitives. Do not label browser callback jitter as physical watch accuracy. Render frames observe logical state; hidden-tab autoplay freezes explicitly.

## UI and acceptance

Deliver all three functioning watches in one synchronized view, assembled/exploded slider, component selection, pause/resume, selected-event stepping, reset, timing/energy overlays and counter/trace microscope. Keyboard controls and reduced-motion view must remain meaningful. Fit the core visual/control experience in one readable desktop viewport; details can expand.

Independent fixtures check default count boundaries, changed rates, gear ratios, exact replay, energy interruption, pause/step/reset, explosion invariance, component-label bindings and bounded retention. Existing foundation gate must remain green. Browser acceptance interacts with controls and inspects actual state changes, captures assembled/exploded screenshots, and verifies no console errors.

After this watch gate, root reassigns teams to ML, then AI/model explainability. Do not narrow those later stages to documentation.
