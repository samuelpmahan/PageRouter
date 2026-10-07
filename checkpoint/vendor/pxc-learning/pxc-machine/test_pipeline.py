import unittest
from pipeline import Pipeline, build_run


class PipelineTests(unittest.TestCase):
    def test_fg_compiles_work_instead_of_recording_a_script_afterward(self):
        p=Pipeline(); p.input('a',2); invoked=[]
        self.assertTrue(hasattr(p,'declare'), 'higher-order pipeline still executes during declaration')
        p.declare('result','double',['a'],lambda a:invoked.append(a) or 2*a)
        p.declare('verdict','equals-four',['result'],lambda result:result==4)
        p.declare('unused','must-not-run',[],lambda:1/0)
        p.guarantee('fg/result','a','result',['verdict/calc'])
        self.assertEqual(invoked,[])
        p.seek(['fg/result'])
        self.assertEqual(invoked,[2])
        self.assertEqual(p.values['result'],4)
        self.assertEqual([row['output'] for row in p.log],['result','verdict'])
        self.assertNotIn('unused',p.values)
        p.seek(['fg/result'])
        self.assertEqual(invoked,[2])

    def test_real_machine_is_sought_through_its_guarantees(self):
        trace=build_run({'source':'LDI 5\nOUT\nHALT','steps':3,'delta':True})
        self.assertEqual(trace['states'][-1]['buses']['OUT'],5)
        self.assertEqual(trace['oracle']['loss'],0)
        self.assertEqual(trace['audit']['loss'],0)
        self.assertIn('fg/cpu-conformance',trace['pipeline']['requested'])
        self.assertIn('fg/execution-evidence',trace['pipeline']['requested'])
        composition=next(c for c in trace['pipeline']['log'] if c['rule']=='compose-cpu')
        self.assertIn('xorRecipe',composition['inputs'])
        self.assertEqual(trace['composition']['gateCount'],4)

    def test_redefining_input_cannot_retain_stale_evidence(self):
        p=Pipeline(); p.input('a',2)
        p.declare('result','double',['a'],lambda a:2*a); p.seek(['result'])
        with self.assertRaisesRegex(ValueError,'duplicate'):
            p.input('a',3)
        self.assertEqual(p.values['a'],2)
        self.assertEqual(p.values['result'],4)

    def test_fg_requires_real_endpoints_and_validator_calculations(self):
        p=Pipeline(); p.input('a',1); p.input('b',1)
        p.guarantee('bad','a','b',['a'])
        with self.assertRaisesRegex(ValueError,'validator'):
            p.seek(['bad'])

if __name__=='__main__':
    unittest.main()
