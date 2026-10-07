# Proto ingestion through the existing PxC dependency engine

Sam proposes that a FunctionalGuarantee can define a transformation interface, supply tests and boundary observation, and select abstract, overridable, or final validation. He asks whether staged Proto ingestion can yield a Part or Calculation, and why the CPU's dependency-resolution mechanism was not being applied here.

**Correction:** it can be applied. The earlier discussion treated incomplete meanings as a reason to defer graph construction. We can ingest the supplied structure, resolve what is available, and retain unresolved frontiers and failed checks. This adapter makes that concrete through the existing CPU Step capability and native Pipeline.

## A small candidate interpretation

An AbstractCalculation can be an interface Part describing a required transformation while its implementation is unresolved. A bound Calculation remains a specialized Part. A FunctionalGuarantee can compose that role with test/validation and observation Calculations; the latter roles can have their own unresolved or replaceable bindings.

In this example, three named slots are used:

| Slot | Selected policy |
| --- | --- |
| execute | Abstract until a registered CPU implementation is bound. |
| validate | A default comparison against the other CPU engine; explicitly overridable. |
| observe | A final boundary observer within this selected definition. |

Those are policies of this contract, not mandatory fields for all FunctionalGuarantees. A changed definition can choose other roles and policies. `final` binds the selected role within a definition; it does not make an engine or checker universally correct.

## What actually executes

`ingest` accepts a supplied Proto declaration. Unknown metadata remains retained. A Part Proto takes this native path:

```text
addressed Proto definition Part
 → ingest-Part Calculation
 → addressed state Part
```

A Calculation Proto with unresolved or opaque implementation references remains `PARTIAL`: its definition is an addressed Part, and its frontier lists the unbound roles. Selecting the gate or integer CPU implementation gives a callable composition:

```text
input state/program/inputByte + selected implementation Parts + Proto definition
 → CPU transition
 → boundary observation
 → ReadOnlyValidation: invoke/capture → ReadOnly check → verdict
 → CPU Step result
```

These are actual declarations lowered by `capability-lab/runtime.py` into `pxc-machine/pipeline.py`. Native dependency traversal supplies their execution order. The observation reads explicit input and candidate Parts. Validation consumes that observation and compares its boundary with the actual arguments before invoking the chosen checker. The returned CPU state comes from the transition; a validator's extra returned state is separately retained as effects-report data.

Validation failure is data in this diagnostic composition. It returns a declared REJECT verdict Part and retains the candidate for inspection; `acceptedOutputs` is null. Unresolved meanings or native linking/execution errors return an `ENGINE_REJECT` envelope with the cause and observations available so far. The native runtime does not return its partial registry on exceptions, so that envelope exposes staging declarations rather than inventing a completed execution graph.

Selection and lowering are small host adapter functions. The transformation, observation, and validation execute through the existing declared Calculations. This is ingestion of supplied CPU declarations and registered implementations, not an arbitrary JavaScript parser or a C# type-inference implementation.

## Results and failures

Twenty tests pass: eleven ingestion/boundary tests and nine compilation-lint tests reproduce bounded expected outcomes:

- Gate and integer implementation Parts agree with three literal cases: load, store, and OUT.
- An unbound or opaque Calculation stays partial without execution; an ordinary Part is produced through the native ingest Calculation.
- A wrong program counter is observed before validation and rejected by the default checker.
- An explicit weak validator accepts that same wrong counter. The independent literal test still reports a mismatch. This preserves a weaker selected checking composition instead of pretending schema validity establishes behavior.
- A missing meaning and a different nominal meaning with an accepting predicate both expose the engine's exact-name linking limitation.
- Selected final roles reject replacement; omitted optional overrides preserve existing bindings.
- A validator's returned PC=2 remains report data while the observed transition's PC=1 remains authoritative. Linking the result to `validate.state` fails because that port does not exist.
- Net changes to candidate state, input state, or program produce ReadOnly REJECT. An integer-to-Boolean change rejects despite Python treating `1 == True` as equal.
- Changing and restoring a borrowed value, while also modifying an external list, passes this boundary check. That retained counterexample identifies its observation limit.
- A correctly typed replacement graph executes and publishes PC=2 without the new lint. Linted ingestion rejects it with zero CPU/validator invocations. Nested forwarding cannot hide the forbidden producer.
- Declared writes through renamed borrowed-input aliases reject; new report writes remain allowed. An allowed report write does not excuse a forbidden borrowed write.
- An opaque Calculation that consumes an allowed producer remains a distinct producer. Declared dependency alone does not establish an identity transformation.
- Missing effects remain PARTIAL, while stale binding claims, nonexistent references, and unresolved/recursive declaration graphs reject before target execution. A false no-writes claim plus hidden change-and-restore preserves the source-completeness gap.

Three review mistakes are preserved in [evidence](proto-evidence.json). Initially the returned state came from the validator, allowing it to substitute PC=2 after observation recorded correct PC=1. The result now comes from the transition. Validation also declared the observation as an input but discarded it; the boundary check now uses it, and an injected mismatch produces REJECT. The first binding helper enforced `final` only on the observer; it now honors that policy on each selected slot.

