"""Arithmetic device oracle, independent of gate builders and execution engines.

One tick means one simulated millisecond. Controls at t affect state t+1;
the divider and display scan are free-running even while elapsed time is held.
This module checks device behavior, separately from primitive gate guarantees.
"""

# Literal active-high rows: bit 0=a, 1=b, 2=c, 3=d, 4=e, 5=f, 6=g.
SEGMENT_ROWS = (0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07,
                0x7F, 0x6F, 0, 0, 0, 0, 0, 0)


def _integer(value, maximum, label):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError(f'{label} must be an integer in 0..{maximum}')


def seven_segment(digit, decimal_point=0):
    """Decimal digits use literal rows; non-decimal 4-bit inputs are blank."""
    _integer(digit, 15, 'digit')
    _integer(decimal_point, 1, 'decimal_point')
    return SEGMENT_ROWS[digit] | (decimal_point << 7)


def expected_truth_rows():
    """All 64 decade-stage transitions, including invalid-state recovery.

    Carry means a valid enabled 9 rolled over. An invalid state recovers to 0
    only when enabled (or reset), and never produces a carry.
    """
    return [dict(state=state, run=run, reset=reset,
                 next=0 if reset else state if not run else
                 state + 1 if state < 9 else 0,
                 carry=int(bool(run and not reset and state == 9)))
            for state in range(16) for run in range(2) for reset in range(2)]


def expected_states(steps, stimuli, initial_ms=0):
    """Return states t(0)..t(steps); surplus terminal controls are unconsumed."""
    if type(steps) is not int or steps < 0:
        raise ValueError('steps must be a nonnegative integer')
    _integer(initial_ms, 99_999_999, 'initial_ms')
    if len(stimuli) < steps:
        raise ValueError('one control observation is required per transition')
    for stimulus in stimuli[:steps]:
        if not isinstance(stimulus, dict) or set(stimulus) != {'run', 'reset'}:
            raise ValueError('each control must declare exactly run and reset')
        _integer(stimulus['run'], 1, 'run')
        _integer(stimulus['reset'], 1, 'reset')
    states, elapsed = [], initial_ms
    for tick in range(steps + 1):
        digits = [(elapsed // 10**place) % 10 for place in range(8)]
        scan = tick % 8
        states.append(dict(t=tick, elapsed_ms=elapsed, digits=digits,
                           div_digits=[(tick // 10**place) % 10 for place in range(3)],
                           strobe=int(tick > 0 and tick % 1000 == 0),
                           scan=scan, digit_enable=1 << scan,
                           selected_digit=digits[scan],
                           segments=seven_segment(digits[scan], int(scan == 3))))
        if tick < steps:
            control = stimuli[tick]
            if control['reset']:
                elapsed = 0
            elif control['run']:
                elapsed = (elapsed + 1) % 100_000_000
    return states


def compare_trace(trace, stimuli, initial_ms=0, *, steps=None):
    """Count violated device observations, independently of primitive FG status.

    Default stimuli contains transitions only. When a runtime also requires an
    unconsumed terminal input, provide steps explicitly. Expected closure never
    comes from the actual trace: a shortened trace must not define its own pass.
    Count includes 16 named buses plus the state index for each expected state.
    Unrequested buses are allowed; additional or missing states are failures.
    """
    expected = expected_states(len(stimuli) if steps is None else steps, stimuli, initial_ms)
    actual = trace.get('states', [])
    failures = []
    for index, state in enumerate(expected):
        fields = {**{f'BCD{i}': value for i, value in enumerate(state['digits'])},
                  **{f'DIV{i}': value for i, value in enumerate(state['div_digits'])},
                  'STROBE': state['strobe'], 'SCAN': state['scan'],
                  'DIGIT_ENABLE': state['digit_enable'], 'SEGMENTS': state['segments'],
                  'SELECTED_DIGIT': state['selected_digit'], 't': index}
        observed = actual[index] if index < len(actual) else {}
        for bus, value in fields.items():
            got = observed.get('t') if bus == 't' else observed.get('buses', {}).get(bus)
            if type(got) is not int or got != value:
                failures.append(dict(t=index, bus=bus, expected=value, actual=got))
    for index in range(len(expected), len(actual)):
        failures.append(dict(t=index, bus='state-closure', expected='absent', actual='present'))
    return dict(loss=len(failures), count=17 * len(expected), failures=failures)
