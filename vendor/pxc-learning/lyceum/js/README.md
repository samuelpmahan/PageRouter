# Zod + fast-check: finite component truth tables

## Later integration: the circuit notebook

The original standalone experiment below is preserved. `dff-truth-table.mjs` now checks 16 exhaustive DFF rows plus 128 samples against the actual Python composition. `extension-truth-tables.mjs` checks 3,218 exhaustive rows across 30 finite domains plus 3,840 samples against the notebook's real gate, XOR, divider, decoder, and mux implementations. `dff-results.json` and `extension-results.json` record current source hashes and the preserved wrong-OR counterexample. Schemas generate legal inputs; separate literal tables supply expected behavior.

From the workspace's `work/lyceum-js` directory, with the scripts staged beside the installed dependencies:

```sh
node-v24.21.0-linux-x64/bin/node dff-truth-table.mjs ../../outputs/flipflop-notebook/generate.py ../../outputs/lyceum/js/dff-results.json
node-v24.21.0-linux-x64/bin/node extension-truth-tables.mjs ../../outputs/flipflop-notebook ../../outputs/lyceum/js/extension-results.json
```

## Original standalone experiment

This standalone proof defines component input/output shapes with real Zod, generates every allowed input row, and checks the same domain with real fast-check. It does not yet connect to the Python graph.

Zod defines **shape**: a bit is `0` or `1`; a tuple is an ordered, fixed-size group such as `[a, b]`. The **FG** is the rule relating inputs to outputs. A valid output shape alone cannot establish correctness: OR and XOR both return bits, but disagree when both inputs are `1`.

The source uses Zod's public `toJSONSchema()` API to enumerate its locally declared bit literals and fixed tuples. This enumeration is **exhaustive**: every finite input is visited once. `fast-check` then **samples** the same domain with `constantFrom`; sampling may repeat rows and is not itself a guarantee of full coverage. The FG uses arithmetic independently of the implementation's bit operators.

| Component | Exhaustive rows passed | Sampled checks passed |
|---|---:|---:|
| wire | 2/2 | 128 |
| AND | 4/4 | 128 |
| XOR | 4/4 | 128 |
| mux | 8/8 | 128 |
| half-adder | 4/4 | 128 |
| **Total** | **22/22** | **640** |

For the mux, inputs are `[select, a, b]`: `select=0` chooses `a`; `select=1` chooses `b`. Half-adder outputs are `[sum, carry]`; its FG checks `a + b = sum + 2*carry`.

The deliberately wrong XOR uses OR. All four output shapes pass, but its exhaustive FG check fails at `[1,1]` (`actual=[1]`, correct XOR output `[0]`). Fast-check independently generated that counterexample on run 3: **seed `20261004`, path `"2"`**. Replay matched it. The saved native counterexample is `[[1,1]]`, because fast-check wraps the property's one tuple argument in an argument list. No failing example was supplied to the generator.

`results.json` retains every row, schemas, per-component counts, seed, failure path, counterexample, and replay. `numRuns` counts runs up to failure; `evaluationsIncludingShrinking` also counts attempts to simplify the failure. The wrong XOR has 3 passing predicate evaluations and 1 failing evaluation, including one unsuccessful simplification attempt. It reports zero successful shrinks.

## Scope

This is a pure pipeline within one state **t**. It does not advance the clock to **t+1**, store a state trie, or generate temporal sequences.

The supported enumeration subset is numeric bit `const`/`enum` plus closed fixed tuples. Other Zod node classes and JSON Schema forms throw. Nine rejection checks cover unrestricted numbers/strings, arrays, objects, a non-bit literal, optional values, rest tuples, transforms, and a narrowing refinement. A singleton bit literal is also checked. This is not a general converter for arbitrary Zod schemas; custom refinements and coercion are outside its contract. The proof declares plain literals and tuples only, and checks that enumerated values parse unchanged.

## Reproduce

Verified with **Node v24.21.0**, **npm 11.19.0**, **Zod 4.6.5**, and **fast-check 4.10.2**. The manifest and lock pin the exact dependencies. `environment.json` records the official Node archive URL, its verified SHA-256 checksum, and matching source/staged-source hashes. Dependencies and the runtime are under `work/`, not this output directory.

From the workspace root, reuse the local Linux runtime:

```sh
mkdir -p work/lyceum-js/replay
cp outputs/lyceum/js/{package.json,package-lock.json,truth-tables.mjs} work/lyceum-js/replay/
cd work/lyceum-js/replay
../node-v24.21.0-linux-x64/bin/node ../node-v24.21.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js ci --ignore-scripts --no-audit --no-fund --cache ../npm-cache
../node-v24.21.0-linux-x64/bin/node truth-tables.mjs results.json
```

Exit code `0` means the five correct components passed, the intentional bug was detected and replayed, and the bounded schema checks passed. If a check fails, Node exits with an assertion error. The script is 145 lines; it writes JSON to the supplied path, or prints it when no path is supplied.

## API references

- [Zod JSON Schema conversion](https://zod.dev/json-schema)
- [Zod literals and tuples](https://zod.dev/api)
- [fast-check runners and result details](https://fast-check.dev/docs/core-blocks/runners/)
- [fast-check constantFrom generator](https://fast-check.dev/docs/api/functions/constantFrom/)
- [fast-check seed and replay parameters](https://fast-check.dev/docs/api/interfaces/Parameters/)
