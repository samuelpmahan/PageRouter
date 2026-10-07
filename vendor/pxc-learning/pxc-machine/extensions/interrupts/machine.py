"""Interrupts, timer and row scanning made from NAND, wire and delay Parts.

This module builds a circuit; it never executes CPU instructions. All runtime
work remains in core's existing primitive evaluator. Interrupt entry takes one
tick before the interrupted instruction, so IRET restores its exact saved PC.
"""
from dataclasses import replace

from circuits import (Net, _constant_bus, add_bus, and_, build_cpu, decode,
                      enabled_register, mux, mux_bus, not_, or_, reduce_gate,
                      select_bus)


EXTRA_WIDTHS = {'IE': 1, 'PENDING': 1, 'ACTIVE': 1, 'SAVED_PC': 4,
                'SAVED_A': 8, 'TIMER': 5, 'SCAN_ROW': 3}
BASE_FIELDS = {'A', 'PC', 'OUT', 'HALT', 'RAM'}


def retarget_wire(net, address, source):
    """Change a declared wire and its actual FG operands together.

    This is a construction operation, never an execution shortcut. Keeping the
    original wire address preserves all consumers and attached guarantee IDs.
    A caller may use it to construct a separately tested mutant circuit.
    """
    producer = net.producers[address]
    validator = net.producers[address+'/valid']
    if producer.rule != 'wire' or validator.rule != 'check:wire':
        raise ValueError('Only a wire with its wire guarantee can be retargeted')
    if source not in net.parts:
        raise ValueError(f'Missing wire source: {source}')
    for old, arguments in ((producer, (source,)), (validator, (source, address))):
        new = replace(old, inputs=arguments)
        net.producers[new.output] = new
        net.parts[new.address] = new
    operands = net.parts[address+'/operands']
    net.parts[operands.address] = replace(operands, depends=(source,) if source != address else ())


def _group_added(net, name, kind, inputs, outputs, before):
    """Attach new component groups so the inspector can reach every gate."""
    added = set(net.groups)-before
    children = {child for address in added for child in net.groups[address]['children']}
    net.group(name, kind, inputs, outputs, sorted(added-children))


def interrupt_control(net, name, ie, pending, active, halt, irq, ei, di, iret):
    """One-bit controller, also usable as a standalone exhaustive truth table.

    ImplSpecific policy: requests coalesce into one pending bit; an accepted
    event consumes pending and the current IRQ together. HALT never wakes.
    EI/DI act only when an ordinary instruction executes. Decoder outputs are
    exclusive in the CPU; if independently asserted together, DI has priority.
    """
    before = set(net.groups)
    running = not_(net, name+'/running', halt)
    idle = not_(net, name+'/idle', active)
    requested = or_(net, name+'/requested', pending, irq)
    accept = reduce_gate(net, name+'/accept', [ie, idle, running, requested], 'AND')
    returning = reduce_gate(net, name+'/return', [active, running, iret], 'AND')
    diverted = or_(net, name+'/diverted', accept, returning)
    normal = not_(net, name+'/normal', diverted)
    execute = and_(net, name+'/execute', running, normal)
    enabled = mux(net, name+'/enable', ie, net.const(1), ei)
    disabled = mux(net, name+'/disable', enabled, net.const(0), di)
    next_ie = mux(net, name+'/next-ie', ie, disabled, execute)
    next_pending = and_(net, name+'/next-pending', requested, not_(net, name+'/not-accepted', accept))
    ended = mux(net, name+'/ended', active, net.const(0), returning)
    next_active = mux(net, name+'/next-active', ended, net.const(1), accept)
    outputs = dict(ACCEPT=accept, RETURN=returning, EXECUTE=execute,
                   NEXT_IE=next_ie, NEXT_PENDING=next_pending, NEXT_ACTIVE=next_active)
    _group_added(net, name, 'INTERRUPT_CONTROL',
                 [ie, pending, active, halt, irq, ei, di, iret], list(outputs.values()), before)
    return outputs


def _counter(net, name, width, initial):
    """A modulo-2**width counter: discard the ripple adder's carry bit."""
    before = set(net.groups)
    value = enabled_register(net, name+'/register',
                             [f'{name}/next/{i}' for i in range(width)], net.const(1), initial)
    increment, carry = add_bus(net, name+'/increment', value, _constant_bus(net, 1, width))
    for i, signal in enumerate(increment):
        net.wire(f'{name}/next/{i}', signal)
    _group_added(net, name, 'MODULO_COUNTER', [], [*value, carry], before)
    return value


