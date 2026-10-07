"""The smaller declaration must preserve observable boundaries and state identity."""
import sys
from pathlib import Path
import unittest
from copy import deepcopy
from dataclasses import replace

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import Net, Part, compile_net, execute_plan
from optimizer import optimize_net, verify_rules, DEFAULT_RULES, INVENTORY, validate_structure


def specimen():
    net = Net('reuse specimen')
    a, b, c = [net.input(x) for x in ('a', 'b', 'c')]
    left = net.nand('first', a, b)
    right = net.nand('duplicate', b, a)
    internal = net.wire('internal', right)
    boundary = net.wire('boundary', internal)
    q0, q1 = net.delay('q0', boundary), net.delay('q1', boundary)
    net.bus('OUT', [boundary, q0, q1])
    net.group('component', 'SPECIMEN', [a, b, c], [boundary, q0, q1])
    return net


class OptimizationTests(unittest.TestCase):
    def test_literal_rules_cover_all_boolean_inputs(self):
        proof = verify_rules(DEFAULT_RULES, INVENTORY)
        self.assertEqual(proof['status'], 'PASS')
        self.assertEqual(proof['rowsChecked'], 4)
        self.assertEqual(proof['loss'], 0)

    def test_canonical_inputs_reuse_nand_but_preserve_boundaries_and_cells(self):
        old = specimen()
        new, report = optimize_net(old)
        self.assertEqual(report['beforeBOM']['nand'], 2)
        self.assertEqual(report['afterBOM']['nand'], 1)
        self.assertEqual(report['beforeBOM']['delay'], 2)
        self.assertEqual(report['afterBOM']['delay'], 2)
        self.assertEqual(old.buses, new.buses)
        self.assertEqual(old.groups, new.groups)
        self.assertNotIn('internal', new.producers)
        self.assertEqual(new.producers['boundary'].rule, 'wire')
        self.assertEqual(report['sourceToResult']['duplicate']['canonical'], 'first')
        self.assertEqual(validate_structure(old, new, report)['loss'], 0)
        schedule = [{'a': a, 'b': b, 'c': c} for a in (0, 1) for b in (0, 1) for c in (0, 1)]
        left, right = [execute_plan(compile_net(net), 7, schedule) for net in (old, new)]
        self.assertEqual([s['buses'] for s in left['states']], [s['buses'] for s in right['states']])

    def test_every_original_boundary_has_a_real_result_part(self):
        old = specimen()
        new, report = optimize_net(old)
        for group in old.groups.values():
            for address in group['inputs'] + group['outputs']:
                self.assertIn(address, new.parts)
        self.assertTrue(all(fg.validators[0] in new.parts for fg in new.guarantees))
        self.assertNotEqual(id(old), id(new))

    def test_rule_mutation_and_missing_rule_rejected(self):
        rules = deepcopy(DEFAULT_RULES)
        rules['nandInputOrder'] = 'ignore-second-input'
        with self.assertRaises(ValueError):
            optimize_net(specimen(), rules)
        with self.assertRaises(ValueError):
            optimize_net(specimen(), {})

    def test_structural_fg_rejects_forged_mapping(self):
        old = specimen()
        new, report = optimize_net(old)
        report['sourceToResult']['duplicate']['canonical'] = 'a'
        self.assertGreater(validate_structure(old, new, report)['loss'], 0)

    def test_changed_predecessor_fg_endpoint_is_rejected(self):
        old = specimen()
        old.parts['first/operands'] = Part('first/operands', ('a',))
        with self.assertRaises(ValueError):
            optimize_net(old)

    def test_report_cannot_hide_changed_observable_boundary(self):
        old = specimen()
        new, report = optimize_net(old)
        for output, operands in [('boundary', ('const/0',)), ('boundary/valid', ('const/0', 'boundary'))]:
            calc = replace(new.producers[output], inputs=operands)
            new.producers[output] = calc; new.parts[calc.address] = calc
        new.parts['boundary/operands'] = Part('boundary/operands', ('const/0',))
        report['sourceToResult']['boundary']['visible'] = 'first'
        self.assertGreater(validate_structure(old, new, report)['loss'], 0)

    def test_candidate_must_retain_regenerated_validator_closure(self):
        old = specimen()
        new, report = optimize_net(old)
        new.guarantees = []
        self.assertGreater(validate_structure(old, new, report)['loss'], 0)

    def test_cost_claim_is_checked_against_actual_graphs(self):
        old = specimen()
        new, report = optimize_net(old)
        report['beforeBOM']['nand'] = 9000
        report['afterBOM']['nand'] = 0
        report['nandSaved'] = 9000
        self.assertGreater(validate_structure(old, new, report)['loss'], 0)

    def test_evidence_suite_reads_the_actual_demo_catalog(self):
        from build_evidence import suite
        examples = [case for case in suite(random_count=0) if case['id'].startswith('demo-')]
        self.assertEqual({case['id'] for case in examples},
                         {'demo-countdown', 'demo-arithmetic', 'demo-input-output'})
        for case in examples:
            self.assertEqual(len(case['inputs']), case['steps']+1)
            self.assertEqual(len(case['program']), 16)


if __name__ == '__main__':
    unittest.main()
