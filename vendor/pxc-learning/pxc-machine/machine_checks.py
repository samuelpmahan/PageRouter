"""Independent CPU-state conformance checks and measured execution receipt."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import time

from oracle import run_reference


def conformance_loss(actual, expected):
    result = {"missing_states": max(0, len(expected) - len(actual)),
              "extra_states": max(0, len(actual) - len(expected)),
              "missing_fields": 0, "extra_fields": 0, "wrong_fields": 0}
    for observed, required in zip(actual, expected):
        result["missing_fields"] += len(required.keys() - observed.keys())
        result["extra_fields"] += len(observed.keys() - required.keys())
        result["wrong_fields"] += sum(observed[key] != required[key]
                                      for key in observed.keys() & required.keys())
    result["total"] = sum(result.values())
    return result


def expected_buses(state):
    return {**{key: state[key] for key in ("A", "PC", "OUT", "HALT")},
            **{f"RAM{i:02}": value for i, value in enumerate(state["RAM"])}}


def cases(random_count=100, steps=8, seed=20261004):
    """Explicit boundaries followed by a reproducible sample, not exhaustive CPU proof."""
    ram = [0] * 16
    ram[15] = 7
    for opcode in range(16):
        yield {"id": f"opcode-{opcode:01x}", "program": [0] * 15 + [16 * opcode + 15],
               "initial": {"A": 250, "PC": 15, "OUT": 12, "RAM": ram},
               "inputs": [173, 99], "steps": 1}
    for opcode in (10, 11):
        yield {"id": f"zero-branch-{opcode:01x}", "program": [16 * opcode + 3] + [0] * 15,
               "initial": {"A": 0}, "inputs": [0, 0], "steps": 1}
    yield {"id": "sub-underflow", "program": [0x50] + [0] * 15,
           "initial": {"RAM": [1] + [0] * 15}, "inputs": [0, 0], "steps": 1}
    yield {"id": "shift-discard", "program": [0xE0] + [0] * 15,
           "initial": {"A": 128}, "inputs": [0, 0], "steps": 1}
    yield {"id": "store-load-output-halt", "program": [0x1D, 0x35, 0x10, 0x25, 0xC0, 0xF0] + [0] * 10,
           "initial": {}, "inputs": [0] * 9, "steps": 8}
    yield {"id": "input-capture", "program": [0xD0, 0xC0, 0xD0, 0xC0] + [0] * 12,
           "initial": {}, "inputs": [42, 99, 7, 123, 0], "steps": 4}
    yield {"id": "countdown-loop", "program": [0x50, 0xC0, 0xB0, 0xF0] + [0] * 12,
           "initial": {"A": 3, "RAM": [1] + [0] * 15}, "inputs": [0] * 12, "steps": 11}
    yield {"id": "already-halted", "program": [0xD0] * 16,
           "initial": {"A": 5, "HALT": 1, "OUT": 19, "PC": 12},
           "inputs": [1, 2, 3, 4], "steps": 3}
    rng = random.Random(seed)
    for index in range(random_count):
        yield {"id": f"random-{index:03}", "program": [rng.randrange(256) for _ in range(16)],
               "initial": {"A": rng.randrange(256), "PC": rng.randrange(16),
                           "OUT": rng.randrange(256), "HALT": int(index % 17 == 16),
                           "RAM": [rng.randrange(256) for _ in range(16)]},
               "inputs": [rng.randrange(256) for _ in range(steps + 1)], "steps": steps}


def verify(random_count=100, steps=8, seed=20261004):
    here = Path(__file__).resolve().parent
    sources = ["PLAN.md", "core.py", "circuits.py", "synthesis.py", "oracle.py", "test_machine.py",
               "machine_checks.py", "../lyceum/common.py"]
    def source_hashes():
        return {name: hashlib.sha256((here / name).read_bytes()).hexdigest() for name in sources}
    starting_sources = source_hashes()
    # Imports at the integration boundary only; oracle.py shares no implementation.
    from circuits import build_cpu
    from core import run_net, audit_trace, compile_net

    started = time.perf_counter()
    rows, failures = [], []
    opcode_coverage = {f"{i:x}": 0 for i in range(16)}
    first = None
    for case in cases(random_count, steps, seed):
        case_start = time.perf_counter()
        net = build_cpu(case["program"], initial=case["initial"])
        expected_plan = compile_net(net)
        stimuli = [{address: (byte >> bit) & 1 for bit, address in enumerate(net.buses["IN"])}
                   for byte in case["inputs"]]
        expected_states = run_reference(case["program"], case["steps"],
                                        initial=case["initial"], inputs=case["inputs"])
        expected = []
        for tick, state in enumerate(expected_states):
            instruction = case["program"][state["PC"]]
            expected.append({**expected_buses(state), "IN": case["inputs"][tick],
                             "INSTRUCTION": instruction, "OPCODE": instruction // 16,
                             "OPERAND": instruction % 16})
        full = run_net(net, case["steps"], stimuli=stimuli, delta=False)
        delta = run_net(net, case["steps"], stimuli=stimuli, delta=True)
        wanted = set(expected[0])
        full_cpu = [{key: value for key, value in state["buses"].items() if key in wanted}
                    for state in full["states"]]
        delta_cpu = [{key: value for key, value in state["buses"].items() if key in wanted}
                     for state in delta["states"]]
        full_loss, delta_loss = conformance_loss(full_cpu, expected), conformance_loss(delta_cpu, expected)
        bit_loss = sum(a["values"] != b["values"] for a, b in zip(full["states"], delta["states"]))
        bit_loss += abs(len(full["states"]) - len(delta["states"]))
        audits = [audit_trace(trace, expected_plan, case["steps"], stimuli) for trace in (full, delta)]
        fg_failures = sum(state["fg"]["failed"] for trace in (full, delta) for state in trace["states"])
        row = {"id": case["id"], "statesPerEngine": len(expected), "fullOracleLoss": full_loss,
               "deltaOracleLoss": delta_loss, "fullDeltaBitStateMismatch": bit_loss,
               "traceAuditLoss": sum(audit["loss"] for audit in audits), "fgFailures": fg_failures,
               "fullEvaluated": full["totals"]["evaluated"], "deltaEvaluated": delta["totals"]["evaluated"],
               "deltaReused": delta["totals"]["reused"], "seconds": round(time.perf_counter() - case_start, 6)}
        row["totalLoss"] = full_loss["total"] + delta_loss["total"] + bit_loss + row["traceAuditLoss"] + fg_failures
        rows.append(row)
        for state in expected_states[:-1]:
            if not state["HALT"]:
                opcode_coverage[f'{case["program"][state["PC"]] >> 4:x}'] += 1
        if row["totalLoss"]:
            failures.append({"case": case, "expected": expected, "full": full_cpu, "delta": delta_cpu,
                             "audits": audits})
        if first is None:
            first = (case, expected, full_cpu)

    # This is a deliberate observation corruption, not an injected circuit fault.
    # Equal engine records still need an independent expectation to mean anything.
    _, expected, observed = first
    both_wrong = [dict(state) for state in observed]
    both_wrong[-1]["A"] ^= 1
    mutation = {"kind": "same deliberately corrupted observation in both engines",
                "engineAgreementLoss": conformance_loss(both_wrong, both_wrong)["total"],
                "independentOracleLoss": conformance_loss(both_wrong, expected)["total"]}
    final_sources = source_hashes()
    changed_sources = [name for name in sources if starting_sources[name] != final_sources[name]]
    receipt = {"schema": "pxc-machine-conformance/v1", "status": "PASS" if not failures and not changed_sources else "FAIL",
               "seed": seed, "caseCount": len(rows), "randomCaseCount": random_count,
               "randomSteps": steps, "statesPerEngine": sum(row["statesPerEngine"] for row in rows),
               "totalLoss": sum(row["totalLoss"] for row in rows), "opcodeExecutionCounts": opcode_coverage,
               "fullEvaluated": sum(row["fullEvaluated"] for row in rows),
               "deltaEvaluated": sum(row["deltaEvaluated"] for row in rows),
               "deltaReused": sum(row["deltaReused"] for row in rows), "mutation": mutation,
               "sourceSha256": final_sources, "startingSourceSha256": starting_sources,
               "changedSourcesDuringExecution": changed_sources,
               "seconds": round(time.perf_counter() - started, 6), "cases": rows, "failures": failures,
               "limits": ["Generated CPU programs and state sequences are sampled, not exhaustive.",
                          "Full and delta share the same gate evaluator; the integer oracle is independent.",
                          "The matching-wrong-output probe mutates observations, not executable circuits."]}
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--random-cases", type=int, default=100)
    parser.add_argument("--steps", type=int, default=8)
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("machine-verification.json"))
    args = parser.parse_args()
    receipt = verify(args.random_cases, args.steps)
    args.output.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({key: receipt[key] for key in ("status", "caseCount", "statesPerEngine", "totalLoss", "seconds")}))
    raise SystemExit(receipt["status"] != "PASS")
