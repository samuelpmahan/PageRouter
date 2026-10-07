"""Declarations only: an eight-bit CPU composed from NAND, wires and clocked bits.

Python loops lay out hardware. Once built, core executes only the declared
primitive Calculations; instruction semantics never run in this module.
Buses are least-significant-bit first. Group inputs are explicit boundaries.
"""
import re
from core import Net

OPCODES = ('NOP', 'LDI', 'LDA', 'STA', 'ADD', 'SUB', 'AND', 'OR',
           'XOR', 'JMP', 'JZ', 'JNZ', 'OUT', 'IN', 'SHL', 'HALT')
OPERAND_OPS = set(OPCODES[1:12])


def not_(net, name, a):
    q = net.nand(name+'/out', a, a)
    net.group(name, 'NOT', [a], [q])
    return q


def and_(net, name, a, b):
    n = net.nand(name+'/nand', a, b)
    q = net.nand(name+'/out', n, n)
    net.group(name, 'AND', [a, b], [q])
    return q


def or_(net, name, a, b):
    na, nb = not_(net, name+'/not-a', a), not_(net, name+'/not-b', b)
    q = net.nand(name+'/out', na, nb)
    net.group(name, 'OR', [a, b], [q], [name+'/not-a', name+'/not-b'])
    return q


def xor(net, name, a, b):
    # The combinator requests XOR's literal behavior; synthesis finds its NAND
    # composition. No XOR implementation is supplied to the inventory.
    from synthesis import instantiate
    q = net.wire(name+'/out', instantiate(net, name+'/synthesized', a, b,
                                         recipe=getattr(net, 'xor_recipe', None)))
    net.group(name, 'XOR', [a, b], [q])
    return q


def mux(net, name, a, b, select):
    """Select b when select=1; otherwise a."""
    ns = not_(net, name+'/not-select', select)
    left = net.nand(name+'/left', a, ns)
    right = net.nand(name+'/right', b, select)
    q = net.nand(name+'/out', left, right)
    net.group(name, 'MUX', [a, b, select], [q], [name+'/not-select'])
    return q


def mux_bus(net, name, a, b, select):
    if len(a) != len(b):
        raise ValueError('MUX buses must have equal widths')
    outputs = [mux(net, f'{name}/bit/{i}', av, bv, select)
               for i, (av, bv) in enumerate(zip(a, b))]
    net.group(name, 'BUS_MUX', [*a, *b, select], outputs,
              [f'{name}/bit/{i}' for i in range(len(a))])
    return outputs


