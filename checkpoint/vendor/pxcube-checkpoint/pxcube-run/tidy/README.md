# tidy

The registry of the PxC hypervisor. tidy is the registry, neat holds the
work, crisp is the seam. tidy has exactly two jobs:

1. **Registering stages.** `tidy register` records a stage: a pointer at a
   working folder (for example `"source": "exp/hello"`). No hashes. Exp work
   is a live pointer. This is what `neat add` triggers, with crisp as the
   go-between.
2. **Recording hashes at promotion.** `tidy promote` copies the crisp
   receipt's content-addressed chunk hashes into the registry entry and
   freezes the stage. Content hashes exist only when frozen, and freezing is
   Sam's hand only: `promote` refuses without `--by-sam`.

tidy never builds. crisp builds whatever tidy's registry points at.

The optional `lib/optimization-links.mjs` bridge lets callers read the shared
PxCube Browser Optimization Store while inspecting lineage. It does not gate
registration or promotion.

## Commands

```
tidy register <id> --source exp/<id> [--title T] [--registry <path>]
    Register a stage: a pointer at a working folder. No hashes.

tidy promote <id> --by-sam --receipt <receipt.json> [--registry <path>]
    Freeze the stage: record the receipt's chunk hashes, mark track clean.
    Refuses without --by-sam.

tidy status [<id>] [--registry <path>]
    Show the registry, or one stage.
```

Exit codes: 0 ok; 1 registry/promotion error; 3 usage error.

The registry lives at `tidy/registry.json` (override with `--registry`, which
is what the tests use). A stage:

```json
{
  "id": "hello",
  "source": "exp/hello",
  "title": "Hello THING",
  "track": "exp",
  "frozen": false,
  "chunks": null,
  "registeredAt": "...",
  "promotedAt": null,
  "promotedBy": null
}
```

After promotion, `track` is `clean`, `frozen` is true, and `chunks` holds the
`[{path, sha256}]` wiring from the crisp receipt, plus `entryChunk`.

## Tests

`node tidy/test/run.mjs` (22 assertions). Runs against a temp registry file;
the repo's `registry.json` is never touched. The promote tests build a genuine
crisp receipt from the crisp hello fixture first.
