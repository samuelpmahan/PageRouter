# PR3 → PR4 → PR5 integration, 2026-10-15

The modern dependency stack builds successfully against main `3723599bb3e1b6c6c44cc5e3385ed2d8fa57e34b`. PR4 required promotion of the already-authored lane-aware selector from original PR5 commit `f550ec1`, merged normally with its original shot/tests/history. The final PR5 evidence checkpoint adds evidence and one new called shot only because original PR5 already contains this fix. Original PR6 optional-plastic source and PR7 kernel files remain exact.

| candidate | compiled files | canonical npm tests | siteBuildId |
|---|---:|---:|---|
| main | 829 | 218/218 | `8e67e1a04e520e68f8a21f1a40b454d829882ccb1c71f198cab9a53b00b89383` |
| modern PR3 | 829 | 219/219 | `8b278a8e5b89f887ffc096f27663ac8f95d60708dee594fe80a58fe042c66d9d` |
| modern PR4 | 829 | 219/219, cached identical build inputs | `8b278a8e5b89f887ffc096f27663ac8f95d60708dee594fe80a58fe042c66d9d` |
| modern PR5 | 839 | 267/267 | `b39f577589ac2bcd33a06d1d72ce1bf10771747c6cf8f57c32474c0e4fb4244e` |

All stages also passed 78 HH regressions, the Atlas built-import check, and 2 build-helper tests; all 14 PxCube packages rebuilt from source. Full manifests, tools, lock hash, recipe hashes, source hashes, commands, and byte deltas are adjacent. Main→PR3 changes 37 output files; PR3→PR4 changes none; PR4→PR5 changes 17 and adds 10. These are measured changes, not an assertion that the modern stack equals the old frozen site.

A second cold modern PR5 build used an independent Bazel output root. Its complete receipt bytes, all 839 site manifest entries (88,201,639 bytes), recipe, source inputs, and toolchain matched the first. Receipt SHA-256: `94466dce45075c77bac91c064066345a7142041ac73779451adffa97383cea4d`; declared epoch: `1791787301`. PR3 and PR4 receipts are also byte-identical.

The independent GitHub PR3 run `38821619032` also passed. Artifact `12013875742` (verified archive SHA-256 `26bbf9053b9d97ef31f48b2c9bbfb6cd4a4e77e08b6bc1725bf24288539bf874`) has the same 829 site manifest entries, site/source digests, declared inputs, epoch, and recipe as local PR3. Host tool hashes differ, so full cross-cloud receipt byte equality is not claimed.

## Behavioral checks and limitations

- Legacy grader tests: 17/17; uncorrected portable PR4 action: 25/25; corrected PR4 action: 26/26; PR5 action: 30/30. The action tests cover per-shot history/lane heads, supersession, and annotation escaping/limits.
- Fresh independent modern5 kernel/CLI tests: 43/43. The pinned trusted-library control harness and subject partitions match the documented extraction behavior; see `trusted-*` files. Control pass does not mean the subjects match the trusted libraries on values outside their contracts.
- Full `work/pxc-kernel` suite on both main and modern5: **302/305**, with the same three pre-existing BAD_FILL failures. Both browser/flipbook checks pass with task-local Playwright 1.56.0, Chromium build1194 and Pillow12.3.0. No PR7 source was changed to make the suite green.
- **Authoritative PolicyBench regeneration remains blocked.** The TypeScript source and emitter at `D:/t-t-1` were not retrieved or updated. Existing guard: pristine7/7; temporary restoration of the three emitted inline readers6/7 (expected alarm). `source-authority.md` gives the exact unresolved upstream handoff.

## PR4 correction

The first modern PR4 cloud job failed despite its 25 unit tests passing. That stage’s original selector always graded the last shot at HEAD, so `per-shot-candidate` incorrectly included unrelated PR6/PR7 changes in C1/C3. An earlier diagnostic mistakenly used the PR5 selector for the PR4 stage; `selection-before.json` now executes each stage’s actual source and reproduces the old null/HEAD selection.

