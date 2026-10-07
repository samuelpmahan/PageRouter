# Imported assets

This directory owns portable assets only.  It does not adopt the Boone shelf,
lane UI, app event handlers, server, or paint wrapper.

## Source and byte mapping

The painter files below were copied from the immutable Git object at
`refs/remotes/muse/uds-live-label` commit
`ec1141f031556779dc3ea71f320d9118df5d9872`, whose painter path is
`pyto/consumers/discstudio-card/port/painter/`.  They are exact source bytes
and use no dependency or DOM API.

| Target asset | Source asset | Git blob | SHA-256 |
| --- | --- | --- | --- |
| `vendor/painter/painter.mjs` | `painter.mjs` | `4b201ab8e09a4c04b2f5e58233a7a04e8300d497` | `5aeab9b991c0a17de632585cc05d9bdb0a0abce731cbf579eabf3d740b1b5cfc` |
| `vendor/painter/core.mjs` | `core.mjs` | `2b6d1c48d89fc0c846b65302af0ef17740fb14f8` | `c0fc0bdc37c3c5ad420f736ca8f4bb082b150fddd388cd4e35fa52e45538fff4` |
| `vendor/painter/families/botanical.mjs` | `families/botanical.mjs` | `5341be2be02a3c8758d94957797c96efb710114b` | `85c894e08f8c4e28b463fb71a4246dd2e4e60a7fdc83ddf526ba2a21f10c3d0d` |
| `vendor/painter/families/cartography.mjs` | `families/cartography.mjs` | `107d5ab16d22ef76600bb5213a4a06a21ec179b6` | `46b5fe9b45d141c881b9930e633c3b8b8e2596f23276349e5abaa55e810c4baa` |
| `vendor/painter/families/foundry.mjs` | `families/foundry.mjs` | `2bb4bc952227fe262f9efa18f86a5712817737fe` | `55a2e372cc0812a9c12ede4561b9a0a11cba0d3c83c298c7100789237f98ce87` |
| `vendor/painter/families/signal.mjs` | `families/signal.mjs` | `8831989ac80cb549f858970c3e5b5861ec43be74` | `a87c490c12d3087fc31f58a6dca4961f4c4e599ae9259d4cf643b61a389c98ad` |

The sibling archive renderer at
`/Users/samuelmahan/Documents/ChatGPT/Pyto/DiscStudio-render-experiment/pyto/consumers/discstudio-card/port/painter/`
has the same SHA-256 for all six assets.  The archived renderer replay can
therefore continue using either path without a painter-byte divergence.

`accepted-shelf.html` is an exact byte copy of the accepted prototype from
`/Users/samuelmahan/.codex/visualizations/2026/09/10/01a08907-ff26-7353-89d6-2b150c921dd0/fairway-shop-to-bag.html`:

| Target asset | SHA-256 |
| --- | --- |
| `accepted-shelf.html` | `47a9d12bfaea4ff8262bf951a9080c2064d3231b44a276f72d8b3dbf16c7a0e0` |

No license, notice, or attribution file was present in the supplied painter
directory at the source tip, so none was invented or added here.

## Brand mark

`brand-mark.svg` is a standalone extraction of the final source header's
ChainSpot C1/C2 mark: the header symbol preserves the source `viewBox="0 0
32 32"`, `currentColor`, outer radius `13`, inner radius `5.75`, and header
stroke width `3`.  The source final header is
`src/app.js:146` at `ec1141f`.

Commit `6dce5857ecfc21cb1247d862c5cd1f0381508774` records the owner-selected
optical correction.  Its CSS couples the header mark to
`.brand-mark svg` (29px square and stroke 3) and defines the display cut as
`.brand-mark--display` (120px square, stroke 1.6); its explanatory comment
specifies display inner radius `6.1`.  The standalone SVG retains that exact
header symbol as the rendered default and exposes the documented display cut
as `#brand-mark-display`; it does not apply CSS or select a product header.
The parent can choose the simple header symbol or display symbol when fitting
the accepted product shell.

| Target asset | SHA-256 |
| --- | --- |
| `brand-mark.svg` | `2ce681c5ee781715bc645b29c3eaaa6532f89103e0b19796dc8c2b87c9771676` |

## Known verification

The supplied painter verifier is
`pyto/consumers/discstudio-card/port/painter/verify_port.mjs`.  It compares
the imported `render()` output's UTF-8 SHA-256 against the Python-produced
family fixture and exits nonzero on any mismatch.  Its family-only command is:

```sh
node verify_port.mjs ./painter.mjs
```

Using the archived fixture verifier against the imported painter completed
`432/432` family cases byte-identically on 2026-09-14.  Separately, each
vendored target's Git blob ID was checked against the source-object ID shown
in the mapping table, and the accepted prototype compared byte-for-byte with
its supplied source.

The companion card renderer, card fixtures, and verifier were deliberately
not imported because the authorized portable set contains exactly these six
painter files.  Therefore the optional two-module card command is not a test
of this vendor directory.

The consumer's first browser pass caught a shell-profile prefix in the copied
accepted HTML. The copy was replaced using raw file bytes, then its served hash
passed. All six painter files were independently compared with raw Git object
bytes. This correction and the final checks are retained in
`../../.neat/ds/imports/boone-uds/integration/asset-check.json`.
