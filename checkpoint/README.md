# Composed Workbench: Page Router × PxCube

Complete browser-local layered aggregation of actual pinned PxCube experiences,
HH C6 fixture functionality and Justin's independently runnable static leaf.

## Reproducible local build

Use Linux, Node **24.19.0**, Python 3, npm and Bazel **7.4.1** (or Bazelisk,
which reads `.bazelversion`). From this directory run:

```sh
bash ci/bazel/run.sh
# If Bazel is installed elsewhere:
BAZEL=/path/to/bazel bash ci/bazel/run.sh
```

The preparation step installs exact `package-lock.json` dependencies with
`npm ci --ignore-scripts` into private build tools. Bazel `//:site` declares the
source/dependency files and writes `bazel-bin/site.site`, `site.evidence`,
`site.receipt.json` and `site.log`. It copies inputs into isolated staging,
refreshes fast-check, compiles neat and all authored PxCube experiences, assembles
the site, verifies crisp delta/clean equality, runs the `npm test` suite against
fresh output and checks built Atlas imports. A failed package or historical
shipped-byte fallback fails the build. The output verifier checks every emitted
site file against its SHA-256 receipt, including after a Bazel cache hit.

Historical `dist/`, package caches and generated build evidence are excluded
from compilation inputs. Your checkout is not rewritten by compilation. Host
Linux shared libraries support the copied, declared Node/shell/cp/mkdir tools;
this is not a fully hermetic operating-system toolchain. Dependency acquisition
occurs only during preparation; compilation itself performs no downloads. The
Bazel configuration disables sandbox networking where Linux namespaces are
available. Restricted environments can fall back to processwrapper staging,
which isolates files but does not enforce network isolation.

For a local static preview:

```sh
python3 -m http.server 4188 --directory bazel-bin/site.site
```

The top-level GitHub Actions workflow uses the same Bazel target, builds pull
requests without deploying, and deploys successful main builds to GitHub Pages.
It detects this `checkpoint/` layout and a future root `package.json` layout.
When moving the checkpoint contents to root, keep its Bazel files, `ci/`,
`.nvmrc`, `.gitignore`, and mirrored `.github/workflows/deploy-pages.yml` together.
The split compiled transport remains for separate later cleanup; Actions no
longer consumes it. The source archive manifest records the original import,
not the current edited source identity; the build receipt records current inputs.

The existing npm scripts remain available for manual development. Browser smoke
scripts are optional and are not included in this source build target.

## Ownership and provenance

- `vendor/pxcube-checkpoint` is the exact verified Drive scene-worlds archive:
  ID 1I6WvjsJy_9d110E4wRccY9QZC8_tq1KQ, SHA256
  7a82d9f4a22756bcff0fd0175975410cf2477f2ab1c223273fa1d73b6a174df1
- `vendor/hh`: C6 browser-preview source at
  7462b8a200a6022b1882135ba97ddf37c20c5568, Drive archive
  1U1YBFvEOmJG-ZHVZnBr7TogjsLmWXoNz
- `vendor/justin`: technical mirrored static snapshot, upstream
  EngSmallz/BrundageForCommunity 9fccd18d3077a30f70c26824981fd11718bd761b
  plus previously materialized assets/Tailwind dependency. Build localizes the
  dependency URL and redirects the broken hero.jpg asset to the existing pinned
  portrait. No campaign prose or outreach work is performed.
- Historical PageRouter source recovered at samuelpmahan/PageRouter
  5cc1ae3d8d4d3c14074829c48118d1e70912b6dd. Original A/B comparison is retained
  unchanged; `src/project-router.mjs` is the explicit new outer adaptation.

Existing **neat** owns lifecycle and human acceptance; **tidy** registers;
**crisp** builds/verifies/packages. Their existing launcher/board are included.
No competing lifecycle tracker is introduced. The annotation example now has a bounded, inspectable FunctionalGuarantee contract; no universal FG semantics are claimed.

## How new surfaces fit existing machinery

The recovered `local/affected-targets.mjs` already hashes declared experience,
shared tool, Studio and composed-base inputs into packageKey. Its original
`local/run.mjs` reuses verified immutable packages or executes crisp on a cache
miss, stages all outputs, checks neat/tidy and generates the full launcher.
That path is retained unchanged in the isolated source copy.

