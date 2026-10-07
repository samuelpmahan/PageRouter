# Deployed parity — bed04fc

**Pass:** the local and actual Pages artifacts agree on Experience bytes,
definitions, work items, tidy types, package outcomes, and available inspection
surfaces. Independent run identities and build timings remain distinct.

Fast-forwarded main from d02e7a7 to
`bed04fc9697623e02683ee52154b9b1189fa8855` without switching the shared checkout's
`codex/local-pages` branch. [Run 34900941989](https://github.com/samuelpmahan/PxCube/actions/runs/34900941989)
completed successfully: all 10 jobs, including deployment.

Compared http://127.0.0.1:4321/ with
https://samuelpmahan.github.io/PxCube/:

- All 103 Experience chunks match byte for byte and verify against their
  deployed crisp receipts. All five manifest contracts now match, including
  BuildBag's Exp track.
- Both artifacts retain five work items, five tidy types, and five successful
  build results. Full work/type/manifest snapshots and package outcomes match
  after normalizing only assembly run IDs and measured build durations.
- Both expose five receipt accordions. Every package's receipt is available.
- `neat.html` returns 200 and is byte-identical. `pxcube-run.json` returns 200;
  its own run identity and measured durations differ as expected.
- The shared shell JavaScript and CSS match; both record source commit bed04fc.
- All eight NTC browser checks passed against actual Pages with zero page errors:
  work board and receipt links, manifest and build inspection, retained owner
  identity, separate test mounts, mobile layout, and explicit build refresh.

`byte-results.json` retains raw comparisons, including `ntcStateMatches: false`
for literal run-identity equality and `ntcSemanticParity: true` for the specified
semantic comparison. The differing identities were not erased from the evidence.
See `workflow.json`, the two state snapshots, and `ntc/browser-results.json`.

After verification, Sam's open local tab still showed an earlier two-card build
and the “New build ready · reload” control. Clicking that control loaded bed04fc;
the actual tab then displayed all five Experiences. The server had retained them
throughout. No Experience or user data was removed.

The audit runner now accepts `PXCUBE_EVIDENCE_DIR` and `WORKFLOW_RUN_ID`, allowing
the same check to preserve each deployment's evidence instead of overwriting the
previous run. Raw downloaded files and screenshots stay local and are ignored
by Git. Production source was unchanged during this final verification.
