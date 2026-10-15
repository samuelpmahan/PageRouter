# Contest round 6: migrate to kernel v0.6

Your round-5 friction drove v0.6. Before you start, read:

- `KERNEL.md` (v0.6);
- `ledger/necessity.jsonl` seq 53–59, which includes your retrospective removal votes (seq 58, declined, with reasons) and what was deferred;
- `test/kernel-v06.test.mjs`;
- `verify/V06.md`;
- `verify/AUDIT.md` with `verify/AUDIT-RESPONSE.md`.

The audit is new. An independent agent checked the kernel's own pictures against their claims, refuted 3, and found view defects that are now fixed: unique gutter lanes, separate decision lanes, verdict marks kept in headers, and cache-hit decisions resolved in the original's scope. Your pictures will change because of those fixes.

## What changed

- **Inherited runs are recorded.** A step that runs because what it reads ran now records `ran` with the producer's cause, so both sides of a condition leave the same rows.
- **`else` and alternatives inherit context.**
  - `else(A)` is skipped when A was skipped by inheritance. A finished game does not forfeit.
  - A `first` or `one` inside a step binding whose every option was skipped now skips the step instead of failing with NO_BRANCH.
- **What chose what, and where fills landed.**
  - `node.chosenBy = { rung, key }`.
  - `receipt.fillReach = { key: [call ids] }`. Cache hits count as their hit node.
- **`landing`.** `run` and `drive` take `landing: 'path'` (the default), `'all'` (every key must land), or `'none'` (a sweep may miss). Typos still fail in every mode.
- **Examples.** Examples take `name`. A failing trajectory tick ends with `(inputs …)`.
- **View.**
  - `else(a, b)` prints short, with its causes drawn as edges.
  - One line per cached verdict.
  - Collected pieces name their tick: `gather[2]←@2`.
  - The precedence rung shows on the implementation line (`by pin …`), or as a `⚑` row when the line is full.
  - Every gutter edge has its own lane.
  - The fill line shows reach (`@ #ids`).

## Red tests at the start

Each of these asserted what v0.6 changed:

| Entry | Red tests | What changed |
|---|---|---|
| B | 39 | a busy tick now records its inherited runs |
| C | 15, 18 (file order) | inherited runs are recorded |
| E | 32, 63, 64, 67 | the `after` row; inheritance through `one`; `else` context; ply decision counts |
| F | 31 (file order) | `regret` now records a `ran` decision |

D has none. Flip them as before.

## Do

Use the same steps as round 5:

1. Remove workarounds that v0.6 makes unnecessary, and count them before and after:
   - trace scans that compute what `fillReach` now answers;
   - guards kept only because of the `one` or `else` gaps;
   - `allowUnusedFill` used where `landing: 'none'` says what you mean.
2. Use `chosenBy`, `fillReach`, `landing` and named examples where your domain wants them.
3. Re-render and re-shoot every picture.
   - Write each claim before you look, and record PASS or FAIL for every claim. The audit found unrecorded claims; don't leave any.
   - Check edge claims in a crowded margin by zooming: crop with PIL and enlarge.
4. Add a Round 6 column to `EXPLAIN.md`, plus new claims.
5. Update `FRICTION.md` with statuses and new friction, each with its Hegel/Wittgenstein line.

Rules: as before. Touch only your own files, do not run git, and end with your entry green.

## Final message

Use the same format as round 5, with the before/after counts from step 1.

Then add one more item. Name the one place where the kernel's picture of your domain and your domain's own picture of itself still disagree most, and say what a reader of your pictures would get wrong because of it.
