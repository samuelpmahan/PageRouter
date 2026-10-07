# Parity fix: one assembly path

The workflow now calls `node local/ci.mjs --staged staging`, using the same
`build()` pipeline as local preview. Its matrix packages are verified and
imported without executing their build commands again. Both paths supply the
NTC work/type/build snapshot, work board, run record, and `receipt.json` links.
The existing extended `pxcube-receipt.json` remains available.

Validation on top of d02e7a7:

- 21 local tests passed, including matching local/matrix NTC snapshots, retained
  producer receipts, no duplicate builds, missing/corrupt artifact isolation, and
  distinguishing a usable partial site from a fatal assembly failure.
- 42 crisp checks passed.
- Reassembled all five packages previously downloaded from actual Pages.
  All 103 verified chunk hashes and all five original receipt values survived.
  The resulting site contains five work items, five tidy types, five successful
  build results, `neat.html`, and `pxcube-run.json`.
- Eight NTC browser checks passed on that reassembled site, with zero page
  errors: real work/type/build/receipt inspection, owner identity retention,
  separate test mounts, narrow layout, and non-destructive build notification.
- Workflow YAML parses. The revised workflow still requires execution on GitHub;
  this evidence does not claim that the public deployment has changed.

Missing or invalid Experience artifacts remain failed while healthy siblings can
ship. `site-ready` is emitted only after a fresh site exists; fatal assembly errors
cannot deploy stale output. Browser-test deployment policy and human promotion
are unchanged.

See `summary.json`, `unit-tests.log`, `crisp-tests.log`, `browser-results.json`,
and the screenshots beside this file. The original live parity gap is preserved
in `../d02e7a7/`. Local and independent CI runs retain their own run IDs and timings.