`compiled-patch.mjs` is a new browser-safe transport for **already compiled
bytes**, with exact baseline/target binding, authenticated source/target metadata,
atomic validation and one minimum enclosing contiguous byte-splice per changed
output. It is not a replacement for crisp, a general optimizing compiler, or a
claim of globally smallest compression. The source builder's inert copy/concat/
literal-template recipes support existing browser-native HH/static sources.

`static-compiler.mjs` declares real literal module/resource dependencies for copy
compilation and groups valid module cycles into strongly connected components.
HTML navigation links do not make another page a compile dependency. Runtime or
nonliteral imports aren't secretly claimed covered.

`local-store.mjs` and `sw.js` make a verified compiled artifact addressable without
an app backend on static GitHub Pages. Imported unknown code cannot execute:
iframe sandbox and response CSP sandbox/default-src deny scripts, forms and
outbound connections, including direct navigation. Only shipped known exact
project digests may run. Integrity is not identity/authenticity of arbitrary
third-party code.

`src/session-repl.mjs` is the visual runtime composer: node operation selectors,
typed output-to-input connections, ordinary caller-parameter controls, real
Part inspection and exact-pin structured graph/session export/import. JSON is
an advanced data view, never executable code. Reusable composed Calculations
are actual versioned function Parts; nested selections bind exact versions.

`exp/cooperative/hh-workbench.mjs` invokes the recovered HH fixture runtime and
uses its actual append-only owning PxC. Each service yields actual Parts and
receipts; an outer ordered composition receives its actual receipt as well.
It doesn't counterfeit generic scene-host disposal that this kernel cannot do.

## Evidence and boundaries

- All 12 original experiences crisp-packaged successfully; original launcher
  displays all12 packages;13 neat items include a separate non-package work item
- HH service adapter: original seven checks plus live Calculation/session tests; adversarial patch/router/graph suites
- HH CSS delta: 72 bytes, CSS + HTML rebuilt, 26 targets reused, applied output
  equals clean build
- Existing crisp hello source delta: one packageKey changed, eleven reused;
  46 byte output splice; every testified compiled chunk equals fresh clean build
- Original attempt IDs, receipt timestamps and launcher provenance remain outside
  deterministic compiled-chunk equality; they are not silently rewritten
- Browser QA, current status and screenshots live in the evidence report
- GitHub Pages output is relative-path ready. Main uses the source-build workflow
  described above; pull requests compile and upload artifacts without deployment.

## Candidate version and release header

New workbench starts at0.0.0 candidate. This is not an earned0.1.0 contract
milestone. package.json is the one workbench version/release-note record;
assembly/bootstrap derive both visible header and hidden double-click notes
from it and pair them with a source-derived immutable build ID. Existing
underlying project versions and compiled/source pins remain distinct.

## Justin live prototype

Display & run opens the pinned local mirror in a site IDE. A registered annotation
projection receives a composed enable/disable → hidden/visible → seek graph, with
real PxC Parts and receipts. Its leaf and composite contracts have the same
consumes/emits/guarantees shape and retain internal wiring. Tagged alternatives
describe event/state choices; composition is explicit binding, not a union.

Marker geometry is measured from verified, count-guarded selectors. Existing
TeacherJourney's pure `{tag,attrs,children}` UI-tree convention is retained; the
DOM host mounts the tree and never triggers actions during projection. There
was no recovered general seek registration API, so this standalone host has a
bounded named projection registry, not a replacement for HH's seek or kernel.

Five presentation-only prototypes are available where their target page and
selector guards match: wrapping navigation/footer links, Contact fragment id,
Blog focus outline, and stronger affected text colors. Undo/reset remain local.
Asset choice, email delivery, citation sources, and collapse focus restoration
remain explicitly unresolved. Exports contain exact compiled/source pins,
viewport, typed operations and annotation wiring, without form values or
execution receipts. The dated static report is secondary evidence.

## Site identity versus evaluator identity

