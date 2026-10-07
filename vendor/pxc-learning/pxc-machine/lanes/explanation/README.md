# Lane C — explain the evidence

Open the local notebook at **http://127.0.0.1:8766/explanation** after starting the parent `serve.py`.

## The question

Can an FG composition explain a failure from actual Part/state dependencies, and refuse a persuasive but unsupported PASS?

**Prediction:** the shrunk CPU input `1` first exposes the changed next-value wire at `t(0)`, then the accumulator at `t(1)`. A zero input conceals the wrong value but preserves the wrong origin. Deleting one validator invocation must leave the obligation unverified.

## Actual results

| Experiment | Observed result |
|---|---|
| Matching execution | PASS; all six loss categories zero |
| Actual accumulator wire mutation; input `1` | FAIL; 219 unequal Part observations, one retained primitive FG failure |
| Same mutation; input `0` | All values agree; four state-specific origin differences still fail the declared origin comparison |
| Clean execution with one validator record removed | UNVERIFIED; the old PASS summary cannot fulfill the missing invocation |

The first public state difference is `A@t(1): expected 1, actual 0`. The displayed path follows the actual delay dependency to `cpu/a/next/0@t(0)`, where the consumed source changed. It says **first observed causal frontier**, not proven physical or authoring cause. The original fast-check reproduction remains seed `20261004`, path `5:0`, input `1`.

`diagnose()` actually executes six declared Calculations through the existing PxC Pipeline: compare observations, verify FG closure, audit both traces, follow dependencies, summarize. The FG requests that composition. Each consumed plan, trace, requested state count, and input schedule is an explicit input Part. The execution log is emitted by those calls.

## Preserved corrections

1. **Creation order was a misleading ordering rule.** A downstream Part can be declared first. The comparison now uses the compiled execution order, and the explanation follows resolved dependencies.
2. **The observed plan could erase its own obligations.** Independent review removed FGs from both the observed plan and trace and obtained a false PASS. Required FGs now come from the predecessor plan; the regression retains that case.
3. **A validator record could hide missing producer evidence.** Missing evidence now propagates through consumed dependencies, including delay edges to previous states. Initialization consumes the initial Part, not an imaginary state `t(-1)`.
4. **An address label could disagree with the executed input index.** Execution uses numeric indices. The diagnostic now resolves those indices, validates their duplicate names, and marks inconsistent declarations unverified. Equal values cannot hide this mismatch.
5. **A forged passing verdict could have a matching forged log.** The diagnostic now replays the declared rule against its actual inputs before accepting that observation. A retained value of `1` is insufficient.

These failures explain why a summary status, a matching bit, and fulfilled FG closure are separate facts.

## The three lanes in one notebook

- **CPU diagnosis:** side-by-side LED matrices, state-bound tooltips, retained failure pins, origin comparison, and a modal that follows earlier states without seeking the main timeline.
- **Declared composition:** reads Lane A's actual candidate traces. Two constructors, measured NAND counts, complete input rows, identical behavior fingerprints where justified, and rejected counterexamples. Every output LED opens the actual producing Part.
- **Extend the inventory:** the same full-adder requirement admits generic constructions using 49 and 25 NANDs and the verified 15-NAND predecessor. A bound of 20 selects only the predecessor. All three correct candidates share the same complete-behavior hash. A zero-NAND candidate sharing the label is rejected by its behavior, despite its low count.
- **Clocked device:** reads Lane B's measured state projection. Eight digits display stored decimal state; exactly one bright digit is physically driven by the actual segment bus. Dim digits are explicitly labeled as a preview. Pulse pins expose the wrong-strobe circuit: `999, 1999` ms instead of `1000, 2000` ms. Both have a 1000 ms period; phase is the failed obligation.

Show + Tell and Max Info are projections of the same report. Device inspection verifies the retained packed file's SHA-256 and decodes only the current and preceding state. Lane B owns the full roundtrip and whole-trace integrity verification.

## Reproduce

From the workspace:

```bash
python3 -m unittest discover -s outputs/pxc-machine/lanes/explanation -p 'test_*.py'
python3 outputs/pxc-machine/lanes/explanation/diagnostics.py
```

The browser check uses the existing Windows Node, Chrome, and Playwright installations:

```text
D:\NodeJS\node.exe C:/Users/tenni/Documents/Codex/2026-10-03/you-re-my-pxc-learning-partner/outputs/pxc-machine/lanes/explanation/browser-check.mjs
```

`test-red.txt` preserves the initial missing-implementation failure; `test-green.txt` contains the focused regression result. `report.json` records checked checkpoint hashes, current source hashes, predictions, actual evidence, and the executed diagnostic composition. `browser-verification.json` binds UI checks to the HTML hash.

The first browser attempt preserved in `browser-red.json` caught an incorrect test assumption: the CPU's actual causal path contains two load-mux NANDs between its register and the changed wire. The four-node path was already present in the trace; the two-node minimal fixture did not describe this CPU. `browser-device-red.json` preserves a genuine adapter mistake: the device artifact's `PASS` field overwrote the transport's `READY` field, preventing rendering. They now have separate names (`artifactStatus` and `status`).

The final browser run passes **11 groups**, including all three lanes, modal state preservation, and mobile layout. `browser-mobile-red.json` preserves the responsive failure: a 396 px experiment selector exceeded the 390 px viewport. Constraining its width and separating long bus labels fixed it. This presentation-only edit followed the **12 passing Python regressions**; `verification.json` retains the original unit-run hashes and records the subsequent browser verification separately.

## Limits and next exercises

The clean trace is a comparison input, not an independent mathematical definition. The CPU oracle, primitive FGs, requested input history, and origin comparison supply different obligations. One displayed path is deterministic, but does not claim that other divergent branches are absent. A sampled CPU program is not exhaustive CPU proof.

Exercises another agent can attempt:

1. Delete an FG from both observed declarations and logs. **Expected:** UNVERIFIED against retained predecessor obligations.
2. Feed an equal-valued alternate Part into a wire. **Expected:** value comparison passes; declared origin comparison fails.
3. Delete a producer invocation before a delay. **Expected:** dependent validation becomes UNVERIFIED in the next state; unrelated initial-state validation can still pass.
4. Preserve pulse period while shifting phase one tick. **Expected:** gate truth tables can pass; the timing FG fails at the exact expected and extra pulse states.
5. Add a new lane using standard `plan`/`trace` and named buses. **Expected:** Part inspection needs no CPU register names or new gate evaluator.
