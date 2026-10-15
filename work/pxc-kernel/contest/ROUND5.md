# Contest round 5: migrate to kernel v0.5

Your round-4 friction drove v0.5. Before you start, read:

- `KERNEL.md` (v0.5);
- `ledger/necessity.jsonl` seq 44–52, which also lists what was deferred or declined, and why;
- `test/kernel-v05.test.mjs`;
- `verify/V05.md`.

## What changed

- **Inherited skips.** A step that reads the output of a skipped step, in its bindings or its `when`, is skipped too. Its decision records the original cause, so you write a guard once. `returns` still needs `first` or `one`.
- **`else`.** `when: { else: ['a', 'b'] }` makes the complement derived, never typed. Its provenance names each step and what decided it.
- **`one` lint.** `{ one }` fails at assembly when an alternative is unconditional, or when one alternative's condition implies another's.
- **Specificity first.** The order is now:
  1. path fill;
  2. slot fill;
  3. `contract#*` fill;
  4. slot select;
  5. contract fill;
  6. contract select.

  A seat's own `select` is a pin that no contract fill (including `prove`'s) reaches. `receipt.fillConsulted` lists the fill keys that were actually used.
- **A path fill must land.** Some call in the run, or anywhere in the drive, has to use it; otherwise it is `BAD_FILL`. Flat slot keys stay standing configuration.
- **Examples over time.**
  - `each`: inputs per tick.
  - `trajectory`: outputs per tick, each tick checked.
  - `startTick`.
  - `tick`: a calculation run at that tick.
- **Fixes.**
  - Literal operands keep their value in a test's provenance.
  - `node.drives` says `until` when `until` held on the last allowed tick.
- **View.**
  - An `at` into a gathered value draws only the pieces it selects, labelled with their path. That removes the "pieces ×N" walls.
  - Long expressions and errors break across lines.
  - Test expressions show short operand values.
  - `traceToSvg(..., { receipt })` prints the run's fill and marks keys that were not consulted.

## Red tests at the start (each asserted what v0.5 changed)

| Entry | Red tests |
|---|---|
| C | 16, 17, 21 (file order) |
| E | 21, 32, 56, 58, 60, 62, 65 |
| F | 31 |

B and D have none. Flip them as before: keep the scenario, rename the test to say what now holds, and don't delete it.

## Do

Use the same steps as round 4:

1. Remove workarounds that v0.5 makes unnecessary. Count, before and after:
   - restated guards;
   - typed complements;
   - pins or fills that existed only to dodge precedence;
   - hand-kept trajectories outside `prove`.
2. Use `else`, inherited skips, `contract#*`, temporal examples and the receipt fill line where your domain wants them.
3. Re-render and re-shoot every picture. Write each claim before you look, then record PASS or FAIL, and say whether the claim, the picture or the kernel was wrong.
4. Add a Round 5 column to `EXPLAIN.md`, and add new claims.
5. Update `FRICTION.md`.
   - Give a status and evidence for each earlier point.
   - Add new friction with its Hegel/Wittgenstein line, especially friction with inherited skips, `else`, specificity and path landing.

Rules: as before. Touch only your own files, do not run git, and end with your entry green.

## Final message

Use the same format as round 4, plus the before/after counts from step 1.

Then add one more item: looking back over five rounds, the single kernel concept that most changed how you would write your domain from scratch, and the one you would remove if you could.
