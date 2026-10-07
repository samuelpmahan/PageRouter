"""Finite component tables and stored-program CPU acceptance checks."""
import importlib
import importlib.util
import itertools
import unittest


def implementation():
    spec = importlib.util.find_spec('circuits')
    assert spec is not None, 'Gate-composed circuit implementation is missing'
    return importlib.import_module('circuits')


class AssemblyTests(unittest.TestCase):
    def test_labels_and_padding(self):
        c = implementation()
        self.assertEqual(c.assemble('LDI 3\nloop: OUT\nSUB 15\nJNZ loop\nHALT'),
                         [0x13, 0xC0, 0x5F, 0xB1, 0xF0] + [0] * 11)

    def test_reject_malformed_program(self):
        c = implementation()
        for source in ('LDI 16', 'LDI -1', 'LDI', 'OUT 1', 'WAT',
                       'JMP missing', 'x: NOP\nx: NOP', '\n'.join(['NOP'] * 17)):
            with self.subTest(source=source), self.assertRaises(ValueError):
                c.assemble(source)


class CircuitTests(unittest.TestCase):
    def test_gates_and_mux_exhaustive(self):
        c = implementation()
        from core import Net, run_net
        n = Net('gates')
        a, b, s = [n.input(k) for k in ('a', 'b', 's')]
        outputs = {
            'not': c.not_(n, 'not', a),
            'and': c.and_(n, 'and', a, b),
            'or': c.or_(n, 'or', a, b),
            'xor': c.xor(n, 'xor', a, b),
            'mux': c.mux(n, 'mux', a, b, s),
        }
        for av, bv, sv in itertools.product((0, 1), repeat=3):
            result = run_net(n, 0, stimuli=[dict(a=av, b=bv, s=sv)])
            state = result['states'][0]
            expected = dict(not_=1-av, and_=av & bv, or_=av | bv,
                            xor=av ^ bv, mux=bv if sv else av)
            for key, address in outputs.items():
                self.assertEqual(state['values'][result['addresses'].index(address)], expected.get(key, expected.get(key+'_')))

    def test_four_bit_adder_exhaustive(self):
        c = implementation()
        from core import Net, run_net
        n = Net('add4')
        a = [n.input('a'+str(i)) for i in range(4)]
        b = [n.input('b'+str(i)) for i in range(4)]
        carry = n.input('carry')
        out, cout = c.add_bus(n, 'adder', a, b, carry)
        n.bus('SUM', out)
        for av, bv, cv in itertools.product(range(16), range(16), range(2)):
            inputs = {**{'a'+str(i): (av >> i) & 1 for i in range(4)},
                      **{'b'+str(i): (bv >> i) & 1 for i in range(4)}, 'carry': cv}
            result = run_net(n, 0, stimuli=[inputs])
            state = result['states'][0]
            self.assertEqual(state['buses']['SUM'], (av+bv+cv) & 15)
            self.assertEqual(state['values'][result['addresses'].index(cout)], (av+bv+cv) >> 4)

    def test_decoder_exhaustive(self):
        c = implementation()
        from core import Net, run_net
        n = Net('decode4')
        inputs = [n.input('address/'+str(i)) for i in range(4)]
        outputs = c.decode(n, 'decode', inputs)
        for value in range(16):
            result = run_net(n, 0, stimuli=[{a: (value >> i) & 1 for i, a in enumerate(inputs)}])
            actual = [result['states'][0]['values'][result['addresses'].index(a)] for a in outputs]
            self.assertEqual(actual, [int(i == value) for i in range(16)])

    def test_demux_truth_table(self):
        c = implementation()
        self.assertTrue(hasattr(c, 'demux'), 'Clock/data routing needs an explicit demultiplexer composition')
        from core import Net, run_net
        n = Net('demux4')
        d = n.input('data')
        inputs = [n.input('address/'+str(i)) for i in range(4)]
        outputs = c.demux(n, 'demux', d, inputs)
        for data, value in itertools.product((0, 1), range(16)):
            result = run_net(n, 0, stimuli=[{'data': data, **{a: (value >> i) & 1 for i, a in enumerate(inputs)}}])
            actual = [result['states'][0]['values'][result['addresses'].index(a)] for a in outputs]
            self.assertEqual(actual, [data if i == value else 0 for i in range(16)])

    def test_enabled_register_transition_table(self):
        c = implementation()
        from core import Net, run_net
        for initial, data, enable in itertools.product((0, 1), repeat=3):
            n = Net('one-bit-register')
            d, en = n.input('d'), n.input('en')
            q = c.enabled_register(n, 'register', [d], en, initial)
            n.bus('Q', q)
            result = run_net(n, 1, stimuli=[{'d': data, 'en': enable}]*2)
            self.assertEqual(result['states'][0]['buses']['Q'], initial)
            self.assertEqual(result['states'][1]['buses']['Q'], data if enable else initial)
            self.assertEqual(result['states'][1]['fg']['failed'], 0)

    def test_groups_reference_actual_parts(self):
        c = implementation()
        n = c.build_cpu(c.assemble('HALT'))
        for group in n.groups.values():
            for address in [*group['inputs'], *group['outputs']]:
                self.assertIn(address, n.parts, (group['address'], address))
            for address in group['children']:
                self.assertIn(address, n.groups, (group['address'], address))
        reached, pending = set(), ['cpu']
        while pending:
            address = pending.pop()
            if address not in reached:
                reached.add(address)
                pending.extend(n.groups[address]['children'])
        self.assertEqual(set(n.groups), reached, 'Every composed group must be reachable for drill-down')
        # The halt register's data wire imports the control group's actual output.
        halt_source = n.producers[n.producers[n.groups['cpu/halt']['outputs'][0]].inputs[0]].inputs[0]
        self.assertIn(halt_source, n.groups['cpu/halt']['inputs'], 'HALT must expose its actual data dependency')

    def test_explicit_xor_recipe_rejects_other_behavior(self):
        c = implementation()
        import inspect
        from synthesis import synthesize
        self.assertIn('xor_recipe', inspect.signature(c.build_cpu).parameters,
                      'CPU composition must consume an explicit recipe dependency')
        or_recipe = synthesize([0, 1, 1, 1])
        with self.assertRaisesRegex(ValueError, 'XOR'):
            c.build_cpu(c.assemble('HALT'), xor_recipe=or_recipe)
        # Relabeling an OR circuit as XOR cannot satisfy the actual behavior check.
        with self.assertRaisesRegex(ValueError, 'wiring'):
            c.build_cpu(c.assemble('HALT'), xor_recipe={**or_recipe, 'truthTable': [0, 1, 1, 0]})

    def test_every_xor_uses_the_supplied_recipe(self):
        c = implementation()
        import inspect
        from synthesis import synthesize
        from core import compile_net, run_net
        self.assertIn('xor_recipe', inspect.signature(c.build_cpu).parameters,
                      'CPU composition must consume an explicit recipe dependency')
        recipe = synthesize([0, 1, 1, 0])
        # Double inversion preserves behavior while changing physical construction.
        # A hidden cached default would silently erase these two declared gates.
        gates = [*recipe['gates'], [recipe['output'], recipe['output']],
                 [len(recipe['gates'])+2, len(recipe['gates'])+2]]
        renamed = dict(status='found', name='arbitrary label, never semantic authority',
                       gates=gates, output=len(gates)+1, gateCount=len(gates),
                       truthTable=[0, 1, 1, 0])
        n = c.build_cpu(c.assemble('LDI 7\nSTA 0\nADD 0\nXOR 0\nOUT\nHALT'), xor_recipe=renamed)
        groups = [g for g in n.groups.values() if g['kind'] == 'XOR']
        self.assertEqual(len(groups), 48)
        for group in groups:
            actual = [calc for calc in n.producers.values() if calc.rule == 'nand'
                      and calc.output.startswith(group['address']+'/synthesized/')]
            self.assertEqual(len(actual), 6, group['address'])
            signals = list(group['inputs'])
            for calc, (left, right) in zip(actual, renamed['gates']):
                self.assertEqual(calc.inputs, (signals[left], signals[right]))
                signals.append(calc.output)
            self.assertEqual(n.producers[group['outputs'][0]].inputs, (signals[renamed['output']],))
        baseline = compile_net(c.build_cpu(c.assemble('HALT'), xor_recipe=recipe))
        self.assertEqual(compile_net(n)['bom']['nand'] - baseline['bom']['nand'], 48*2)
        states = run_net(n, 6, stimuli=[{f'cpu/in/{i}': 0 for i in range(8)}]*7)['states']
        self.assertEqual(states[5]['buses']['OUT'], 9)
        self.assertEqual(states[6]['buses']['HALT'], 1)

    def test_cpu_program_state_and_halt(self):
        c = implementation()
        from core import run_net
        program = c.assemble('LDI 15\nSTA 0\nADD 0\nSHL\nOUT\nHALT')
        n = c.build_cpu(program)
        stimuli = [{f'cpu/in/{i}': 0 for i in range(8)} for _ in range(9)]
        states = run_net(n, 8, stimuli=stimuli)['states']
        self.assertEqual([s['buses']['A'] for s in states], [0, 15, 15, 30, 60, 60, 60, 60, 60])
        self.assertEqual([s['buses']['PC'] for s in states], [0, 1, 2, 3, 4, 5, 5, 5, 5])
        self.assertEqual(states[2]['buses']['RAM00'], 15)
        self.assertEqual(states[5]['buses']['OUT'], 60)
        self.assertEqual([s['buses']['HALT'] for s in states], [0, 0, 0, 0, 0, 0, 1, 1, 1])

    def test_initial_and_input_are_explicit(self):
        c = implementation()
        from core import run_net
        n = c.build_cpu(c.assemble('IN\nOUT\nHALT'), initial={'A': 9, 'OUT': 3, 'RAM': [7]*16})
        stimuli = [{f'cpu/in/{i}': (v >> i) & 1 for i in range(8)} for v in (171, 4, 6, 8)]
        states = run_net(n, 3, stimuli=stimuli)['states']
        self.assertEqual(states[0]['buses']['A'], 9)
        self.assertEqual(states[1]['buses']['A'], 171)
        self.assertEqual(states[2]['buses']['OUT'], 171)
        self.assertEqual(states[3]['buses']['RAM15'], 7)


if __name__ == '__main__':
    unittest.main(verbosity=2)
