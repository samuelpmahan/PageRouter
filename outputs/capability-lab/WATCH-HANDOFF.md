# Source-grounded next phase

Implement after the foundation gate, with the same team structure and explicitly reassigned ownership. Read ../story-data/watch-capstone-plan.json and watch-model-design.json; those are prior plans, not implementation evidence.

Primary sources refreshed on 2026-10-08:

- Grand Seiko https://www.grand-seiko.com/uk-en/collections/movement/mechanical supports mainspring energy, escape wheel/pallet/balance regulation and the distinction between full oscillation and beats. Its pictured movement varies by caliber; do not copy artwork or imply exact CAD fidelity.
- Seiko education https://www.seiko.co.jp/csr/toki-iku/tokiq-nazotoki/ explains a nominal 32768-Hz reference and successive halving to the slower drive timing. Use generic labelled teaching parameters, with source-specific exceptions clearly acknowledged.
- MDN https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame documents render scheduling and hidden-tab pauses. The renderer observes the logical state; the simulation has explicit time-transport policy.

Proposed next assignment: statistics team mechanical/quartz mechanisms and measured-timing adapters; linalg team exact software/shared transport and view-transform geometry; workbench team renderer and source/state-linked explanations. Ownership will be announced before landing. The independent wildcard challenges counts, browser controls, label bindings and bounded retention.

Use integer counters/rational logical time with explicit boundary inclusion. Stepping selected internal events advances all views to that elapsed time. Schematic explosion is a view transform. Exact contact geometry, spring/torque/friction dynamics and hardware accuracy remain outside what the available source evidence proves.
