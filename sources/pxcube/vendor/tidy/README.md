# Tidy

Tidy is a tiny, portable guard for structured lineage in one working tree. Git owns history; Tidy checks the local lineage boundary, version progression, and relevant tests.

## Add it to a repository

Copy the released `tidy` executable into the target repository root and make it executable:

```sh
chmod +x tidy
./tidy check
```

Tidy requires Node, but no package install. It always uses the directory where it is run as the target repository, so the target only needs `.tidy/manifest.json`.

```text
my-repo/
  tidy
  .tidy/manifest.json
```

## Commands

```sh
./tidy check
./tidy up -v TYPE:TARGET_VERSION [--parent_dir DIR] [--allow-test-failure]
```

`check` validates the manifest. `up` accepts exactly one legal semantic-version successor, requires `<parent_dir>/<TYPE>/clean`, then runs the manifest’s test commands before writing the new version. By default, `parent_dir` is the repository root. A failed test refuses the version change; only an explicit patch bump may continue with `--allow-test-failure`.

Example manifest:

```json
{
  "schemaVersion": 1,
  "types": {
    "s0": {
      "version": "1.3.7",
      "tests": ["npm run test:s0"]
    }
  }
}
```

Example stage-local boundary:

```sh
./tidy up -v s0:1.3.8 --parent_dir ./lab/stages
```

Tidy does not manage Git branches, commit changes, decide `clean/` contents, or coordinate work.

## Develop Tidy

The tool has no runtime dependencies. Its focused parity tests use Node’s built-in test runner:

```sh
node --test
```

## Optional commit backstop

The repository includes [`hooks/pre-commit`](hooks/pre-commit), an executable hook that runs `./tidy check`. Copy it into the target repository’s `.githooks/pre-commit`, then enable that repository-carried hook:

```sh
mkdir -p .githooks
cp /path/to/tidy/hooks/pre-commit .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

It checks only manifest structure. It does not inspect staged files or run `tidy up`.

## Extraction provenance

This first standalone release preserves the JSON implementation from ChainSpot commit [`c31c4981a7afa8c1e18222b24b0e0a70e5a00c43`](https://github.com/samuelpmahan/ChainSpot/tree/c31c4981a7afa8c1e18222b24b0e0a70e5a00c43). The only packaging change is that the executable resolves its target from the caller’s current directory and uses portable dynamic built-in imports, so its one file runs when copied into either CommonJS or `type: module` repositories.

## Promotion

A lineage may optionally declare a repository-relative `root` and lineage-relative `clean` and `experiments`; their defaults are `TYPE`, `clean`, and `exp`. `up` uses the declared root and clean directory too; an explicit `--parent_dir DIR` takes precedence and resolves the legacy boundary as `DIR/TYPE/<clean> (where `clean` defaults to `clean`)`.

```json
{
  "schemaVersion": 1,
  "types": {
    "disc-studio-ui": {
      "version": "0.0.1",
      "root": "src/disc-studio",
      "clean": "clean",
      "experiments": "exp",
      "tests": ["node -e \"process.exit(0)\""]
    }
  }
}
```

Promote one file only:

```sh
./tidy promote disc-studio-ui editorial DiscCard.svelte
./tidy promote disc-studio-ui editorial DiscCard.svelte --replace
```

The first command copies `src/disc-studio/exp/editorial/DiscCard.svelte` to `src/disc-studio/clean/DiscCard.svelte`, runs that lineage’s tests, and leaves the experiment source in place. It refuses an existing destination unless `--replace` is explicit. When tests fail after copying, Tidy reports failure and deliberately leaves the copied destination in the working tree for inspection; it never changes the lineage version.

`promote` is files-only in this release. Directory promotion is deferred because copying a subtree needs an explicit policy for conflicts, replacement, and deletions.

### Self-contained promotion repro

```sh
demo_dir="$(mktemp -d)"
mkdir -p "$demo_dir/.tidy" "$demo_dir/src/disc-studio/exp/editorial"
cp /path/to/tidy/tidy "$demo_dir/tidy"
chmod +x "$demo_dir/tidy"
cat > "$demo_dir/.tidy/manifest.json" <<'JSON'
{"schemaVersion":1,"types":{"disc-studio-ui":{"version":"0.0.1","root":"src/disc-studio","clean":"clean","experiments":"exp","tests":["node -e \"process.exit(0)\""]}}}
JSON
printf '<article>editorial</article>\n' > "$demo_dir/src/disc-studio/exp/editorial/DiscCard.svelte"
cd "$demo_dir"
./tidy promote disc-studio-ui editorial DiscCard.svelte
./tidy promote disc-studio-ui editorial DiscCard.svelte     # refuses: destination exists
./tidy promote disc-studio-ui editorial DiscCard.svelte --replace
```
