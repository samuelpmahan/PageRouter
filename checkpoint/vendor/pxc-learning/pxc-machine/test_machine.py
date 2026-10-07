"""Literal instruction checks, then independent end-to-end circuit checks."""
import unittest
from copy import deepcopy

from oracle import run_reference
from machine_checks import conformance_loss


class OracleTests(unittest.TestCase):
    def test_each_opcode_from_literal_examples(self):
        # An incorrect opcode mapping or wrong source operand changes these states.
        ram = [0] * 16
        ram[3] = 7
        cases = [
            (0x03, {}, {}),                 # NOP ignores its operand.
            (0x13, {}, {"A": 3}),
            (0x23, {}, {"A": 7}),
            (0x33, {}, {"RAM": ram[:3] + [250] + ram[4:]}),
            (0x43, {}, {"A": 1}),           # 250 + 7 wraps.
            (0x53, {}, {"A": 243}),
            (0x63, {}, {"A": 2}),
            (0x73, {}, {"A": 255}),
            (0x83, {}, {"A": 253}),
            (0x93, {}, {"PC": 3}),
            (0xA3, {}, {}),
            (0xB3, {}, {"PC": 3}),
            (0xC3, {}, {"OUT": 250}),
            (0xD3, {}, {"A": 173}),
            (0xE3, {}, {"A": 244}),
            (0xF3, {}, {"HALT": 1, "PC": 0}),
        ]
        for instruction, overrides, changed in cases:
            with self.subTest(instruction=hex(instruction)):
                initial = {"A": 250, "PC": 0, "OUT": 12, "HALT": 0, "RAM": ram}
                initial.update(overrides)
                expected = dict(initial, PC=1, RAM=list(ram))
                expected.update(changed)
                actual = run_reference([instruction] + [0] * 15, 1,
                                       initial=initial, inputs=[173])[1]
                self.assertEqual(actual, expected)

    def test_zero_branch_and_wrap_boundaries(self):
        for instruction, accumulator, expected_pc in [(0xA3, 0, 3), (0xA3, 1, 0),
                                                     (0xB3, 0, 0), (0xB3, 1, 3)]:
            with self.subTest(instruction=hex(instruction), A=accumulator):
                states = run_reference([0] * 15 + [instruction], 1,
                                       initial={"PC": 15, "A": accumulator})
                self.assertEqual(states[1]["PC"], expected_pc)
        self.assertEqual(run_reference([0] * 16, 1, initial={"PC": 15})[1]["PC"], 0)

    def test_arithmetic_underflow_and_shift_discard(self):
        ram = [1] + [0] * 15
        self.assertEqual(run_reference([0x50] + [0] * 15, 1, initial={"RAM": ram})[1]["A"], 255)
        self.assertEqual(run_reference([0xE0] + [0] * 15, 1, initial={"A": 128})[1]["A"], 0)

    def test_store_load_output_and_halt_capture_prior_state(self):
        program = [0x1D, 0x35, 0x10, 0x25, 0xC0, 0xF0] + [0] * 10
        states = run_reference(program, 8)
        self.assertEqual([s["A"] for s in states], [0, 13, 13, 0, 13, 13, 13, 13, 13])
        self.assertEqual([s["PC"] for s in states], [0, 1, 2, 3, 4, 5, 5, 5, 5])
        self.assertEqual([s["RAM"][5] for s in states], [0, 0, 13, 13, 13, 13, 13, 13, 13])
        self.assertEqual([s["OUT"] for s in states], [0, 0, 0, 0, 0, 13, 13, 13, 13])
        self.assertEqual(states[6], states[8])
        states[8]["RAM"][5] = 99
        self.assertEqual(states[2]["RAM"][5], 13, "historical snapshots must not share RAM")

    def test_input_reads_at_executing_state_and_initial_halt_holds(self):
        states = run_reference([0xD0, 0xC0, 0xD0, 0xC0] + [0] * 12, 4, inputs=[42, 99, 7, 123])
        self.assertEqual([s["A"] for s in states], [0, 42, 42, 7, 7])
        self.assertEqual([s["OUT"] for s in states], [0, 0, 42, 42, 7])
        held = run_reference([0xD0] * 16, 3, initial={"A": 5, "HALT": 1}, inputs=[1, 2, 3])
        self.assertTrue(all(s == held[0] for s in held))

    def test_rejects_invalid_widths_instead_of_silent_truncation(self):
        for program, kwargs in [([256] + [0] * 15, {}), ([0] * 15, {}),
                                ([0] * 16, {"initial": {"A": 256}}),
                                ([0] * 16, {"initial": {"PC": 16}}),
                                ([0] * 16, {"initial": {"HALT": 2}}),
                                ([0] * 16, {"initial": {"RAM": [0]}}),
                                ([0] * 16, {"inputs": [True]}),
                                ([0] * 16, {"inputs": []})]:
            with self.subTest(program=program, kwargs=kwargs), self.assertRaises(ValueError):
                run_reference(program, 1, **kwargs)


class CheckingTests(unittest.TestCase):
    def test_independent_expectation_catches_matching_wrong_engines(self):
        expected = [{"A": 0, "PC": 0}, {"A": 13, "PC": 1}]
        wrong_a = [{"A": 0, "PC": 0}, {"A": 0, "PC": 1}]
        wrong_b = [dict(state) for state in wrong_a]
        self.assertEqual(conformance_loss(wrong_a, wrong_b)["total"], 0)
        self.assertEqual(conformance_loss(wrong_a, expected)["wrong_fields"], 1)

    def test_missing_records_and_fields_have_loss(self):
        expected = [{"A": 0, "PC": 0}, {"A": 13, "PC": 1}]
        self.assertEqual(conformance_loss([], expected)["missing_states"], 2)
        actual = [{"A": 0, "surprise": 1}]
        self.assertEqual(conformance_loss(actual, expected), {
            "missing_states": 1, "extra_states": 0, "missing_fields": 1,
            "extra_fields": 1, "wrong_fields": 0, "total": 3})

    def test_delay_trace_detects_stale_capture_and_omitted_execution(self):
        from core import Net, run_net, audit_trace, compile_net
        net = Net("independent-temporal-check")
        d = net.input("D")
        q = net.delay("Q", d)
        net.bus("Q", [q])
        obligations = compile_net(net)
        supplied = [{d: 0}, {d: 1}, {d: 0}]
        trace = run_net(net, 2, supplied)
        self.assertEqual([state["buses"]["Q"] for state in trace["states"]], [0, 0, 1])
        self.assertEqual(audit_trace(trace, obligations, 2, supplied)["loss"], 0)
        self.assertEqual(audit_trace(trace)["status"], "UNVERIFIED")
        stale = deepcopy(trace)
        stale["states"][2]["values"][trace["addresses"].index(q)] = 0
        self.assertGreater(audit_trace(stale, obligations, 2, supplied)["loss"], 0)
        omitted = deepcopy(trace)
        omitted["states"][1]["pxcLog"].pop()
        self.assertGreater(audit_trace(omitted, obligations, 2, supplied)["loss"], 0)

    def test_delay_rejects_an_undeclared_source(self):
        from core import Net, run_net
        net = Net("missing-source")
        net.delay("Q", "missing")
        with self.assertRaises(ValueError):
            run_net(net, 1)


if __name__ == "__main__":
    unittest.main()
