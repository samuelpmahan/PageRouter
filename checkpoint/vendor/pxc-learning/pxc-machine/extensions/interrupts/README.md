# Interrupt and framebuffer experiment

The CPU counts in the foreground. A gate-built timer requests an interrupt every 32 ticks. The handler grows one row of pixels, then restores the interrupted program counter and accumulator. A separate gate-built scanner selects one of eight RAM rows per tick.

Run from `outputs/pxc-machine`:

```sh
python3 -m extensions.interrupts.experiment
node extensions/interrupts/generate_cases.mjs > /dev/null
python3 -m extensions.interrupts.verify
```

`demo.asm` is the exact source. The default RAM is zero except RAM[15] = 1; external inputs and IRQ are zero. Across 104 transitions, entries commit at states 32/64/96, row 0 becomes 1/3/7 at 36/68/100, and returns commit at 37/69/101. State `t` contains committed storage and combinational signals: `IRQ`, `ACCEPT` and `RETURN` at `t` decide transition `t → t+1`.

The extension adds `EI` (0x01), `DI` (0x02), and `IRET` (0x03). Acceptance precedes the interrupted instruction, saves PC/A, and jumps to address 8. `IRET` restores PC/A. A single pending bit coalesces multiple requests; there is no queue or nesting. HALT never wakes, while timer and scan counters continue. RAM[0..7] describes eight display rows; bit x is column x.

The existing Pipeline declares assembly, circuit construction, compilation, explicit stimuli, gate execution, independent integer reference and validators. Its six requested FunctionalGuarantees cause those Calculations to execute. A FunctionalGuarantee is a declared relationship with executable checking; successful primitive relationships alone do not establish interrupt behavior.

The `contract/*` Parts contain readable descriptions. Their rules are implemented by fixed validator Calculations; this experiment does not synthesize a controller from arbitrary contract text.

Evidence:

- `run.json`: compact actual observations for the viewer, events, checks, pipeline declarations and source hashes.
- `dual-input.json.gz`: complete primitive trace, execution/seek logs, explicit stimuli and requested horizon for independent JavaScript replay.
- `verification.json`: fresh trace audit, full/delta comparison, directed cases, 24 seeded fast-check cases, and expected failures.
- `wrong-return-input.json.gz`: complete trace of an actual mutant circuit that restores `SAVED_PC + 1`. Its gates and trace audit pass, but context restoration and reference comparison fail at state 37.
- `overload-input.json.gz`: self-contained source, initial state, input schedule, complete trace and comparisons for the three-pulse coalescing case.
- `generated-cases.json`: exact generated inputs and seed for replay. No exhaustive proof or shrinking is claimed.

The overload case sends separate pulses at states 2, 4 and 6. Two handler entries at states 3 and 9 satisfy the declared coalescing policy. An additional requirement Part promises three services by state 16; seeking its actual `fg/every-external-pulse-serviced` runs a counting validator and fails with loss 1. The overload artifact retains both FG closures and results. These failed comparisons are retained by an explicit implementation policy.

This is an ideal synchronous Boolean model. It specifies logical tick behavior, with no physical clock frequency, analog timing or physical video output claim. Source hashes identify exact implementation bytes; they do not establish semantic equality.
