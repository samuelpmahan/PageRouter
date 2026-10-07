"""Guards for the small experimental declarative boundary."""
import copy
import unittest

from runtime import run


def specimen():
    definitions = {
        'add': dict(kind='calculation', label='Add one', inputs={'n': 'int'},
                    outputs={'n': 'int'}, implementation='increment'),
        'twice': dict(kind='functionalGuarantee', label='Advance twice',
                      inputs={'n': 'int'}, outputs={'n': 'int'},
                      steps=[dict(id='second', use='add', bind={'n': 'first.n'}),
                             dict(id='first', use='add', bind={'n': '$input.n'})],
                      returns={'n': 'second.n'}),
    }
    return dict(definitions=definitions, implementations={'increment': lambda n: {'n': n + 1}},
                schemas={'int': lambda value: type(value) is int})


class RuntimeTests(unittest.TestCase):
    def test_forward_binding_executes_before_consumer(self):
        result = run('twice', {'n': 5}, **specimen())
        self.assertEqual(result['outputs'], {'n': 7})
        first = next(i for i, entry in enumerate(result['log']) if entry['rule'] == 'add')
        self.assertIn('/first/', result['log'][first]['calculation'])

    def test_missing_input_rejected_before_scripts_execute(self):
        spec = specimen()
        calls = []
        spec['implementations']['increment'] = lambda n: calls.append(n) or {'n': n + 1}
        with self.assertRaises(ValueError):
            run('twice', {}, **spec)
        self.assertEqual(calls, [])

    def test_wrong_output_shape_is_rejected(self):
        spec = specimen()
        spec['implementations']['increment'] = lambda n: {'not_n': n + 1}
        with self.assertRaises(ValueError):
            run('twice', {'n': 5}, **spec)

    def test_same_state_cycle_rejected(self):
        spec = specimen()
        spec['definitions']['twice']['steps'][1]['bind']['n'] = 'second.n'
        with self.assertRaises(ValueError):
            run('twice', {'n': 5}, **spec)

    def test_completion_keeps_unreturned_check(self):
        spec = specimen()
        spec['definitions']['twice']['steps'].append(
            dict(id='check', use='reject', bind={'n': 'second.n'}))
        spec['definitions']['reject'] = dict(kind='calculation', label='Reject',
            inputs={'n': 'int'}, outputs={'n': 'int'}, implementation='reject')
        def reject(n):
            raise ValueError('intentional check failure')
        spec['implementations']['reject'] = reject
        with self.assertRaisesRegex(ValueError, 'intentional check failure'):
            run('twice', {'n': 5}, **spec)

    def test_link_kind_mismatch_rejected_before_execution(self):
        spec = specimen()
        spec['definitions']['add']['inputs']['n'] = 'otherMeaning'
        spec['schemas']['otherMeaning'] = spec['schemas']['int']
        with self.assertRaises(ValueError):
            run('twice', {'n': 5}, **spec)

    def test_explicit_after_sequences_independent_steps(self):
        spec = specimen()
        spec['definitions']['twice']['steps'][0]['bind']['n'] = '$input.n'
        spec['definitions']['twice']['steps'][0]['after'] = ['first']
        result = run('twice', {'n': 5}, **spec)
        operations = [e['calculation'] for e in result['log'] if e['rule'] == 'add']
        self.assertIn('/first/', operations[0])
        self.assertIn('/second/', operations[1])


if __name__ == '__main__':
    unittest.main()