The bounded fix is a normal merge of original PR5 commit `f550ec1`: the existing lane-aware selector, test, and `lane-merges` shot move one stage earlier. The corrected selector assigns `per-shot-candidate` to original `37fbece` and `lane-merges` to original `f550ec1`. Corrected units pass26/26; all1513 canonical source inputs and both recipe hashes remain identical to the passing PR3/PR4 build. Corrected GitHub run `38822637740` / job `116722590941` is **successful**: canonical829-file build at the same modern ID and all four historical shots made, with `per-shot-candidate` at `37fbece` and `lane-merges` at `f550ec1`. The failed prior run is `38821630814`. Complete old cloud failure and corrected unit evidence are in `pr4-action-tests.txt`; the actual corrected four-shot replay follows the original three-shot replay in `historical-pr4-regrade.txt`.

## Historical claims and modern reassessment

Historical shots are evaluated at their original commits/lanes, using their original baselines and hashes. The two `historical-*-regrade.txt` files contain the fresh action replay. Original PR4: 3/3 made, exit0. Original PR5: all15 evaluated,14made and the retained `extract-flag` miss explicitly superseded by made `extract-flag-v2`, exit0. The PR5 replay includes canonical prewarm command/result provenance; its last detached2a build was an extra cold proof, while the action independently built that final HEAD through its normal working-tree path. `run.json` records per-commit receipt/source/site hashes and test counts. Original CI evidence is retained separately, including the original intentional `extract-flag` miss and its explicit supersession by `extract-flag-v2`; neither is rewritten.

The historical `portable-action` shot made its original C3 identity claim (`7f45fbf0…`). The same portable-action change isolated on modern PR3 preserves the exact promised source set and every output byte (C1/C2 made), while its unchanged C3 correctly misses on the modern site ID (`8b278a8e…`). Reassessing the complete initial modern PR4 head (before the selector correction) also misses C1 because two later original shots were added; this is expected outside the original single-shot candidate. Both reports are retained without weakening or superseding the old claim. The isolated reassessment reuses output only after all 1,513 declared source input hashes match the successful modern PR4 receipt.

PR4’s target-branch ancestry is modern PR3, and PR5’s target-branch ancestry is corrected modern PR4. The observed corrected PR4 cloud workflow payload nevertheless used original `3a492fa` as its event base; its four shots all made. The separate local corrected replay uses modern `15869c` as base. For final PR5, the selector is validated against both corrected modern base `d42e364` (14 original shots plus the new evidence shot) and original event base `37fbece` (15 original shots plus the new evidence shot); its eventual cloud event base must be read from that run. All these intended bases already contain the imported PR3 demonstration records. The additional aggregate `--base main` selector diagnostic includes them: `extract-safePath` deliberately has no Git baseline and direct grading exits2 (`no --base given and the shot records no baseline.commit`). That aggregate is not the actual stack gate. No fabricated baseline, migration skip, or historical metadata edit was introduced. `selection-before.json` executes the actual selection function for the named immutable stage/base scenarios and the aggregate diagnostic; `selection-final.json` covers both possible PR5 event bases.

## Preservation and evidence-shot coverage

`preservation.json` compares actual working bytes to original Git blobs: all 4 PR6 files, all 140 PR7 files, and all 35 immutable historical record files match. The original 3,879 event bytes are an exact prefix; exactly one new parsed `shot.called` event names the new shot and its SHA-256.

The new evidence shot's C1 verifies the exact changed **file set**. The byte-preservation and exactly-one-event parts of S1 are independently verified in `preservation.json`; a dedicated grader clause does not prove those content properties. This coverage gap is explicit, and the already-called shot bytes/hash were not changed. The new call keeps the final evidence commit from extending the candidate of the last historical shot (`annotation-limits`).

`run.json` distinguishes local tested commits from connector-published commits with identical trees. Publication and integration into main are lead-owned; these receipts do not claim a main merge or completed upstream source repair.
