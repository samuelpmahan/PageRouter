"""Independent declarations exercise generic finite synthesis, never a named adder builder."""
from copy import deepcopy
from dataclasses import replace
from itertools import product
from pathlib import Path
import sys
import json
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
try:
    import composition
except ImportError:
    composition = None
from core import Net, compile_net, execute_plan

FULL_ADDER = dict(name='full adder', inputs=['a', 'b', 'carryIn'], outputs=['sum', 'carryOut'], rows=[
    dict(inputs=list(i), outputs=list(o)) for i, o in [
        ((0,0,0),(0,0)), ((0,0,1),(1,0)), ((0,1,0),(1,0)), ((0,1,1),(0,1)),
        ((1,0,0),(1,0)), ((1,0,1),(0,1)), ((1,1,0),(0,1)), ((1,1,1),(1,1))]])
MUX = dict(name='mux', inputs=['a','b','select'], outputs=['q'], rows=[
    dict(inputs=list(i), outputs=[o]) for i, o in [
        ((0,0,0),0), ((0,0,1),0), ((0,1,0),0), ((0,1,1),1),
        ((1,0,0),1), ((1,0,1),0), ((1,1,0),1), ((1,1,1),1)]])
DECODER = dict(name='decoder', inputs=['high','low'], outputs=['d0','d1','d2','d3'], rows=[
    dict(inputs=list(i), outputs=list(o)) for i, o in [
        ((0,0),(1,0,0,0)), ((0,1),(0,1,0,0)), ((1,0),(0,0,1,0)), ((1,1),(0,0,0,1))]])


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(composition, 'generic declaration-driven composer is absent')

    def test_literal_fulladder_mux_decoder(self):
        for requirement in (FULL_ADDER, MUX, DECODER):
            report = composition.compose(requirement)
            self.assertEqual(report['selection']['status'], 'PASS')
            self.assertEqual(len(report['candidates']), 2)
            for candidate in report['candidates']:
                self.assertEqual(candidate['verification']['status'], 'PASS')
                self.assertEqual(candidate['verification']['rows'], requirement['rows'])
                self.assertEqual(candidate['verification']['primitiveFailures'], 0)
                self.assertEqual(candidate['verification']['audit']['loss'], 0)
                self.assertTrue(all(c['rule'] in ('nand','wire','check:nand','check:wire')
                                    for c in candidate['plan']['calculations']))
            self.assertEqual(*[c['verification']['semantic']['hash'] for c in report['candidates']])

    def test_all_three_input_functions_and_five_input_multioutput(self):
        domain = list(product((0,1), repeat=3))
        for table in product((0,1), repeat=8):
            requirement = dict(name='arbitrary',inputs=['x','y','z'], outputs=['q'],
                               rows=[dict(inputs=list(i),outputs=[o]) for i,o in zip(domain,table)])
            report=composition.compose(requirement)
            self.assertTrue(all(c['verification']['loss']==0 for c in report['candidates']))
        # Values are a complete literal bit string, not the synthesis algorithms' reference arithmetic.
        patterns=['01101001100101101001011001101001','00000000111111110000000011111111',
                  '00101101010110010110100011010010']
        requirement=dict(name='five inputs',inputs=list('abcde'),outputs=['p','q','r'],
            rows=[dict(inputs=list(i),outputs=[int(p[k]) for p in patterns])
                  for k,i in enumerate(product((0,1),repeat=5))])
        self.assertTrue(all(c['verification']['loss']==0 for c in composition.compose(requirement)['candidates']))

    def test_schema_rejects_incomplete_duplicate_boolean_and_unknown(self):
        bad=[]
        r=deepcopy(FULL_ADDER); r['rows'].pop(); bad.append(r)
        r=deepcopy(FULL_ADDER); r['rows'][-1]=r['rows'][0]; bad.append(r)
        r=deepcopy(FULL_ADDER); r['rows'][0]['outputs'][0]=False; bad.append(r)
        r=deepcopy(FULL_ADDER); r['inputs'][1]='a'; bad.append(r)
        r=deepcopy(FULL_ADDER); r['outputs']=[]; bad.append(r)
        r=deepcopy(FULL_ADDER); r['rows'][0]['outputs'].pop(); bad.append(r)
        r=deepcopy(FULL_ADDER); r['surprise']=True; bad.append(r)
        r=deepcopy(FULL_ADDER); r['inputs']=list('abcdef'); bad.append(r)
        for r in bad:
            with self.assertRaises(ValueError): composition.compose(r)
        with self.assertRaises(ValueError): composition.compose(FULL_ADDER, {'maxNand':True})
        with self.assertRaises(ValueError): composition.compose(FULL_ADDER, inventory={'primitives':['and']})

    def test_semantic_hash_ignores_labels_and_row_order_but_observes_port_order(self):
        first=composition.compose(FULL_ADDER)
        renamed=deepcopy(FULL_ADDER); renamed['name']='other'; renamed['inputs']=['x','y','z']
        renamed['outputs']=['first','second']; renamed['rows'].reverse()
        second=composition.compose(renamed)
        self.assertEqual(first['semanticRequirement'],second['semanticRequirement'])
        swapped=deepcopy(FULL_ADDER)
        for row in swapped['rows']: row['outputs'].reverse()
        third=composition.compose(swapped)
        self.assertNotEqual(first['semanticRequirement']['hash'],third['semanticRequirement']['hash'])

    def test_wrong_wiring_fails_requirement_while_primitive_guarantees_pass(self):
        report=composition.compose(FULL_ADDER)
        net=composition.construct(composition.validate_requirement(FULL_ADDER),composition.INVENTORY,'shannon')
        # A physically valid output wire routes input a instead of sum. Update its own wire guarantee too.
        output=net.buses['sum'][0]; old=net.producers[output]
        net.producers[output]=replace(old, inputs=('input/0',)); net.parts[old.address]=net.producers[output]
        check=net.producers[output+'/valid']; net.producers[output+'/valid']=replace(check,inputs=('input/0',output))
        net.parts[check.address]=net.producers[output+'/valid']
        plan=compile_net(net)
        trace=composition.execute_requirement(plan,composition.validate_requirement(FULL_ADDER))
        verdict=composition.verify(composition.validate_requirement(FULL_ADDER),plan,trace)
        self.assertEqual(verdict['primitiveFailures'],0)
        self.assertEqual(verdict['status'],'FAIL')
        self.assertTrue(verdict['mismatches'])
        self.assertNotEqual(verdict['semantic']['hash'],report['semanticRequirement']['hash'])

    def test_bom_bound_and_selection_use_measured_graph(self):
        report=composition.compose(FULL_ADDER)
        counts=[c['bom']['nand'] for c in report['candidates']]
        self.assertNotEqual(*counts)
        one=composition.compose(FULL_ADDER,{'maxNand':min(counts)})
        self.assertEqual(len(one['selection']['qualifying']),1)
        none=composition.compose(FULL_ADDER,{'maxNand':min(counts)-1})
        self.assertEqual(none['selection']['status'],'FAIL')
        self.assertIsNone(none['selection']['selectedStrategy'])
        self.assertIn('because',none['selection']['reason'])
        self.assertTrue(none['selection']['try'])
        for c in report['candidates']:
            self.assertEqual(c['bom']['nand'],sum(x['rule']=='nand' for x in c['plan']['calculations']))

    def test_pipeline_replay_consumes_request_and_every_fg_executes(self):
        report=composition.compose(FULL_ADDER)
        changed=deepcopy(report['pipeline']['inputValues']); changed['request/requirement']=MUX
        replay=composition.replay(changed)
        self.assertEqual(replay['requirement']['name'],'mux')
        self.assertNotEqual(replay['semanticRequirement']['hash'],report['semanticRequirement']['hash'])
        removed=deepcopy(changed); del removed['request/inventory']
        with self.assertRaises(ValueError): composition.replay(removed)
        altered=deepcopy(changed); altered['request/constraints']={'maxNand':0}
        self.assertEqual(composition.replay(altered)['selection']['status'],'FAIL')
        log={r['calculation']:r for r in report['pipeline']['log']}
        for part in report['pipeline']['declarations'].values():
            if 'validators' in part:
                self.assertTrue(all(v in log for v in part['validators']))
        self.assertIn('request/requirement',log['requirement/calc']['inputs'])

    def test_actual_instantiation_composes_outputs_and_rejects_failed_selection(self):
        report=composition.compose(FULL_ADDER)
        net=Net('consumer'); inputs=[net.input('port/'+str(i)) for i in range(3)]
        outputs=composition.instantiate(net,'adder',inputs,report)
        for name,address in zip(FULL_ADDER['outputs'],outputs): net.bus(name,[address])
        plan=compile_net(net)
        trace=execute_plan(plan,7,[dict(zip(inputs,row['inputs'])) for row in FULL_ADDER['rows']])
        self.assertEqual([[s['buses'][n] for n in FULL_ADDER['outputs']] for s in trace['states']],
                         [r['outputs'] for r in FULL_ADDER['rows']])
        failed=composition.compose(FULL_ADDER,{'maxNand':0})
        with self.assertRaises(ValueError): composition.instantiate(net,'bad',inputs,failed)

    def test_saved_report_is_reusable_and_stale_graph_proof_is_rejected(self):
        report=json.loads(json.dumps(composition.compose(FULL_ADDER)))
        net=Net('round trip'); ports=[net.input(str(i)) for i in range(3)]
        self.assertEqual(len(composition.instantiate(net,'valid',ports,report)),2)
        candidate=next(c for c in report['candidates'] if c['strategy']==report['selection']['selectedStrategy'])
        plan=candidate['plan']; output=plan['busAddresses']['sum'][0]
        wire=next(c for c in plan['calculations'] if c['outputAddress']==output)
        wire['inputs']=[plan['addresses'].index('input/0')]; wire['inputAddresses']=['input/0']
        validator=next(c for c in plan['calculations'] if c['outputAddress']==output+'/valid')
        validator['inputs']=[plan['addresses'].index('input/0'),plan['addresses'].index(output)]
        validator['inputAddresses']=['input/0',output]
        with self.assertRaises(ValueError): composition.instantiate(net,'stale',ports,report)

    def test_address_metadata_cannot_change_instantiation_after_numeric_verification(self):
        report=composition.compose(FULL_ADDER)
        selected=next(c for c in report['candidates'] if c['strategy']==report['selection']['selectedStrategy'])
        wire=next(c for c in selected['plan']['calculations'] if c['outputAddress']=='output/0')
        wire['inputAddresses']=['input/0']
        net=Net('metadata'); ports=[net.input(str(i)) for i in range(3)]
        with self.assertRaisesRegex(ValueError,'binding'):
            composition.instantiate(net,'bad',ports,report)

    def test_trace_inputs_must_match_declared_rows_even_for_symmetric_function(self):
        report=composition.compose(FULL_ADDER); candidate=report['candidates'][0]
        # Full adder is symmetric in a,b, so swapping those supplied inputs leaves outputs unchanged.
        requirement=report['requirement']; plan=candidate['plan']
        stimuli=[{'input/0':r['inputs'][1],'input/1':r['inputs'][0],'input/2':r['inputs'][2]}
                 for r in requirement['rows']]
        trace=execute_plan(plan,7,stimuli)
        self.assertEqual([s['buses'] for s in trace['states']],[s['buses'] for s in candidate['trace']['states']])
        verdict=composition.verify(requirement,plan,trace)
        self.assertEqual(verdict['status'],'FAIL')
        self.assertTrue(any(m['kind']=='input-binding' for m in verdict['mismatches']))

    def test_forged_constant_cannot_supply_another_functions_truth_table(self):
        requirement=dict(name='xor',inputs=['a','b'],outputs=['q'],rows=[
            dict(inputs=list(i),outputs=[o]) for i,o in [((0,0),0),((0,1),1),((1,0),1),((1,1),0)]])
        zero=deepcopy(requirement)
        for row in zero['rows']: row['outputs']=[0]
        candidate=composition.compose(zero)['candidates'][0]
        trace=deepcopy(candidate['trace']); plan=candidate['plan']
        constant=plan['addresses'].index('const/0'); output=plan['buses']['q'][0]
        calc=next(c['index'] for c in plan['calculations'] if c['output']==output)
        for row,state in zip(requirement['rows'],trace['states']):
            expected=row['outputs'][0]
            state['values'][constant]=expected; state['values'][output]=expected; state['buses']['q']=expected
            state['pxcLog']=[[ci,expected if ci==calc else value] for ci,value in state['pxcLog']]
        verdict=composition.verify(requirement,plan,trace)
        self.assertEqual(verdict['status'],'FAIL')
        self.assertIsNone(verdict['semantic'])
        self.assertTrue(any(m['kind']=='constant-binding' for m in verdict['mismatches']))

    def test_component_composition_builds_four_bit_adder_for_all_512_inputs(self):
        report=composition.compose(FULL_ADDER)
        net=Net('four-bit composition'); left=[net.input('a/'+str(i)) for i in range(4)]
        right=[net.input('b/'+str(i)) for i in range(4)]; cin=net.input('carryIn'); carry=cin; result=[]
        for bit in range(4):
            value,carry=composition.instantiate(net,'stage/'+str(bit),[left[bit],right[bit],carry],report)
            result.append(value)
        net.bus('sum',result); net.bus('carry',[carry])
        stimuli=[]; expected=[]
        for a,b,c in product(range(16),range(16),(0,1)):
            stimuli.append({**{left[i]:(a>>i)&1 for i in range(4)},
                            **{right[i]:(b>>i)&1 for i in range(4)},cin:c})
            expected.append(a+b+c)  # Independent integer oracle only; runtime is NAND/wire.
        trace=execute_plan(compile_net(net),511,stimuli)
        self.assertEqual([s['buses']['sum']+16*s['buses']['carry'] for s in trace['states']],expected)
        self.assertTrue(all(s['fg']['failed']==0 for s in trace['states']))
        self.assertEqual(trace['bom']['nand'],4*25)

    def test_requirement_not_name_drives_construction_and_constant_projection(self):
        for table in ([0,0],[1,1],[0,1],[1,0]):
            requirement=dict(name='called-XOR',inputs=['x'],outputs=['out'],rows=[
                dict(inputs=[i],outputs=[value]) for i,value in enumerate(table)])
            report=composition.compose(requirement)
            self.assertTrue(all(c['verification']['loss']==0 for c in report['candidates']))
        r=deepcopy(MUX); r['name']='full adder'; report=composition.compose(r)
        self.assertEqual(report['requirement']['rows'],MUX['rows'])

if __name__=='__main__': unittest.main()
