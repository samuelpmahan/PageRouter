# Generated Experience scaffold

`experience.json` names the tidy type. Tidy supplies its current manifest to
crisp at every build, including labels, inputs, planned outputs, and steps.
`generation.json` records the manifest/template digests and initial file hashes.
It is origin evidence, not a requirement to keep these files unchanged.

Fill in `app.mjs`, `index.html`, and `style.css`. `build.mjs` uses crisp's shared
assembly function. Run `node crisp/bin/crisp package experiences/<id>` from the
repo root, or use the existing local/CI program to assemble the whole launcher.

The scaffold reuses the owned mock-world implementation. Interactive work uses
`mock.<id>`; New test sandbox allocates `mock.<id>.<iterator>`. It retains draft
edits, earlier tests, and change history. Declared outputs are planned; generating
the frame does not execute domain Calculations or create a bag. The inspector
shows real mock values, not P&C Calculation receipts.

The frames are trusted same-origin apps with separate storage keys and guarded
resolvers. They are not a security boundary against hostile JavaScript.