`release.siteBuildId` identifies the entire assembled site and appears in the
header. The legacy `release.buildId` field remains the HH session implementation
pin. It is retained only when the complete statically declared evaluator
dependency closure, schemas/adapters and actual host invocation bindings have
exactly identical bytes to the verified published baseline. The closure digest
and file evidence are included in the release record. A calculation dependency
change gets a new implementation pin and rejects prior session imports; a
caption/audit-only change does not invalidate reproducible composition data.

The trusted pinned Justin preview retains its original Tailwind runtime and uses
same-origin DOM access for selectors and reversible presentation changes. Its
`allow-scripts allow-same-origin` iframe is **not a hostile-code isolation
boundary**. No unknown imported code is routed into this editor; those imports
retain the separate inert CSP/sandbox path. Preview operation controls are
locked during apply/undo to keep history/export tied to the same document.

## PxCube Atlas candidate

Open `#/pxcube/atlas` or the Atlas tab. Run search invokes the actual browser runtime: fit the five-transition model, build/cross-check its reference expression, search a bounded size-ordered family, retain concrete failures and prune later candidates before full-grid checks. Program sizes charge complete canonical UTF-8 JSON with native JavaScript numeric encoding; default reference/candidate sizes are 66/43 B. Acceptance applies to all 25 declared cases at tolerance 1e-9, without claiming arbitrary-input equivalence or global minimality.

Run original composition exposes the existing six-node motion/Beta/Boolean fixture calculation. Its policy result and posterior are separate from candidate equivalence. Gain/bias controls specialize the fitted model against the declared fixtures. The app keeps one session through view navigation; shared replay, inspection and reset operate on its most recently run recipe. Recipe/result/inspection downloads are explicit. HH's established evaluator implementation pin is unchanged; Atlas has its own source-derived implementation closure bound into Parts/producers.

The Bazel source build compiles all authored PxCube sources and refuses the historical shipped-byte relocation fallback. Use `bash ci/bazel/run.sh` to build and test the fresh site. The Atlas and prior HH built import regressions run with `node --test scripts/atlas-built-imports.test.mjs scripts/hh-built-imports.test.mjs`. `scripts/atlas-browser-smoke.mjs` uses primary-runtime Playwright with an optional `CHROME_PATH`; new screenshots and downloadable execution reports stay outside the canonical source checkpoint.

Create an immutable source checkpoint using `evidence/create-checkpoint.py --baseline-commit VERIFIED_PAGES_COMMIT --base-source-commit VERIFIED_BASE_SOURCE_COMMIT --base-checkpoint VERIFIED_BASE_CHECKPOINT_BUILD_ID`. This exports the complete materialized source, including Atlas, and attributes its baseline without inventing a new Git source commit. Root supplies the observed new Drive file URL to `evidence/finalize-atlas-publication.py` after upload. The GitHub deployment now compiles current checked-out source; the original immutable checkpoint remains provenance for the import.


## Executable capability ladder

Open `#/pxcube/atlas` for a JSON definition editor above the existing search and
original composition controls. The six-node sample is built from the original
motion → Beta → Boolean recipe and literal seed Parts without executing it.
Choose Parse, Validate, Interpret and Execute in order, or Run ladder to invoke
the same capabilities as a composed action. Each rung retains a Part with its
input addresses, producer, kernel composition and structured failure. The fixed
registry resolves shipped domain Calculations; arbitrary JavaScript is never
evaluated, and user-defined contract semantics remain unspecified.

Editing the definition invalidates every displayed rung and result. Repeating
a rung invalidates later rungs. The draft, authentic runtime handles and pending
completion survive route navigation within the current page. Reload starts a
new browser-local controller. Replay reuses the retained interpreted Part and
shows domain body executions separately from cache hits; kernel receipts are
visible in inspection. Reset clears ladder Parts and its domain cache while
retaining the draft. Definitions download as editable JSON text; result and
inspection downloads are JSON evidence, not re-importable authentic handles.

`npm test` includes controller lifecycle, invalidation and escaped-value checks.
After assembly, `npm run test:ladder:browser` exercises staged and composed runs,
replay, failures, exports, navigation, and 320/390-pixel layouts.
The source-derived Atlas identity follows the runtime's actual relative import
closure, including capability modules, while the existing evaluator pin and
compiled project digests remain separately verified.
