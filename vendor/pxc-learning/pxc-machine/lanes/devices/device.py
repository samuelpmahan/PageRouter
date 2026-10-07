"""Gate-declared millisecond stopwatch. Python builds hardware, never advances it.

Only core's NAND, wire and ideal delay Calculations execute the device. A tick
means exactly one simulated millisecond; it makes no physical-clock claim.
"""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import Net
from circuits import and_, or_, not_, xor, mux_bus, reduce_gate, decode, select_bus

SEGMENT_ROWS = (0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0, 0, 0, 0, 0, 0)


def increment(net, name, q):
    """Carry ripple assembled from XOR/AND gates, not a host integer update."""
    carry, output = net.const(1), []
    for i, bit in enumerate(q):
        output.append(xor(net, f'{name}/sum/{i}', bit, carry))
        carry = and_(net, f'{name}/carry/{i}', bit, carry)
    net.group(name, 'BINARY_INCREMENT', q, [*output, carry])
    return output

def decimal_next(net, name, q, enable, reset):
    """BCD transition: reset wins, pause holds, invalid enabled values recover zero.

    BCD stores one decimal digit in four bits. A carry occurs only on 9 -> 0.
    This complete 16 x 2 x 2 relation is exhaustively checked independently.
    """
    if len(q) != 4:
        raise ValueError('Decimal state needs four bits')
    nonzero_low = reduce_gate(net, name+'/low-nonzero', q[:3], 'OR')
    ge_nine = and_(net, name+'/at-least-nine', q[3], nonzero_low)
    valid_advance = not_(net, name+'/may-advance', ge_nine)
    advanced = increment(net, name+'/increment', q)
    wrapped = [and_(net, f'{name}/wrap/{i}', bit, valid_advance) for i, bit in enumerate(advanced)]
    held = mux_bus(net, name+'/enable', q, wrapped, enable)
    no_reset = not_(net, name+'/no-reset', reset)
    nxt = [and_(net, f'{name}/reset/{i}', bit, no_reset) for i, bit in enumerate(held)]
    nine = reduce_gate(net, name+'/nine',
                       [q[0], not_(net, name+'/not-one', q[1]),
                        not_(net, name+'/not-two', q[2]), q[3]], 'AND')
    carry = reduce_gate(net, name+'/carry', [nine, enable, no_reset], 'AND')
    net.group(name, 'DECIMAL_NEXT', [*q, enable, reset], [*nxt, carry])
    return nxt, carry


def decimal_register(net, name, enable, reset, initial=0):
    if type(initial) is not int or not 0 <= initial <= 9:
        raise ValueError('Initial decimal digit must be 0 through 9')
    q = [net.delay(f'{name}/q/{i}', f'{name}/next/{i}', (initial >> i) & 1) for i in range(4)]
    nxt, carry = decimal_next(net, name+'/transition', q, enable, reset)
    for i, source in enumerate(nxt):
        net.wire(f'{name}/next/{i}', source)
    net.group(name, 'DECIMAL_REGISTER', [enable, reset], [*q, carry], [name+'/transition'])
    return q, carry


def display(net, name, digits, scan):
    if len(digits) != 8 or any(len(d) != 4 for d in digits) or len(scan) != 3:
        raise ValueError('Display needs eight four-bit digits and a three-bit scan')
    selected = select_bus(net, name+'/select-digit', digits, scan)
    digit_enable = decode(net, name+'/enable-digit', scan)
    rows = decode(net, name+'/decode-value', selected)
    segments = [reduce_gate(net, f'{name}/segment/{segment}',
                            [rows[d] for d, mask in enumerate(SEGMENT_ROWS) if (mask >> segment) & 1],
                            'OR') for segment in range(7)]
    # Digits are milliseconds, LSD first. Place decimal point after digit 3.
    segments.append(net.wire(name+'/decimal-point', digit_enable[3]))
    net.group(name, 'MULTIPLEXED_EIGHT_DIGIT_DISPLAY',
              [*(bit for digit in digits for bit in digit), *scan],
              [*segments, *digit_enable, *selected],
              [name+'/select-digit', name+'/enable-digit', name+'/decode-value'])
    return selected, segments, digit_enable


def build_stopwatch(initial_ms=0, *, wrong_strobe=False):
    if type(initial_ms) is not int or not 0 <= initial_ms < 100_000_000:
        raise ValueError('Initial elapsed milliseconds must fit eight decimal digits')
    net = Net('PxC-millisecond-stopwatch')
    run, reset = net.input('control/run'), net.input('control/reset')
    zero, one = net.const(0), net.const(1)
    digits, carry = [], run
    for i in range(8):
        q, carry = decimal_register(net, f'stopwatch/digit/{i}', carry, reset,
                                    (initial_ms // 10**i) % 10)
        digits.append(q); net.bus(f'BCD{i}', q)
    net.bus('ELAPSED_ROLLOVER', [carry])
    dividers, clock_carry = [], one
    for i in range(3):
        q, clock_carry = decimal_register(net, f'clock/divide/{i}', clock_carry, zero)
        dividers.append(q); net.bus(f'DIV{i}', q)
    # Carry is the pending transition at t=999. Delay makes its observable pulse
    # belong to the completed transition at t=1000. Mutation omits this boundary.
    strobe = (net.wire('clock/strobe', clock_carry) if wrong_strobe
              else net.delay('clock/strobe', clock_carry, 0))
    scan = [net.delay(f'display/scan/q/{i}', f'display/scan/next/{i}', 0) for i in range(3)]
    nxt = increment(net, 'display/scan/increment', scan)
    for i, bit in enumerate(nxt):
        net.wire(f'display/scan/next/{i}', bit)
    selected, segments, digit_enable = display(net, 'display/multiplex', digits, scan)
    for name, values in (('RUN', [run]), ('RESET', [reset]), ('STROBE', [strobe]),
                         ('SCAN', scan), ('DIGIT_ENABLE', digit_enable),
                         ('SEGMENTS', segments), ('SELECTED_DIGIT', selected)):
        net.bus(name, values)
    net.group('clock', 'DIVIDE_1000', [], [*(b for d in dividers for b in d), strobe],
              [f'clock/divide/{i}' for i in range(3)])
    net.group('stopwatch', 'EIGHT_DECIMAL_MILLISECONDS', [run, reset],
              [b for digit in digits for b in digit], [f'stopwatch/digit/{i}' for i in range(8)])
    net.group('device', 'MILLISECOND_STOPWATCH', [run, reset],
              [*segments, *digit_enable, strobe], ['clock', 'stopwatch', 'display/multiplex'])
    return net


def inputs(controls):
    return [{'control/run': row['run'], 'control/reset': row['reset']} for row in controls]
