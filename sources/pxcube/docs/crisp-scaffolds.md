# Define in tidy; generate and build through crisp

BuildBag is the first generated Experience in this local Node path.

```sh
node tidy/manifest.mjs pxcube-build-bag
node crisp/bin/crisp scaffold pxcube-build-bag
node crisp/bin/crisp package experiences/build-bag
node local/run.mjs dev
```

The scaffold command is for an absent destination; it refuses existing work.
The checked-in BuildBag files were produced with that command. To make another
Experience, add another type with an `experience` definition to tidy and invoke
crisp with its type name. No launcher entry or per-Experience workflow edit is
needed. `--root <repo>` supports generation from outside the destination repo.

The `sandbox@1` template creates six files plus `generation.json`: HTML, JS, CSS,
a build entry point, a README, and a tidy reference. Generation records the
template, input and initial output hashes. Those hashes document its origin;
they do not prevent someone from developing the generated code.

During packaging, crisp resolves that reference through tidy's provider. The
local/CI program snapshots the manifest along with source and shared tools.
The input digest participates in the source identity and appears as
`manifestSource` in the package receipt. Earlier builds keep their own snapshots.
Changing a tidy definition changes the next build; no regeneration is required.

BuildBag's scaffold has a shelf input, three planned steps, a bag-name draft,
and a planned bag output. The shelf is the existing two-disc mock seed, not the
user's live shelf. Saving a name writes the actual `sc.draft` value through the
existing mock mount owner. It does not select discs, create a domain Bag, or emit
Calculation receipts. These are the seams to fill next.

Interactive work lives at `mock.build-bag.*`; a test sandbox receives
`mock.build-bag.<iterator>.*`. Reload restores prior values. Failed storage is
visible; the guarded resolver refuses sibling addresses. Same-origin JavaScript
is trusted, as in the existing Experience sandboxes.

Verification:

```sh
node --test local/test/*.test.mjs
node local/test/scaffold-browser.mjs
```

The browser test needs Playwright (override with `PLAYWRIGHT_MODULE`) and Chromium
(optionally `CHROME_BIN`). CI installs the pinned test runner. It creates an
empty test workspace, generates the app through the actual crisp CLI, packages
it through the shared pipeline, and exercises the launcher under `/` and a
Pages-style `/PxCube/` prefix. It preserves interactive/test state across Back
and reload, checks the actual object values and planned-output absence, and
checks failure when storage cannot retain a write.

The original tidy CLI and neat sources are unchanged. Their existing checks
still run. This adds the manifest-to-crisp build seam without deciding what tidy
will eventually promote together.
