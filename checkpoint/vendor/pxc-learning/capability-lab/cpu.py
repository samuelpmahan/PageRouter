"""One CPU Step declaration, with independently checked provider choices.

Architectural state means the state a program can observe: accumulator A,
program counter PC, output OUT, halted flag HALT, and sixteen RAM bytes.
The gate engine and integer interpreter remain in ../pxc-machine unchanged.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import random
import sys


MACHINE = Path(__file__).resolve().parent.parent / "pxc-machine"
sys.path.insert(0, str(MACHINE))
from circuits import build_cpu
from core import run_net
from oracle import run_reference


def byte(value):
    return type(value) is int and 0 <= value <= 255


def bytes16(value):
    return type(value) is list and len(value) == 16 and all(byte(v) for v in value)


def cpu_state(value):
    return (
        type(value) is dict and set(value) == {"A", "PC", "OUT", "HALT", "RAM"}
        and byte(value["A"]) and byte(value["OUT"])
        and type(value["PC"]) is int and 0 <= value["PC"] < 16
        and type(value["HALT"]) is int and value["HALT"] in (0, 1)
        and bytes16(value["RAM"])
    )


def integer_step(*, state, program, inputByte):
    return {"state": run_reference(program, 1, initial=state, inputs=[inputByte])[1]}


def _gate_failure(state, failures):
    raise ValueError(f"gate FunctionalGuarantees failed at tick {state['t']}: {failures[:3]}")


def gates_step(*, state, program, inputByte):
    net = build_cpu(program, initial=state)
    supplied = {address: (inputByte >> bit) & 1
                for bit, address in enumerate(net.buses["IN"])}
    # The existing runner records tick 0 and tick 1; the instruction consumes
    # tick 0's input. Tick 1 also needs an input to evaluate its combinational wires.
    trace = run_net(net, 1, stimuli=[supplied, supplied], on_failure=_gate_failure)
    buses = trace["states"][1]["buses"]
    return {"state": {**{key: buses[key] for key in ("A", "PC", "OUT", "HALT")},
                      "RAM": [buses[f"RAM{i:02}"] for i in range(16)]}}


def _validator(independent_step):
    def validate(*, state, program, inputByte, candidate):
        expected = independent_step(state=state, program=program, inputByte=inputByte)["state"]
        differences = {key: {"expected": expected[key], "actual": candidate.get(key)}
                       for key in expected if candidate.get(key) != expected[key]}
        if differences or set(candidate) != set(expected):
            raise ValueError("CPU Step contract mismatch: " + json.dumps(differences, sort_keys=True))
        return {"state": candidate}
    return validate


def make_cpu(provider="gates"):
    """Return the same declaration with a selected implementation dictionary."""
    providers = {"gates": (gates_step, integer_step), "integer": (integer_step, gates_step)}
    if provider not in providers:
        raise ValueError(f"unknown CPU provider {provider!r}; choose gates or integer")
    execute, independently_check = providers[provider]
    inputs = {"state": "CpuState", "program": "Program16", "inputByte": "Byte"}
    outputs = {"state": "CpuState"}
    bindings = {port: f"$input.{port}" for port in inputs}
    definitions = {
        "Cpu.Transition": {
            "kind": "calculation", "label": "Compute one CPU state transition",
            "inputs": dict(inputs), "outputs": dict(outputs), "implementation": "cpu.transition",
        },
        "Cpu.Validate": {
            "kind": "calculation", "label": "Check the complete next state independently",
            "inputs": {**inputs, "candidate": "CpuState"}, "outputs": dict(outputs),
            "implementation": "cpu.validate",
        },
        "Cpu.Step": {
            "kind": "functionalGuarantee", "label": "CPU Step",
            "inputs": dict(inputs), "outputs": dict(outputs),
            "steps": [
                {"id": "transition", "use": "Cpu.Transition", "bind": dict(bindings)},
                {"id": "validate", "use": "Cpu.Validate",
                 "bind": {**bindings, "candidate": "transition.state"}},
            ],
            "returns": {"state": "validate.state"},
        },
    }
    return ("Cpu.Step", definitions,
            {"cpu.transition": execute, "cpu.validate": _validator(independently_check)},
            {"CpuState": cpu_state, "Program16": bytes16, "Byte": byte})


def _cases():
    """Twenty-two directed cases have literal expected states; four are seeded."""
    ram = [11 * i for i in range(16)]
    ram[3] = 7
    initial = {"A": 250, "PC": 0, "OUT": 12, "HALT": 0, "RAM": ram}
    changes = [
        {}, {"A": 3}, {"A": 7}, {"RAM": ram[:3] + [250] + ram[4:]},
        {"A": 1}, {"A": 243}, {"A": 2}, {"A": 255}, {"A": 253},
        {"PC": 3}, {}, {"PC": 3}, {"OUT": 250}, {"A": 173},
        {"A": 244}, {"PC": 0, "HALT": 1},
    ]
    for opcode, changed in enumerate(changes):
        yield {"id": f"opcode-{opcode:x}",
               "inputs": {"state": deepcopy(initial), "program": [opcode * 16 + 3] + [0] * 15,
                          "inputByte": 173},
               "expected": {**deepcopy(initial), "PC": 1, **deepcopy(changed)}}
    for name, instruction, overrides, changed in [
        ("zero-jump-taken", 0xA3, {"A": 0}, {"PC": 3}),
        ("nonzero-jump-not-taken", 0xB3, {"A": 0}, {}),
        ("pc-wrap", 0x00, {"PC": 15}, {"PC": 0}),
        ("subtract-underflow", 0x53, {"A": 0}, {"A": 249}),
        ("shift-discards-high-bit", 0xE0, {"A": 128}, {"A": 0}),
        ("already-halted-store-holds-all-state", 0x3F, {"PC": 12, "HALT": 1}, {"PC": 12}),
    ]:
        state = {**deepcopy(initial), **overrides}
        program = [0] * 16
        program[state["PC"]] = instruction
        yield {"id": name, "inputs": {"state": state, "program": program, "inputByte": 173},
               "expected": {**deepcopy(state), "PC": (state["PC"] + 1) % 16, **changed}}
    rng = random.Random(20261005)
    for i in range(4):
        yield {"id": f"deterministic-{i}", "inputs": {
            "state": {"A": rng.randrange(256), "PC": rng.randrange(16), "OUT": rng.randrange(256),
                      "HALT": i % 2, "RAM": [rng.randrange(256) for _ in range(16)]},
            "program": [rng.randrange(256) for _ in range(16)], "inputByte": rng.randrange(256)},
            "expected": None}


def probe():
    """Run the declared composition; retain bounded agreement and rejection evidence."""
    from runtime import describe, run

    configs = {provider: make_cpu(provider) for provider in ("gates", "integer")}
    failures, rows, rejections, checks = [], [], [], []

    def execute(provider, inputs, implementations=None):
        identifier, definitions, defaults, schemas = configs[provider]
        return run(identifier, inputs, definitions=definitions,
                   implementations=defaults if implementations is None else implementations, schemas=schemas)

    checks.append({"name": "identical-declaration-for-both-providers",
                   "passed": configs["gates"][1] == configs["integer"][1]})
    opcode_coverage, feature_sets = set(), []
    sources_before = {name: hashlib.sha256((MACHINE / name).read_bytes()).hexdigest()
                      for name in ("core.py", "circuits.py", "oracle.py")}
    for case in _cases():
        before = deepcopy(case["inputs"])
        try:
            gate = execute("gates", case["inputs"])
            integer = execute("integer", case["inputs"])
            state = gate["outputs"]["state"]
            same = state == integer["outputs"]["state"]
            literal = case["expected"] is None or state == case["expected"]
            features_match = gate["features"] == integer["features"]
            unchanged = case["inputs"] == before
            passed = same and literal and features_match and unchanged
            if not passed:
                failures.append({"case": case["id"], "inputs": before, "expected": case["expected"],
                                 "gates": state, "integer": integer["outputs"]["state"]})
            rows.append({"case": case["id"], "passed": passed, "nextState": state,
                         "literalExpectation": case["expected"] is not None,
                         "providersAgree": same, "featuresAgree": features_match, "inputsUnchanged": unchanged})
            if not feature_sets:
                feature_sets = gate["features"]
            if not before["state"]["HALT"]:
                opcode_coverage.add(before["program"][before["state"]["PC"]] >> 4)
        except Exception as error:
            failures.append({"case": case["id"], "error": str(error)})
            rows.append({"case": case["id"], "passed": False})

    counterexample = next(_cases())["inputs"]
    for name in ("wrong-pc", "missing-out", "missing-output-port"):
        observed = {}

        def broken(*, state, program, inputByte):
            result = integer_step(state=state, program=program, inputByte=inputByte)
            if name == "wrong-pc":
                result["state"]["PC"] = (result["state"]["PC"] + 1) % 16
            elif name == "missing-out":
                del result["state"]["OUT"]
            else:
                result = {}
            observed.update(deepcopy(result))
            return result

        implementations = {**configs["gates"][2], "cpu.transition": broken}
        try:
            execute("gates", deepcopy(counterexample), implementations)
            rejections.append({"case": name, "rejected": False})
            failures.append({"case": name, "error": "invalid provider was accepted"})
        except Exception as error:
            rejections.append({"case": name, "rejected": True, "reason": str(error),
                               "input": counterexample, "candidate": observed,
                               "expected": integer_step(**counterexample)})

    checks.extend([
        {"name": "all-directed-and-deterministic-cases-agree", "passed": all(row["passed"] for row in rows)},
        {"name": "covers-all-sixteen-opcodes", "passed": opcode_coverage == set(range(16))},
        {"name": "wrong-pc-and-missing-output-rejected", "passed": all(row["rejected"] for row in rejections)},
        {"name": "original-engine-files-unchanged", "passed": all(
            hashlib.sha256((MACHINE / name).read_bytes()).hexdigest() == digest
            for name, digest in sources_before.items())},
    ])
    for check in checks:
        if not check["passed"]:
            failures.append({"check": check["name"]})
    return {
        "question": "Can one declared CPU Step capability accept a gate CPU and an independent integer CPU, and reject a behavioral mismatch?",
        "prediction": "Both providers derive the same public capability and full next state; an incorrect PC or missing output is rejected.",
        "observations": {
            "casesCompared": len(rows), "opcodeCoverage": sorted(opcode_coverage), "cases": rows,
            "features": feature_sets, "declaration": describe("Cpu.Step", configs["gates"][1]),
            "providerImplementations": {
                "gates": {"transition": "circuits.build_cpu + core.run_net", "validator": "oracle.run_reference"},
                "integer": {"transition": "oracle.run_reference", "validator": "circuits.build_cpu + core.run_net"}},
            "rejections": rejections, "sourceHashes": sources_before,
        },
        "failures": failures, "checks": checks,
        "limitations": [
            "Twenty-two literal cases and four seeded cases are bounded evidence, not exhaustive CPU equivalence.",
            "Each call executes one logical clock tick; physical timing and multi-tick performance are outside this probe.",
            "FunctionalGuarantees depend on trusted declarations, schemas, and validators; replacing both provider and checker can defeat this boundary.",
            "Both implementations are Python programs; their execution logic is independent, but they share the stated instruction-set specification.",
        ],
    }


if __name__ == "__main__":
    report = probe()
    path = Path(__file__).with_name("cpu-report.json")
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(path), "cases": report["observations"]["casesCompared"],
                      "failures": len(report["failures"])}))
    raise SystemExit(bool(report["failures"]))
