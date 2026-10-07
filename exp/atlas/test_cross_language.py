import hashlib
import unittest

from exp.atlas import cross_language as atlas


def case(gain=2, bias=1, minimum=.8):
    queries = [{'x': 7 * index - 13, 'action': index + 1} for index in range(10)]
    sources = {
        '/parts/training': {'transitions': [
            {'x': index * 3 - 4, 'action': action,
             'next_x': index * 3 - 4 + gain * action + bias}
            for index, action in enumerate([-2, -1, 0, 1, 2])]},
        '/parts/config': {},
        '/parts/queries': {'transitions': queries},
        '/parts/observed': {'values': [row['x'] + 2 * row['action'] + 1 for row in queries], 'tolerance': 1e-9},
        '/parts/prior': {'alpha': 1, 'beta': 1},
        '/parts/policy': {'min_cases': 10, 'min_mean': minimum},
        '/parts/specification': {'expected_gain': 2, 'expected_bias': 1, 'tolerance': 1e-9},
    }
    record = {'format': atlas.FORMAT,
              'recipe': {'nodes': [{'id': node, 'calculation': calculation, 'inputs': inputs, 'output': output}
                                   for node, calculation, inputs, output in atlas.NODES], 'outputs': atlas.OUTPUTS},
              'sources': sources, 'implementationIdentity': None}
    payload = {key: record[key] for key in ('recipe', 'sources', 'implementationIdentity')}
    record['case_id'] = 'sha256:' + hashlib.sha256(atlas.canonical(payload).encode()).hexdigest()
    return record


class CrossLanguageTests(unittest.TestCase):
    def test_ground_truth_motion_oracle_and_beta_counts(self):
        for gain, bias in [(2, 1), (3, -2), (-1, 4), (0, 0)]:
            with self.subTest(gain=gain, bias=bias):
                record = case(gain, bias)
                result = atlas.evaluate(record)['observables']
                expected = [row['x'] + gain * row['action'] + bias
                            for row in record['sources']['/parts/queries']['transitions']]
                self.assertEqual(result['predictions'], expected)
                self.assertEqual((result['model']['gain'], result['model']['bias']), (gain, bias))
                observed = record['sources']['/parts/observed']['values']
                passed = sum(abs(a - b) <= 1e-9 for a, b in zip(expected, observed))
                self.assertEqual(result['prediction_probe']['passed'], passed)
                self.assertEqual((result['posterior']['alpha'], result['posterior']['beta']),
                                 (1 + passed, 11 - passed))

    def test_decision_varies_with_policy_without_changing_model(self):
        accepted = atlas.evaluate(case())['observables']
        declined = atlas.evaluate(case(minimum=.95))['observables']
        self.assertEqual(accepted['model'], declined['model'])
        self.assertTrue(accepted['decision']['accepted'])
        self.assertFalse(declined['decision']['accepted'])

    def test_tampered_case_rejected_before_evaluation(self):
        record = case()
        record['sources']['/parts/observed']['values'][0] += 1
        with self.assertRaisesRegex(TypeError, 'case identity disagrees'):
            atlas.evaluate(record)


if __name__ == '__main__':
    unittest.main()
