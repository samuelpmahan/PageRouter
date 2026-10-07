# Local / Pages parity — d02e7a7

**Result: Experience parity passes; complete NTC parity does not.**

Checked September 14, 2026 against the actual deployed site at
[PxCube Pages](https://samuelpmahan.github.io/PxCube/), not a local server with a
Pages-shaped URL. [Run 34897594224](https://github.com/samuelpmahan/PxCube/actions/runs/34897594224)
deployed `d02e7a7f674d0b87a4d250c3d7d3335a3ba3982a`.

Fetched origin and fast-forwarded the existing `codex/local-pages` branch to
that commit. No branch switch. The local build is
`2026-09-14T21-26-19-004Z-6ae87a3f`; the refreshed development server is running
at http://127.0.0.1:4321/. Production source and workflow were not edited during
this audit. The subsequent repair and its validation are recorded in `../fix/`.

| Experience | Deployed chunks verified against receipt | Byte-identical to local |
| --- | ---: | ---: |
| BuildBag | 6 / 6 | 6 / 6 |
| ExploreShelf | 45 / 45 | 45 / 45 |
| Hello THING | 1 / 1 | 1 / 1 |
| MockPxC | 6 / 6 | 6 / 6 |
| UploadDiscToShelf | 45 / 45 | 45 / 45 |
| **Total** | **103 / 103** | **103 / 103** |

All requests for those chunks returned 200. The existing crisp `verifyReceipt`
implementation independently verified the downloaded files. All five source
hashes, manifest hashes, and entry-chunk hashes match local. All five deployed
receipts report no undeclared mounts or persisted-prefix violations. This last
claim is about the build validator's scope, not a blanket claim about browser
storage or hostile-code isolation. `shell.css` and `shell.mjs` are also identical.

## What is missing from parity

| Surface | Local | Actual Pages |
| --- | --- | --- |
| NTC work snapshot | 5 items | 0 items |
| Retained tidy type snapshot | 5 types | 0 types |
| NTC build results | 5 packaged, 0 failed | “Build evidence not supplied” |
| Artifact / source identity in header | Run identity and d02e7a7f | Both “not recorded” |
| Work board `neat.html` | Present | **404** |
| Run record `pxcube-run.json` | Present | **404** |
| Receipt wiring in manifest accordions | Absent | Present for all 5 |

The five Experience manifests and their real titles are present on both. The
missing tidy type snapshot is separate from those manifests. Pages' per-Experience
receipts are valid even though its NTC build inspector has no aggregated evidence.

Cause: `.github/workflows/experiences.yml:136` assembles the matrix artifacts by
calling the launcher directly. It does not provide the `ntc-state.json` that
`local/run.mjs:107` produces, or the board/run record that local adds afterward.
`launcher/build-launcher.mjs:165` therefore uses empty work/types/results.
The CI browser job tests a separately assembled local artifact and uploads it as
test evidence; that is not the artifact sent to Pages. Browser tests also do not
gate deployment, explicitly by current workflow policy.

The receipt mismatch goes the other direction: local stages
`pxcube-receipt.json` (`local/run.mjs:91`), while the workflow stages
`receipt.json` and the launcher reads that name (`launcher/build-launcher.mjs:69`).

One minor raw-manifest difference: Pages omits BuildBag's `track`, while local
supplies `exp`. Both launchers default it to Exp, so the effective contract and
visible placement agree. The audit retains both raw and effective comparisons.

The bounded follow-up is to feed both assembly paths the same NTC snapshot and
supporting files, and use a common receipt filename. No promotion or deployment
policy change is needed to address these particular gaps.

## Live behavior checked

One headless browser at a time, isolated fresh contexts for each origin. The
user's open browser and storage were untouched. The existing Studio browser
assertions were reused against actual Pages, with additional shell/Mock/BuildBag
checks. Both environments passed:

- All five Experiences open; Hello stays in its restricted frame.
- MockPxC's visible isolation check passes all three assertions.
- BuildBag saves its draft, preserves exact owner identity across NTC views,
  exposes actual owner values, and creates an independent numbered test.
- Painted-disc upload creates a real Disc and resolves the exact owning Part.
- Numbered Upload and live Shelf Cases pass their declared checks.
- Shelf filtering respects speeds 7–8; “Passion ESP” is exact; nicknames do not
  match; specimens sort by plastic then descending weight; bag creation retains
  the selected physical copies.
- Interactive and test worlds remain independent; Back retains context identity;
  reload retains saved values and test observations without rerunning them.
- The shell fits a 390px viewport. Runtime requests stay on the tested origin.

The first Pages attempt timed out after an early MockPxC button click, with no
page exception. That failure is retained in `browser-failure.json`. A fresh probe
passed; the completed Pages suite explicitly waited for the exposed owner before
clicking and passed with zero page errors. The original timeout's cause was not
conclusively established; this audit does not claim the startup interaction is
fully hardened.

Evidence: `byte-results.json`, `workflow.json`, `local-state.json`,
`pages-state.json`, `local-browser-results.json`, `pages-browser-results.json`,
and the screenshots beside this file. Raw downloaded chunks remain locally in
`downloaded/` and are ignored by Git. Timing and packaging timestamps are not
required to match across independently executed builds.

Reproduce the byte audit with `node evidence/local-pages-parity/d02e7a7/verify-bytes.mjs`.
Run `runtime-parity.mjs` with `PLAYWRIGHT_MODULE` and `CHROME_BIN` set to the local
Playwright module and Chrome executable; `PARITY_MODE=pages` checks only Pages.
The source build must already be served on port 4321.
