# Reuse the October 3 PxC CPU and Proto source

The Python files under `pxc-machine`, `capability-lab`, `fg-proto-ingestion`,
`fault-localization`, and `lyceum` are byte-for-byte source copies from the
October 3 learning workspace. `scripts/ingest-proto.py` is a small CLI around
the existing `cpu_proto`, `bind_proto`, and `ingest` functions. It reads supplied
Proto and input JSON, uses the registered CPU gate or integer Calculation, and
returns native PxC order, validation, ReadOnly, frontier, and source hashes.
It never evaluates code from the JSON.

From the workbench source directory:

```sh
python scripts/ingest-proto.py cpu
python scripts/ingest-proto.py cpu --provider cpu.gates --inputs cpu-input.json --output cpu-result.json
python scripts/ingest-proto.py my-proto.json --provider cpu.integer --inputs cpu-input.json
python scripts/test_ingest_proto.py
```

`cpu-input.json` contains `state` with `A`, `PC`, `OUT`, `HALT`, and sixteen
`RAM` bytes, `program` with sixteen bytes, and `inputByte` as one byte.
An unbound execute slot returns `PARTIAL` with a frontier. A bound step runs
the existing CPU Step FG, with the other implementation as validator. Known
forbidden declared links or writes return `LINT_REJECT` before the CPU step
executes and the command exits 1. `ACCEPT`, staged `PART`, and `PARTIAL` exit 0.
This is native CPU capability ingestion; it is not a browser CPU runtime.

The fault probe is independently repeatable with
`python vendor/pxc-learning/fault-localization/probe.py`. Its trace hook
changes a live simulated RAM Part and existing FGs locate the first fault.
It is a simulator fault model, not a physical memory diagnosis.

Atlas's browser and CLI capture/import path is documented in
`exp/atlas/CROSS_LANGUAGE.md`. Both use existing recipe/Proto declarations and
PxC FunctionalGuarantees. The historical completed-game ReplayString source
has not been found in the provided checkpoints, so neither path claims that
encoding or a replacement for it.
