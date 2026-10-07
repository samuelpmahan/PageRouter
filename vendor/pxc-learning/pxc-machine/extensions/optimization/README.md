# Optimization as an executed FunctionalGuarantee

**Question:** Can a declared rewrite make the predecessor CPU smaller while preserving its behavior, inspectable boundaries, and verification obligations?

**Prediction:** Several independently composed components calculate the same NAND expressions. Sharing those calculations should reduce the logical NAND count. Each storage cell must remain distinct.

## Observed result

The final source-fenced receipt passed **59 CPU cases / 403 states per engine**, with zero conformance, structural, rule, or audit loss. The cases include all 16 opcodes, predecessor boundary scenarios, 32 seeded programs, and all three existing demos. Every case retained 149 distinct storage cells and removed between 1,150 and 1,438 declared NANDs.

For the countdown demo:

| Declared component | Before | After |
|---|---:|---:|
| NAND | 3,292 | 2,110 |
| Clocked bit | 149 | 149 |
| Wire | 255 | 1,050 |
| Total hardware Calculations | 3,696 | 3,309 |
| Validator Calculations | 3,696 | 3,309 |

The 1,182 saved NANDs do not imply 1,182 fewer total Calculations: boundary aliases add 795 wires. The graph still loses 387 hardware Calculations while retaining the same named observable boundaries. All four review counterexamples reject; the unsafe merge has two observable failures with zero primitive or audit failures. Ten focused unit groups pass.

## What executes

`optimizer.py` rebuilds the actual predecessor graph through the existing `Net.nand`, `Net.wire`, and `Net.delay` APIs. This regenerates validators for the wiring that will execute.

The supported rules are deliberately small:

- NAND inputs may be permuted: `NAND(a,b) = NAND(b,a)`.
- The same NAND calculation on the same canonical inputs may be reused.
- A wire carries its input value unchanged.
- Each clocked cell keeps its own address, initial bit, and previous-state dependency.

“Canonical input” means the already established representative for an equivalent input Part. This is local expression equality, not inference from function names or a claim that arbitrary programs are equivalent. All four Boolean input pairs execute through real primitive Calculations to check the rewrite rules.

Every original bus and group boundary keeps its address. When its computation is shared, an explicit alias wire connects that boundary to the shared result. Internal wires may disappear; `sourceToResult` maps each original value address to its canonical result and gives the literal rewrite reason.

## Pipeline and FGs

`build_pipeline` receives the actual predecessor Net, program, state, and input observations as addressed Parts. Its declared Calculations compile the predecessor, validate the rules, produce a new Net, compile fresh validators, execute both machines, and run an independent integer interpreter.

The executed FGs check:

1. Exhaustive primitive rewrite-rule behavior.
2. The local rewrite relation for every predecessor expression, including preserved storage and boundary addresses.
3. The complete accepted primitive FG declaration structure before and after rewriting.
4. Equal observable bus values at every simulated state.
5. Both machines against the independent instruction interpreter.
6. Both execution logs against their own plans and input obligations.
7. Independently counted BOMs and reported savings: NAND count cannot increase, and storage count cannot change. The CPU receipt additionally requires a strict NAND reduction in every case.

The optimizer accepts the standard primitive contracts created by `Net`. A custom hardware FG requires an explicit transport rule and is rejected here. Its implementation-specific failure policy retains failed validator results for inspection.

## Useful failures

`unsafe-merge.json` contains a real circuit mutation: `NAND(a,c)` is incorrectly replaced by `NAND(a,b)`. Every remaining primitive is correct and both execution audits pass. Two of eight observable input cases fail the composition FG. **Because local gate validity cannot establish a justified substitution, compare the declared boundary behavior and the source-to-result relation.**

Read-only review exposed four additional blind spots, retained in `review-red.json`, `test-review-red.txt`, `cost-red.json`, and `test-cost-red.txt`:

- An altered incoming FG operand Part was accepted and replaced with a different endpoint structure.
- A forged display mapping could hide a changed observable boundary from the structural validator.
- Removing candidate FGs left the value checks and execution audit green.
- A false claimed BOM of 9,000 → 0 NANDs passed the structural FG because it did not independently count the graph.

The repair checks the actual Part/Calculation/FG declarations on both sides, verifies actual boundary aliases independently of display mappings, requires the complete supported validator set, and counts actual Calculations independently of the reported cost. `receipt.json` records the four repaired rejection cases.

## Run and inspect

From this directory:

```sh
python3 test_optimizer.py
python3 build_evidence.py
```

Public APIs:

```python
optimized_net, report = optimize_net(predecessor_net)
pipeline = build_pipeline(predecessor_net, program, steps,
                          initial=initial_state, inputs=input_bytes)
```

The executed Pipeline retains real Net, plan, trace, report, and validator result Parts in `pipeline.values`. `report` includes before/after BOMs, boundary aliases, and `sourceToResult`. The evidence runner retains a countdown example's complete mappings and bus observations in `example.json`; that saved projection explicitly omits the full bit logs, which were executed and audited in memory.

This is logical common-subexpression elimination: reusing calculations that have the same declared inputs and operation. It does not estimate physical chip area, signal propagation, power, or maximum clock speed. NAND count and alias-wire count are reported separately. CPU state sequences are sampled; the primitive rewrite domain and local expression checks are complete within the declared model.
