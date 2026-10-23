# Semirings: one product, many meanings

`src/semiring/index.mjs`, first use (reference implementation). A matrix is a weighted graph stored as an edge list; an absent edge is the semiring's zero, so no Infinity is ever needed.

| Semiring | ⊕, ⊗ | The product answers |
|---|---|---|
| boolean | or, and | can i reach j |
| counting | +, × | how many paths |
| tropical | min, + | cheapest path |
| viterbi | max, × | most reliable path |
| lineage | ∪, ∪ | which inputs a path used |

Atoms: `semiring.add`, `semiring.product`. Composed: `semiring.power` (Aᵏ), `semiring.closure` (A ⊕ … ⊕ Aⁿ), `provenance.evaluate` (a sum of products of named inputs, evaluated as 1×1 matrices on the same product; each way is reported, so the winning one is visible).

The examples in each descriptor are the documentation: path counts, cheapest and most reliable routes on one small graph, and the tee pad pose (corner × rectangle + edge × edge × rectangle + anchor × map). `test/semiring/semiring.test.mjs` checks the product against brute-force walk enumeration in all five semirings, the semiring laws on seeded random graphs, closure against a separate relaxation, deletion propagation, rejected inputs and traces; four mutations of the source each fail it.

Second use: thro's "every way this disc could be a card" (PxCube `experiences/thro/ways.mjs`). The proposal for what a second use sublates into the PxC kernel is `docs/semiring-sublation.md`. Not yet wired into the workbench UI (`ui/app.mjs` is an existing file; adding a domain there is a separate, owned change).
