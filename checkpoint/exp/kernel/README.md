# Kernels

Small pure functions that several PageRouter modules shared as copies. Each
was extracted only after a control: the trusted library that defines the job
passes its own test suite in `ci/controls/harness.mjs`, then every PageRouter
copy runs the same suite. Copies whose results are identical on every input
tried form one behavior class, and each class became one kernel function that
behaves exactly like the copies it replaced. Every move was a called shot,
graded by `actions/called-shot` (records in `ci/shots/called/`).

Rules, enforced by `layout.test.mjs`:

- A kernel module imports only other kernel modules. It ships to the browser
  under `exp/kernel/` and runs in Node, unchanged, in both.
- Every kernel module has a `<name>.test.mjs` beside it.

From an `exp/<folder>/` module, import `../kernel/<name>.mjs`. From a `src/`
module, import `../exp/kernel/<name>.mjs`; the site build rewrites it to
`./exp/kernel/<name>.mjs`, because `src/` ships at the site root.

## Inventory

| module | function | replaced | trusted control (passes its own suite) | this function on that suite |
|---|---|---|---|---|
| `canonical.mjs` | `canonicalLax` | `canonical` in `src/compiled-patch.mjs` (re-exported there) and `scripts/evaluator-identity.mjs` | canonicalize 5.1.0, 86/86; RFC 8785 vectors 6/6 | 50/86; 6/6 |
| `canonical.mjs` | `canonicalJson`, `validateJson`, `plainObject` | `exp/block5/core/canonical.mjs` (re-exported there) | same | 46/86; 6/6 |
| `html.mjs` | `esc` | `src/app.mjs`, `src/atlas-view.mjs`, `src/block5-view.mjs`, `src/justin-site-ide.mjs` | escape-html 1.0.3, 30/30 | 28/30 |
| `equal-json.mjs` | `equalJson` | `exp/block5/core/composed.mjs`, `exp/block5/core/runtime.mjs` | fast-deep-equal 3.1.3 table, both orders, 110/110 | 96/110 |
| `freeze.mjs` | `freezeTree` (children first, frozen nodes skipped) | `exp/compression/feedback.mjs`, `exp/compression/graph.mjs`, `deepFreeze` in `exp/block5/core/composed.mjs`, `freezeJson` in `exp/block5/core/pixel-cache.mjs` | deep-freeze 0.0.1, 2/2 | 0/2 |
| `freeze.mjs` | `freeze` (children first, walks frozen nodes) | `exp/atlas/capability-protocol.mjs`, `exp/atlas/runtime-adapter.mjs` | same | 0/2 |
| `freeze.mjs` | `freezeTreeParentFirst` (node first, frozen nodes skipped) | `freezeTree` in `exp/cooperative/annotation-fg.mjs`, `freeze` in `exp/cooperative/fg-association.mjs` | same | 0/2 |

Where a kernel differs from its trusted library, the difference is the
replaced copies' behavior, kept exactly and pinned in the kernel's test:

- `canonicalLax` is not safe as a content address for non-JSON values:
  `[undefined]` and `[]` both give `[]`, `NaN` gives `null`, and
  `{a:undefined}` gives text that is not JSON. Its callers hash JSON-shaped
  records, where none of this is reached. Fixing it changes digests, so it
  waits for a called change.
- `canonicalJson` throws a `TypeError` on anything that is not plain, finite,
  dense, acyclic JSON, where the trusted library skips, nulls or unwraps.
  Deliberate. Both canonical functions accept lone surrogates, which RFC 8785
  rejects; pinned.
- `esc` maps `null` and `undefined` to `''`: its callers fill optional
  template slots. Deliberate.
- `equalJson` differs only outside JSON (`NaN`, `Date`, `RegExp`, functions).
- The freeze functions are for data: they neither freeze nor walk functions,
  which is the whole of the trusted test. The three differ from each other in
  traversal order and in whether they walk frozen nodes, which shows in getter
  timing and cycles; no current caller can reach the difference.

Node-only helpers shared by the identity scripts live in
`scripts/import-closure.mjs` (`sha256Hex` passes the four NIST FIPS 180-2
SHA-256 examples; the Atlas and evaluator identities are unchanged).

## Kept on purpose

- `canonical` in `exp/atlas/calculations.mjs`. Moving it onto `canonicalJson`
  was measured and declined: it would change behavior a caller can reach
  (another error message in a capability-protocol failure Part for a valid,
  miswired envelope; Atlas session runs about 25% slower; the deepest input it
  takes lower, by one level from a cold start and by up to 2,354 levels after
  warm-up) to fix defects no caller can reach (array holes, cycles).
- `canonical` in `exp/compression/canonical.mjs`: a different contract. It
  keeps `-0` as `-0` for exact round trips, where RFC 8785 writes `0`.
- `canonical` in `exp/block5/core/grid-engine.mjs`: the file is a byte-for-byte
  copy of an external engine whose bytes feed `GRID_ENGINE_SHA256`.
- Copies in frozen files (`src/session-repl.mjs`,
  `exp/cooperative/hh-workbench.mjs`): the evaluator identity pins their bytes.
- `pretty`/`json` and `download` in the views: two behavior classes each, and
  one class of `pretty` is a bare `JSON.stringify` call.
