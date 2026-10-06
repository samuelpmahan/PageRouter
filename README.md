# PageRouter × PxCube Composed Workbench

Candidate 0.0.0 · site build d0d44d43dc42aaada0ae4ac146d4c6d679dcd91a6f05fac16ddc03c70c6e22cb

This repair fixes the HH style playground import in the assembled site. The source assembly recipe now points the copied adapter at its colocated `services/style-playground.mjs`; a regression check follows the built HH entry's local imports so this path cannot silently break again. The existing bounded style behavior and evaluator implementation pin are unchanged.

The workbench retains the HH synthetic teacher preview, PxCube experiences, Game Boy Connect Four cartridges, and Justin's standalone technical snapshot.

Owner-private source checkpoint: https://drive.google.com/file/d/19pmwn3CjvZ401EFF5MetGmZ0EXEniYPI/view?usp=drivesdk
Source archive SHA-256: ac15948543630e27f1f2abe8c71758ab01421233665048582d2ab4667bff3920
Base source commit: 854e271da06087dc798422328b2eaac921625277
Drive sharing was not changed.

Local verification: 55/55 Node tests passed, including the new built import check. Headless Chrome loaded `#/hh/run`, loaded the direct HH fixture, and generated six style variants without page errors. The Pages artifact contains 692 compiled files and is hash-verified by `deploy-materialize.py`. The HH evaluator implementation pin remains af0c2e0f2a17e2f7d3e81f0f119e8b4401a3683c322c764fb7bd3e61bad53492.

Candidate 0.0.0 is not a human contract milestone. See `artifact.json` and `SOURCE-CHECKPOINT.json` for exact build and source checkpoint identities.