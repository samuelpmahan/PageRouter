# Lane A — Declare behavior, construct a component

**Sam’s direction:** DeclarativeComposition is the North Star: “I declare do X, it composes it.” Checkpoint first, then extend through lanes that verify what came before.

**This experiment’s interpretation:** a complete finite truth table can be an executable construction requirement. The requested name never selects an implementation. Two generic constructors consume the table, produce ordinary PxC NAND/wire Parts, execute them, and qualify them against behavior and component-count FGs.

## What changed

Checkpoint 001 had a bounded two-input NAND search and an authored CPU. This lane adds arbitrary **1–5 input, 1–32 output Boolean components**. It does not contain an implementation selected by the names “full adder,” “mux,” or “decoder.” Those examples are literal rows in `requirements.json`.

Two constructors:

- **Sum of products:** make an AND term for each input row that must output one, then OR those terms. Shared terms are shared graph nodes.
- **Shannon decomposition:** split the table into the cases where an input is zero or one, recursively construct those two smaller functions, then connect a multiplexer. A multiplexer selects one input using another bit.

Both lower to **NAND, wires, and constants** using existing combinators. Runtime execution still goes through the existing PxC gate engine. Python chooses the circuit layout; it does not secretly perform the circuit’s runtime arithmetic.

## Observed choices

| Declared component | Sum-of-products NANDs | Shannon NANDs | Selection |
|---|---:|---:|---|
| Full adder: 3 inputs, sum + carry outputs | 49 | 25 | Shannon |
| Multiplexer: 3 inputs, 1 output | 28 | 13 | Shannon |
| Decoder: 2 inputs, 4 outputs | 10 | 17 | Sum of products |

The **BOM**, or bill of materials, counts actual primitive nodes in the compiled output dependency graph. Validators and wires have separate counts. This is not a physical transistor count or a global minimum claim. The selection chooses the least NANDs among the two qualifying candidates.

For the full adder, an inclusive `maxNand: 25` accepts only Shannon. `maxNand: 24` accepts neither. The failure retains both candidates and explains: **because** their measured size exceeds the bound, **try** another constructor or change the bound. A failed search among two constructors does not prove that no qualifying circuit exists.

## Executed composition, not an annotated transcript

The existing `Pipeline` executes these declared Calculations:

```text
requirement + inventory + strategy
                ↓
          construct component
                ↓
           compile FG closure
                ↓
requirement → execute every row → verify behavior and trace
                                  ↓
                   measured BOM + bound → qualification
                                              ↓
                                  compare candidates → selection
```

The FGs reference the actual executed validator Calculations. `seek` starts from those FGs. The artifact preserves declarations, actual calculation order, actual execution log, input Part values, and paths to every result Part. Construction, compilation, execution, verification, counting, and selection are separate semantic units.

**Implementation-specific failure policy:** failed candidate validations remain available to comparison; selection returns `FAIL` with no selected candidate when none qualifies. This is an experiment’s policy, not a universal PxC rule.

## Semantic equality

The fingerprint represents the complete Boolean input/output relation under **ordered port positions**. Display labels, component name, source code, constructor, and BOM are excluded. Renaming ports preserves meaning. Swapping the sum and carry positions changes meaning.

Both candidate behavior hashes come from their actual measured rows. Matching hashes also require exact canonical comparison—comparison of the same reproducible representation—so a hash collision cannot itself establish equality. Missing or incorrectly bound domain observations do not receive a complete-domain semantic fingerprint.

Behavior and size are separate obligations: two implementations may have the same finite behavior and different BOMs. Timing or origin equality would need additional contracts.

## Evidence and preserved failures

`evidence.json` contains full plans, traces, literal requirements, pipeline declarations, and validation results for the four specimens; all 256 three-input single-output functions are retained as a compact corpus. Each construction sees all eight rows, so this corpus checks **512 constructed graphs and 4,096 row evaluations**. A five-input, three-output specimen checks all 32 input combinations.

A consumer then instantiates four copies of the selected full-adder composition to build a four-bit ripple adder. All **512 combinations** of its two four-bit operands and carry input agree with an independent integer addition oracle. The runtime graph contains 100 NANDs plus wires and validators. Integer addition is used only by the oracle.

Failures that improved the implementation:

1. **Every NAND was correct, but the component was wrong.** An output wire faithfully copied the wrong source. Primitive FGs all passed; the independent full-adder table failed. This counterexample is retained with its actual graph and trace.
2. **Equal outputs hid incorrect input-state labels.** Swapping two inputs of the symmetric full adder produced the same outputs. The first verifier copied expected input labels without checking actual input Parts. The new input-binding check fails, and no complete semantic fingerprint is issued.
3. **Readable and numerical wiring could disagree.** The verifier used numerical indices while reuse initially used address strings. An address-only mutation could therefore instantiate a different graph after a PASS. The lane now checks both representations agree and lowers from the verified indices.
4. **A self-consistent trace changed a constant.** Primitive replay alone did not bind root constant values to declarations. The lane explicitly checks constants and external input rows. This finding also motivated the root’s shared audit correction.
5. **Saving JSON changed integer dictionary keys to strings.** Reusing a saved report initially failed at constant loading. The import boundary restores constant indices and checks the address bindings before execution.

`test-red.txt`, `test-adversarial-red.txt`, and `test-review-red.txt` preserve the earlier failures. `test-green.txt` records the corrected suite. Passing tests support the stated finite scope; they do not establish every possible future PxC composition.

## API and reproduction

Run from the workspace root:

```bash
python3 -m unittest discover -s outputs/pxc-machine/lanes/composition -p 'test_composition.py' -v
python3 outputs/pxc-machine/lanes/composition/build_evidence.py
```

Python API from this directory:

```python
from composition import compose, instantiate, replay

report = compose(requirement, constraints={"maxNand": 25})
# Builds both candidates; report["selection"] decides which satisfies the FGs.

outputs = instantiate(net, "component", input_part_addresses, report)
# Revalidates the selected actual graph before connecting it into another Net.
# Input and returned output bindings follow the requirement's declared order.

fresh = replay(report["pipeline"]["inputValues"])
# Executes a new Pipeline from declared request Parts, with no cached derived values.
```

## Exercises and open questions

- Declare the asymmetric table `00→0, 01→0, 10→1, 11→0`. Expected: both constructors implement `a AND NOT b`; swapping input roles changes behavior.
- Rename the decoder to “full adder.” Expected: its output behavior remains the decoder table. Names cannot select semantics.
- Add an unused NAND. Expected: the output closure’s BOM and behavior stay unchanged. A generated but unreachable gate is not part of the delivered circuit.
- Tighten the decoder’s bound to ten NANDs. Expected: only sum of products qualifies. Tighten it to nine: neither qualifies, without proving nine is impossible.
- Can a third constructor improve these sizes while fulfilling the same FGs? How should a later contract combine this finite value relation with clocked state, timing, and provenance?

The two constructors are algorithmically independent but share the existing primitive execution and validation engine. A separately implemented engine remains useful for detecting a shared evaluator error. Physical delays, analog behavior, arbitrary program equivalence, and global optimization are outside this finite contract.
