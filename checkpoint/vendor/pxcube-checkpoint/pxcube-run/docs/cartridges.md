# Cartridges: composed, offline THINGs

A THING is a cartridge. crisp already content-addressed the chunks (the ROM:
immutable bytes with sha256 names); this doc covers the two pieces that make
the metaphor real: Kustomize-style composition and the offline runtime.

## Borrowed behaviors, named

- **Kustomize**: `base` + `patches`, no templating. An `experience.json` may
  declare `"base": "<sibling-experience-dir>"` and `"patches": [...]`.
  The overlay's own keys win over the base's; objects merge recursively;
  arrays and scalars replace. Patches are RFC 7386 JSON merge patches applied
  in order (a patch value of `null` deletes the key). Bases chain; cycles are
  refused. `base` + `tidy` together are refused for now.
- **Game Boy**: the cartridge is immutable, save RAM persists. The composed
  output chunks are the ROM (precached, cache-first, versioned by the run id);
  only the save API persists, namespaced per cartridge.

## How composition resolves

`crisp/lib/manifest.mjs` `loadManifest` resolves `base` recursively, merges,
applies patches, and records `composition: { base, patches }` on the resolved
manifest — so the launcher accordion shows exactly what composed, and
`crisp resolve <dir>` prints it.

`crisp/lib/packager.mjs` `packageApp` packages the base first (its own build
runs, its own receipt lands in its own `.crisp/`), runs the overlay build,
then layers the base's output chunks under the overlay's: the overlay wins
every path conflict. The receipt records
`composition: { base, patches, baseChunks, overridden }`.

The composed cartridge materializes in the overlay's `outDir`; repackaging is
idempotent because content-addressing makes the layering stable.

## The offline runtime

`local/run.mjs` generates `sw.js` at assembly time: a precache of the shell,
`neat.html`, the review checklist component script, and every chunk every
packaged receipt names. `VERSION` is the run id; activation purges older
cartridges. `pxcube-run.json` stays network-only — it is the new-build signal,
and the shell already treats its absence as "inspectable offline".

## The Game Boy base (`experiences/gameboy`)

The player shell: 160x144 canvas, d-pad plus A/B/Start/Select (touch and
keyboard), a fixed 60Hz loop, and save RAM (`save.get`/`save.set`, JSON values,
namespaced `pxcube:cartridge:<game>:<key>` in localStorage).

A ROM is `window.ROM = { tick(input, save), draw(ctx, save) }`.
The base ships a `rom.js` that draws NO CARTRIDGE; an overlay's `rom.js`
shadows it. `experiences/snake` is the proof: `{ "base": "gameboy" }` plus its
own title, build, and `rom.js`. Nothing else.
