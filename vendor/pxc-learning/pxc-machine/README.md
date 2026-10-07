# A machine you can explain

**Open the [CPU workbench](http://127.0.0.1:8766/), [three-lane evidence notebook](http://127.0.0.1:8766/explanation), or [graph optimization view](http://127.0.0.1:8766/optimization).**

If its server is stopped, run from this workspace:

```sh
python3 outputs/pxc-machine/serve.py --port 8766
```

This is the first integrated machine milestone under Sam's larger goal, not a finished specification of PxC. Sam's North Star is **DeclarativeComposition: declare what is required; let the system compose it**.

**Checkpoint 001 is preserved in `../pxc-checkpoints/001/`.** Its original receipts remain attached to that snapshot. Current CPU verification lives in `frontier-machine-verification.json` and `frontier-generated-checks.json`; `checkpoint-regression.json` confirms the same hardware declarations and all 25 baseline states. See [LANES.md](LANES.md) for the three extensions and their separate evidence.

## What the three lanes added

| Lane | Constructed extension | Evidence that changes the conclusion |
|---|---|---|
| A: composition | Two constructors generate NAND circuits from complete finite truth tables. A verified component catalog can supply another implementation under the same contract. | A full adder costs 49 or 25 NANDs when generated, versus 15 in the existing library. A decoder reverses the two constructors' ranking: 10 versus 17. |
| B: clocked devices | Eight decimal digits, pause/reset, chained clock division, and multiplexed seven-segment display plus decimal point. | Removing one storage bit keeps a 1,000 ms period but shifts pulses to 999 and 1,999 ms. Every primitive FG passes; the temporal FG fails. |
| C: explanation | LED comparisons, state-aware dependency inspection, and separate failed/unknown evidence. The notebook also projects A and B's retained artifacts. | Equal output values can hide a changed source. A recorded PASS can lack the Calculation evidence needed to justify it. |

The notebook's **Show + tell** and **Max info** modes project the same evidence. Selecting a Part in a modal leaves the main timeline unchanged. In the stopwatch, bright segments show the digit actually driven at that state; the optional dim preview shows the stored digits.

Further bounded extensions live in `extensions/optimization/` and `verification/js/`: mechanical reuse of pure gate expressions, and an independently implemented JavaScript compiler/executor. Their own receipts retain scope, source identities, counterexamples and verification results. The optimizer preserves original component boundaries through alias wires, so it reports NAND savings and the added wires separately.

- Independent JavaScript execution: **26 cases, 1,221 states, 4,329,398 bit comparisons**, zero disagreement. Incorrect NAND and stale-delay source mutations are detected.
- Graph optimization: **59 CPU cases, 403 states per engine**, zero unexpected loss. The countdown changes **3,292 → 2,110 NANDs**, retains **149 clocked bits**, and changes **255 → 1,050 named wires**. Total hardware operations change **3,696 → 3,309**. The wrong merge and four adversarial evidence/obligation/cost cases remain visible.
- Current evidence index: `successor-verification.json`. The complete successor snapshot is [checkpoint 002](../pxc-checkpoints/002/manifest.json); checkpoint 001 remains unchanged. The index checks receipt freshness and acceptance conditions; it does not turn sampled CPU histories into exhaustive correctness.

## Try it

1. Run the countdown. OUT shows 5, 4, 3, 2, 1, 0 before HALT.
2. Click t(4), then A. Open a bit, then its D input. The inspector moves to the producing Part at t(3); the main timeline stays at t(4).
3. Open CPU → ALU → nested components. Counts come from unique declared dependencies within the selected boundary.
4. Open one of XOR's four synthesized NANDs and change the truth-table row. Its outputs and validating evidence come from that actual execution.
5. Select **Max info**. It exposes more of the same data, including addresses, instruction decoding and FG results.
6. Enable reuse, rerun, and compare executed versus reused Calculations. Logical ticks remain separate from browser playback and wall time.

![The machine workbench](viewer-desktop.png)

## What is built

| Component | Implementation |
|---|---|
| Boolean logic | NAND is the only arithmetic/logic primitive. NOT, AND, OR, XOR, mux and demux compose it. |
| State | 149 ideal clocked bit cells: q(t+1)=D(t), with explicit initial bits. |
| Arithmetic | Gate-composed ripple adders, subtraction, bitwise operations and shift wiring. A ripple adder passes carry from one bit to the next. |
| CPU | Eight-bit accumulator, four-bit program counter, input/output ports, halted bit. |
| Memory | 16 eight-bit instruction words selected through gates; 16 eight-bit RAM words built from clocked bits and write multiplexers. |
| Observability | Every bit, Calculation, primitive FG, component group and state is addressable in the trace. |
| Composition | XOR is constructed from its requested truth table and a NAND inventory. CPU construction consumes that exact recipe as a declared Part. |

**Derived hardware count:** 3,292 NANDs, 149 clocked bits and 255 named wires. There are separately 3,696 primitive validators, for 7,392 runtime Calculations total. Validators are verification work, not hardware gates. These are logical component counts, not transistor or technology-mapped synthesis counts.

All 48 XOR instances use the synthesized recipe. Supplying a different valid six-NAND XOR changes all 48 instances and adds exactly 96 NANDs while preserving observed CPU behavior. A wrong recipe is rejected.

### Instruction meanings

Each instruction is a byte: four opcode bits followed by a four-bit operand. A byte is eight bits, so arithmetic wraps at 256. Program addresses wrap at 16.

| Opcode | Instruction | Effect at the next tick |
|---:|---|---|
| 0 | NOP | Advance PC. |
| 1 | LDI n | A becomes n (0..15). |
| 2 | LDA n | A becomes RAM[n]. |
| 3 | STA n | RAM[n] becomes A. |
| 4 | ADD n | A becomes A + RAM[n], modulo 256. |
| 5 | SUB n | A becomes A − RAM[n], modulo 256. |
| 6 | AND n | A becomes A AND RAM[n]. |
| 7 | OR n | A becomes A OR RAM[n]. |
| 8 | XOR n | A becomes A XOR RAM[n]. |
| 9 | JMP n | PC becomes n. |
| 10 | JZ n | Jump when current A is zero. |
| 11 | JNZ n | Jump when current A is nonzero. |
| 12 | OUT | Output port captures A. |
| 13 | IN | A captures the input byte supplied at this state. |
| 14 | SHL | Shift A left, discarding the top bit. |
| 15 | HALT | Set halted; hold PC and all stored state on subsequent ticks. |

Unmentioned state holds. All storage updates together from the preceding state. The CPU never calls the integer instruction interpreter: that interpreter is an independent checker.

## How PxC drives it

The frozen Part, Calculation and FunctionalGuarantee classes are reused from the earlier Lyceum experiment. The runtime and larger circuit declarations are isolated here.

At the higher level, declarations do no work. Seeking these FGs compiles and executes their dependencies:

```text
fg/cpu-conformance
  comparison(execution, independentReference)
    execution(compiledPlan, requestedStates, suppliedInputs, reuseMode)
      compiledPlan(machine)
        machine(program, initialState, synthesizedXorRecipe)
          synthesizedXorRecipe(requiredTruthTable, gateBound)

fg/execution-evidence
  traceAudit(execution, expectedPlan, requestedStates, suppliedInputs)
```

Each step is an actual Calculation consuming addressed input Parts. The trace retains the requested FG roots, compiled order, executed operations and outputs. An unused declaration does not execute.

At the bit level, compilation follows data dependencies and the **FGs' declared validator references**. A NAND's validator consumes independent literal truth-table cells. Delay dependencies cross from the preceding state; ordinary gate dependencies remain in the current state. This separates legitimate clocked feedback from an invalid same-state cycle.

The optional delta engine reuses a result only when its resolved input tuple is unchanged under the same fixed rule. Its log distinguishes reuse from execution. This is exact value reuse in a fixed graph; it does not yet implement semantic cache sharing across rewritten programs or state branches.

## What has actually been checked

- `machine-verification.json`: **124 cases, 970 states per engine**, zero conformance loss. Includes 24 explicit scenarios and 100 seeded random programs. Every opcode executed. Every architectural register, RAM word, input, instruction selection and full/delta bit state was compared.
- Full execution performed **7,170,240 Calculations**. Delta performed **2,391,394**, with **4,778,846 reuses**. This is about 66.6% fewer evaluations, not a measured wall-time speedup claim.
- `generated-checks.json`: **24 additional Zod-validated fast-check cases**, 3–5 ticks each, with zero unexpected loss. A real declaration mutation was found and shrunk to input 1; seed `20261004`, path `5:0` replays it.
- Component tests exhaust the declared small domains: 512 four-bit-adder rows, 16 decoder rows, 32 demux rows, 8 enabled-register transitions, gate/mux rows and all 16 possible two-input truth tables within the synthesis search bound.
- `viewer-browser-checks.json`: desktop and mobile checks in actual Windows Chrome, including state-aware drilling, both modes, validation displays, invalid assembly and focus restoration. No external requests are needed.

The broader CPU input space is sampled, not exhausted. Full and delta execution share the bit evaluator; the separately implemented integer CPU oracle supplies independent instruction-level checking.

### Failures that changed the implementation

| Observed failure | Correction |
|---|---|
| Removing work from both the plan and its logs could pass the audit. Even an empty history could pass. | Audit now consumes a separately supplied expected plan and requested state count. |
| A shallow copy let a trace edit also change its expected plan. | Execution makes a separate copy of the input declaration. |
| An FG's declared validator could be replaced by a missing address without affecting execution. | Compilation resolves the declared links and rejects missing validators. |
| CPU XOR used an implicit cached recipe; displayed synthesis evidence was another call. | The actual synthesis result is an input Part of CPU composition. |
| Correct NANDs wired incorrectly still passed each NAND's FG. | The composed truth-table FG rejects the wrong overall behavior. |
| A stuck accumulator capture made full and delta agree on a wrong value. | The independent oracle and retained wire FG detect it; fast-check shrank the input to 1. |
| 43 nested hold-mux groups were unreachable in drill-down; HALT metadata named the wrong source. | Group links and actual source boundaries were corrected and checked. |

Because a result can agree for the wrong reason, **try changing its source while preserving its value**. Because logs can erase their own obligations, **try deleting the same item from every reported view**. Because Parts must drive work, **try seeking an FG while leaving an unrelated failing Calculation declared but unused**.

## Reproduce

```sh
python3 -m unittest discover -s outputs/pxc-machine -p 'test_*.py' -v
python3 outputs/pxc-machine/machine_checks.py
```

The fast-check runner uses the already installed Node, Zod and fast-check under `work/lyceum-js`; its receipt records versions and exact sources. The browser runner is `work/browser-preview/test-machine.mjs`, using the existing Windows Node and Chrome with an isolated temporary profile. No installation or publication was performed.

## Active frontier

The larger objective remains active. This milestone does not establish arbitrary FG-driven program synthesis. The CPU architecture is a declared construction recipe; the XOR subcircuit is searched from a behavioral requirement. Conditional CPU jumps execute within a clocked state pipeline; they are not yet a human-interaction state trie. Physical gate delays, metastability and oscillator drift are outside this ideal Boolean model. Partial output plans are inspectable, while the workbench currently executes complete machine snapshots.

Sam answered the steering question by requesting **all three lanes**, each verifying and extending its predecessor. The resulting artifacts preserve both successful constructions and their counterexamples. This bounded model now supports a gate-built machine, requirements-driven component construction, clocked devices, diagnostic compositions and checked graph rewriting. Arbitrary code ingestion and general program synthesis remain beyond the demonstrated scope.
