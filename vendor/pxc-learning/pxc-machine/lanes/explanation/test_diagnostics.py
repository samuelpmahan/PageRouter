"""Diagnostic obligations: values, provenance, closure, and honest uncertainty."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import Net, compile_net, execute_plan
from dataclasses import replace
from diagnostics import diagnose as run_diagnosis, inspect_part, build_cases


def diagnose(plan, clean, observed_plan, observed, steps, stimuli=None):
    requested = stimuli if stimuli is not None else [{'a': 1, 'b': 0}, {'a': 0, 'b': 0}]
    return run_diagnosis(plan, clean, observed_plan, observed, steps, requested)


def fixture(wrong_origin=False):
    net = Net('diagnostic-fixture')
    a, b = net.input('a'), net.input('b')
    net.wire('copy', a); net.delay('q', 'copy'); net.bus('Q', ['q'])
    expected = compile_net(net)
    if wrong_origin:
        old = net.producers['copy']; changed = replace(old, inputs=(b,))
        net.producers['copy'] = changed; net.parts[old.address] = changed
    actual = compile_net(net)
    stimuli = [{'a': 1, 'b': 0}, {'a': 0, 'b': 0}]
    return expected, execute_plan(expected, 1, stimuli), actual, execute_plan(actual, 1, stimuli)


class DiagnosticsTests(unittest.TestCase):
    def test_causal_path_crosses_clock_boundary(self):
        plan, clean, observed_plan, wrong = fixture(True)
        result = diagnose(plan, clean, observed_plan, wrong, 1)
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['firstBusDifference'], {'t': 1, 'bus': 'Q', 'expected': 1, 'actual': 0})
        self.assertEqual([(x['t'], x['address']) for x in result['explanation']['path']], [(1, 'q'), (0, 'copy')])
        self.assertEqual(result['explanation']['frontier']['kind'], 'changed-origin')
        self.assertEqual(result['retainedFailures'][0]['address'], 'copy/fg')

    def test_equal_values_do_not_hide_changed_origin(self):
        plan, clean, observed_plan, wrong = fixture(True)
        stimuli = [{'a': 0, 'b': 0}] * 2
        result = diagnose(plan, execute_plan(plan, 1, stimuli), observed_plan, execute_plan(observed_plan, 1, stimuli), 1, stimuli)
        self.assertEqual(result['loss']['wrongValue'], 0)
        self.assertGreater(result['loss']['wrongOrigin'], 0)
        self.assertEqual(result['status'], 'FAIL')

    def test_missing_validator_log_cannot_be_pass(self):
        plan, clean, _, observed = fixture()
        ci = next(c['index'] for c in plan['calculations'] if c['outputAddress'] == 'copy/valid')
        observed['states'][0]['pxcLog'] = [r for r in observed['states'][0]['pxcLog'] if r[0] != ci]
        result = diagnose(plan, clean, plan, observed, 1)
        self.assertEqual(result['status'], 'UNVERIFIED')
        self.assertGreater(result['loss']['missingEvidence'], 0)
        self.assertEqual(result['obligations'][0]['status'], 'UNVERIFIED')

    def test_missing_producer_evidence_propagates_through_delay(self):
        plan, clean, _, observed = fixture()
        ci = next(c['index'] for c in plan['calculations'] if c['outputAddress'] == 'copy')
        observed['states'][0]['pxcLog'] = [r for r in observed['states'][0]['pxcLog'] if r[0] != ci]
        result = diagnose(plan, clean, plan, observed, 1)
        obligations = {(f['t'], f['address']): f for f in result['obligations']}
        self.assertEqual(obligations[(0, 'copy/fg')]['status'], 'UNVERIFIED')
        self.assertEqual(obligations[(1, 'q/fg')]['status'], 'UNVERIFIED')
        self.assertEqual(obligations[(0, 'q/fg')]['status'], 'PASS')

    def test_forged_passing_validator_is_replayed_against_actual_inputs(self):
        plan, clean, changed_plan, observed = fixture(True)
        c = next(c for c in changed_plan['calculations'] if c['outputAddress'] == 'copy/valid')
        state = observed['states'][0]
        state['values'][c['output']] = 1
        for row in state['pxcLog']:
            if row[0] == c['index']:
                row[1] = 1
        result = diagnose(plan, clean, changed_plan, observed, 1)
        fg = next(f for f in result['obligations'] if f['t'] == 0 and f['address'] == 'copy/fg')
        self.assertEqual(fg['status'], 'UNVERIFIED')
        self.assertIn('execution value agrees with declared rule', fg['validators'][0]['missing'])

    def test_missing_dependency_stops_explanation(self):
        plan, clean, observed_plan, wrong = fixture(True)
        wrong['states'][0]['values'][wrong['addresses'].index('copy')] = None
        result = diagnose(plan, clean, observed_plan, wrong, 1)
        self.assertEqual(result['explanation']['frontier']['kind'], 'missing-evidence')
        self.assertFalse(result['explanation']['complete'])

    def test_clean_and_delta_have_same_values_and_declared_origin(self):
        plan, clean, _, _ = fixture()
        delta = execute_plan(plan, 1, [{'a': 1, 'b': 0}, {'a': 0, 'b': 0}], True)
        self.assertEqual(diagnose(plan, clean, plan, delta, 1)['status'], 'PASS')
        part = inspect_part(delta, plan, 0, 'q')
        self.assertEqual(part['inputs'][0]['address'], 'const/0')
        self.assertEqual(part['inputs'][0]['t'], 0)

    def test_deleted_fg_declaration_does_not_remove_obligation(self):
        plan, clean, _, observed = fixture()
        observed['fgs'] = []
        result = diagnose(plan, clean, plan, observed, 1)
        self.assertEqual(result['status'], 'UNVERIFIED')
        self.assertEqual(result['loss']['unverifiedFG'], 4)

    def test_deleting_fgs_from_both_observed_plan_and_trace_cannot_erase_them(self):
        plan, clean, _, observed = fixture()
        changed_plan = deepcopy(plan)
        changed_plan['fgs'] = []
        observed['fgs'] = []
        for state in observed['states']:
            state['fg'] = {'passed': 0, 'failed': 0, 'total': 0, 'failures': []}
        result = diagnose(plan, clean, changed_plan, observed, 1)
        self.assertEqual(result['status'], 'UNVERIFIED')
        self.assertEqual(result['loss']['unverifiedFG'], 4)

    def test_alternate_input_history_is_a_visible_difference(self):
        plan, clean, _, _ = fixture()
        other = execute_plan(plan, 1, [{'a': 0, 'b': 0}] * 2)
        result = diagnose(plan, clean, plan, other, 1)
        self.assertEqual(result['audits']['observed']['status'], 'FAIL')
        self.assertEqual(result['status'], 'FAIL')
        self.assertEqual(result['explanation']['frontier']['address'], 'a')
        self.assertEqual(result['explanation']['frontier']['t'], 0)

    def test_numeric_inputs_are_authoritative_and_alias_conflict_is_unverified(self):
        net = Net('equal-valued-origins')
        a = net.wire('a', net.const(0)); b = net.wire('b', net.const(0))
        net.wire('copy', a); net.bus('copy', ['copy'])
        plan = compile_net(net); changed = deepcopy(plan)
        calc = next(c for c in changed['calculations'] if c['outputAddress'] == 'copy')
        calc['inputs'] = [changed['addresses'].index(b)]
        actual = execute_plan(changed, 0)
        result = diagnose(plan, execute_plan(plan, 0), changed, actual, 0, [{}])
        self.assertEqual(result['status'], 'UNVERIFIED')
        shown = inspect_part(actual, changed, 0, 'copy')
        self.assertEqual(shown['inputs'][0]['address'], 'b')
        self.assertIn('consistent address/index declaration', shown['missing'])

    def test_original_counterexample_replays(self):
        cases = build_cases()
        result = cases['wrong-value']['diagnosis']
        self.assertEqual(result['firstBusDifference']['t'], 1)
        self.assertEqual(result['firstBusDifference']['bus'], 'A')
        self.assertEqual(result['explanation']['frontier']['address'], 'cpu/a/next/0')
        self.assertEqual(result['explanation']['frontier']['t'], 0)
        self.assertEqual(cases['wrong-origin']['diagnosis']['loss']['wrongValue'], 0)


if __name__ == '__main__':
    unittest.main()
