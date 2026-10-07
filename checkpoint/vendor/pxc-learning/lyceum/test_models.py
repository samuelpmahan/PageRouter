"""Shared behavioral checks. Run from this folder: python3 -m unittest -v"""

from dataclasses import FrozenInstanceError
from importlib import import_module
from itertools import product
import unittest

from common import Circuit, Part, Calculation, FunctionalGuarantee
from examples import adder, adder_inputs, counter, xor_comparison, gate


class SchemaTests(unittest.TestCase):
    def test_declarations_are_parts_and_execute_nothing(self):
        circuit = Circuit()
        a = circuit.input("a")
        out = circuit.derive("out", "wire", (a,))
        circuit.fg("identity", a, out, "wire")
        self.assertIsInstance(circuit.producers[out], Part)
        self.assertIsInstance(circuit.parts["identity"], Part)
        self.assertIsInstance(circuit.parts["identity"], FunctionalGuarantee)
        self.assertIsInstance(circuit.parts["identity/verdict/calc"], Calculation)
        self.assertEqual(circuit.parts[out].depends, ("out/calc",))
        self.assertFalse(hasattr(circuit.parts[out], "value"))
        with self.assertRaises(FrozenInstanceError):
            circuit.parts[out].address = "changed"

    def test_multiple_producers_rejected(self):
        circuit = Circuit()
        circuit.input("in")
        circuit.derive("wire", "wire", ("in",))
        with self.assertRaises(ValueError):
            circuit.derive("wire", "not", ("in",))

    def test_composites_are_addressed_parts_with_calculations(self):
        circuit = adder()
        for name in ("adder", "adder/0", "adder/0/first", "adder/0/second"):
            self.assertIsInstance(circuit.parts[name], Part)
            self.assertEqual(circuit.producers[name].rule, "bundle")
        self.assertEqual(circuit.producers["adder"].inputs, ("adder/0", "adder/1"))


