# Reused tools

These are pinned snapshots of Sam's standalone repositories, not rewrites of neat
or tidy. `SOURCES.json` gives commit, original path and SHA-256 for every copied
source. Remote Git objects were fetched through Sam's saved SSH alias. No global
installation, hooks, promotion or source-repo edits were performed.

- neat: be9a1ec7a13af9121a5725576126d6772cca52d5, TypeScript sources plus compiled JS.
- tidy: 9969312b90bbf4f771ffe015b7ef9a2d7b74ea90, standalone executable.

The JavaScript was produced using TypeScript 5.9.3 transpileModule, ES2022 target,
ESNext module, default remaining options. `node vendor/build-neat.mjs
/absolute/path/to/typescript/lib/typescript.js` reproduces it. Transpilation is
not type-checking; the exercised commands are checked through integration tests.
Runtime users only need Node 24. `vendor/neat/package.json` supplies the module type.
