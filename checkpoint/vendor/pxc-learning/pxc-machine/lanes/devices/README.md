# Lane B: a clocked device from gates

This lane extends checkpoint 001's NAND, wire, ideal clocked bit, and FG-aware
executor. `device.py` declares circuits; it never increments a runtime counter
in Python. The independent oracle deliberately uses integer arithmetic.

## The declared contract

- One simulated tick is exactly **1 ms**. This is an ideal clock contract, not a
  measurement of a physical oscillator or browser animation speed.
- `controls[t]` determine elapsed state `t+1`. Reset wins over run. Pause holds
  the elapsed digits; reset clears them. Both leave the independent clock and
  display scanning active.
- Eight BCD digits store `00000.000` through `99999.999` seconds. BCD means one
  decimal digit stored in four bits. The display rolls over after 100,000,000 ms.
- Three chained decade counters divide the ideal 1 kHz input into a one-tick
  strobe at `t=1000, 2000, ...`. This strobe is **1 ms wide** and has a **1 s period**.
- The multiplexed display selects one digit per tick: each digit receives one
  of eight 1 ms slots, so a complete scan lasts 8 ms. This model has ideal
  switching: analog brightness, propagation delay and electrical ghosting are
  outside its contract.
- Segment bits 0..6 mean `a,b,c,d,e,f,g`, active high; bit 7 is the decimal point.
  `BCD0` is the least significant millisecond digit. `SCAN=3` includes the
  decimal point, separating five second digits from three millisecond digits.
- The diagnostic bus `ELAPSED_ROLLOVER` is the **pending carry** from the last
  digit, before the next state transition. `STROBE` is a registered, completed
  event. The two labels intentionally expose different clock boundaries.

## What is composed

```text
NAND + ideal clocked bit
  -> XOR / AND / decoder / mux
  -> 4-bit decimal transition -> decimal register
  -> eight-digit stopwatch + divide-by-10 -> divide-by-10 -> divide-by-10
  -> digit-selection mux -> seven-segment decoder + decimal point
```

Every arrow is a real gate declaration. The core compiles their dependency
closure and primitive validators. A higher-order PxC pipeline then executes
construction, compilation, seeking, independent comparison, and log replay.
The `fg/device-conformance` and `fg/execution-evidence` Parts name the actual
Calculations that produced their validation results.

The resulting BOM is a **declaration count**, not a technology-mapped silicon
area estimate. It includes 1,249 NANDs, 48 clocked bits and 163 wires; 1,460
validator Calculations are listed separately. Shared gate outputs are counted
once by their address.

## Reproduce

```bash
python3 -m unittest discover -s outputs/pxc-machine/lanes/devices -p 'test_*.py' -v
python3 outputs/pxc-machine/lanes/devices/generated_checks.py
python3 outputs/pxc-machine/lanes/devices/truth_tables.py
python3 outputs/pxc-machine/lanes/devices/run.py
```

`run_case(steps, controls, initial_ms=0)` returns an ordinary core trace with
additional independent oracle results and the executed pipeline's declarations
and log. Controls include the unconsumed terminal observation because every
state exposes its input Parts. The separate `steps` obligation detects missing
terminal states; a shortened trace cannot define its own completeness.

`device-summary.json` projects every observed state into named buses and FG
results. `clean-smokelog.json` and `wrong-strobe-smokelog.json` preserve the full
gate values and execution/seek logs with the existing bitpacked Base64 codec.
Packing is lossless transport; the byte digest is an integrity check.

`generated-checks.json` retains 16 fast-check samples plus deliberate decimal
boundary overrides. Full execution and delta execution—the mode that reuses
unchanged Calculation results—are compared at every bit, alongside the
independent arithmetic oracle. These samples are reproducible; this runner
does not claim shrinking or exhaustive input-history coverage.

`component-truth-tables.json` retains 192 measured rows: input, expected output,
actual output, primitive FG summary and an input-bound execution audit. It is
a readable projection; the script reproduces each row's internal gate trace.

## Counterexample: all primitive checks pass, composition is wrong

The deliberately wrong circuit connects the third divider's pending carry
directly to the strobe. A carry at `t=999` says that the **next transition** will
complete 1,000 ms. A delay is required to expose that completed event at
`t=1000`. Removing it moves each pulse one tick early.

The wrong circuit's NAND and wire truth tables still hold. Its unchanged
device timing FG must fail. **Because pending carry and completed pulse refer
to different states, try putting the state boundary back into the composition.**

This is also why measuring only the interval between pulses is insufficient:
the wrong circuit still has a 1,000 ms period. Its phase—the position of each
pulse relative to the clock's origin—is wrong.

The mutation also removes one clocked bit: 48 becomes 47, while declared wires
increase from 163 to 164. With an objective of minimizing clocked storage and
an equality contract that observes only the 1,000 ms period, that implementation
would qualify as an optimization. Under the required contract that also
observes phase against `t(0)`, it fails. This is a concrete reason for the FG to
declare the equality seam before a compositor optimizes the BOM.

Measured over `t(0)..t(2001)`, the correct pulse states are `[1000, 2000]`; the
mutant's are `[999, 1999]`. Each has zero primitive FG failures. The composed
device FG reports zero losses for the correct circuit and four for the mutant:
an unexpected pulse followed by a missing pulse, twice. Both complete traces
are retained, including the wrong observations.

## Coverage boundaries

- Exhaust all 64 single-digit state/enable/reset transitions, including invalid
  decimal states 10..15. Enabled invalid digits recover to zero; pause holds
  them; reset clears them; invalid digits never emit a carry.
- Exhaust all 16 digit encodings at every one of eight scan selections.
- Exercise reset, pause, `999 -> 1000`, and full eight-digit rollover.
- Seek all states of two full strobe periods and compare the 16 behavior buses
  and state identity to the independent oracle. The separate input-bound audit
  checks requested controls; unit cases check their bus labels and pending
  elapsed rollover. This is finite temporal evidence,
  not a proof of all possible future input histories.
- Preserve a wrong composition with passing primitive checks and failed
  temporal checks. No observation is silently dropped to make the result pass.

The initial failed counter test is retained in `test-red.txt`.
