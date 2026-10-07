# NTC release path

`neat` owns reviewable work, `tidy` resolves the manifests, and `crisp`
produces/validates the immutable receipt. `local/run.mjs` is the one assembly
program used by local preview and Pages CI; GitHub Actions only distributes
the package legs and invokes that assembler with their staged receipts.

## Delta packages, complete Pages

The Page cannot deploy a partial shelf: every Experience needs a verified
receipt in every assembled artifact. We therefore cache packages rather than
shipping partial output.

`local/affected-targets.mjs` is the shared dependency graph:

- an Experience's own source always keys its package;
- `crisp` and `mock-pxc` key every package;
- a typed manifest provider keys only its typed Experiences;
- Studio's importer keys Upload, Explore, Your Shelf, Build Bag, and On
  Course; the Studio-demo renderer additionally keys Build Bag and On Course;
- a composed base propagates to its overlays.

For a normal push, Actions prints the affected set, restores each exact
package key, recompiles only cache misses, verifies every restored/new receipt,
then stages the complete shelf. A cache eviction is safe: it merely causes an
honest rebuild. Local builds use the same keys under `.pxcube/package-cache/`.
Launcher-only and documentation changes reassemble the Page without invalidating
Experience packages.

## Subcommit snapshots

`neat` is the iteration lane, not a request to commit early. `local/run.mjs`
packages the current working-tree bytes, including staged, unstaged, and relevant
untracked build inputs. Each run records a `sourceSnapshot` with its base commit,
dirty paths, exact per-Experience package keys, and a digest. `sourceCommit` is
only ancestry provenance; it is never used as a package-cache key. This means a
dirty source edit invalidates the affected package immediately, can be browser
verified, and is promoted to Git only when the reviewer accepts its coherent
batch.

Snapshot transport is explicit. Local mode packages/tests the working-tree
snapshot directly. A cloud agent, GitHub Actions, or Pages needs that same
snapshot carried through a branch commit; its `transport.kind` is `git-commit`
instead of `working-tree`. That transport commit makes the bytes available on
another machine—it is neither acceptance evidence nor a tidy/clean promotion.

## Calculation evolution and retained state

`neat` is a working lane: its retained browser state preserves authored/source
material and immutable captures, then recomputes every derived Part using the
current calculations. A changed output is therefore an ordinary iteration, not
a restore failure. Unfrozen demo state must never be bricked by an old derived
value.

`tidy` is the boundary that freezes a graph. It records the selected
calculation IDs, implementation/schema versions, and exact material choices.
Only a tidy-frozen artifact uses strict replay: the canonical `neat`
calculation schema/CLI should provide stable IDs, explicit supported
`fromVersion` migrations, deterministic migration functions, and declared
invariants. An unregistered version change fails closed. `crisp` verifies the
frozen graph and writes the migration/invariant evidence into its receipt.
PxCube's browser harness is an adapter/executor, not the home for that
base-library policy.

Useful commands:

```sh
node local/affected-targets.mjs --base HEAD~1 --head HEAD
node local/affected-targets.mjs --base HEAD~1 --head HEAD --matrix
node local/run.mjs build
```

The target graph is intentionally conservative. Add a dependency category
before a builder starts reading a new shared directory; cache reuse must never
be guessed.
