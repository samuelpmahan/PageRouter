"""JSON-lines test bridge. Mutations affect fresh declarations only, never source files."""
from dataclasses import replace
import hashlib
import json
from pathlib import Path
import sys

from circuits import build_cpu
from core import audit_trace, compile_net, run_net
from machine_checks import conformance_loss, expected_buses
from oracle import run_reference

HERE = Path(__file__).resolve().parent
SOURCES = ("PLAN.md", "core.py", "circuits.py", "synthesis.py", "oracle.py",
           "machine_checks.py", "generated_bridge.py", "../lyceum/common.py")


def evidence():
    return {"python": sys.version, "sourceSha256": {
        name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in SOURCES}}


def check(case, mutant=False):
    steps, inputs = case["steps"], case["inputs"]
    if type(steps) is not int or not 3 <= steps <= 5 or len(inputs) != steps + 1:
        raise ValueError("Expected 3..5 ticks and one input observation per state")
    expected_states = run_reference(case["program"], steps,
                                    initial=case["initial"], inputs=inputs)
    net = build_cpu(case["program"], initial=case["initial"])
    mutation = None
    if mutant:
        # Keep the original equality FG. Only this test's fresh wire declaration changes.
        original = net.producers["cpu/a/next/0"]
        assert original.rule == "wire" and len(original.inputs) == 1
        changed = replace(original, inputs=(net.buses["A"][0],))
        net.producers[original.output] = changed
        net.parts[original.address] = changed
        mutation = {"kind": "wire source replaced by old accumulator bit 0",
                    "calculation": original.address, "rule": original.rule,
                    "originalInputs": original.inputs, "mutatedInputs": changed.inputs,
                    "originalValidatorRetained": original.output + "/valid"}
    stimuli = [{address: (value >> bit) & 1 for bit, address in enumerate(net.buses["IN"])}
               for value in inputs]
    expected = []
    for tick, state in enumerate(expected_states):
        instruction = case["program"][state["PC"]]
        expected.append({**expected_buses(state), "IN": inputs[tick],
                         "INSTRUCTION": instruction, "OPCODE": instruction // 16,
                         "OPERAND": instruction % 16})
    expected_plan = compile_net(net)
    full = run_net(net, steps, stimuli=stimuli, delta=False)
    delta = run_net(net, steps, stimuli=stimuli, delta=True)
    audit_loss = sum(audit_trace(trace, expected_plan, steps, stimuli)["loss"] for trace in (full, delta))
    wanted = set(expected[0])
    project = lambda trace: [{k: v for k, v in state["buses"].items() if k in wanted}
                             for state in trace["states"]]
    observed = project(full)
    full_loss = conformance_loss(observed, expected)
    delta_loss = conformance_loss(project(delta), expected)
    bit_loss = sum(a["values"] != b["values"] for a, b in zip(full["states"], delta["states"]))
    bit_loss += abs(len(full["states"]) - len(delta["states"]))
    fg_failures = sum(state["fg"]["failed"] for trace in (full, delta) for state in trace["states"])
    first = next(({"t": tick, "bus": name, "expected": value, "actual": actual.get(name)}
                  for tick, (actual, required) in enumerate(zip(observed, expected))
                  for name, value in required.items() if actual.get(name) != value), None)
    return {"statesPerEngine": len(expected), "fullOracleLoss": full_loss,
            "deltaOracleLoss": delta_loss, "fullDeltaBitStateMismatch": bit_loss,
            "fgFailures": fg_failures, "traceAuditLoss": audit_loss,
            "totalLoss": full_loss["total"] + delta_loss["total"] + bit_loss + fg_failures + audit_loss,
            "firstMismatch": first, "mutation": mutation,
            "executedOpcodes": [case["program"][state["PC"]] >> 4
                                for state in expected_states[:-1] if not state["HALT"]],
            "fullEvaluated": full["totals"]["evaluated"],
            "deltaEvaluated": delta["totals"]["evaluated"],
            "deltaReused": delta["totals"]["reused"]}


def main():
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            if request["op"] == "evidence":
                result = evidence()
            elif request["op"] == "check":
                result = check(request["case"], request.get("mutant", False))
            else:
                raise ValueError("Unknown bridge operation")
            print(json.dumps({"id": request["id"], "result": result}), flush=True)
        except Exception as error:
            print(json.dumps({"id": request.get("id") if isinstance(request, dict) else None,
                              "error": f"{type(error).__name__}: {error}"}), flush=True)


if __name__ == "__main__":
    main()
