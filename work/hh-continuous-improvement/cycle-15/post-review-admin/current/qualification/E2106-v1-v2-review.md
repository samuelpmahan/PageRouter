# E2106 source-only review and version history

The five original unexecuted E2106 artifacts remain preserved exactly under `history/E2106-v1/`. Original SHA-256 pins:

| Artifact | Original SHA-256 |
|---|---|
| `precommit-gate.mjs` | `5e0dfb96db0f0ca9e880cc80b963ca2b3b5ba0d2e4b91d01c910bd8c1a187b83` |
| `verify-staged-allowlist.mjs` | `e734092c2ddfe84b7bd79d1ff2401c803fc02b39beb7aac12331e94cf1d43ec7` |
| `export-once.mjs` | `4988279114a4a2bc993ddfa09624208924f94de7189ee9b8c185802ec08b8b73` |
| `FLOW.md` | `3e6e2c40e325834404de6b2da02befca83f9e884b78b5e74e4cc6e6fd3447b33` |
| `prospective.json` | `86e70dcaa3cf9f07ec4ffa13296e79ddbeb8fb5a09fa6986dab97fa162db54b2` |

Root's review record `qualification/E2106-source-review-v1.json` identifies two bounded source defects: (1) the site hash literal in the original gate, exporter, and prospective record contains `...b4baf...` instead of the authoritative source's `...b4faf...`; (2) original `walkPackage(packageRoot)` inventories the entire cycle root as exactly 107 files while a future `post-review-admin/current` subtree is located inside that root and separately indexed. The v2 gate excludes only that exact subtree and validates it independently against its own manifest. V2 corrects the source hash in every literal and uses versioned filenames, preserving all v1 bytes and pins.

This was source inspection of preparation code only. No v1 or v2 script was syntax-checked or executed; no observed product/test/native failure occurred. The v2 scripts remain inert planning artifacts pending root review and any later phase-specific authorization. See `history/E2106-v2-root-review/v1-v2-final.diff.txt` for the final unified diff; the earlier first-pass diff is also retained without being rewritten. The initial copied v2 snapshots under `history/E2106-v2/` and `history/E2106-v2-final/` are preserved as intermediate artifacts; the final post-review v2 source pins are in `history/E2106-v2-root-review/` and H1's E2106 `prospective.v2.json`.
