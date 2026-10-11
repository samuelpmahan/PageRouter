# PolicyBench × Tac-x-Tic (exp/policybench)

Policy-driven games on the PxC kernel. Tac-x-Tic is the reference game: an outer 3×3 board of inner boards; each GO both
players commit a plan for staying and for switching (a switch marks blind on arrival). The interesting decision is how a
policy splits its budget between planning (simulator units) and memory (metered slots) under uncertainty.

- `tac-x-tic/` game rules, baseline policies, `capabilities.mjs` (contracts, implementations, checks), `contrib/` authored policies
- `pxc/` capability graph and a match composed as PxC Parts (`state/n`, `obs/n/<seat>`, `plan/n/<seat>`, receipts = provenance);
  imports this repo's existing kernel (`sources/pxcube/vendor/studio/part-first-kernel/src/pxc.mjs`), no new copy
- `core/`, `engine/`, `policies/` contracts, the reference engine (equivalence-tested against the PxC version), shared policies
- `cli/` headless match, experiment runner, ledger
- `policybench.test.mjs` runs in `npm test` (so in CI on every push): PxC == engine GO for GO for every pairing,
  structural simultaneity/provenance, and every implementation proving its contract

The `.mjs` modules here are generated from the TypeScript source (D:/t-t-1, `node tools/emit-pagerouter.mjs`); the test is authored here.

Headless match (from checkpoint/): `node exp/policybench/cli/match.mjs planner scout --rules clash=seeded-coin`

## Flick Puck (`flick-puck/`)

Second game, owner's design: a board split by a centre wall with a gap, 5 discs per side, flick any of your (slow enough) discs any time, empty your side to win. Real time is sliced into GOs of fixed physics steps; physics is integer-only (fixed point, frozen sine table, exact integer sqrt) so matches replay bit-exactly. Rules: gap, discs, flicks per GO, steps per GO, seeded aim noise, friction, grab speed. Policies: sniper, spray, patient, planner (simulator). The engine and PxC driver needed no changes. `flick-puck.test.mjs` checks replay, PxC == engine, integer state, and rule validation.

Headless: `node exp/policybench/cli/flick.mjs match planner spray --rules aimNoise=4` or `... robin --seeds 5`.