def select_bus(net, name, words, address):
    """A balanced multiplexer tree selects one word from 2**len(address)."""
    if len(words) != 1 << len(address) or len({len(w) for w in words}) != 1:
        raise ValueError('Selector needs equally sized words for every address')
    level, children = list(words), []
    for bit, select in enumerate(address):
        names = [f'{name}/level/{bit}/pair/{i}' for i in range(len(level)//2)]
        level = [mux_bus(net, child, level[2*i], level[2*i+1], select)
                 for i, child in enumerate(names)]
        children.extend(names)
    out = [net.wire(f'{name}/out/{i}', a) for i, a in enumerate(level[0])]
    net.group(name, 'WORD_SELECTOR', [*address, *(a for w in words for a in w)],
              out, children)
    return out


def full_adder(net, name, a, b, carry):
    different = xor(net, name+'/xor-ab', a, b)
    result = xor(net, name+'/xor-carry', different, carry)
    ab = and_(net, name+'/carry-ab', a, b)
    xc = and_(net, name+'/carry-x', different, carry)
    cout = or_(net, name+'/carry-or', ab, xc)
    net.group(name, 'FULL_ADDER', [a, b, carry], [result, cout],
              [name+'/'+s for s in ('xor-ab', 'xor-carry', 'carry-ab', 'carry-x', 'carry-or')])
    return result, cout


def add_bus(net, name, a, b, carry=None):
    if len(a) != len(b) or not a:
        raise ValueError('Adder buses must have equal positive widths')
    initial_carry = net.const(0) if carry is None else carry
    carry, output = initial_carry, []
    for i, (av, bv) in enumerate(zip(a, b)):
        result, carry = full_adder(net, f'{name}/bit/{i}', av, bv, carry)
        output.append(result)
    net.group(name, 'RIPPLE_ADDER', [*a, *b, initial_carry], [*output, carry],
              [f'{name}/bit/{i}' for i in range(len(a))])
    return output, carry


def reduce_gate(net, name, values, kind):
    """A balanced AND/OR tree. Empty AND is true; empty OR is false."""
    if kind not in ('AND', 'OR'):
        raise ValueError('Reduction supports AND or OR')
    layer, children, depth = list(values), [], 0
    gate = and_ if kind == 'AND' else or_
    while len(layer) > 1:
        next_layer = []
        for i in range(0, len(layer)-1, 2):
            child = f'{name}/level/{depth}/pair/{i//2}'
            next_layer.append(gate(net, child, layer[i], layer[i+1]))
            children.append(child)
        if len(layer) % 2:
            next_layer.append(layer[-1])
        layer, depth = next_layer, depth+1
    out = net.wire(name+'/out', layer[0] if layer else net.const(int(kind == 'AND')))
    net.group(name, kind+'_REDUCTION', values, [out], children)
    return out


def decode(net, name, bits):
    """One-hot decoder: exactly one output is true for each binary input."""
    inverse = [not_(net, f'{name}/invert/{i}', a) for i, a in enumerate(bits)]
    outputs = [reduce_gate(net, f'{name}/value/{value}',
                           [bit if (value >> i) & 1 else inverse[i]
                            for i, bit in enumerate(bits)], 'AND')
               for value in range(1 << len(bits))]
    net.group(name, 'DECODER', bits, outputs,
              [f'{name}/invert/{i}' for i in range(len(bits))] +
              [f'{name}/value/{v}' for v in range(1 << len(bits))])
    return outputs


def demux(net, name, data, address):
    """Route a bit to the selected output; every other output is zero."""
    selected = decode(net, name+'/decode', address)
    outputs = [and_(net, f'{name}/route/{i}', data, bit) for i, bit in enumerate(selected)]
    net.group(name, 'DEMUX', [data, *address], outputs,
              [name+'/decode', *[f'{name}/route/{i}' for i in range(len(outputs))]])
    return outputs


def enabled_register(net, name, data, enable, initial=0):
    if type(initial) is not int or not 0 <= initial < (1 << len(data)):
        raise ValueError('Initial register value does not fit its width')
    out = [net.delay(f'{name}/q/{i}', f'{name}/load/bit/{i}/out', (initial >> i) & 1)
           for i in range(len(data))]
    mux_bus(net, name+'/load', out, data, enable)
    net.group(name, 'ENABLED_REGISTER', [*data, enable], out, [name+'/load'])
    return out


def _constant_bus(net, value, width):
    return [net.const((value >> i) & 1) for i in range(width)]


def build_cpu(program, initial=None, *, xor_recipe=None):
    """Build hardware using the supplied XOR declaration, if present.

    xor_recipe is construction context, not mutable runtime state. The pipeline
    supplies it as an explicit Part; standalone examples may synthesize a default.
    Each tick executes one instruction from the current PC.
    """
    if xor_recipe is not None:
        table = xor_recipe.get('truthTable') if isinstance(xor_recipe, dict) else None
        if (not isinstance(table, list) or len(table) != 4 or
                any(type(v) is not int for v in table) or table != [0, 1, 1, 0]):
            raise ValueError('CPU requires an XOR recipe with literal table [0, 1, 1, 0]')
    if not isinstance(program, (list, tuple)) or len(program) > 16:
        raise ValueError('Program must contain at most 16 byte values')
    if any(type(v) is not int or not 0 <= v <= 255 for v in program):
        raise ValueError('Instructions must be integer bytes')
    initial = {} if initial is None else dict(initial)
    if set(initial) - {'A', 'PC', 'OUT', 'HALT', 'RAM'}:
        raise ValueError('Unknown initial state field')
    for key, maximum in (('A', 255), ('PC', 15), ('OUT', 255), ('HALT', 1)):
        value = initial.get(key, 0)
        if type(value) is not int or not 0 <= value <= maximum:
            raise ValueError(f'Invalid initial {key}')
    memory = initial.get('RAM', [0]*16)
    if (not isinstance(memory, (list, tuple)) or len(memory) != 16 or
            any(type(v) is not int or not 0 <= v <= 255 for v in memory)):
        raise ValueError('Initial RAM needs 16 integer bytes')
    program = list(program) + [0]*(16-len(program))
    net = Net('PxC-8')
    net.xor_recipe = xor_recipe
    zero, one = net.const(0), net.const(1)
    # Delay outputs exist before the next-state circuit: delay is a state boundary,
    # so these forward references do not introduce a combinational cycle.
    a = enabled_register(net, 'cpu/a', [f'cpu/a/next/{i}' for i in range(8)], one, initial.get('A', 0))
    pc = enabled_register(net, 'cpu/pc', [f'cpu/pc/next/{i}' for i in range(4)], one, initial.get('PC', 0))
    out = enabled_register(net, 'cpu/out', [f'cpu/out/next/{i}' for i in range(8)], one, initial.get('OUT', 0))
    halted = net.delay('cpu/halt/q', 'cpu/halt/next', initial.get('HALT', 0))
    inp = [net.input(f'cpu/in/{i}') for i in range(8)]
    ram = [enabled_register(net, f'cpu/ram/word/{j}',
                            [f'cpu/ram/word/{j}/next/{i}' for i in range(8)],
                            one, memory[j]) for j in range(16)]
    rom = [_constant_bus(net, value, 8) for value in program]
    instruction = select_bus(net, 'cpu/rom/read', rom, pc)
    operand, opcode = instruction[:4], instruction[4:]
    commands = decode(net, 'cpu/control/opcode', opcode)
    read = select_bus(net, 'cpu/ram/read', ram, operand)
    running = not_(net, 'cpu/control/running', halted)
    store = and_(net, 'cpu/control/store', running, commands[3])
    write_enables = demux(net, 'cpu/ram/write-select', store, operand)
    for j in range(16):
        data = mux_bus(net, f'cpu/ram/word/{j}/write', ram[j], a, write_enables[j])
        for i, bit in enumerate(data):
            net.wire(f'cpu/ram/word/{j}/next/{i}', bit)
    net.group('cpu/ram', 'RAM_16x8', [*operand, *a, store],
              [*read, *(b for word in ram for b in word)],
              ['cpu/ram/read', 'cpu/ram/write-select', *[f'cpu/ram/word/{j}' for j in range(16)],
               *[f'cpu/ram/word/{j}/write' for j in range(16)]])
    net.group('cpu/rom', 'ROM_16x8', pc, instruction, ['cpu/rom/read'])

    addition, carry_add = add_bus(net, 'cpu/alu/add', a, read)
    inverse = [not_(net, f'cpu/alu/invert/{i}', bit) for i, bit in enumerate(read)]
    subtraction, carry_sub = add_bus(net, 'cpu/alu/subtract', a, inverse, one)
    bit_and = [and_(net, f'cpu/alu/and/{i}', av, bv) for i, (av, bv) in enumerate(zip(a, read))]
    bit_or = [or_(net, f'cpu/alu/or/{i}', av, bv) for i, (av, bv) in enumerate(zip(a, read))]
    bit_xor = [xor(net, f'cpu/alu/xor/{i}', av, bv) for i, (av, bv) in enumerate(zip(a, read))]
    shifted = [zero, *a[:-1]]
    immediate = [*operand, *([zero]*4)]
    choices = [a, immediate, read, a, addition, subtraction, bit_and, bit_or,
               bit_xor, a, a, a, a, inp, shifted, a]
    alu = select_bus(net, 'cpu/alu/select', choices, opcode)
    next_a = mux_bus(net, 'cpu/a/hold', a, alu, running)
    for i, bit in enumerate(next_a):
        net.wire(f'cpu/a/next/{i}', bit)
    net.group('cpu/alu', 'ALU_8', [*a, *read, *operand, *opcode, *inp],
              [*alu, carry_add, carry_sub],
              ['cpu/alu/add', 'cpu/alu/subtract', 'cpu/alu/select'] +
              [f'cpu/alu/{kind}/{i}' for kind in ('invert', 'and', 'or', 'xor') for i in range(8)])

    nonzero = reduce_gate(net, 'cpu/control/nonzero', a, 'OR')
    iszero = not_(net, 'cpu/control/zero', nonzero)
    jump_zero = and_(net, 'cpu/control/jump-zero', commands[10], iszero)
    jump_nonzero = and_(net, 'cpu/control/jump-nonzero', commands[11], nonzero)
    jump = reduce_gate(net, 'cpu/control/jump', [commands[9], jump_zero, jump_nonzero], 'OR')
    advance, pc_carry = add_bus(net, 'cpu/control/increment', pc, _constant_bus(net, 1, 4))
    target = mux_bus(net, 'cpu/control/target', advance, operand, jump)
    stop = or_(net, 'cpu/control/stop', halted, commands[15])
    next_pc = mux_bus(net, 'cpu/pc/hold', target, pc, stop)
    for i, bit in enumerate(next_pc):
        net.wire(f'cpu/pc/next/{i}', bit)
    net.wire('cpu/halt/next', stop)
    write_out = and_(net, 'cpu/control/write-out', running, commands[12])
    next_out = mux_bus(net, 'cpu/out/hold', out, a, write_out)
    for i, bit in enumerate(next_out):
        net.wire(f'cpu/out/next/{i}', bit)
    net.group('cpu/halt', 'HALT_REGISTER', [stop], [halted])
    net.group('cpu/control', 'CONTROL', [*opcode, *operand, *a, *pc, halted],
              [*target, stop, store, write_out, running, pc_carry],
              ['cpu/control/'+s for s in ('opcode', 'running', 'store', 'nonzero', 'zero',
               'jump-zero', 'jump-nonzero', 'jump', 'increment', 'target', 'stop', 'write-out')])
    buses = {'A': a, 'PC': pc, 'OUT': out, 'HALT': [halted], 'IN': inp,
             'INSTRUCTION': instruction, 'OPERAND': operand, 'OPCODE': opcode,
             'RAM_READ': read, 'ALU': alu, 'ZERO': [iszero], 'ADD_CARRY': [carry_add],
             'SUB_NO_BORROW': [carry_sub]}
    buses.update({f'RAM{i:02}': word for i, word in enumerate(ram)})
    for name, bits in buses.items():
        net.bus(name, bits)
    net.group('cpu', 'CPU_8', inp, [*a, *pc, *out, halted, *(b for word in ram for b in word)],
              ['cpu/'+s for s in ('a', 'pc', 'out', 'halt', 'ram', 'rom', 'alu', 'control',
                                    'a/hold', 'pc/hold', 'out/hold')])
    return net


def assemble(text):
    """Two-pass assembler. Labels are case-insensitive; ; and # start comments."""
    if not isinstance(text, str):
        raise ValueError('Assembly source must be text')
    labels, statements = {}, []
    for line_no, raw in enumerate(text.splitlines(), 1):
        line = re.split(r'[;#]', raw, maxsplit=1)[0].strip()
        if ':' in line:
            label, line = line.split(':', 1)
            label, line = label.strip().upper(), line.strip()
            if not re.fullmatch(r'[A-Z_][A-Z_0-9]*', label) or label in labels:
                raise ValueError(f'Invalid or duplicate label on line {line_no}')
            if len(statements) >= 16:
                raise ValueError(f'Label is outside program memory on line {line_no}')
            labels[label] = len(statements)
        if line:
            statements.append((line_no, line.upper().split()))
    if len(statements) > 16:
        raise ValueError('Program exceeds 16 instruction words')
    result = []
    for line_no, tokens in statements:
        mnemonic = tokens[0]
        if mnemonic not in OPCODES:
            raise ValueError(f'Unknown opcode on line {line_no}: {mnemonic}')
        count = 2 if mnemonic in OPERAND_OPS else 1
        if len(tokens) != count:
            raise ValueError(f'{mnemonic} needs {count-1} operand(s), line {line_no}')
        operand = 0
        if count == 2:
            token = tokens[1]
            try:
                operand = labels[token] if token in labels else int(token, 0)
            except ValueError as exc:
                raise ValueError(f'Unknown operand on line {line_no}: {token}') from exc
            if not 0 <= operand < 16:
                raise ValueError(f'Operand must fit four bits, line {line_no}')
        result.append((OPCODES.index(mnemonic) << 4) | operand)
    return result + [0]*(16-len(result))


DEMOS = {
    'countdown': {
        'title': 'Count down through a conditional loop',
        'description': 'Store one, count 5 to 0, expose each value on OUT, then halt.',
        'source': 'LDI 1\nSTA 15\nLDI 5\nloop: OUT\nSUB 15\nJNZ loop\nOUT\nHALT',
        'inputs': [0]*23,
    },
    'arithmetic': {
        'title': 'Arithmetic and RAM',
        'description': '15 + 15, shift to 60, store it, subtract 15, output 45.',
        'source': 'LDI 15\nSTA 0\nADD 0\nSHL\nSTA 1\nSUB 0\nOUT\nHALT',
        'inputs': [0]*11,
    },
    'input-output': {
        'title': 'Input capture and bitwise operations',
        'description': 'Capture input 165, mask with 15, XOR with 15, and output 10.',
        'source': 'LDI 15\nSTA 0\nIN\nAND 0\nXOR 0\nOUT\nHALT',
        'inputs': [165]*11,
    },
}
