# FunctionalGuarantees composing into capabilities

Open the local experiment at **http://127.0.0.1:8772/**. Choose **Write memory, then step CPU** and invoke it: it writes 42 to RAM[3], binds the resulting memory into CPU state, executes `LDA 3`, and displays accumulator 42 as LEDs. The input example advances only after a successful invocation; edits made during execution are preserved.

This is an isolated, executable learning probe. It reuses the existing Python CPU and Pipeline, with a native HTML/JavaScript client. It does not change the older machine or claim a complete TS/JS integration framework.

## Three questions, one working composition

| Question and prediction | Observed answer | Preserved breaking case |
|---|---|---|
| Can one parameterized declaration compose bit cells into memory and derive capacity? Predict yes for finite banks. | Recursive register/bank declarations match all 8,448 state/address/value/write combinations across 2x2 and 4x2 memory. Capacity counts follow instantiated definitions. | Swapping bank write enables preserves every value schema but writes the wrong word. A whole-memory validation step in the declaration now rejects it. |
| Can freely written implementations satisfy the same CPU Step capability? Predict gate and integer implementations agree on the shared state contract. | Both use exactly the same declaration. All 26 cases agree, covering all 16 opcodes; 22 have literal expected states, four are seeded cases. | Wrong program counter, missing OUT state, and missing output port are rejected. |
| Can a UI and a script consume the same capability? Predict equal inputs produce equal outputs and execution order. | Fifteen direct Python, HTTP, and actual Chrome-button invocations agree across five exposed capabilities, including memory composed with CPU Step. | Missing inputs and malformed JSON preserve displayed output. Browser numeric normalization initially hid a Python schema distinction; raw request text now preserves it. |

The integrated example is produced by `composition.make_memory_cpu()`. Its input/output wiring is a definition consumed by the same runtime as the standalone examples. Both CPU providers load the written 42. Changing Step's binding to the original state produces A=0 even though the child memory and CPU contracts each pass. The independent parent experiment catches this. **Child contracts do not infer the intended parent state relationship.**

## What is declarative here

`runtime.py` lowers a finite FunctionalGuarantee definition into the existing addressed Pipeline. Definitions declare named input/output meanings, nested uses, input bindings, optional sequencing (`after`), and returned outputs. Calculations refer to registered imperative functions. Nested expansion, linking, dependency order, returned state and the feature tree come from these definitions.

For example, the memory-then-CPU definition contains these actual bindings:

```text
currentMemory = read RAM from input state
memory        = Storage(currentMemory, address, value, write)
boundState    = bind memory.memory into input state
step          = CPU.Step(boundState.state, program, inputByte)
return step.state and memory.read
```

The same declaration is projected into the catalog, button label, required input/output list, and expandable composition. The UI also shows the actual execution order. Layout, editable examples, LED mappings and next-input feedback are explicitly chosen presentation configuration. The browser calls the same `invoke` function exposed to scripts.

Root-owned schema and runtime remain deliberately small. A FunctionalGuarantee definition has `kind`, `label`, `inputs`, `outputs`, `steps` and `returns`. A Calculation definition has the same port fields plus an `implementation` key. Input bindings use `$input.name` or `step.output`. Named local predicates check the supplied values; exact matching names are the current linking rule. These names and predicates are trusted definitions, not a general semantic-equivalence engine.

All steps declared inside a composition are required, including validation steps whose results are not returned. Unused definitions do not execute. Ordinary JSON input state is copied before entering an imperative implementation. This protects the caller's supplied state but does not sandbox globals, files, external side effects or malicious scripts. A failed check raises in this probe; that is its explicit implementation-specific failure policy.

## Evidence and reproduction

From the parent workspace:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 outputs/capability-lab/verify.py
PYTHONDONTWRITEBYTECODE=1 python3 outputs/capability-lab/interaction.py --port 8772
PYTHONDONTWRITEBYTECODE=1 python3 outputs/capability-lab/ui/test_interaction.py
```

Then use the existing Playwright setup to run `ui/test_browser.mjs`; its default URL is localhost:8772. No dependencies were installed for these experiments.

- `verification.json`: seven runtime guards, storage and CPU checks, integrated behavior, source hashes.
- `storage-report.json`: exhaustive small-domain observations, raw bank counterexample, and rejection by the validated declaration.
- `cpu-report.json`: provider comparisons, literal cases and rejected implementations.
- `composition-report.json`: actual memory-to-CPU results and the wrong-state-binding counterexample.
- `ui/script-results.json`: direct Python/HTTP invocation inputs, outputs and orders.
- `ui/browser-results.json`: actual browser parity, input rejection, mobile overflow and edit-preservation checks.

The browser's `1.0`/`1e0` case follows this probe's Python predicate, which distinguishes integer and float representations. Preserving that distinction is evidence of transport parity; it is not proposed as a universal PxC numeric meaning.

## What we learned and what remains open

The positive result is executable: reusable functional declarations can supply a capability, its expanded dependency structure, alternative imperative implementations, and a shared browser/script invocation surface.

The small domains are exhaustively checked; CPU agreement is bounded. Feature descriptions still start from meanings supplied in the reusable definitions. Memory capacity is counted from registered cell/bank constructors. We have not inferred arbitrary script semantics or synthesized a complete browser game engine. Recursive expansion is finite here; self-recursive definitions without finite instantiation are rejected.

Because valid child contracts can compose with the wrong state, **try retaining the requested parent relationship independently and changing only the binding**. Because an internal implementation can preserve shape while changing behavior, **try swapping a routing decision without changing schemas**. Because two callers may normalize input differently, **try representation-sensitive inputs through both actual invocation paths**.

![Capability UI with CPU state, LEDs and declarative composition](ui/browser-desktop.png)
