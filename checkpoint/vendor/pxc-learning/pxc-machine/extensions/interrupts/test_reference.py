"""Literal contract cases for the independently implemented interrupt oracle."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    from extensions.interrupts.reference import run_reference_interrupts
except ImportError:
    run_reference_interrupts = None

try:
    from extensions.interrupts import checks
except ImportError:
    checks = None


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(run_reference_interrupts), "independent interrupt reference is not implemented")

    def run_case(self, program, steps=1, **kwargs):
        return run_reference_interrupts(program + [0] * (16 - len(program)), steps, **kwargs)

    def test_timer_boundary_accepts_before_fetch_and_saves_current_context(self):
        states = self.run_case([0x1F], initial={"IE": 1, "TIMER": 31, "A": 99, "OUT": 42})
        self.assertEqual({k: states[0][k] for k in ("IRQ", "ACCEPT", "RETURN", "SCAN_DATA", "ROW_ENABLE")},
                         {"IRQ": 1, "ACCEPT": 1, "RETURN": 0, "SCAN_DATA": 0, "ROW_ENABLE": 1})
        self.assertEqual({k: states[1][k] for k in ("A", "PC", "OUT", "IE", "PENDING", "ACTIVE", "SAVED_PC", "SAVED_A", "TIMER", "SCAN_ROW")},
                         {"A": 99, "PC": 8, "OUT": 42, "IE": 1, "PENDING": 0, "ACTIVE": 1, "SAVED_PC": 0, "SAVED_A": 99, "TIMER": 0, "SCAN_ROW": 1})

    def test_ei_with_same_tick_request_records_pending_then_accepts(self):
        states = self.run_case([0x01, 0x1F], steps=2, irqs=[1, 0, 0])
        self.assertEqual([(s["PC"], s["IE"], s["PENDING"], s["ACTIVE"], s["A"]) for s in states],
                         [(0, 0, 0, 0, 0), (1, 1, 1, 0, 0), (8, 1, 0, 1, 0)])

    def test_accept_precedes_di_but_executed_di_masks_later_requests(self):
        accepted = self.run_case([0x02], initial={"IE": 1}, irqs=[1, 0])[-1]
        self.assertEqual((accepted["PC"], accepted["IE"], accepted["ACTIVE"]), (8, 1, 1))
        masked = self.run_case([0x02, 0x1F], steps=2, initial={"IE": 1}, irqs=[0, 1, 0])[-1]
        self.assertEqual((masked["PC"], masked["IE"], masked["ACTIVE"], masked["PENDING"], masked["A"]), (2, 0, 0, 1, 15))

    def test_iret_restores_exact_pc_and_a_while_preserving_handler_effects(self):
        ram = [0] * 16
        ram[3] = 128
        states = self.run_case([0x03], initial={"ACTIVE": 1, "A": 7, "OUT": 23, "SAVED_PC": 5, "SAVED_A": 91, "RAM": ram}, irqs=[1, 0])
        self.assertEqual(states[0]["RETURN"], 1)
        got = states[-1]
        self.assertEqual((got["PC"], got["A"], got["OUT"], got["ACTIVE"], got["PENDING"], got["SAVED_PC"], got["SAVED_A"]),
                         (5, 91, 23, 0, 1, 5, 91))
        self.assertEqual(got["RAM"], ram)

    def test_inactive_iret_is_nop(self):
        got = self.run_case([0x03], initial={"A": 99, "SAVED_PC": 7, "SAVED_A": 11})[-1]
        self.assertEqual((got["PC"], got["A"], got["ACTIVE"]), (1, 99, 0))

    def test_requests_during_handler_coalesce_and_accept_after_return(self):
        program = [0] * 8 + [0x00, 0x03] + [0] * 6
        states = self.run_case(program, steps=4, initial={"IE": 1, "PC": 8, "ACTIVE": 1, "SAVED_PC": 4, "SAVED_A": 77}, irqs=[1, 1, 1, 0, 0])
        self.assertEqual([(s["PC"], s["ACTIVE"], s["PENDING"]) for s in states],
                         [(8, 1, 0), (9, 1, 1), (4, 0, 1), (8, 1, 0), (9, 1, 0)])
        self.assertEqual(states[3]["SAVED_PC"], 4)
        self.assertEqual(states[3]["SAVED_A"], 77)

    def test_halt_keeps_cpu_frozen_but_advances_timer_and_scan(self):
        initial = {"HALT": 1, "IE": 1, "ACTIVE": 1, "PC": 6, "A": 42, "OUT": 17, "TIMER": 31, "SCAN_ROW": 7, "SAVED_PC": 3, "SAVED_A": 7}
        states = self.run_case([0x03] * 16, steps=2, initial=initial, irqs=[1, 1, 0])
        self.assertEqual([(s["TIMER"], s["SCAN_ROW"], s["PENDING"], s["ACCEPT"], s["RETURN"]) for s in states],
                         [(31, 7, 0, 0, 0), (0, 0, 1, 0, 0), (1, 1, 1, 0, 0)])
        for state in states:
            for key in ("HALT", "IE", "ACTIVE", "PC", "A", "OUT", "SAVED_PC", "SAVED_A"):
                self.assertEqual(state[key], initial[key])

    def test_handler_draws_pixel_then_resumes_unexecuted_instruction(self):
        program = [0x01, 0x1B, 0x12, 0xC0, 0xF0, 0, 0, 0, 0x11, 0xE0, 0xE0, 0xE0, 0x32, 0x03, 0, 0]
        states = self.run_case(program, steps=12, irqs=[0, 0, 1] + [0] * 10)
        self.assertEqual((states[3]["PC"], states[3]["SAVED_PC"], states[3]["SAVED_A"]), (8, 2, 11))
        self.assertEqual((states[9]["PC"], states[9]["A"], states[9]["RAM"][2]), (2, 11, 8))
        self.assertEqual((states[10]["PC"], states[10]["A"], states[10]["SCAN_ROW"], states[10]["SCAN_DATA"], states[10]["ROW_ENABLE"]), (3, 2, 2, 8, 4))
        self.assertEqual((states[12]["PC"], states[12]["HALT"], states[12]["OUT"]), (4, 1, 2))

    def test_original_opcode_semantics_match_existing_integer_oracle(self):
        from oracle import run_reference
        for opcode in range(16):
            for a in (0, 250):
                program = [opcode * 16 + 15] + [0] * 15
                initial = {"A": a, "OUT": 12, "RAM": [0] * 15 + [7]}
                old = run_reference(program, 1, initial=initial, inputs=[173, 0])[-1]
                new = self.run_case(program, initial=initial, inputs=[173, 0])[-1]
                self.assertEqual({k: new[k] for k in old}, old)

    def test_snapshots_do_not_alias_ram_or_change_supplied_initial_state(self):
        initial = {"RAM": [0] * 16, "A": 27}
        before = deepcopy(initial)
        states = self.run_case([0x31], initial=initial)
        self.assertEqual(initial, before)
        self.assertEqual(states[0]["RAM"][1], 0)
        self.assertEqual(states[1]["RAM"][1], 27)

    def test_rejects_wrong_widths_and_missing_final_input_observation(self):
        invalid = [dict(steps=-1), dict(initial={"TIMER": 32}), dict(initial={"SCAN_ROW": 8}),
                   dict(initial={"IE": 2}), dict(initial={"SAVED_PC": 16}), dict(initial={"SAVED_A": 256}),
                   dict(initial={"UNKNOWN": 0}), dict(inputs=[0]), dict(irqs=[0]), dict(irqs=[2, 0])]
        for kwargs in invalid:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.run_case([0], **kwargs)


class ValidatorTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(checks, "independent behavioral validators are not implemented")
        from extensions.interrupts.reference import expected_buses
        self.program = [0x01, 0x1B, 0x12, 0xC0, 0xF0, 0, 0, 0, 0x11, 0xE0, 0xE0, 0xE0, 0x32, 0x03, 0, 0]
        self.irqs = [0, 0, 1] + [0] * 10
        self.trace = {"states": [{"t": t, "buses": expected_buses(state), "fg": {"failed": 0, "status": "PASS"}}
                                 for t, state in enumerate(run_reference_interrupts(self.program, 12, irqs=self.irqs))]}

    def test_all_behavioral_checks_accept_reference_observations(self):
        result = checks.check_instruction_conformance(self.trace, self.program, 12, irqs=self.irqs)
        self.assertEqual((result["status"], result["loss"]), ("PASS", 0))
        for check in (checks.check_interrupt_context, checks.check_pending_semantics, checks.check_display_mapping):
            result = check(self.trace)
            self.assertEqual((result["status"], result["loss"]), ("PASS", 0))

    def test_wrong_return_address_rejected_despite_claimed_primitive_success(self):
        self.trace["states"][9]["buses"]["PC"] = 3
        result = checks.check_interrupt_context(self.trace)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(any(issue.get("field") == "PC" and issue.get("kind") == "interrupt-return" for issue in result["issues"]))
        self.assertEqual(checks.check_instruction_conformance(self.trace, self.program, 12, irqs=self.irqs)["status"], "FAIL")

    def test_entry_context_corruption_rejected(self):
        self.trace["states"][3]["buses"]["SAVED_A"] = 0
        self.assertEqual(checks.check_interrupt_context(self.trace)["status"], "FAIL")

    def test_pending_loss_and_timer_freeze_rejected(self):
        from extensions.interrupts.reference import expected_buses
        states = run_reference_interrupts([0] * 16, 2, initial={"HALT": 1, "TIMER": 31})
        trace = {"states": [{"t": t, "buses": expected_buses(state)} for t, state in enumerate(states)]}
        self.assertEqual(checks.check_pending_semantics(trace)["status"], "PASS")
        trace["states"][1]["buses"]["PENDING"] = 0
        trace["states"][1]["buses"]["TIMER"] = 31
        result = checks.check_pending_semantics(trace)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue({"PENDING", "TIMER"} <= {issue.get("field") for issue in result["issues"]})

    def test_scan_wrong_memory_column_and_row_enable_rejected(self):
        self.trace["states"][10]["buses"]["SCAN_DATA"] = 4
        self.trace["states"][10]["buses"]["ROW_ENABLE"] = 3
        result = checks.check_display_mapping(self.trace)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue({"SCAN_DATA", "ROW_ENABLE"} <= {issue.get("field") for issue in result["issues"]})

    def test_missing_states_fields_and_wrong_labels_cannot_pass(self):
        for check in (checks.check_interrupt_context, checks.check_pending_semantics, checks.check_display_mapping):
            for malformed in ({"states": []}, {"states": [{"t": 1, "buses": {}}]}, {}):
                self.assertEqual(check(malformed)["status"], "FAIL")
        del self.trace["states"][-1]
        self.assertEqual(checks.check_instruction_conformance(self.trace, self.program, 12, irqs=self.irqs)["status"], "FAIL")

    def test_boolean_bus_value_cannot_impersonate_integer_bit(self):
        self.trace["states"][0]["buses"]["ACTIVE"] = False
        self.assertEqual(checks.check_interrupt_context(self.trace)["status"], "FAIL")

    def test_structure_check_requires_independent_plan_and_catches_bad_shape(self):
        result = checks.check_trace_structure(self.trace, None, 12, None)
        self.assertEqual((result["status"], result["loss"]), ("UNVERIFIED", 1))
        result = checks.check_trace_structure({"states": []}, {}, 12, [])
        self.assertEqual(result["status"], "FAIL")


if __name__ == "__main__":
    unittest.main()
