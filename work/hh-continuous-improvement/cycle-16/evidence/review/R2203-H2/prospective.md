# R2203 preregistration — independent lifecycle-regression review

Worker H2; native review task R2203. Review only the one new 94-line test in `PageRouter/checkpoint/vendor/hh/src/public-controller.test.mjs` (post-change SHA-256 `bbc47f37250ffb207b671fb83d3f467123e21b1673ae72f2c32f45dfe759b2d0`; baseline `9768d179968f1e2fcaafa0576e2896d5a72f45a7ae5ea0153a4ca4596a8bb164`). Parent/root recorded exactly one test-file change and no production source change.

## Review hypotheses and falsifiers

Expected: this is useful characterization coverage for the existing local-only profile-edit contract, not a production fix. Assertions should establish the boundary before and after save (copy, capabilities, no update port; no provider calls/state, runtime snapshot, receipt, storage, Part identity/value/serializable changes), same-controller alias overlay behavior, a genuinely fresh provider/runtime/controller rehydrated from synthetic session storage but without the process-local overlay, and explicit reset clearing. Assertions must not imply backend/browser/real-account behavior, inspect unobservable provider/function closures, or turn absent cross-controller persistence into a defect.

Falsifiers include an incorrect assertion or test setup that never reaches the claimed boundary; hidden cross-component mutation not checked by the asserted evidence; source/test differences beyond the authorized one-test addition; or a failed focused test. Review retained source and native result first. Then execute exactly one focused Node test by its exact name; preserve the first raw stdout/stderr/UTC/exit. Do not rerun, edit, weaken assertions, run the whole file/build/browser, or perform Git/Lab changes.

## Known evidence distinction

H2's E2202 probe created a fresh controller over the same runtime, so it did not establish a fresh-provider/fresh-runtime boundary. H1's new test claims a fresh fixture provider/runtime/controller over the same in-memory storage after the edit, a stronger and distinct condition. Existing tests already exercise basic local save and same-controller owner alias; review incremental value rather than treating those as absent.

## Evidence limits

The test uses volatile fixture provider/controller/runtime and emitted renderer tree. It does not establish mounted DOM, native browser validity/FormData, backend persistence, production provider, real account, human acceptance, or feature requirements. A focused test-pattern invocation loads the test module but must execute only this named test; skipped tests are not coverage from this run.
