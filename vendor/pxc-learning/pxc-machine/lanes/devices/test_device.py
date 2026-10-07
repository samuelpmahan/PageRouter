"""Exhaustive finite contracts and exact state-boundary scenarios."""
import unittest
from device import decimal_next, display, build_stopwatch, inputs
from core import Net, run_net, compile_net, audit_trace


class DeviceTests(unittest.TestCase):
    def test_decimal_transition_table(self):
        net = Net('decimal-transition')
        q = [net.input(f'q/{i}') for i in range(4)]
        enable, reset = net.input('enable'), net.input('reset')
        nxt, carry = decimal_next(net, 'decimal', q, enable, reset)
        net.bus('NEXT', nxt); net.bus('CARRY', [carry])
        for state in range(16):
            for run in (0, 1):
                for clear in (0, 1):
                    supplied = {f'q/{i}': (state >> i) & 1 for i in range(4)}
                    supplied.update(enable=run, reset=clear)
                    actual = run_net(net, 0, [supplied])['states'][0]['buses']
                    expected = 0 if clear else state if not run else state + 1 if state < 9 else 0
                    self.assertEqual(actual['NEXT'], expected, (state, run, clear))
                    self.assertEqual(actual['CARRY'], int(state == 9 and run and not clear), (state, run, clear))

    def test_display_all_digits_and_invalid_values_at_every_scan(self):
        literal = (0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0, 0, 0, 0, 0, 0)
        net = Net('display-table')
        digits = [[net.input(f'digit/{d}/{b}') for b in range(4)] for d in range(8)]
        scan = [net.input(f'scan/{b}') for b in range(3)]
        selected, segments, enable = display(net, 'display', digits, scan)
        net.bus('VALUE', selected); net.bus('SEGMENTS', segments); net.bus('ENABLE', enable)
        for scan_index in range(8):
            for value in range(16):
                data = {f'digit/{d}/{b}': (((value if d == scan_index else d) >> b) & 1)
                        for d in range(8) for b in range(4)}
                data.update({f'scan/{b}': (scan_index >> b) & 1 for b in range(3)})
                state = run_net(net, 0, [data])['states'][0]
                self.assertEqual(state['buses']['VALUE'], value)
                self.assertEqual(state['buses']['ENABLE'], 1 << scan_index)
                self.assertEqual(state['buses']['SEGMENTS'], literal[value] | (128 if scan_index == 3 else 0))
                self.assertEqual(state['fg']['failed'], 0)

    def test_run_pause_reset_and_carry_are_real_gates(self):
        net = build_stopwatch(998)
        controls = [{'run': 1, 'reset': 0}] * 3 + [{'run': 0, 'reset': 0}] * 2 + [{'run': 0, 'reset': 1}] + [{'run': 1, 'reset': 0}] * 3
        trace = run_net(net, 8, inputs(controls), delta=True)
        observed = [sum(s['buses'][f'BCD{i}'] * 10**i for i in range(8)) for s in trace['states']]
        self.assertEqual(observed, [998, 999, 1000, 1001, 1001, 1001, 0, 1, 2])
        self.assertEqual(audit_trace(trace, compile_net(net), 8, inputs(controls))['loss'], 0)
        self.assertEqual(set(c['rule'] for c in trace['calculations']), {'nand', 'wire', 'delay', 'check:nand', 'check:wire', 'check:delay'})

    def test_eight_digit_rollover(self):
        trace = run_net(build_stopwatch(99_999_999), 1, inputs([{'run': 1, 'reset': 0}] * 2))
        self.assertTrue(all(trace['states'][1]['buses'][f'BCD{i}'] == 0 for i in range(8)))
        self.assertEqual(trace['states'][0]['buses']['ELAPSED_ROLLOVER'], 1)

    def test_control_bus_labels_and_pending_rollover(self):
        for initial in (0, 99_999_998, 99_999_999):
            for run in (0, 1):
                for reset in (0, 1):
                    controls = [{'run': run, 'reset': reset}] * 2
                    trace = run_net(build_stopwatch(initial), 1, inputs(controls))
                    elapsed = [initial, 0 if reset else (initial + run) % 100_000_000]
                    for t, state in enumerate(trace['states']):
                        self.assertEqual(state['buses']['RUN'], run)
                        self.assertEqual(state['buses']['RESET'], reset)
                        self.assertEqual(state['buses']['ELAPSED_ROLLOVER'],
                                         int(elapsed[t] == 99_999_999 and run and not reset))


if __name__ == '__main__':
    unittest.main()
