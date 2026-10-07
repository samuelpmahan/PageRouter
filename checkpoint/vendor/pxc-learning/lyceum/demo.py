"""Generate actual comparison observations: python3 demo.py > results.json"""

from dataclasses import asdict
from importlib import import_module
from itertools import product
import json

from common import Circuit, Calculation, FunctionalGuarantee
from examples import adder, adder_inputs, counter, xor_comparison


def observe(model, address, tick=0):
    return asdict(model.seek(address, tick))


def probe(engine):
    evidence = {}
    circuit = Circuit()
    circuit.input("zero"), circuit.input("unknown")
    circuit.derive("and", "and", ("zero", "unknown"))
    circuit.derive("inputs", "bundle", ("zero", "unknown"))
    verdict = circuit.fg("and_fg", "inputs", "and", "and")
    model = engine(circuit, {("zero", 0): 0})
    evidence["partial_and"] = observe(model, "and")
    evidence["partial_and_fg"] = observe(model, verdict)

    circuit = Circuit()
    circuit.input("a")
    circuit.derive("wanted", "wire", ("a",))
    circuit.derive("unrelated/one", "not", ("a",))
    circuit.derive("unrelated/two", "not", ("unrelated/one",))
    model = engine(circuit, {("a", 0): 1})
    evidence["demand"] = {"answer": observe(model, "wanted"),
                          "executed": list(model.evaluations)}

    evidence["loops"] = {}
    for label, rules in (("identity", ("wire",)), ("self_not", ("not",)),
                         ("three_not_ring", ("not", "not", "not"))):
        circuit = Circuit()
        for index, rule in enumerate(rules):
            circuit.derive(str(index), rule, (str((index + 1) % len(rules)),))
        evidence["loops"][label] = observe(engine(circuit, {}), "0")

    model = engine(counter(), {})
    values = {str(tick): observe(model, "state/bits", tick) for tick in (7, 2, 8)}
    before = len(model.evaluations)
    observe(model, "state/bits", 2)
    evidence["counter"] = {"observations": values,
                           "executions_before_repeat": before,
                           "executions_after_repeat": len(model.evaluations)}

    model = engine(adder(miswire=True), adder_inputs(0, 2))
    evidence["wrong_wiring"] = {
        "result": observe(model, "out/bits"),
        "whole_arithmetic_fg": observe(model, "checks/arithmetic/verdict"),
        "composed_circuit_fg": observe(model, "checks/circuit/verdict"),
        "individual_gate_fgs": {
            key: asdict(value) for key, value in model.seek_prefix("checks/adder").items()
        },
    }

    comparisons = []
    for a, b in product((0, 1), repeat=2):
        model = engine(xor_comparison(bad=True), {("in/a", 0): a, ("in/b", 0): b})
        comparisons.append({"inputs": [a, b],
                            "fg": observe(model, "checks/comparison/verdict")})
    evidence["xor_vs_wrong_or"] = comparisons

    circuit = counter()
    model = engine(circuit, {})
    observe(model, "state/bits", 2)
    evidence["counter_derivation"] = [
        {"address": address, "tick": tick, "value": value,
         "depends": list(circuit.parts[address].depends)}
        for (address, tick), value in sorted(model.cache.items(), key=lambda row: (row[0][1], row[0][0]))
    ]
    evidence["schema_instance_counts"] = {
        "calculation_parts": sum(isinstance(p, Calculation) for p in circuit.parts.values()),
        "fg_parts": sum(isinstance(p, FunctionalGuarantee) for p in circuit.parts.values()),
        "value_parts": len(circuit.values),
    }
    return evidence


if __name__ == "__main__":
    report = {name: probe(import_module(name).Model)
              for name in ("lazy", "clocked", "relational")}
    print(json.dumps(report, indent=2))
