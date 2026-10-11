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
