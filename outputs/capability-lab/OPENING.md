# Capability Lab quick start

From the repository root, use Node 20 or newer:

- Run product and nested tests: `node outputs/capability-lab/scripts/verify-all.mjs`
- Run the independent source gate: `node work/capability-lab/verification/gate.mjs outputs/capability-lab`
- Run the watch, ML, and explain gates with `watch-gate.mjs`, `ml-gate.mjs`, and `explain-gate.mjs` in that same verification directory.
- Preview locally: `node outputs/capability-lab/serve.mjs 4173`

The immutable candidate archive SHA-256 is recorded in `outputs/capability-lab/evidence/independent/FINAL-COMPLETION.json`; that proof records the fresh delivered archive replay and browser gates. The original candidate ZIP is retained outside this repository.
