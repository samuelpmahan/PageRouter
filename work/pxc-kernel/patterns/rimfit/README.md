# Rim fit

One contract, `disc.rimfit`, with every candidate as an implementation of it. Nothing is
overwritten: today's DiscStudio 6.6.0 behaviour is one selection among ten.

| File | What it holds |
|---|---|
| `world.mjs` | the contract, the compositions (`rimfit/app-6.6.0`, `rimfit/referee`), the ten selections, and the run over all 36 photos |
| `impls.mjs` | the implementations: v3 (Node, and Chromium replayed from receipts), candidate-circle, outward-snap, outward-edge, segment-band, past-frame |
| `paths.mjs` | where fixtures, working files and the DiscStudio source are |
| `score.py` | overlap, cut and bleed against the hand-traced rims; parity of "app 6.6.0" with the real page |
| `decode.mjs` | decodes the photos in Chromium (the browser's own pixels) into `.work/raw` |
| `v3-chromium.mjs` | records v3 in the real page, because v3 gives different answers on Node |
| `parity.mjs`, `parity2.mjs` | the proof that identical pixels give different v3 answers on Node and Chromium |
| `fixtures/` | 36 photos (3 discs × 12 conditions), the traced truth, recorded Chromium v3 receipts, browser fits |

## Run

```sh
export DISCSTUDIO_DISC=/path/to/discstudio-6.6.0/source/vendor/discstudio/disc
node patterns/rimfit/decode.mjs        # once: photos -> .work/raw (needs Playwright and the DiscStudio page on localhost:4173)
node patterns/rimfit/world.mjs         # all selections; SEL=<substring> or ONLY=<photo> to narrow
python3 patterns/rimfit/score.py       # -> .work/scores.json and the counts per selection
```

Result on 2026-10-14 (good fits out of 36): app 6.6.0 3, circle → segment-band 18, referee 17,
best of the referee's four candidates on each photo 23.
