# BuildBag: tidy → crisp → sandbox

The only BuildBag-specific source authored for this addition was its definition
in `.tidy/manifest.json`. From the PxCube repo root:

    node crisp/bin/crisp scaffold pxcube-build-bag

Crisp produced `experiences/build-bag/` (six files plus `generation.json`).
`packaging.json` includes the generator's input/template/output hashes and a
check that all six generated files still match those original hashes. It also
retains the actual local preview's package receipt with the tidy input digest.
The existing program discovered the folder and assembled five successful apps.

- `unit.txt`: 19 passing Node tests, including existing fixtures/retention and
  the new provider, reproducible generator, no-overwrite, alternate id,
  live-manifest change, failed-build and CLI-through-launcher checks.
- `browser-results.json`: 21 checks on a fresh temporary workspace generated
  through the crisp CLI, packaged through the same program and served at both
  `/` and `/PxCube/`. The browser reads/writes the actual mock owner; it checks
  isolated iterations, reload retention, output absence, and storage failure.
- `launcher-regression/` and `studio-regression/`: existing browser checks run
  against the real local artifact that includes BuildBag.

The browser fixture uses different descriptive copy from the actual BuildBag
manifest; its generated source/template is the same. Screenshots are local,
ignored by Git. Evidence records a local working-tree candidate; its source
hashes identify the tested code even where the recorded HEAD precedes the commit.
The GitHub Actions job is wired to run the new E2E test but has not run remotely.

The scaffold's only editable operation is the existing mock scratch write for
a bag name. The planned domain bag output is absent. It makes no claim that
BuildBag's selection, ordering, or Bag publication is implemented, reviewed, or
promoted. No upstream neat/tidy source or promotion behavior was modified.
