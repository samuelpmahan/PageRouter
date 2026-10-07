# Scalar composition · measured local refinement

## What works

```js
mold = { speed: 5, glide: 5, turn: 0, fade: 0 }
disc = { mold: moldRef, turn: -1 }
// fn.read({base: mold, own: disc}) → inherited fields plus turn=-1
// oc.update({value: disc, remove: ['turn']}) → inherit again
```

Actual catalog material is converted from arrays once on import. A saved Disc
stores `mold` and only supplied flight overrides. Zero and null win over defaults;
absence inherits. Mold corrections retain old base Parts for already-saved discs.
The live upload controls exercise this; shelf cards show resolved flight fields.

`operations.ts` supplies shallow object create/read/update and membership removal.
`fn.find` reuses DevTools' existing finder with explicit collection/field inputs.
All remain OnTop; the kernel was not changed.

Save runs `specialize` → `depict` → `retain`. `runStage` executes Calculations
in order and yields at each Tick; boundary Parts link actual output Parts.
Saved cards open those boundaries in DevTools. Save consumes the whole Stage;
there is no Next-button Case runner or automatic rollback claim.

## Before → after

Comparison is against the dirty local source captured before this edit, not HEAD.
The app was already untracked. Baseline hashes are in `refinement-baseline.json`.

| Measure | Before | After |
| --- | ---: | ---: |
| Domain-specific registered Calculations | 5 | 3 (−40%) |
| Flight values required for a one-field catalog correction | 4 | 1 (−75%) |
| Scalar specimen overrides | unavailable | absent / value / null |
| Explicit save Tick boundaries | 0 | 3 |
| Combined passing tests | 52 | 58 |
| Model + app + shared-operations bytes | 19,008 | 23,684 (+24.6%) |
| Same files, physical lines | 233 | 294 (+26.2%) |

Removed domain Calculations: `refineSeed`, `composeDisc`; shared `oc.update`
and `oc.create` replace them. Remaining: select painting, render painting, add to shelf.
Registered Calculations total **increased from 5 to 9**, including five shared
CRUD/read/find bindings and one Tick-boundary helper. This is reuse, not fewer APIs.
No duplicate finder was added; update logic serves mold review and specimen edits.
This does not claim the old code had two identical update implementations.

The byte/line scope excludes unchanged painter/DevTools code, catalog, tests,
docs and the one-line server allowlist addition. Added controls and execution
inspection account for new capability; the whole program is not smaller.
No runtime performance improvement was measured.

## Verification · 2026-09-13

- `node --test *.test.ts devtools.test.mjs ../part-first-kernel/test/*.test.mjs`:
  58 passed. Six new tests; existing model/catalog assertions migrated to the
  intentional scalar/reference names, without dropping prior behavioral checks.
- TypeScript no-emit app check passed using the existing TS 5.9.3 installation.
- Browser: Buzzz defaults `5 / 4 / -1 / 1`; own turn=0 → `5 / 4 / 0 / 1`;
  saved as `ds.px.disc.save-2` with nickname `Scalar proof` and readback success.
- Browser: checked blank turn → `?`; unchecked → inherited `-1`.
- Browser: Inspect specialize opened `ds.px.tick.save-2.specialize`, linking
  `ds.px.disc.save-2` and `ds.px.resolved.save-2` through `fn.tick`.

## Not claimed

Shelf edit UI/promotion, reload persistence, upload search UI, draft discard
wiring, experimental Tick selection, and displayed Case assertions remain open.
`updateDisc` creates an inspectable candidate; it does not select it for the shelf.
`destroy` removes collection membership, never deletes historical Parts.
The mGM Cases remain the review bar, not a blanket green receipt.
