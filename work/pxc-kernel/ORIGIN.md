# Where this came from

The PxC kernel was built in a standalone repo (kernel v0.1 on 2026-10-12 through v0.6, the contest
rounds, the ledger, the flow miner, the DiscStudio and PxCube field tests, and rim fit). This folder is
that repo's tree at commit `e1e43d3`, brought into PageRouter so it lives in main.

- **Full history** (master plus the parked `v0.7-params-wip` branch) is in the git bundle
  `Documents\pxc-kernel-backup\pxc-kernel.bundle` on Sam's desktop
  (SHA-256 `effeba7c59235bfbe76d24f1bf304a039e396146465605220a2067d07a46b4e9`, taken at `5137a9e`,
  one commit before this tree; that commit only made rim fit's paths portable).
  `git clone pxc-kernel.bundle pxc-kernel` restores it.
- **Left out:** the rendered screenshots in `verify/out/` and `patterns/out/` (249 PNGs, about 70 MB
  across their history). They are outputs of the scripts beside them.
- **Known:** `npm test` gives 302 of 305. The three failures are contest tests that still expect
  path-segment typos to pass under `landing: 'none'`; round 6 (`826d49e`) made the kernel reject them.
- The field-test scripts in `patterns/*.mjs` still name the paths they ran with. `patterns/rimfit/` does not
  (see its README).
