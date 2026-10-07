"""Finite declarations must construct circuits, not select prewritten XOR code."""
import copy
import unittest

from core import Net, compile_net, run_net
from synthesis import synthesize, instantiate, replay


class SynthesisTests(unittest.TestCase):
    def test_xor_constructed_from_nand_only_and_minimum_count_proved(self):
        recipe = synthesize([0, 1, 1, 0])
        self.assertEqual(recipe['status'], 'found')
        self.assertEqual(recipe['gateCount'], 4)
        self.assertEqual(recipe['truthTable'], [0, 1, 1, 0])
        self.assertEqual(recipe['search']['completedSizes'], [0, 1, 2, 3])
        self.assertEqual(recipe['search']['candidatesBySize'][:4], [2, 3, 18, 180])
        self.assertEqual(recipe['proof']['bom']['nand'], 4)
        self.assertTrue(all(row['fg']['failed'] == 0 for row in recipe['proof']['rows']))
        inventory = recipe['evidence']['values']['input/inventory']
        self.assertEqual([p['op'] for p in inventory['primitives']], ['nand'])

    def test_declaration_replay_changes_composition(self):
        xor = synthesize([0, 1, 1, 0])
        rename = copy.deepcopy(xor['evidence']['values']['input/requirement'])
        rename['name'] = 'this label means nothing'
        renamed = replay(xor['evidence'], {'input/requirement': rename})
        self.assertEqual(renamed['values']['result/recipe']['semanticHash'], xor['semanticHash'])
        rename['truthTable'] = [0, 1, 1, 1]
        changed = replay(xor['evidence'], {'input/requirement': rename})
        result = changed['values']['result/recipe']
        self.assertEqual(result['truthTable'], [0, 1, 1, 1])
        self.assertEqual(result['gateCount'], 3)
        self.assertNotEqual(result['semanticHash'], xor['semanticHash'])
        self.assertEqual(len(changed['calculations']), len(xor['evidence']['calculations']))

    def test_bound_is_actual_input(self):
        recipe = synthesize([0, 1, 1, 0], 3)
        self.assertEqual(recipe['status'], 'not-found')
        self.assertEqual(recipe['search']['completedSizes'], [0, 1, 2, 3])
        self.assertIsNone(recipe['semanticHash'])
        with self.assertRaises(ValueError):
            instantiate(Net('no solution'), 'xor', 'a', 'b', recipe)

    def test_instantiation_uses_executable_nands_and_graph_bom(self):
        net = Net('composed XOR')
        a, b = net.input('a'), net.input('b')
        q = instantiate(net, 'constructed', a, b)
        net.bus('Q', [q])
        self.assertEqual(compile_net(net)['bom']['nand'], 4)
        for (a, b), expected in zip(((0, 0), (0, 1), (1, 0), (1, 1)), (0, 1, 1, 0)):
            state = run_net(net, 0, [{'a': a, 'b': b}])['states'][0]
            self.assertEqual(state['buses']['Q'], expected)
            self.assertEqual(state['fg']['failed'], 0)

    def test_wire_mutation_is_caught_by_independent_requirement(self):
        recipe = synthesize([0, 1, 1, 0])
        evidence = copy.deepcopy(recipe['evidence'])
        # Replaying from this cut substitutes a bad candidate with the same claim.
        candidate = copy.deepcopy(evidence['values']['result/candidate'])
        candidate['gates'][-1] = [0, 0]
        evidence['calculations'] = evidence['calculations'][1:]
        mutated = replay(evidence, {'result/candidate': candidate})
        proof = mutated['values']['result/proof']
        self.assertEqual(proof['status'], 'FAIL')
        self.assertGreater(len(proof['mismatches']), 0)
        # Every primitive NAND is still valid; the composition is wrong.
        self.assertTrue(all(row['fg']['failed'] == 0 for row in proof['rows']))
        self.assertEqual(mutated['values']['result/recipe']['status'], 'rejected')

    def test_all_sixteen_tables_obey_bound_and_actual_verification(self):
        found = 0
        for mask in range(16):
            table = [(mask >> i) & 1 for i in range(4)]
            recipe = synthesize(table)
            if recipe['status'] == 'found':
                found += 1
                self.assertEqual(recipe['truthTable'], table)
                self.assertEqual(recipe['proof']['status'], 'PASS')
                self.assertLessEqual(recipe['gateCount'], 4)
            else:
                self.assertEqual(recipe['search']['completedSizes'], [0, 1, 2, 3, 4])
        self.assertEqual(found, 15)
        xnor = synthesize([1, 0, 0, 1])
        self.assertEqual(xnor['search']['candidatesBySize'], [2, 3, 18, 180, 2700])

    def test_replay_requires_declared_inputs_and_rejects_changed_inventory(self):
        evidence = synthesize([0, 1, 1, 0])['evidence']
        omitted = copy.deepcopy(evidence)
        del omitted['values']['input/inventory']
        with self.assertRaises(KeyError):
            replay(omitted)
        altered = copy.deepcopy(evidence['values']['input/inventory'])
        altered['primitives'][0]['truthTable'] = [0, 0, 0, 1]
        with self.assertRaises(ValueError):
            replay(evidence, {'input/inventory': altered})
        altered['primitives'][0]['truthTable'] = [True, 1, 1, 0]
        with self.assertRaises(ValueError):
            replay(evidence, {'input/inventory': altered})
        invalid_domain = copy.deepcopy(evidence['values']['input/requirement'])
        invalid_domain['inputDomain'][0][0] = False
        with self.assertRaises(ValueError):
            replay(evidence, {'input/requirement': invalid_domain})

    def test_input_validation(self):
        for table in ([], [0, 1], [0, 1, 1, True], [0, 1, 1, 2], [0, 1, 1, 0.0]):
            with self.assertRaises(ValueError):
                synthesize(table)
        for bound in (-1, 5, True, 2.0):
            with self.assertRaises(ValueError):
                synthesize([0, 1, 1, 0], bound)
        recipe = synthesize([0, 1, 1, 0])
        bad = copy.deepcopy(recipe)
        bad['gates'][0] = [0, 100]
        with self.assertRaises(ValueError):
            instantiate(Net('bad'), 'bad', 'a', 'b', bad)


if __name__ == '__main__':
    unittest.main()
