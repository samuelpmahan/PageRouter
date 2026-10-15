# PolicyBench source authority and regeneration handoff

**Upstream regeneration is blocked; it has not been certified or completed.**

The checked-in headers identify `D:/t-t-1/packages/cli/src/flick.ts`, `match.ts`, and `tournament.ts` and `tools/emit-pagerouter.mjs` as authoritative. Those bytes and the upstream revision were unavailable in this executor and the connected-source discovery recorded in `original-ci-and-source-discovery.json`. No substitute TypeScript authority was created and no authoritative source/emitter update is claimed.

PR5's `checkpoint/exp/policybench/cli/args.mjs` is explicitly authored in PageRouter. The three generated CLI files were changed to import it. An unmodified upstream emitter can therefore restore the three inline readers and silently undo the extraction unless checked.

The existing authored `exp/policybench/cli-args.test.mjs` is part of the canonical npm/Bazel suite. It asserts the exact shared import and one `const flag = flagReader(args);` declaration in all three emitted files, then exercises the established argv semantics. Fresh positive run: 7/7. In a disposable snapshot, restoring the pre-extraction inline readers in all three files produced 6/7 and failed with `flick.mjs imports flagReader`. This is evidence of a regression alarm, not proof of upstream source repair or actual regeneration.

## Required upstream follow-up

1. Retrieve and identify the real `D:/t-t-1` repository revision, the three TypeScript CLI files, and `tools/emit-pagerouter.mjs`.
2. Apply the shared-reader extraction at that authority. A concrete preferred implementation is a typed `packages/cli/src/args.ts` exporting the existing first-exact-token/nullish-fallback reader, with the three CLI files importing it. Preserve first repeated flag wins, ignored `--key=value`, values beginning with `-`, and continued scanning after `--`; do not substitute `parseArgs` behavior.
3. Inspect the actual emitter and add/map the shared module so it emits `cli/args.mjs` and the three relative imports consistently. Its actual mapping/cleanup behavior was unavailable; this step is a handoff, not an applied patch.
4. From that authoritative repository run the documented `node tools/emit-pagerouter.mjs`, then in PageRouter/checkpoint run `node --test exp/policybench/cli-args.test.mjs` and `BAZEL=<pinned-7.4.1> bash ci/bazel/run.sh`.
5. Record the upstream commit, emitter/source hashes, emitted diff, and fresh build receipt. The three generated CLI files must retain the shared import/reader after regeneration. Until then the source-of-truth requirement remains unresolved.