def build_interrupt_cpu(program, initial=None):
    """Extend PxC-8 with vector 8, modulo-32 timer, and eight scan rows.

    Extra initial fields are literal register values and checked against their
    declared widths. cpu/irq is a separate one-bit input from cpu/in/0..7.
    """
    initial = {} if initial is None else dict(initial)
    if set(initial)-BASE_FIELDS-set(EXTRA_WIDTHS):
        raise ValueError('Unknown initial state field')
    for name, width in EXTRA_WIDTHS.items():
        value = initial.get(name, 0)
        if type(value) is not int or not 0 <= value < 1 << width:
            raise ValueError(f'Invalid initial {name}')
    net = build_cpu(program, {name: value for name, value in initial.items() if name in BASE_FIELDS})
    net.name = 'PxC-8 interrupts and scanning display'
    before = set(net.groups)
    base_outputs = set(net.producers)
    a, pc, out = (net.buses[name] for name in ('A', 'PC', 'OUT'))
    halted = net.buses['HALT'][0]
    ram = [net.buses[f'RAM{i:02}'] for i in range(16)]
    ext_irq = net.input('cpu/irq')

    timer = _counter(net, 'cpu/timer', 5, initial.get('TIMER', 0))
    timer_irq = reduce_gate(net, 'cpu/timer/expired', timer, 'AND')
    irq = or_(net, 'cpu/irq/request', ext_irq, timer_irq)
    scan = _counter(net, 'cpu/display/scan', 3, initial.get('SCAN_ROW', 0))
    pixels = select_bus(net, 'cpu/display/read', ram[:8], scan)
    row_enable = decode(net, 'cpu/display/rows', scan)

    flags = {name: net.delay(f'cpu/irq/{name.lower()}/q', f'cpu/irq/{name.lower()}/next',
                            initial.get(name, 0)) for name in ('IE', 'PENDING', 'ACTIVE')}
    # Decode the literal low-nibble encodings of otherwise unused NOP forms.
    instruction = net.buses['INSTRUCTION']
    inverted = [not_(net, f'cpu/irq/decode/invert/{i}', signal)
                for i, signal in enumerate(instruction)]
    special = {name: reduce_gate(net, f'cpu/irq/decode/{name}',
                                 [signal if (value >> i) & 1 else inverted[i]
                                  for i, signal in enumerate(instruction)], 'AND')
               for name, value in (('ei', 1), ('di', 2), ('iret', 3))}
    control = interrupt_control(net, 'cpu/irq/control', flags['IE'], flags['PENDING'],
                                flags['ACTIVE'], halted, irq, **special)
    accept, returning = control['ACCEPT'], control['RETURN']
    for name, signal in flags.items():
        data = control['NEXT_'+name]
        net.wire(f'cpu/irq/{name.lower()}/next', data)
        net.group(f'cpu/irq/{name.lower()}', 'FLAG_REGISTER', [data], [signal])

    saved_pc = enabled_register(net, 'cpu/irq/saved-pc', pc, accept, initial.get('SAVED_PC', 0))
    saved_a = enabled_register(net, 'cpu/irq/saved-a', a, accept, initial.get('SAVED_A', 0))
    # Explicit return wires form a construction seam for the wrong-PC mutant.
    return_pc = [net.wire(f'cpu/irq/return-pc/{i}', signal) for i, signal in enumerate(saved_pc)]
    diverted = or_(net, 'cpu/irq/diverted', accept, returning)

    def source(address):
        return net.producers[address].inputs[0]

    normal_pc = [source(f'cpu/pc/next/{i}') for i in range(4)]
    restored_pc = mux_bus(net, 'cpu/irq/restore-pc', normal_pc, return_pc, returning)
    next_pc = mux_bus(net, 'cpu/irq/vector', restored_pc, _constant_bus(net, 8, 4), accept)
    for i, signal in enumerate(next_pc):
        retarget_wire(net, f'cpu/pc/next/{i}', signal)

    normal_a = [source(f'cpu/a/next/{i}') for i in range(8)]
    restored_a = mux_bus(net, 'cpu/irq/restore-a', normal_a, saved_a, returning)
    next_a = mux_bus(net, 'cpu/irq/entry-hold-a', restored_a, a, accept)
    for i, signal in enumerate(next_a):
        retarget_wire(net, f'cpu/a/next/{i}', signal)

    for name, current in [('cpu/out', out), *[(f'cpu/ram/word/{j}', word) for j, word in enumerate(ram)]]:
        normal = [source(f'{name}/next/{i}') for i in range(len(current))]
        held = mux_bus(net, name+'/interrupt-hold', normal, current, diverted)
        for i, signal in enumerate(held):
            retarget_wire(net, f'{name}/next/{i}', signal)
        # Registers import the final next-state wires, and the RAM still exposes
        # the ordinary store decoder separately from interrupt gating.
        net.groups[name]['inputs'] = [*[f'{name}/next/{i}' for i in range(len(current))], net.const(1)]

    next_halt = mux(net, 'cpu/irq/hold-halt', source('cpu/halt/next'), halted, diverted)
    retarget_wire(net, 'cpu/halt/next', next_halt)
    net.groups['cpu/halt']['inputs'] = [next_halt]
    net.groups['cpu/ram']['inputs'].append(diverted)

    extra = {**{name: [signal] for name, signal in flags.items()},
             'SAVED_PC': saved_pc, 'SAVED_A': saved_a, 'TIMER': timer,
             'IRQ': [irq], 'EXT_IRQ': [ext_irq], 'ACCEPT': [accept], 'RETURN': [returning],
             'SCAN_ROW': scan, 'SCAN_DATA': pixels, 'ROW_ENABLE': row_enable}
    for name, signals in extra.items():
        net.bus(name, signals)
    # Record the real boundary, including the base CPU's ordinary next values.
    # These explicit dependencies make drilling into a hold/restore mux honest.
    added_outputs = set(net.producers)-base_outputs
    boundary_inputs = sorted({signal for address in added_outputs
                              if not net.producers[address].rule.startswith('check:')
                              for signal in net.producers[address].inputs if signal not in added_outputs})
    boundary_outputs = {signal for address in base_outputs
                        if not net.producers[address].rule.startswith('check:')
                        for signal in net.producers[address].inputs if signal in added_outputs}
    boundary_outputs.update(bit for signals in extra.values() for bit in signals)
    _group_added(net, 'cpu/interrupts', 'INTERRUPT_EXTENSION',
                 boundary_inputs, sorted(boundary_outputs), before)
    net.groups['cpu']['inputs'].append(ext_irq)
    net.groups['cpu']['outputs'].extend(bit for signals in extra.values() for bit in signals)
    net.groups['cpu']['children'].append('cpu/interrupts')
    net.parts['cpu'] = replace(net.parts['cpu'], depends=tuple(net.groups['cpu']['outputs']))
    return net
