# Contest round 3: migrate to kernel v0.3

The kernel changed because of your round-2 friction. Read:

- `KERNEL.md` (v0.3);
- `ledger/necessity.jsonl` seq 24–33, to see which of your points drove which change;
- `test/kernel-v03.test.mjs` and `verify/render-v03.mjs`, which show each concept working;
- `verify/V03.md`, which shows how the pictures were checked.

## What is new, in one line each

- **Tick dependency.** `ctx.tick()` is a cache dependency, not impurity, and the call around a drive stays cacheable.
- **Slot language.**
  - A slot fill key must be declared or consulted, otherwise `BAD_FILL`.
  - A slot is declared by `uses: ['contract#slot']` or by a composition step's `slot`.
  - A drive validates its fill across all ticks.
  - An implementation that declares slots of a contract may call only those slots (`UNDECLARED_SLOT`).
  - `select(contract, impl, slot)`.
- **Cache hits carry verdicts.** A cache hit carries its subtree's verdicts, and `receipt.verdicts` includes them marked `cached`. Failed receipts keep the verdicts finished before the throw.
- **Addressing.** `world.node(run, call)` and `world.ref(run, call, port)`.
- **`ctx.concat` and composition `{concat}`.**
- **`ctx.drive(tick, args, {ticks|until, each, slot})`** inside an implementation. Each tick is a child node with `tick: k`.
- **Branching.**
  - Composition steps take `when`, read through `{first: [...]}`.
  - `ctx.when(boolRef, label)` records decisions with provenance.
  - A skipped step leaves no node and a `skipped` decision.
- **Examples** take `fill` and `ticks`, and implementations take their own `examples`.
- **Smaller additions.**
  - Check steps are exempt from the unused-output lint.
  - `replay(receipt, {maxCalls})`.
  - `ctx.fault(message, code)`.
- **View.**
  - Decision rows with amber edges.
  - `@k` tick tags.
  - `expand` (ghost boxes for a cache hit's original subtree).
  - Grouped pieces.
  - Rows wrap inside their boxes.

## Do

1. **Fix your red tests.** The suite is 164/171. The 7 reds each asserted a v0.2 bug or gap that v0.3 fixes:
   - B: tests 22 and 29;
   - C: test 41;
   - D: tests 56 and 57;
   - E: tests 89 and 118.

   Keep the scenario and flip the expectation. Rename the test to say what now holds. Do not delete it.
2. **Declare your slots** in `uses` where your implementations call slots. Then a typo in a fill fails, and the slot list is part of the implementation's interface.
3. **Remove workarounds that v0.3 makes unnecessary**, and use the new concepts where they fit your domain. Examples:
   - `ctx.drive` instead of a hand loop over ticks inside an implementation;
   - `when`/`first` or `ctx.when` instead of an untraced `if` that decides which call happens;
   - `concat` instead of gathering `at` pieces by hand;
   - `world.ref` or `world.node` instead of scanning `runs()`;
   - implementation examples instead of examples kept outside the kernel.

   If a workaround should stay, say why.
4. **Re-render and re-shoot every picture, and look at each one with the Read tool.** Add new pictures where v0.3 now shows something it could not before:
   - a decision row;
   - a ghost-expanded cache hit (`expand: (n) => world.node(n.cachedFrom.run, n.cachedFrom.call)`);
   - `@k` children of a `ctx.drive`.

   Write each claim down before you look, then record PASS or FAIL from what the picture shows. If a picture contradicts a claim, decide which one is wrong and say which.
5. **Update `EXPLAIN.md`.** Add a "Round 3" verdict column, new claims for anything new, and where a picture changed, what changed in it.
6. **Update `FRICTION.md`.**
   - Mark each earlier point Resolved, Partly resolved, or Open, with evidence (a test name, or a PNG and where to look in it).
   - Add the new friction v0.3 introduced or exposed, especially with slot declaration, `when`/`first`, `ctx.when`, `ctx.drive`, the tick dependency, and `concat`.
   - For each new point, add one line: "Hegel would say … / Wittgenstein would say …". That is, what a concept that contains its own other would want, versus what the actual use in your domain shows. Use it to sharpen what the kernel should do, not as decoration.

## Rules (same as before)

- Do not edit any of these:
  - `src/`, `KERNEL.md`, `ledger/`;
  - `test/kernel-*.test.mjs`;
  - `contest/a-numeric/`;
  - `verify/render-v0*.mjs`;
  - another entry's files.
- Your files are:
  - `contest/<your-entry>/*`;
  - `test/contest-<your-entry>.test.mjs`;
  - `verify/render-<your-entry>.mjs`;
  - your PNG/HTML outputs in `verify/out/`, named with your entry's prefix.
- `cd /root/pxc-kernel && node --test test/*.test.mjs` must end fully green for your entry. Other entries are migrating at the same time, so their tests may be red mid-way. Report those reds; do not touch them.
- Do not run `git` commands. I commit.

## Final message

Reply with:

- your entry's test summary, and the full-suite summary line;
- the tests you flipped (old name → new name);
- the workarounds removed and the ones kept, with reasons;
- the round 3 claims table summary, including any picture that contradicted a claim;
- each friction point with its new status;
- the new friction, with its Hegel/Wittgenstein line;
- the one kernel change you would most want next, and the evidence for it.
