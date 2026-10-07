"""Small declarations shared by the competing execution models."""

from common import Circuit, FunctionalGuarantee


def gate(circuit, address, rule, inputs):
    output = circuit.derive(address, rule, inputs)
    linked_input = (inputs[0] if rule == "wire" else
                    circuit.derive(address + "/inputs", "bundle", inputs))
    circuit.fg("checks/" + address, linked_input, output, rule)
    return output


def half_adder(circuit, name, a, b):
    result = gate(circuit, name + "/sum", "xor", (a, b))
    carry = gate(circuit, name + "/carry", "and", (a, b))
    return circuit.derive(name, "bundle", (result, carry))


def full_adder(circuit, name, a, b, carry_in):
    first = half_adder(circuit, name + "/first", a, b)
    first_sum = circuit.derive(name + "/first_sum", "get:0", (first,))
    c1 = circuit.derive(name + "/first_carry", "get:1", (first,))
    second = half_adder(circuit, name + "/second", first_sum, carry_in)
    result = circuit.derive(name + "/second_sum", "get:0", (second,))
    c2 = circuit.derive(name + "/second_carry", "get:1", (second,))
    carry = gate(circuit, name + "/carry", "or", (c1, c2))
    return circuit.derive(name, "bundle", (result, carry))


def adder(width=2, miswire=False):
    circuit = Circuit()
    a = tuple(circuit.input(f"in/a/{i}") for i in range(width))
    b = tuple(circuit.input(f"in/b/{i}") for i in range(width))
    carry = circuit.input("in/carry")
    sums, stages = [], []
    for index in range(width):
        other = b[0] if miswire else b[index]
        stage = full_adder(circuit, f"adder/{index}", a[index], other, carry)
        stages.append(stage)
        result = circuit.derive(stage + "/result", "get:0", (stage,))
        carry = circuit.derive(stage + "/carry_out", "get:1", (stage,))
        sums.append(result)
    circuit.derive("adder", "bundle", stages)
    circuit.derive("out/bits", "bundle", (*sums, carry))
    left = circuit.derive("contract/a", "bundle", a)
    right = circuit.derive("contract/b", "bundle", b)
    circuit.derive("contract/input", "bundle", (left, right, "in/carry"))
    gates = tuple(part.address + "/verdict" for part in circuit.parts.values()
                  if isinstance(part, FunctionalGuarantee))
    circuit.derive("checks/gates", "all", gates)
    arithmetic = circuit.fg("checks/arithmetic", "contract/input", "out/bits", "add")
    circuit.fg("checks/circuit", "checks/gates", arithmetic, "both")
    return circuit


def adder_inputs(a, b, carry=0, width=2):
    return {(name, 0): bit for name, bit in
            [(f"in/a/{i}", (a >> i) & 1) for i in range(width)] +
            [(f"in/b/{i}", (b >> i) & 1) for i in range(width)] +
            [("in/carry", carry)]}


def xor_comparison(bad=False):
    circuit = Circuit()
    a, b = circuit.input("in/a"), circuit.input("in/b")
    reference = gate(circuit, "reference", "xor", (a, b))
    either = gate(circuit, "candidate/either", "or", (a, b))
    both = gate(circuit, "candidate/both", "and", (a, b))
    not_both = gate(circuit, "candidate/not_both", "not", (both,))
    result = either if bad else gate(circuit, "candidate/out", "and", (either, not_both))
    circuit.fg("checks/comparison", reference, result, "eq")
    return circuit


def counter():
    """Two-bit modulo-four counter, composed of delays and gates."""
    circuit = Circuit()
    low = circuit.derive("state/low", "delay", ("next/low",), initial=0)
    high = circuit.derive("state/high", "delay", ("next/high",), initial=0)
    gate(circuit, "next/low", "not", (low,))
    gate(circuit, "next/high", "xor", (high, low))
    circuit.derive("state/bits", "bundle", (low, high))
    return circuit
