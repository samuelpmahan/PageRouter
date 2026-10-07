"""Admission is earned by executed behavior, never by a component's name."""
from copy import deepcopy
from itertools import product
import json
from pathlib import Path
import unittest
try:
    import library
except ImportError:
    library=None
from composition import Net, compile_net, execute_plan

REQUIREMENT=json.loads((Path(__file__).parent/'requirements.json').read_text())['fullAdder']


class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(library,'verified library admission is absent')

    def test_predecessor_beats_generic_candidates_under_explicit_bound(self):
        report=library.choose_component(REQUIREMENT,{'maxNand':20})
        self.assertEqual(report['selection']['status'],'PASS')
        winner=report['selection']['selectedId']
        self.assertEqual(winner,'library/checkpoint-full-adder')
        self.assertEqual([c['bom']['nand'] for c in report['candidates']], [49,25,15,0])
        good=next(c for c in report['candidates'] if c['id']==winner)
        self.assertEqual(good['verification']['semantic'],report['semanticRequirement'])
        self.assertEqual(good['verification']['rows'],REQUIREMENT['rows'])
        self.assertEqual(good['verification']['primitiveFailures'],0)
        self.assertTrue(all(c['qualification']['status']=='FAIL' for c in report['candidates'] if c['id']!=winner))
        wrong=report['candidates'][-1]
        self.assertEqual(wrong['label'],good['label'])
        self.assertGreater(wrong['verification']['loss'],0)
        self.assertEqual(wrong['verification']['primitiveFailures'],0)

    def test_name_never_admits_candidate_or_changes_finite_meaning(self):
        catalog=deepcopy(library.DEFAULT_CATALOG)
        for entry in catalog: entry['label']='same claimed magic'; entry['id']='renamed-'+entry['id']
        request=deepcopy(REQUIREMENT); request['name']='not an adder';request['inputs']=['x','y','z']
        request['outputs']=['first','second']
        report=library.choose_component(request,{'maxNand':20},catalog)
        good=next(c for c in report['candidates'] if c['id']==report['selection']['selectedId'])
        original=library.choose_component(REQUIREMENT,{'maxNand':20})
        self.assertEqual(good['verification']['semantic'],original['semanticRequirement'])
        wrong_only=[dict(id='checkpoint-full-adder',label='full adder',builder='wrong-output-wires')]
        rejected=library.choose_component(REQUIREMENT,{'maxNand':20},wrong_only)
        self.assertEqual(rejected['selection']['status'],'FAIL')
        self.assertIsNone(rejected['selection']['selectedId'])

    def test_smaller_bound_and_changed_requirement_revoke_admission(self):
        report=library.choose_component(REQUIREMENT,{'maxNand':14})
        self.assertEqual(report['selection']['status'],'FAIL')
        self.assertTrue(report['selection']['because'])
        changed=deepcopy(REQUIREMENT); changed['rows'][0]['outputs'][0]=1
        report=library.choose_component(changed,{'maxNand':20})
        predecessor=next(c for c in report['candidates'] if c['id']=='library/checkpoint-full-adder')
        self.assertEqual(predecessor['qualification']['status'],'FAIL')
        self.assertEqual(predecessor['verification']['mismatches'][0]['t'],0)

    def test_pipeline_replay_uses_all_inputs_and_executed_fg_validators(self):
        report=library.choose_component(REQUIREMENT,{'maxNand':20})
        replay=library.replay_choice(report['pipeline']['inputValues'])
        self.assertEqual(replay['selection'],report['selection'])
        log={row['calculation']:row for row in report['pipeline']['log']}
        for part in report['pipeline']['declarations'].values():
            if 'validators' in part: self.assertTrue(all(v in log for v in part['validators']))
        for key in report['pipeline']['inputValues']:
            removed=deepcopy(report['pipeline']['inputValues']);del removed[key]
            with self.assertRaises(ValueError):library.replay_choice(removed)
        changed=deepcopy(report['pipeline']['inputValues']);changed['request/constraints']={'maxNand':14}
        self.assertEqual(library.replay_choice(changed)['selection']['status'],'FAIL')
        changed=deepcopy(report['pipeline']['inputValues']);changed['request/catalog']=changed['request/catalog'][1:]
        self.assertEqual(library.replay_choice(changed)['selection']['status'],'FAIL')
        self.assertTrue(report['sourceProvenance']['files'])
        self.assertNotIn('files',report['semanticRequirement'])

    def test_saved_choice_instantiates_and_composes_without_host_addition(self):
        report=json.loads(json.dumps(library.choose_component(REQUIREMENT,{'maxNand':20})))
        net=Net('two-bit library consumer'); a=[net.input('a/'+str(i)) for i in range(2)]
        b=[net.input('b/'+str(i)) for i in range(2)]; cin=net.input('carry'); carry=cin; result=[]
        for i in range(2):
            value,carry=library.instantiate_component(net,'stage/'+str(i),[a[i],b[i],carry],report)
            result.append(value)
        net.bus('sum',result);net.bus('carry',[carry]);plan=compile_net(net)
        stimuli=[];expected=[]
        for av,bv,c in product(range(4),range(4),(0,1)):
            stimuli.append({**{a[i]:(av>>i)&1 for i in range(2)},**{b[i]:(bv>>i)&1 for i in range(2)},cin:c})
            expected.append(av+bv+c)
        trace=execute_plan(plan,31,stimuli)
        self.assertEqual([s['buses']['sum']+4*s['buses']['carry'] for s in trace['states']],expected)
        self.assertEqual(plan['bom']['nand'],30)
        self.assertTrue(all(s['fg']['failed']==0 for s in trace['states']))
        failed=library.choose_component(REQUIREMENT,{'maxNand':14})
        with self.assertRaises(ValueError):library.instantiate_component(net,'failed',[a[0],b[0],cin],failed)

    def test_stale_verdict_and_alias_mutation_cannot_change_selected_graph(self):
        report=library.choose_component(REQUIREMENT,{'maxNand':20})
        chosen=next(c for c in report['candidates'] if c['id']==report['selection']['selectedId'])
        chosen['plan']['calculations'][0]['inputAddresses']=['wrong','wrong']
        net=Net('bad');ports=[net.input(str(i)) for i in range(3)]
        with self.assertRaisesRegex(ValueError,'binding'):library.instantiate_component(net,'bad',ports,report)

    def test_invalid_catalog_rejected_and_empty_catalog_keeps_generic_choices(self):
        for catalog in ([{'id':'x','label':'x','builder':'magic'}],
                        [library.DEFAULT_CATALOG[0],library.DEFAULT_CATALOG[0]],'not-list'):
            with self.assertRaises(ValueError):library.choose_component(REQUIREMENT,{'maxNand':20},catalog)
        report=library.choose_component(REQUIREMENT,{'maxNand':25},[])
        self.assertEqual(report['selection']['selectedId'],'generic/shannon')

if __name__=='__main__':unittest.main()