class Behavior:
    def model(self, circuit, inputs=None):
        return self.engine(circuit, inputs or {})

    def ready(self, observation, value):
        self.assertEqual(observation.status, "ready", observation.reason)
        self.assertEqual(observation.value, value)

    def test_truth_tables(self):
        tables = {"and": (0, 0, 0, 1), "or": (0, 1, 1, 1),
                  "xor": (0, 1, 1, 0)}
        for rule, expected in tables.items():
            for (a, b), out in zip(product((0, 1), repeat=2), expected):
                with self.subTest(rule=rule, a=a, b=b):
                    circuit = Circuit()
                    circuit.input("a"), circuit.input("b")
                    circuit.derive("out", rule, ("a", "b"))
                    model = self.model(circuit, {("a", 0): a, ("b", 0): b})
                    self.ready(model.seek("out"), out)

    def test_primitive_gate_fg_matches_every_truth_table_row(self):
        for rule, arity in (("wire", 1), ("not", 1), ("and", 2), ("or", 2),
                            ("xor", 2), ("mux", 3)):
            for row in product((0, 1), repeat=arity):
                circuit = Circuit()
                inputs = tuple(circuit.input(f"in/{i}") for i in range(arity))
                gate(circuit, "out", rule, inputs)
                stimuli = {(name, 0): value for name, value in zip(inputs, row)}
                self.ready(self.model(circuit, stimuli).seek("checks/out/verdict"), 1)

    def test_wire_not_mux(self):
        for a in (0, 1):
            circuit = Circuit()
            circuit.input("a")
            circuit.derive("w", "wire", ("a",))
            circuit.derive("n", "not", ("a",))
            model = self.model(circuit, {("a", 0): a})
            self.ready(model.seek("w"), a)
            self.ready(model.seek("n"), 1 - a)
        for select, a, b in product((0, 1), repeat=3):
            circuit = Circuit()
            for name in ("s", "a", "b"):
                circuit.input(name)
            circuit.derive("out", "mux", ("s", "a", "b"))
            model = self.model(circuit, dict(zip((("s", 0), ("a", 0), ("b", 0)),
                                                (select, a, b))))
            self.ready(model.seek("out"), a if select == 0 else b)

    def test_missing_input_is_pending_not_zero(self):
        circuit = Circuit()
        circuit.input("a")
        circuit.derive("out", "wire", ("a",))
        self.assertEqual(self.model(circuit).seek("out").status, "pending")

    def test_invalid_requests_are_conflicts(self):
        circuit = Circuit()
        circuit.input("a")
        for address, tick, inputs in (("absent", 0, {}), ("a", -1, {}),
                                      ("a", 0, {("a", 0): 2})):
            self.assertEqual(self.model(circuit, inputs).seek(address, tick).status, "conflict")

    def test_undeclared_dependency_is_conflict(self):
        circuit = Circuit()
        circuit.derive("out", "wire", ("typo",))
        self.assertEqual(self.model(circuit).seek("out").status, "conflict")

    def test_fg_exposes_wrong_wire(self):
        circuit = Circuit()
        circuit.input("in")
        circuit.derive("out", "not", ("in",))
        verdict = circuit.fg("wire_contract", "in", "out", "wire")
        model = self.model(circuit, {("in", 0): 1})
        self.ready(model.seek(verdict), 0)
        self.assertIn((circuit.parts["wire_contract"].validators[0], 0), model.evaluations)

    def test_unknown_fg_is_not_a_verdict(self):
        circuit = Circuit()
        circuit.input("left"), circuit.input("right")
        verdict = circuit.fg("equal", "left", "right", "eq")
        self.assertEqual(self.model(circuit).seek(verdict).status, "pending")

    def test_feedback_cannot_fulfill_an_unknown_validator(self):
        circuit = Circuit()
        circuit.input("a"), circuit.input("b")
        verdict = circuit.fg("equal", "a", "b", "eq")
        circuit.derive("loop", "xor", (verdict, "loop"))
        model = self.model(circuit)
        self.assertEqual(model.seek(verdict).status, "pending")
        model.seek("loop")
        self.assertEqual(model.seek(verdict).status, "pending")
        self.assertNotIn(("equal/verdict/calc", 0), model.evaluations)

    def test_bundle_width_is_part_of_equality(self):
        circuit = Circuit()
        circuit.input("zero")
        circuit.derive("wide", "bundle", ("zero", "zero"))
        circuit.derive("narrow", "bundle", ("zero",))
        verdict = circuit.fg("same_shape", "wide", "narrow", "eq")
        self.ready(self.model(circuit, {("zero", 0): 0}).seek(verdict), 0)

    def test_cache_and_prefix_selection(self):
        circuit = Circuit()
        circuit.input("a")
        circuit.derive("x/one", "wire", ("a",))
        circuit.derive("x/two", "not", ("a",))
        circuit.derive("xyz/other", "wire", ("a",))
        model = self.model(circuit, {("a", 0): 1})
        self.ready(model.seek("x/one"), 1)
        first_count = len(model.evaluations)
        self.ready(model.seek("x/one"), 1)
        self.assertEqual(len(model.evaluations), first_count)
        self.assertEqual(set(model.seek_prefix("x")), {"x/one", "x/two"})

    def test_register_samples_previous_tick(self):
        circuit = Circuit()
        circuit.input("d")
        circuit.derive("q", "delay", ("d",), initial=0)
        model = self.model(circuit, {("d", 0): 1, ("d", 1): 0})
        for tick, expected in ((2, 0), (0, 0), (1, 1)):
            self.ready(model.seek("q", tick), expected)
        self.assertEqual(model.seek("q", 3).status, "pending")

    def test_register_swap_uses_one_old_snapshot(self):
        for reverse in (False, True):
            circuit = Circuit()
            declarations = [("a", "b", 0), ("b", "a", 1)]
            for out, source, initial in declarations[::(-1 if reverse else 1)]:
                circuit.derive(out, "delay", (source,), initial=initial)
            model = self.model(circuit)
            for tick in (4, 1, 3, 0, 2):
                self.ready(model.seek("a", tick), tick % 2)
                self.ready(model.seek("b", tick), 1 - tick % 2)

    def test_two_bit_counter(self):
        model = self.model(counter())
        for tick in (7, 0, 3, 8, 1, 5):
            value = tick % 4
            self.ready(model.seek("state/bits", tick), (value & 1, (value >> 1) & 1))

    def test_two_bit_addition_and_contract(self):
        circuit = adder()
        for a, b, carry in product(range(4), range(4), (0, 1)):
            with self.subTest(a=a, b=b, carry=carry):
                model = self.model(circuit, adder_inputs(a, b, carry))
                expected = a + b + carry
                self.ready(model.seek("out/bits"), tuple((expected >> i) & 1 for i in range(3)))
                self.ready(model.seek("checks/arithmetic/verdict"), 1)
                self.ready(model.seek("checks/circuit/verdict"), 1)

    def test_correct_gates_do_not_prove_correct_wiring(self):
        model = self.model(adder(miswire=True), adder_inputs(0, 2))
        self.ready(model.seek("checks/arithmetic/verdict"), 0)
        self.ready(model.seek("checks/circuit/verdict"), 0)
        checks = model.seek_prefix("checks/adder")
        self.assertTrue(checks)
        for verdict in checks.values():
            self.ready(verdict, 1)

    def test_comparison_preserves_counterexample(self):
        for a, b in product((0, 1), repeat=2):
            inputs = {("in/a", 0): a, ("in/b", 0): b}
            self.ready(self.model(xor_comparison(), inputs).seek("checks/comparison/verdict"), 1)
            self.ready(self.model(xor_comparison(bad=True), inputs).seek("checks/comparison/verdict"),
                       0 if a == b == 1 else 1)

    def test_fg_composition_all_and_any_have_different_meanings(self):
        circuit = Circuit()
        for name in ("a", "b", "c"):
            circuit.input(name)
        first = circuit.fg("ab", "a", "b", "eq")
        second = circuit.fg("ac", "a", "c", "eq")
        both = circuit.fg("both", first, second, "both")
        either = circuit.fg("either", first, second, "either")
        self.assertIsInstance(circuit.parts["both"], FunctionalGuarantee)
        self.assertIsInstance(circuit.parts["either"], FunctionalGuarantee)
        model = self.model(circuit, {("a", 0): 1, ("b", 0): 1, ("c", 0): 0})
        self.ready(model.seek(both), 0)
        self.ready(model.seek(either), 1)


for module_name in ("lazy", "clocked", "relational"):
    engine = import_module(module_name).Model
    globals()[module_name.title() + "Tests"] = type(
        module_name.title() + "Tests", (Behavior, unittest.TestCase), {"engine": engine})


if __name__ == "__main__":
    unittest.main()
