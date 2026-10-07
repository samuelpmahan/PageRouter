"""Behavioral gates for the executable PxC graph, not receipt-shape tests."""
import unittest
from dataclasses import replace
try:
    from core import Net, compile_net, run_net, execute_plan, audit_trace
except ImportError:
    Net = None


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(Net, 'PxC machine execution is not implemented')

    def test_nand_truth_table_and_required_fg(self):
        n = Net('nand'); a = n.input('a'); b = n.input('b'); q = n.nand('q', a, b); n.bus('Q', [q])
        for av, bv, expected in [(0, 0, 1), (0, 1, 1), (1, 0, 1), (1, 1, 0)]:
            r = run_net(n, 0, [{'a': av, 'b': bv}])
            self.assertEqual(r['states'][0]['buses']['Q'], expected)
            self.assertEqual(r['states'][0]['fg']['passed'], 1)
            self.assertEqual(r['states'][0]['fg']['failed'], 0)
            self.assertTrue(r['fgs'])

    def test_delays_read_parent_not_partially_committed_state(self):
        n = Net('shift'); d = n.input('D'); a = n.delay('A', d); b = n.delay('B', a)
        n.bus('A', [a]); n.bus('B', [b])
        r = run_net(n, 3, [{'D': x} for x in [1, 0, 1, 1]])
        self.assertEqual([(s['buses']['A'], s['buses']['B']) for s in r['states']], [(0,0),(1,0),(0,1),(1,0)])
        self.assertTrue(all(s['fg']['failed'] == 0 for s in r['states']))

    def test_feedback_is_temporal_and_history_is_unchanged(self):
        n = Net('toggle'); q = n.delay('q', 'next'); n.nand('next', q, q); n.bus('Q', [q])
        r = run_net(n, 10)
        self.assertEqual([s['buses']['Q'] for s in r['states']], [i%2 for i in range(11)])
        self.assertEqual(r['states'][0]['buses']['Q'], 0)

    def test_delta_agrees_and_records_reuse_separately(self):
        n = Net('constant'); q = n.nand('q', n.const(1), n.const(0)); n.bus('Q', [q])
        full = run_net(n, 4); delta = run_net(n, 4, delta=True)
        self.assertEqual([s['values'] for s in full['states']], [s['values'] for s in delta['states']])
        self.assertTrue(delta['states'][1]['reused'])
        self.assertFalse(delta['states'][1]['evaluated'])

    def test_invalid_graph_and_inputs_fail(self):
        n = Net('missing'); n.nand('q', 'absent', n.const(0))
        with self.assertRaisesRegex(ValueError, 'missing'):
            compile_net(n)
        n = Net('cycle'); n.wire('a', 'b'); n.wire('b', 'a')
        with self.assertRaisesRegex(ValueError, 'cycle'):
            compile_net(n)
        n = Net('input'); n.bus('A', [n.input('a')])
        with self.assertRaisesRegex(ValueError, 'missing'):
            run_net(n, 0)
        with self.assertRaises(ValueError):
            run_net(n, 0, [{'a': True}])

    def test_wrong_implementation_is_detected_by_literal_fg(self):
        n = Net('broken-nand'); a=n.input('a'); b=n.input('b'); q=n.nand('q', a,b); n.bus('Q',[q])
        original=n.producers[q]
        n.producers[q]=replace(original,rule='wire',inputs=(a,))
        n.parts[original.address]=n.producers[q]
        failures=[]
        trace=run_net(n,0,[{'a':0,'b':0}],on_failure=lambda state,items:failures.extend(items))
        self.assertEqual(trace['states'][0]['buses']['Q'],0)
        self.assertEqual(trace['states'][0]['fg']['failed'],1)
        self.assertEqual(failures,['q/fg'])

    def test_requested_output_brings_its_guarantee_closure(self):
        n=Net('closure'); a=n.input('a'); b=n.input('b'); q=n.nand('q',a,b)
        unused=n.nand('unused',a,a)
        plan=compile_net(n,[q])
        self.assertEqual([fg['right'] for fg in plan['fgs']],[q])
        self.assertNotIn(unused,[c['outputAddress'] for c in plan['calculations']])

    def test_fake_reuse_event_and_false_fg_summary_are_detected(self):
        from copy import deepcopy
        n=Net('evidence'); q=n.nand('q',n.const(0),n.const(0)); n.bus('Q',[q])
        trace=run_net(n,1)
        broken=deepcopy(trace); broken['states'][0]['seekLog'][0][1]=1
        self.assertGreater(audit_trace(broken,compile_net(n),1)['loss'],0)
        broken=deepcopy(trace); broken['states'][0]['fg']['failed']=1
        self.assertGreater(audit_trace(broken,compile_net(n),1)['loss'],0)

    def test_audit_cannot_erase_its_obligations(self):
        from copy import deepcopy
        n=Net('closure'); q=n.nand('q',n.const(0),n.const(0)); n.bus('Q',[q])
        plan=compile_net(n); trace=run_net(n,1)
        self.assertEqual(audit_trace(trace,plan,1)['status'],'PASS')
        broken=deepcopy(trace); broken['states']=[]
        self.assertGreater(audit_trace(broken,plan,1)['loss'],0)
        broken=deepcopy(trace); ci=next(c['index'] for c in broken['calculations'] if c['rule']=='nand')
        broken['plan']['order'].remove(ci)
        for state in broken['states']:
            state['evaluated'].remove(ci)
            state['pxcLog']=[row for row in state['pxcLog'] if row[0]!=ci]
            state['seekLog']=[row for row in state['seekLog'] if row[0]!=ci]
        self.assertGreater(audit_trace(broken,plan,1)['loss'],0)
        broken=deepcopy(trace); broken['fgs']=[]
        for state in broken['states']:
            state['fg']=dict(passed=0,failed=0,total=0,failures=[])
        self.assertGreater(audit_trace(broken,plan,1)['loss'],0)

    def test_fg_follows_its_declared_validators(self):
        n=Net('fg-links'); q=n.nand('q',n.const(0),n.const(0))
        fg=n.guarantees[0]
        n.guarantees[0]=replace(fg,validators=('missing-validator',))
        with self.assertRaisesRegex(ValueError,'validator'):
            compile_net(n)

    def test_execution_cannot_mutate_its_input_plan(self):
        n=Net('immutable-plan'); q=n.nand('q',n.const(0),n.const(0)); n.bus('Q',[q])
        plan=compile_net(n); original=list(plan['plan']['order'])
        trace=execute_plan(plan,0)
        trace['plan']['order'].pop()
        self.assertEqual(plan['plan']['order'],original)

    def test_partial_seek_needs_only_selected_inputs_and_buses(self):
        n=Net('partial'); a=n.input('a'); b=n.input('b')
        q=n.nand('q',a,a); other=n.nand('other',b,b)
        n.bus('Q',[q]); n.bus('OTHER',[other])
        plan=compile_net(n,[q]); trace=execute_plan(plan,0,[{'a':0}])
        self.assertEqual(trace['states'][0]['buses'],{'Q':1})
        self.assertEqual(trace['states'][0]['fg']['passed'],1)
        self.assertEqual(audit_trace(trace,plan,0,[{'a':0}])['status'],'PASS')

    def test_constant_only_declared_bus_is_observable(self):
        n=Net('constant-output'); n.bus('ZERO',[n.const(0)])
        self.assertEqual(run_net(n,0)['states'][0]['buses'],{'ZERO':0})

    def test_audit_binds_constant_and_supplied_input_observations(self):
        n=Net('constant'); n.bus('ZERO',[n.const(0)])
        plan=compile_net(n); trace=run_net(n,0)
        trace['states'][0]['values'][0]=1; trace['states'][0]['buses']['ZERO']=1
        self.assertGreater(audit_trace(trace,plan,0)['loss'],0)
        n=Net('input'); n.bus('A',[n.input('a')]); plan=compile_net(n)
        trace=run_net(n,0,[{'a':0}])
        self.assertEqual(audit_trace(trace,plan,0)['status'],'UNVERIFIED')
        trace['states'][0]['values'][0]=1; trace['states'][0]['buses']['A']=1
        self.assertGreater(audit_trace(trace,plan,0,[{'a':0}])['loss'],0)

    def test_clock_experiment_can_cover_more_than_one_second(self):
        n=Net('long-clock'); q=n.delay('q','next'); n.nand('next',q,q); n.bus('Q',[q])
        trace=run_net(n,2000,delta=True)
        self.assertEqual(len(trace['states']),2001)
        self.assertEqual([trace['states'][t]['buses']['Q'] for t in [0,511,512,999,1000,1001,2000]],[0,1,0,1,0,1,0])
        with self.assertRaises(ValueError):
            run_net(n,10001)

if __name__ == '__main__':
    unittest.main()
