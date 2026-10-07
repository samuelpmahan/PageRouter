"""Independent literal checks: no imports from the gate device or its circuits."""
import unittest
from copy import deepcopy

from device_oracle import compare_trace, expected_states, expected_truth_rows, seven_segment


class DeviceOracleTests(unittest.TestCase):
    def test_literal_decimal_segments_and_blank_invalid_digits(self):
        # Bit 0=a through bit 6=g; bit 7 is the decimal point.
        self.assertEqual([seven_segment(n) for n in range(16)],
                         [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07,
                          0x7F, 0x6F, 0, 0, 0, 0, 0, 0])
        self.assertEqual(seven_segment(0, decimal_point=1), 0xBF)

    def test_transition_consumes_prior_controls_and_reset_has_priority(self):
        controls = [{'run': 1, 'reset': 0}, {'run': 0, 'reset': 0},
                    {'run': 1, 'reset': 1}, {'run': 0, 'reset': 0},
                    {'run': 1, 'reset': 0}]
        states = expected_states(5, controls, initial_ms=998)
        self.assertEqual([s['elapsed_ms'] for s in states], [998, 999, 999, 0, 0, 1])
        self.assertEqual([s['scan'] for s in states], [0, 1, 2, 3, 4, 5])
        self.assertEqual([s['div_digits'] for s in states],
                         [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [5, 0, 0]])
        self.assertEqual(states[3]['segments'], 0xBF)

    def test_millisecond_carry_wrap_and_scan(self):
        controls = [{'run': 1, 'reset': 0}] * 10
        states = expected_states(10, controls, initial_ms=999)
        self.assertEqual(states[0]['digits'], [9, 9, 9, 0, 0, 0, 0, 0])
        self.assertEqual(states[1]['digits'], [0, 0, 0, 1, 0, 0, 0, 0])
        self.assertEqual(states[3]['selected_digit'], 1)
        self.assertEqual(states[3]['segments'], 0x86)
        self.assertEqual([states[t]['digit_enable'] for t in range(9)],
                         [1, 2, 4, 8, 16, 32, 64, 128, 1])
        wrap = expected_states(1, controls, initial_ms=99_999_999)
        self.assertEqual(wrap[1]['elapsed_ms'], 0)

    def test_free_running_strobe_survives_pause_and_reset(self):
        states = expected_states(1001, [{'run': 0, 'reset': 1}] * 1001)
        self.assertEqual([s['t'] for s in states if s['strobe']], [1000])
        self.assertEqual(states[999]['div_digits'], [9, 9, 9])
        self.assertEqual(states[1000]['div_digits'], [0, 0, 0])
        self.assertEqual(states[1001]['div_digits'], [1, 0, 0])
        self.assertTrue(all(s['elapsed_ms'] == 0 for s in states))

    def test_divider_literal_boundaries_and_invalid_recovery(self):
        rows = {(r['state'], r['run'], r['reset']): (r['next'], r['carry'])
                for r in expected_truth_rows()}
        self.assertEqual(len(rows), 64)
        for state in range(16):
            self.assertEqual(rows[state, 0, 0], (state, 0))
            self.assertEqual(rows[state, 0, 1], (0, 0))
            self.assertEqual(rows[state, 1, 1], (0, 0))
        self.assertEqual(rows[8, 1, 0], (9, 0))
        self.assertEqual(rows[9, 1, 0], (0, 1))
        for invalid in range(10, 16):
            self.assertEqual(rows[invalid, 1, 0], (0, 0))

    def test_checker_is_independent_of_primitive_fg_summary(self):
        controls = [{'run': 1, 'reset': 0}]
        trace = {'states': [
            {'t': 0, 'buses': {**{f'BCD{i}': 0 for i in range(8)},
                               **{f'DIV{i}': 0 for i in range(3)},
                               'STROBE': 0, 'SCAN': 0, 'DIGIT_ENABLE': 1,
                               'SELECTED_DIGIT': 0, 'SEGMENTS': 0x3F}},
            {'t': 1, 'buses': {**{f'BCD{i}': int(i == 0) for i in range(8)},
                               **{f'DIV{i}': int(i == 0) for i in range(3)},
                               'STROBE': 0, 'SCAN': 1, 'DIGIT_ENABLE': 2,
                               'SELECTED_DIGIT': 0, 'SEGMENTS': 0x3F}},
        ]}
        self.assertEqual(compare_trace(trace, controls)['loss'], 0)
        terminal = controls + [{'run': 0, 'reset': 1}]
        self.assertEqual(compare_trace(trace, terminal, steps=1)['loss'], 0)
        self.assertGreater(compare_trace(trace, terminal, steps=2)['loss'], 0)
        wrong = deepcopy(trace)
        wrong['states'][1]['fg'] = {'failed': 0, 'passed': 1000}
        wrong['states'][1]['buses']['BCD0'] = 0
        verdict = compare_trace(wrong, controls)
        self.assertEqual(verdict['loss'], 1)
        self.assertEqual(verdict['failures'][0]['bus'], 'BCD0')
        missing = deepcopy(trace)
        missing['states'].pop()
        self.assertGreater(compare_trace(missing, controls)['loss'], 0)
        self.assertGreater(compare_trace(missing, terminal, steps=1)['loss'], 0)
        extra = deepcopy(trace)
        extra['states'].append(deepcopy(trace['states'][-1]))
        self.assertGreater(compare_trace(extra, controls)['loss'], 0)
        wrong = deepcopy(trace)
        wrong['states'][1]['t'] = 0
        self.assertGreater(compare_trace(wrong, controls)['loss'], 0)

    def test_rejects_ambiguous_or_missing_inputs(self):
        for args in [(-1, []), (1, []), (1, [{'run': True, 'reset': 0}]),
                     (1, [{'run': 2, 'reset': 0}]), (1, [{'run': 1}])]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                expected_states(*args)
        for initial in [-1, 100_000_000, True]:
            with self.assertRaises(ValueError):
                expected_states(0, [], initial_ms=initial)


if __name__ == '__main__':
    unittest.main()
