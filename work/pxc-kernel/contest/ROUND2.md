# Contest round 2: migrate to kernel v0.2

The kernel changed because of your friction reports. Read `KERNEL.md` (v0.2) and `ledger/necessity.jsonl` seq 9–23 to see which of your points drove which change. `test/kernel-v02.test.mjs` and `verify/render-v02.mjs` show each new concept working.

Kernel v0.2 currently turns 14 contest tests red. Every one of them asserted the old buggy behaviour: cache poisoning, a stale cross-run `from`, the oneOf lint, a check with no kind, or a throw with no trace.

## Do

1. **Fix the red tests.**
   - Rewrite each test that asserted a kernel bug so it asserts the fixed behaviour. Keep the scenario; flip the expectation. Rename it from "KERNEL BUG/GAP/surprise" to say what now holds.
   - Do not delete them. They are now regression tests for the fix.
2. **Remove workarounds that v0.2 makes unnecessary**, using the new concepts where they fit your domain.
   - Examples: slots instead of seat-specific contracts; `gather` instead of packing contracts or `computed` objects; `kind: 'tick'` + `drive` instead of hand-threaded state and tick fields; `kind: 'check'` for verdicts; cross-run Refs instead of scanning `runs()`; dropping `pure:false` that only existed to dodge the cache bug. Randomness now marks impurity automatically.
   - If a workaround should stay, say why.
3. **Re-render and re-shoot every picture, and look at each one again.** Add new pictures where a new concept now shows something the old one couldn't (a drive strip via `driveToSvg`, slot names in a trace, gather labels, output brackets, a red check box).
4. **Update `EXPLAIN.md`.**
   - Add a "Round 2" verdict column (PASS/FAIL from what you saw in the new PNG), and new claims for anything new.
   - Where a picture changed, say what changed in it, specifically.
5. **Update `FRICTION.md`.**
   - Mark each round-1 point Resolved, Partly resolved, or Open, with the evidence (test name or PNG and where to look).
   - Add any new friction v0.2 introduced or exposed. That includes friction with the new concepts themselves: a slot, gather, tick or check that didn't fit how your domain wanted to use it. That kind of friction is the most valuable output of this round.

## Same rules as round 1

- Do not edit `src/`, `KERNEL.md`, `ledger/`, `test/kernel-*.test.mjs`, `contest/a-numeric/`, or another entry's files.
- `cd /root/pxc-kernel && node --test test/*.test.mjs` must end fully green for everything, including other entries' tests that you did not touch. If another entry's test is red, leave it and report it.

## Final message

Reply with:

- the full-suite summary line;
- the tests you flipped (old name → new name);
- the workarounds removed and the ones kept, with reasons;
- the claims table summary for round 2;
- the friction points with their new status;
- any new friction, especially with slot, gather, tick, check or drive.
