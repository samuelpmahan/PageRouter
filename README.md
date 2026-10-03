# PageRouter × PxCube Composed Workbench

Candidate 0.0.0 · site build 79a3faea165817ad13de3a46c27488743cbd7635acdcd24f3161ca859feedc92

This release adds an HH style playground that uses PxC Parts and fixed Calculations with fast-check 4.10.2. It generates six reproducible style variants from a seed inside visible hue, card-padding, grid-gap, and radius bounds. Selecting a variant applies fixed CSS custom properties; keep, restore, reset, and JSON export are available. The playground changes styling only and does not execute arbitrary JavaScript or alter teacher data.

The workbench also retains the Game Boy cartridge picker, plain Connect Four baseline, same-rules PxC + `seek(tree)` port, and ochre high-contrast yellow discs.

Immutable owner-private source checkpoint: https://drive.google.com/file/d/1wGQ-QrpNpXgHCF8EAVQQ0XUaVW0UUOov/view?usp=drivesdk
Archive SHA-256: cebb70063c46bb696f3709119a12588d4c702baa7c1da354d1628015b62642b9
Source commit: 854e271da06087dc798422328b2eaac921625277
No Drive permissions changed.

Verification: 54/54 integrated Node tests passed; focused style tests passed; the fast-check browser bundle is self-hosted and hash-pinned. The Pages deployment artifact contains 692 compiled files and is hash-verified before deployment. The HH evaluator implementation pin remains af0c2e0f2a17e2f7d3e81f0f119e8b4401a3683c322c764fb7bd3e61bad53492.

Candidate 0.0.0 is not a human contract milestone. See `artifact.json` and `SOURCE-CHECKPOINT.json` for exact immutable build/source identities.
