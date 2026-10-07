"""Focused tests for the interrupt circuit, independent of the full CPU oracle."""
import importlib
import importlib.util
import itertools
from pathlib import Path
import sys
import unittest

BASE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BASE))
from core import Net, compile_net, execute_plan, run_net


def implementation(name):
    path = f'extensions.interrupts.{name}'
    assert importlib.util.find_spec(path) is not None, f'{name} implementation is missing'
    return importlib.import_module(path)


def inputs(irq=0, value=0):
    return {'cpu/irq': irq, **{f'cpu/in/{i}': (value >> i) & 1 for i in range(8)}}


class AssemblerTests(unittest.TestCase):
    def test_extended_opcodes_origins_and_forward_labels(self):
        assemble = implementation('assembler').assemble_interrupts
        self.assertEqual(assemble('ei\nJMP loop\n.ORG 8\nhandler: di\niret\n'
                                  '.ORG 4\nloop: OUT\nJMP handler'),
                         [1, 0x94, 0, 0, 0xC0, 0x98, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0])

    def test_reject_overlaps_and_malformed_origins(self):
        assemble = implementation('assembler').assemble_interrupts
        for source in ('NOP\n.ORG 0\nNOP', '.ORG 16', '.ORG -1', '.ORG',
                       '.ORG 1 2', '.ORG later\nlater: NOP', 'EI 0', 'DI 1',
                       'IRET 2', 'LDI 16', 'JMP missing', '.ORG 15\nNOP\nNOP'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                assemble(source)


class ControllerTests(unittest.TestCase):
    def test_all_256_controller_input_combinations(self):
        machine = implementation('machine')
        net = Net('interrupt-controller-table')
        names = ('ie', 'pending', 'active', 'halt', 'irq', 'ei', 'di', 'iret')
        signals = {name: net.input(name) for name in names}
        outputs = machine.interrupt_control(net, 'control', **signals)
        for name, signal in outputs.items():
            net.bus(name, [signal])
        combinations = [dict(zip(names, bits)) for bits in itertools.product((0, 1), repeat=8)]
        states = run_net(net, len(combinations)-1, combinations)['states']
        for given, state in zip(combinations, states):
            ie, pending, active, halt, irq, ei, di, iret = (given[k] for k in names)
            accept = int(bool(ie and not active and not halt and (pending or irq)))
            returning = int(bool(active and not halt and iret))
            executing = int(not (halt or accept or returning))
            next_ie = (0 if di else 1 if ei else ie) if executing else ie
            self.assertEqual(state['buses'], {
                'ACCEPT': accept, 'RETURN': returning, 'EXECUTE': executing,
                'NEXT_IE': next_ie, 'NEXT_PENDING': int(bool((pending or irq) and not accept)),
                'NEXT_ACTIVE': 1 if accept else 0 if returning else active}, given)
            self.assertEqual(state['fg']['failed'], 0)


class InterruptMachineTests(unittest.TestCase):
    def run_program(self, source, steps, initial=None, irq=None):
        machine, assembler = implementation('machine'), implementation('assembler')
        net = machine.build_interrupt_cpu(assembler.assemble_interrupts(source), initial)
        stimuli = [inputs((irq or {}).get(t, 0)) for t in range(steps+1)]
        trace = run_net(net, steps, stimuli)
        self.assertTrue(all(state['fg']['failed'] == 0 for state in trace['states']))
        return net, trace

    def test_accept_precedes_instruction_and_return_restores_interrupted_pc_and_a(self):
        _, trace = self.run_program('OUT\nHALT\n.ORG 8\nLDI 1\nSTA 2\nIRET', 6,
                                   {'IE': 1, 'TIMER': 31, 'A': 165})
        states = [state['buses'] for state in trace['states']]
        self.assertEqual([s['PC'] for s in states], [0, 8, 9, 10, 0, 1, 1])
        self.assertEqual([s['A'] for s in states], [165, 165, 1, 1, 165, 165, 165])
        self.assertEqual([s['OUT'] for s in states], [0, 0, 0, 0, 0, 165, 165])
        self.assertEqual(states[1]['SAVED_PC'], 0)
        self.assertEqual(states[1]['SAVED_A'], 165)
        self.assertEqual(states[3]['RAM02'], 1)
        self.assertEqual(states[1]['PENDING'], 0)
        self.assertEqual(states[4]['ACTIVE'], 0)

    def test_pending_coalesces_while_active_then_accepts_after_return(self):
        _, trace = self.run_program('HALT\n.ORG 8\nNOP\nIRET', 5,
                                   {'IE': 1, 'TIMER': 31, 'A': 73}, {1: 1, 2: 1})
        states = [state['buses'] for state in trace['states']]
        self.assertEqual([s['PC'] for s in states], [0, 8, 9, 0, 8, 9])
        self.assertEqual([s['PENDING'] for s in states], [0, 0, 1, 1, 0, 0])
        self.assertEqual([s['ACTIVE'] for s in states], [0, 1, 1, 0, 1, 1])
        self.assertTrue(all(s['HALT'] == 0 for s in states))

    def test_halted_cpu_stays_still_while_timer_and_scan_continue(self):
        memory = [1 << i for i in range(8)] + [0]*8
        _, trace = self.run_program('EI', 3, {'HALT': 1, 'IE': 1, 'TIMER': 30,
                                             'SCAN_ROW': 7, 'RAM': memory})
        states = [state['buses'] for state in trace['states']]
        self.assertEqual([s['TIMER'] for s in states], [30, 31, 0, 1])
        self.assertEqual([s['SCAN_ROW'] for s in states], [7, 0, 1, 2])
        self.assertEqual([s['SCAN_DATA'] for s in states], [128, 1, 2, 4])
        self.assertEqual([s['ROW_ENABLE'] for s in states], [128, 1, 2, 4])
        self.assertEqual([s['PENDING'] for s in states], [0, 0, 1, 1])
        self.assertTrue(all(s['PC'] == 0 and s['HALT'] == 1 and s['ACCEPT'] == 0 for s in states))

    def test_ei_di_and_nonactive_iret(self):
        _, trace = self.run_program('EI\nDI\nIRET\nHALT', 5)
        states = [state['buses'] for state in trace['states']]
        self.assertEqual([s['IE'] for s in states], [0, 1, 0, 0, 0, 0])
        self.assertEqual([s['PC'] for s in states], [0, 1, 2, 3, 3, 3])

    def test_interrupt_accept_holds_a_store_until_return(self):
        _, trace = self.run_program('STA 2\nHALT\n.ORG 8\nIRET', 3,
                                   {'IE': 1, 'A': 42}, {0: 1})
        states = [state['buses'] for state in trace['states']]
        self.assertEqual([s['RAM02'] for s in states], [0, 0, 0, 42])
        self.assertEqual([s['EXT_IRQ'] for s in states], [1, 0, 0, 0])

    def test_extension_initial_values_validate_widths(self):
        machine = implementation('machine')
        widths = {'IE': 1, 'PENDING': 1, 'ACTIVE': 1, 'SAVED_PC': 4,
                  'SAVED_A': 8, 'TIMER': 5, 'SCAN_ROW': 3}
        for name, width in widths.items():
            for value in (-1, 1 << width, True, 0.5):
                with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                    machine.build_interrupt_cpu([0], {name: value})
        with self.assertRaises(ValueError):
            machine.build_interrupt_cpu([0], {'TYPO': 1})

    def test_primitive_inventory_and_groups_have_complete_dependencies(self):
        net, trace = self.run_program('HALT', 1)
        self.assertEqual(set(c['rule'] for c in trace['calculations']),
                         {'nand', 'wire', 'delay', 'check:nand', 'check:wire', 'check:delay'})
        self.assertEqual(trace['bom']['delay'], 172)
        for group in net.groups.values():
            self.assertEqual(net.parts[group['address']].depends, tuple(group['outputs']),
                             'Group Part dependencies must match displayed outputs: '+group['address'])
            for address in (*group['inputs'], *group['outputs']):
                self.assertIn(address, net.parts, group['address'])
            for child in group['children']:
                self.assertIn(child, net.groups, group['address'])
        reached, pending = set(), ['cpu']
        while pending:
            address = pending.pop()
            if address not in reached:
                reached.add(address)
                pending.extend(net.groups[address]['children'])
        self.assertEqual(set(net.groups), reached)
        for fg in net.guarantees:
            check = net.producers[fg.right+'/valid']
            if check.rule == 'check:wire':
                self.assertEqual(check.inputs, (*net.producers[fg.right].inputs, fg.right))
                self.assertEqual(net.parts[fg.left].depends, tuple(a for a in check.inputs if a != fg.right))


if __name__ == '__main__':
    unittest.main(verbosity=2)
