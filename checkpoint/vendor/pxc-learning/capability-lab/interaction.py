"""Local capability adapter: browser and scripts call the same registry/runtime.

Run: python3 interaction.py --port 8772
The server retains no application state. A successful result is committed by
the caller; a rejected invocation cannot replace the browser's last result.
"""

import argparse
from copy import deepcopy
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def make_counter():
    """Small initial example; the real storage/CPU factories join the registry."""
    definitions = {
        "counter.increment": {
            "kind": "calculation", "label": "Increment byte",
            "inputs": {"value": "byte"}, "outputs": {"value": "byte"},
            "implementation": "increment",
        },
        "counter.step": {
            "kind": "functionalGuarantee", "label": "Step counter",
            "inputs": {"value": "byte"}, "outputs": {"value": "byte"},
            "steps": [{"id": "increment", "use": "counter.increment",
                       "bind": {"value": "$input.value"}}],
            "returns": {"value": "increment.value"},
        },
    }
    return ("counter.step", definitions,
            {"increment": lambda value: {"value": (value + 1) % 256}},
            {"byte": lambda value: type(value) is int and 0 <= value <= 255})


def registry():
    """Explicit input/display bindings are projection choices, not inference."""
    result = {}

    def add(key, bundle, example, feedback, leds):
        capability, definitions, implementations, schemas = bundle
        result[key] = dict(capability=capability, definitions=definitions,
                           implementations=implementations, schemas=schemas,
                           example=deepcopy(example), projection={"feedback": feedback, "leds": leds})

    add("counter", make_counter(), {"value": 0}, {"value": "value"},
        [{"path": "value", "label": "Byte", "width": 8}])
    # Imports stay here so the initial fixture works before the other probes land.
    try:
        from storage import make_storage
    except ModuleNotFoundError as error:
        if error.name != "storage":
            raise
    else:
        add("storage", make_storage(words=2, width=2),
            {"memory": [0, 0], "address": 1, "value": 3, "write": True},
            {"memory": "memory"},
            [{"path": "memory", "label": "Memory", "width": 2},
             {"path": "read", "label": "Read", "width": 2}])
    try:
        from cpu import make_cpu
    except ModuleNotFoundError as error:
        if error.name != "cpu":
            raise
    else:
        example = {"state": {"A": 0, "PC": 0, "OUT": 0, "HALT": 0, "RAM": [0] * 16},
                   "program": [0x11, 0xC0, 0xE0, 0xC0, 0xF0] + [0] * 11, "inputByte": 0}
        leds = [{"path": "state." + key, "label": key, "width": width}
                for key, width in [("A", 8), ("PC", 4), ("OUT", 8), ("HALT", 1), ("RAM", 8)]]
        for provider in ("gates", "integer"):
            add("cpu." + provider, make_cpu(provider=provider), example,
                {"state": "state"}, leds)
    try:
        from composition import EXAMPLE, make_memory_cpu
    except ModuleNotFoundError as error:
        if error.name != "composition":
            raise
    else:
        add("memory.cpu", make_memory_cpu(), EXAMPLE, {"state": "state"},
            leds + [{"path": "read", "label": "Read", "width": 8}])
    return result


def catalog():
    from runtime import describe
    return [{"key": key, "definition": describe(item["capability"], item["definitions"]),
             "example": item["example"], "projection": item["projection"]}
            for key, item in registry().items()]


def invoke(key, inputs):
    """Same public Python entrypoint used by HTTP; no capability-specific handler."""
    from runtime import run
    choices = registry()
    if key not in choices:
        raise ValueError("Unknown capability: " + str(key))
    item = choices[key]
    return run(item["capability"], inputs, definitions=item["definitions"],
               implementations=item["implementations"], schemas=item["schemas"])


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, content_type="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/catalog":
            self.respond(200, catalog())
        elif self.path in ("/", "/index.html"):
            self.respond(200, (Path(__file__).parent / "ui/index.html").read_bytes(), "text/html; charset=utf-8")
        else:
            self.respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/invoke":
            self.respond(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1_000_000:
                raise ValueError("Expected a JSON request under 1 MB")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict) or set(body) != {"capability", "inputs"}:
                raise ValueError("Request needs exactly capability and inputs")
            result = invoke(body["capability"], body["inputs"])
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {"error": str(error)})
            return
        self.respond(200, result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8772)
    args = parser.parse_args()
    print(f"Capability lab: http://127.0.0.1:{args.port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
