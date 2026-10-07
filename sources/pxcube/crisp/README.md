# crisp

The execution lane of the PxC hypervisor. tidy is the registry, neat holds the
work, crisp is the seam: `neat add` uses crisp to scaffold and register, and
crisp manages builds based on tidy manifests. crisp never decides what to
build and never freezes anything; it builds whatever the manifest points at.

The optional `lib/optimization-links.mjs` bridge exposes the shared Browser
Optimization Store to preview callers. It is advisory: package and check keep
their existing behavior, including for unrelated Experiences.

## The model

- An **exp manifest is a pointer**, not a hash. It points at a working folder
  (for example `"source": "exp/hello"`). Exp work is mutable by nature.
- **Content hashes exist only when frozen.** crisp records chunk hashes in the
  build receipt; tidy copies them into the registry manifest at promotion
  (Sam's hand). crisp itself never writes hashes into a manifest.
- A **package is a wiring manifest**: the built output chunks are hashed by
  content, and the receipt wires app -> entry chunk -> chunk hashes. That is
  the artifact's identity. Sources changing and repackaging just produces new
  chunk hashes (a new version); there is no source-drift gate because there is
  nothing to drift from.
- `verify` checks the artifact, not the source tree: it re-hashes the deployed
  chunks and compares them to the receipt. Run it against the live Page.

## Commands

```
crisp scaffold <dir> [--title T] [--mounts a,b] [--source exp/id]
    Generate a fresh experience folder with the canonical layout crisp knows
    how to compile (experience.json, src/index.html, build.mjs). Refuses a
    non-empty directory. Called on `neat add` so the folder crisp later
    builds is one crisp itself authored.

crisp package <app-dir> [--pxc <path>]
    Validate the manifest and mounts, run the build, content-address the
    output chunks, and emit .crisp/receipt.json (the wiring manifest) plus
    .crisp/manifest.snapshot.json.

crisp check <app-dir> [--pxc <path>]
    Validate manifest shape, mount declarations, and mount usage. No build.

crisp verify <receipt.json> <chunks-dir>
    Re-hash the chunks and compare them to the receipt. Exit 0 when every
    chunk matches, 1 naming each missing or mismatched chunk.
```

Exit codes: 0 ok; 1 manifest/mounts/verify/scaffold refusal; 2 build/output;
3 usage error.

## The app contract

`experience.json`:

```json
{
  "title": "Hello Shelf",
  "version": "0.0.1",
  "mounts": ["shelf"],
  "entry": "src/index.html",
  "build": "node build.mjs",
  "outDir": "dist",
  "sandbox": ["allow-scripts"],
  "source": "exp/hello"
}
```

- `mounts` names the worlds the app reads, in `{MOUNT}.{px|fn|oc|sc}.*` form.
  Every mount used in source must be declared; every declared mount is checked
  against the PxC the build runs against (`--pxc`, default mock-pxc).
- Persisted Part addresses must be `px|fn|oc|sc.*` **without** the mount
  prefix. The mount resolves at the hypervisor seam and never persists into
  the address. crisp rejects a build that persists `shelf.px.discs`.
- `entry` is source-relative; crisp wires it to the built chunk using the
  canonical `src/**` -> `outDir` root mapping. Builds that do not follow the
  canonical mapping still package fine; their receipt just records
  `entryChunk: null` and the launcher wires the entry manually.
- `source` is the tidy registry pointer. Optional; recorded into the receipt.

## Tests

`node crisp/test/run.mjs` (42 assertions). Runs the CLI against temp copies of
`crisp/fixtures/*`; fixtures are never mutated in place.
