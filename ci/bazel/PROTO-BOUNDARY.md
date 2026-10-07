# Proto creation and ingestion boundary

This note defines only the handoff between a pinned PageRouter build and a
later Proto experiment. It does not define Proto meaning or acceptance rules.

## Current mint boundary

The current mint is exactly these three `.pxc` files, each containing its
named tuple followed by one newline:

```text
FunctionalGuarantee/proto/none/m.pxc             {FunctionalGuarantee|{?}|m|{?}}
FunctionalGuarantee/proto/none/c.pxc             {FunctionalGuarantee|{?}|c|{?}}
FunctionalGuarantee/proto/none/LossFunction.pxc  {FunctionalGuarantee|{?}|LossFunction|{?}}
```

The `{?}` slots remain unresolved. The `none` path is a name, not a defined
semantic mode. No `.pxc` parser or consumer was identified in the audited
PageRouter source, and the current JSON ingestion CLI cannot ingest these
tuple files. Do not convert them to JSON, fill either slot, or infer behavior
from the tuple name. Record that format/consumer mismatch as an observation
until its owner defines the interface.

## Keep build identity beside the data

Each experiment should carry a data-only JSON manifest with:

- an experiment identifier and manifest schema version;
- the canonical source identity, build recipe identity, Bazel target label,
  toolchain receipt identity, and GitHub Actions run ID (when applicable);
- root-relative paths and SHA-256 digests for the Proto JSON, any input data,
  and each selected file from the Bazel-declared output tree.

The manifest records identities and file references. It must not contain shell
text, executable code, environment substitutions, or instructions to fetch or
run arbitrary paths. A fixed, reviewed runner resolves its paths beneath the
workspace, rejects symlinks and path traversal, checks the listed digests, and
then passes explicit files to the existing ingestion CLI.

Keep the Proto declaration JSON and its input data as separate files. The
build receipt says which source and toolchain produced an output; it does not
assign Proto semantics to that output. The ingestion observation should retain
the manifest identity, exact Proto and input digests, the CLI exit code, and the
CLI's raw JSON result. Record a short human-readable note with the question,
the action taken, and the observed answer so the machine record stays
inspectable.

## Existing ingestion entry point

Use `scripts/ingest-proto.py` for experiments that fit its current interface:

```text
python scripts/ingest-proto.py PROTO.json [--inputs INPUTS.json] [--provider cpu.gates|cpu.integer] [--output RESULT.json]
```

The special `cpu` input selects the existing CPU Step Proto. A supplied Proto
is read as JSON data. The CLI does not import executable code from a Proto or
its inputs. It returns the ingestion result, including the existing status,
frontier, validation, compile lint, cause, and output fields where present.
Keep that result and exit code unchanged in the observation; do not add a
build-specific rule that turns a successful Bazel build into Proto acceptance.

The manifest is not itself a Proto and is not passed as the `PROTO.json`
argument. The reviewed runner reads the data-only manifest, validates its
file identities, and supplies the manifest's explicit Proto and input paths to
the CLI. The provider option remains limited to the CLI's existing choices.

## Scope of future prototypes

For a later minted Proto, use its declared Bazel output files as immutable,
hash-pinned inputs. Keep its schema and domain checks with the Proto's owner.
This boundary provides provenance and safe file handoff only; it does not
decide what a Proto means, whether its outputs are correct, or whether its
status is acceptable for a domain task.
