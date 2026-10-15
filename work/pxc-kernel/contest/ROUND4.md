# Contest round 4: migrate to kernel v0.4

Your round-3 friction drove v0.4. Before you start, read:

- `KERNEL.md` (v0.4);
- `ledger/necessity.jsonl` seq 34–43, which says which of your points drove which change and which were deferred, and why;
- `test/kernel-v04.test.mjs`;
- `verify/V04.md`.

## What changed

- **Conditions are relations.** `when` and `ctx.when` accept tests built from specs or Refs:
  - `{not}`, `{and}`, `{or}`;
  - `{eq}`, `{ne}`;
  - `{lt}`, `{le}`, `{gt}`, `{ge}`.

  `ctx.test` returns a boolean Ref, and its provenance names every operand. `and` and `or` short-circuit.
- **Branches.**
  - `{one: [...]}` chooses exactly one alternative, and fails with `AMBIGUOUS_BRANCH` if several are live.
  - `first` takes a single alternative.
  - A skipped piece makes its gather, concat, at or test skipped.
  - A step under `{and: [A, ...]}` may read steps that are guarded by A.
- **Named branches.** `ctx.when(cond, label, {true: 'name', false: 'name'})` records which branch ran and which was skipped.
- **Path-qualified slot fills.** For example, `'adder.ripple4#hi/adder.full#bit2'`. The longest path wins, and the cache stays correct.
- **`ctx.drive` additions.**
  - `collect: ['port']` returns one gathered Ref, with each element pointing at its tick's call.
  - Zero ticks returns the input state.
  - `startTick` works on both drives.
  - `node.drives` records how many ticks ran and why the drive stopped.
- **Cache hits carry decisions.**
- **`world.node` is indexed.**
- **`x-` annotations** are allowed on port schemas.
- **View.**
  - Test expressions, with edges to every operand.
  - Identical decisions merged into one row.
  - Drive rows (`⟳`).
  - Text stays inside boxes and titles.
  - `← run r #c`.
  - Labels read target ← source.
  - Cached verdicts name their check.
  - Drive strips show the origin run and ✓/✗ counts.

## Do

The red tests at the start are B 28 and 36, and E 162. Each asserted the old skip trap or the old first-needs-two rule. Flip them as before: keep the scenario, rename the test to say what now holds, and don't delete it.

Then follow the same steps as round 3:

1. Remove workarounds that v0.4 makes unnecessary.
   - Helper contracts that exist only to emit a boolean are the main target. Count them before and after.
   - If a helper should stay, say why.
2. Use path slots, `one`, `collect` and `startTick` where your domain wanted them.
3. Re-render and re-shoot every picture. Write each claim before you look, then look with Read and record PASS or FAIL. Say whether the claim or the picture was wrong.
4. Add a Round 4 column to `EXPLAIN.md`, and add new claims for anything new.
5. Update `FRICTION.md`.
   - Give a status and evidence for each earlier point.
   - Add new friction with its Hegel/Wittgenstein line.
   - Report especially friction with the new concepts themselves: tests, `one`, path slots and `collect`.

Rules: as in `ROUND3.md`. Touch only your own files, do not run git, and end with your entry green.

## Final message

Use the same format as `ROUND3.md`, plus one more item: the before/after count of helper contracts and lines that v0.4 removed from your entry.
