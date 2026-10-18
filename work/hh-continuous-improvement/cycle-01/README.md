# HH continuous improvement, cycle 01

This candidate repairs school-choice recovery in the local HH preview. Failed school lookup retries stay bound to their original input and epoch. Retry ownership is isolated from directory/profile reads, missing registration choices are reloaded when returning to Register, permanent lookup errors remain visible, and Retry appears only for retryable errors.

The accepted scope covers the registration school cascade and shared directory lookup retry behavior. The shared `journey.loading` flag can still remain stale if an invalidated async read resolves after navigation; it is internal state shared with directory loading and was deferred.

Evidence is under `evidence/`: the three executed Rebalancer specifications, scheduler summary and state, solve JSON for epochs 00–06, all ten E/R packet receipts, focused candidate tests, baseline-with-regressions tests, and the canonical build log. Full native solver bundles are omitted; `manifest.json` records their SHA-256 hashes. The cycle used three active workers across ten packets and seven epochs, with repair packets E04 and E05. This records allocation and rebalancing; it does not claim a speedup.

Validation recorded here: focused HH controller and renderer suite passed 32/32; the original base with the added regressions passed 25 and failed 7. These seven red assertions are regression evidence, not seven distinct pre-existing defects. The final canonical build passed 92 targeted HH tests, 247 full-suite tests, 1 built Atlas import test, and 2 build-helper tests; all 14 PxCube packages succeeded and 843 output files were verified. Site build ID: `0b10b5a2fcc2e2d7ad9aab97cba4f3e389993759ae60eec7a5845eea88f7ba02`; site digest: `3bc7256cafcfe67abeef2d6582dc39339ef975e72fecbd1c4303db5f127551e5`; source digest: `987b863a9286ec40de5f4d6623999df770bc9eb73149ec4408da73c93ed8bac6`. All four changed source hashes match canonical build inputs. Browser visual QA was not run because Chrome Headless Shell archive downloads were invalid or truncated and no installed browser was found.

Changed product sources are limited to `checkpoint/vendor/hh/src/public-controller.mjs`, `public-controller.test.mjs`, `public-site.mjs`, and `public-site.test.mjs`; exact SHA-256 values are in `evidence/manifest.json`. The candidate is based on `main` at `7adf7e74a85c4310a5704a4c42808e85a1a82d71`.

See [NEXT.md](NEXT.md) for the next bounded journey check and [continuation.json](continuation.json) for machine-readable resume state.
