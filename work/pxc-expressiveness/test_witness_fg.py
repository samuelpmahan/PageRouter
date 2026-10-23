import unittest
from witness_fg import Evidence, WitnessFG

class WitnessTests(unittest.TestCase):
    def setUp(self):
        self.fg = WitnessFG('alternative derivation survives', 'R=(ab+c)d', ('c*d independent of a',))

    def test_evidence_is_content_addressed(self):
        args = ('alternative derivation survives', 'supporting', 'unit test', ('c','d'), 'true', 'R=(ab+c)d')
        self.assertEqual(Evidence.create(*args).id, Evidence.create(*args).id)

    def test_support_is_not_proof(self):
        e = Evidence.create(self.fg.claim, 'supporting', 'unit test', ('a','b','c','d'), 'passed', self.fg.scope)
        next_fg = self.fg.append(e)
        self.assertEqual(next_fg.verdict, 'supported')
        self.assertEqual(self.fg.verdict, 'unverified')
        self.assertEqual(next_fg.append(e).provenance, next_fg.provenance)

    def test_counterexample_preserved(self):
        good = Evidence.create(self.fg.claim, 'supporting', 'unit test', ('a',), 'passed', self.fg.scope)
        bad = Evidence.create(self.fg.claim, 'counterexample', 'delta debugging', ('a','c'), 'failed', self.fg.scope)
        result = self.fg.append(good).append(bad)
        self.assertEqual(result.verdict, 'challenged')
        self.assertEqual(len(result.provenance), 2)

    def test_scope_isolation(self):
        other = Evidence.create(self.fg.claim, 'supporting', 'test', (), 'passed', 'different scope')
        with self.assertRaises(ValueError):
            self.fg.append(other)

if __name__ == '__main__': unittest.main()
