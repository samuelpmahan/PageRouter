"""Ingest a supplied Proto through the existing CPU PxC declarations.

This is a CLI around vendor/pxc-learning/fg-proto-ingestion/proto_adapter.py.
It accepts declaration and input JSON, never imports executable code from them.
"""
import argparse
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vendor" / "pxc-learning" / "fg-proto-ingestion"))
from proto_adapter import bind_proto, cpu_proto, ingest  # noqa: E402


def run(proto, inputs=None, provider=None):
    if provider:
        if provider not in ("cpu.gates", "cpu.integer"):
            raise ValueError("provider must be cpu.gates or cpu.integer")
        if proto["as"] != "calculation":
            raise ValueError("provider applies only to calculation Proto")
        proto = bind_proto(proto, provider)
    result = ingest(proto, inputs)
    return {
        "status": result["status"], "proto": result["proto"],
        "sourceHashes": result["sourceHashes"],
        "frontier": result.get("frontier", []),
        "acceptedOutputs": result.get("acceptedOutputs"),
        "validation": result.get("validation"),
        "compileLint": result.get("compileLint"),
        "readOnly": result.get("readOnly"),
        "cause": result.get("cause"),
        "order": result.get("native", {}).get("order") if result.get("native") else result.get("order"),
        "value": result.get("value"),
        "originalSourcesUnchanged": result.get("originalSourcesUnchanged"),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proto", help="Proto declaration JSON, or 'cpu' for the existing CPU Step Proto")
    parser.add_argument("--inputs", type=Path, help="JSON input Parts for a bound Calculation")
    parser.add_argument("--provider", choices=("cpu.gates", "cpu.integer"))
    parser.add_argument("--output", type=Path, help="write the result JSON here")
    args = parser.parse_args(argv)
    try:
        proto = cpu_proto() if args.proto == "cpu" else json.loads(Path(args.proto).read_text())
        inputs = json.loads(args.inputs.read_text()) if args.inputs else None
        result = run(proto, inputs, args.provider)
        body = json.dumps(result, indent=2) + "\n"
        if args.output:
            args.output.write_text(body)
        else:
            print(body, end="")
        return 0 if result["status"] in ("ACCEPT", "PART", "PARTIAL") else 1
    except (ValueError, KeyError, TypeError, OSError) as error:
        print(f"Proto ingestion error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