Because a validator can return data different from what it checked, try varying that data while holding the observed transition fixed. Because a declared input can go unread, try changing only the boundary observation. Because a weaker checker can pass a wrong result, retain an independently supplied test expectation and report the disagreement.

## Discovered association: ReadOnly

Sam named ReadOnly after the validator-substitution counterexample. Candidate meaning: `ReadOnly(target Part, actor Calculation)` associates a protected state with the operation permitted to inspect it and produce new report Parts.

Three readings are worth keeping separate:

| Reading | This implementation |
| --- | --- |
| Preserve state at declared observation boundaries. | Deep before/after snapshots compare borrowed JSON argument content and types. |
| Restrict publication through the declared interface. | ReadOnlyValidation exposes verdicts and effects reports, with no direct CPU-state replacement port. |
| Prohibit every write attempt, including restored writes. | Boundary snapshots cannot establish this; the graph lint below rejects declared protected writes, while undeclared effects remain unresolved. |

The FunctionalGuarantee in [readonly.py](readonly.py) composes three Calculations: invocation/capture, ReadOnly checking, and verdict composition. These run in the existing addressed Pipeline. The selected validator can remain overridable; `final` constrains implementation selection while ReadOnly constrains effects on chosen state.

The snapshots detect net changes at invocation boundaries. They do not observe transient writes, globals, files, other threads, or later alias mutations. Producing evidence is allowed. A ReadOnly validator can still accept a wrong CPU result: the weak-checker counterexample preserves that distinction. ReadOnly also does not establish that an image remains available or fresh; those meanings can compose through other FunctionalGuarantees.

## ReadOnly as a compilation rule

Sam extends the association: a ReadOnly lint check can ban a link in the compilation graph. A *lint check* inspects declarations for a prohibited pattern before the target executes. Here the rule is itself a FunctionalGuarantee over graph and requirement Parts:

```text
Graph.Resolve → ReadOnly.LinkCheck → Compile.Verdict
```

The selected CPU build supplies two local requirements:

- Its authoritative `state` output must resolve to `transition.state`. A correctly typed validator replacement still violates that association. Forwarding through another FunctionalGuarantee does not erase its origin.
- The validator closure may read borrowed candidate/state/program Parts and produce new reports. Declared writes to the protected borrowed targets, including forwarded input aliases, are banned.

These are policies of this concrete build. Calculation bodies implement graph resolution and checks; the FunctionalGuarantee declares their composition. A known violation prevents CPU and validator invocation. The failed link and its resolution remain report data.

Optional `validatorEffects` Proto metadata names the selected binding and its declared `reads`/`writes`, for example:

```python
proto["validatorEffects"] = {
    "binding": "cpu.report",
    "reads": ["invoke.$input.candidate"],
    "writes": [],
}
```

It supplies graph facts to check; it does not prove that a Python body reports all its effects. Missing metadata leaves a PARTIAL frontier. A mismatched binding or nonexistent effect reference rejects the declared specification. Even a matching declaration retains `sourceEffectsCompleteness: UNVERIFIED`. The diagnostic adapter's implementation-specific hook continues with partial effect knowledge and retains it alongside the runtime ReadOnly verdict. It does not continue after a known forbidden link.

This gives three different, composable questions: does the declared graph permit the link; did observed state change at runtime; and is the computed answer correct? A no-writes declaration paired with a hidden change-and-restore demonstrates why source-to-effects completeness remains another obligation. Ordinary native linking still checks port existence and nominal meanings.

The native engine executes this lint FunctionalGuarantee; a small host adapter hook enforces its verdict before invoking the target. This is not yet a conditional compilation facility inside the original engine. Forwarding through declared FunctionalGuarantees is resolved; opaque Calculation outputs remain distinct producers rather than guessed aliases.

## Reproduce

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s outputs/fg-proto-ingestion -p 'test_*.py' -v
```

APIs in [proto_adapter.py](proto_adapter.py): `cpu_proto()`, `bind_proto(...)`, and `ingest(...)`. [Ingestion tests](test_proto_adapter.py) write source-bound [boundary evidence](proto-evidence.json). [Compilation tests](test_readonly_lint.py) exercise `compile_readonly(...)` in [readonly_lint.py](readonly_lint.py) and write [lint evidence](readonly-lint-evidence.json), including the exact consumed declaration/rule Parts, native logs, resolved origins, and rejected links. All six original engine source files remain unchanged.

## Why the CPU worked

The circuit importer and compiler already received drivers, port roles, truth laws, state transitions, and observation addresses. They derived schedules and state-indexed closures from those relationships. Fault diagnosis compared retained values and origins, then walked differing dependencies. A code/prototype ingester can provide the same kinds of relationships at its chosen granularity; an opaque operation remains a visible boundary until another implementation expands or instruments it.

The hardware evidence was bit-exact for one 105-state program and its requested observations. The fault input differed at t(35), RAM stored it at t(36), and the scanner exposed it at t(40). Restricted display observations could detect the difference but returned an unresolved hidden cause. That bounded success did not establish all CPU executions or identify arbitrary physical bit flips.

The next missing capability is explicit in this artifact: derive richer compatibility and ingestion rules while continuing to use the same addressed graph, rather than requiring complete semantics before constructing a useful partial composition.
