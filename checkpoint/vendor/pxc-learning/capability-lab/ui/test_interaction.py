"""Script side of the parity probe. Start interaction.py before running."""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from interaction import catalog, invoke


def request(base, key, inputs):
    data = json.dumps({"capability": key, "inputs": inputs}).encode()
    with urlopen(Request(base + "/api/invoke", data,
                         {"Content-Type": "application/json"}), timeout=60) as response:
        return json.load(response)


def check(base):
    evidence = []
    for text in ('{"value":1.0}', '{"value":1e0}'):
        try:
            invoke("counter", json.loads(text))
            raise AssertionError("Decimal spelling should fail the integer schema")
        except ValueError as error:
            assert "does not satisfy byte" in str(error)
        try:
            request(base, "counter", json.loads(text))
            raise AssertionError("HTTP decimal should fail the integer schema")
        except HTTPError as error:
            assert error.code == 400
    for item in catalog():
        inputs = deepcopy(item["example"])
        runs = []
        count = 5 if item["key"].startswith("cpu.") else (1 if item["key"] == "memory.cpu" else 2)
        for _ in range(count):
            before = deepcopy(inputs)
            direct = invoke(item["key"], inputs)
            assert inputs == before, "Invocation mutated the caller's input"
            remote = request(base, item["key"], before)
            assert remote["outputs"] == direct["outputs"]
            assert remote["order"] == direct["order"]
            runs.append({"inputs": before, "outputs": direct["outputs"], "order": direct["order"]})
            for name, path in item["projection"]["feedback"].items():
                value = direct["outputs"]
                for part in path.split("."):
                    value = value[part]
                inputs[name] = deepcopy(value)
        missing = deepcopy(inputs)
        missing_port = next(iter(item["definition"]["inputs"]))
        del missing[missing_port]
        try:
            request(base, item["key"], missing)
            raise AssertionError("Missing required input accepted")
        except HTTPError as error:
            assert error.code == 400
            message = json.load(error)["error"]
            assert missing_port in message
        evidence.append({"key": item["key"], "runs": runs, "missingPort": missing_port})
    output = Path(__file__).with_name("script-results.json")
    output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"status": "PASS", "capabilities": [item["key"] for item in evidence],
                      "scriptInvocations": sum(len(item["runs"]) for item in evidence),
                      "evidence": str(output)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8772")
    check(parser.parse_args().url)
