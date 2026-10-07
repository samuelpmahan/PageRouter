"""Execute device construction, state seeking and independent FGs as Calculations."""
from dataclasses import asdict
from pathlib import Path
import hashlib
import json
import sys

from device import build_stopwatch, inputs
from device_oracle import compare_trace, expected_states, expected_truth_rows, SEGMENT_ROWS
from core import compile_net, execute_plan, audit_trace
from pipeline import Pipeline
from smokelog import pack_trace, unpack_trace

HERE = Path(__file__).resolve().parent


def run_case(steps, controls, initial_ms=0, *, delta=True, wrong_strobe=False):
    if type(steps) is not int or not 0 <= steps <= 10_000:
        raise ValueError('steps must be an integer from 0 through 10000')
    if len(controls) != steps + 1:
        raise ValueError('Exactly one control observation is required per state, including the terminal state')
    if any(type(row) is not dict or set(row) != {'run', 'reset'} or
           any(type(v) is not int or v not in (0, 1) for v in row.values()) for row in controls):
        raise ValueError('Controls need explicit integer run/reset bits')
    if type(delta) is not bool or type(wrong_strobe) is not bool:
        raise ValueError('delta and wrong_strobe must be Boolean')
    p = Pipeline()
    for name, value in [('steps', steps), ('controls', controls), ('initialMs', initial_ms),
                        ('delta', delta), ('wrongStrobe', wrong_strobe)]:
        p.input('request/'+name, value)
    p.input('contract/clock', {'tickMilliseconds': 1, 'physicalClock': False,
                             'transition': 'controls[t] determine elapsed state[t+1]'})
    p.declare('machine', 'compose-stopwatch-from-gates', ['request/initialMs', 'request/wrongStrobe'],
              lambda initial, wrong: build_stopwatch(initial, wrong_strobe=wrong))
    p.declare('plan', 'compile-with-fg-closure', ['machine'], compile_net)
    p.declare('stimuli', 'bind-control-bits', ['request/controls'], inputs)
    p.declare('execution', 'seek-millisecond-states', ['plan', 'request/steps', 'stimuli', 'request/delta'], execute_plan)
    p.declare('reference', 'independent-decimal-device-reference',
              ['request/steps', 'request/controls', 'request/initialMs', 'contract/clock'],
              lambda steps, controls, initial, clock: _reference(steps, controls, initial, clock))
    p.declare('comparison', 'validate-device-temporal-contract',
              ['execution', 'request/controls', 'request/initialMs', 'request/steps', 'reference'],
              lambda execution, controls, initial, steps, reference: _compare(execution, controls, initial, steps, reference))
    p.declare('traceAudit', 'replay-execution-evidence', ['execution', 'plan', 'request/steps', 'stimuli'], audit_trace)
    p.guarantee('fg/device-conformance', 'execution', 'reference', ['comparison/calc'])
    p.guarantee('fg/execution-evidence', 'execution', 'plan', ['traceAudit/calc'])
    p.seek(['fg/device-conformance', 'fg/execution-evidence'])
    trace = p.values['execution']
    trace.update(reference=p.values['reference'], oracle=p.values['comparison'], audit=p.values['traceAudit'],
                 clock=p.values['contract/clock'], controls=controls, initialMs=initial_ms,
                 declarations={address: asdict(part) for address, part in p.parts.items()},
                 pipeline=dict(requested=p.requested, order=p.order, log=p.log,
                               values={address: value for address, value in p.values.items()
                                       if address.startswith(('request/', 'contract/'))},
                               valuePaths={'execution': 'states', 'reference': 'reference',
                                           'comparison': 'oracle', 'traceAudit': 'audit'},
                               note='Machine/plan Parts share the trace declaration fields. Every listed Calculation actually executed.'))
    return trace


def _reference(steps, controls, initial, clock):
    if clock != {'tickMilliseconds': 1, 'physicalClock': False,
                 'transition': 'controls[t] determine elapsed state[t+1]'}:
        raise ValueError('Reference supports the declared ideal 1ms clock only')
    return expected_states(steps, controls, initial)


def _compare(execution, controls, initial, steps, reference):
    # Independent oracle validates all observations against caller-supplied steps.
    # The retained reference is also checked, so it cannot be an unrelated caption.
    result = compare_trace(execution, controls, initial, steps=steps)
    wanted = expected_states(steps, controls, initial)
    if reference != wanted:
        result['failures'].append({'kind': 'reference-record-disagreement'})
        result['loss'] += 1
    result['status'] = 'PASS' if result['loss'] == 0 else 'FAIL'
    return result


def project(trace):
    failures = {}
    for failure in trace['oracle']['failures']:
        failures.setdefault(failure.get('t'), []).append(failure)
    return [dict(t=s['t'], buses=s['buses'], fg=s['fg'],
                 deviceFG=dict(status='FAIL' if s['t'] in failures else 'PASS',
                               failures=failures.get(s['t'], []))) for s in trace['states']]


def evidence():
    paths = [HERE/'device.py', HERE/'device_oracle.py', HERE/'run.py',
             HERE.parent.parent/'core.py', HERE.parent.parent/'circuits.py',
             HERE.parent.parent/'synthesis.py', HERE.parent.parent/'pipeline.py',
             HERE.parent.parent/'smokelog.py']
    return {str(path.relative_to(HERE.parent.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths}


def main():
    summary = dict(schema='pxc-device-evidence/v1', clock={'tickMilliseconds': 1, 'physicalClock': False},
                   sourceSha256=evidence(), primitivePredecessor='../../../pxc-checkpoints/001/manifest.json',
                   truthTables={'decimalTransition': expected_truth_rows(), 'sevenSegment': list(SEGMENT_ROWS)},
                   scenarios=[])
    # Two full pulse intervals, not an extrapolated period from a short sample.
    for name, wrong in [('clean', False), ('wrong-strobe', True)]:
        trace = run_case(2001, [{'run': 1, 'reset': 0}] * 2002, wrong_strobe=wrong)
        packed = pack_trace(trace)
        assert unpack_trace(packed) == trace
        filename = name+'-smokelog.json'
        (HERE/filename).write_text(json.dumps(packed, separators=(',', ':')))
        rows = project(trace)
        pulses = [row['t'] for row in rows if row['buses']['STROBE']]
        scenario = dict(name=name, trace=filename, projection=rows, bom=trace['bom'],
                        oracle=trace['oracle'], audit=trace['audit'], totals=trace['totals'],
                        states=len(rows), pulseTicks=pulses,
                        pulseIntervalsMs=[b-a for a, b in zip(pulses, pulses[1:])],
                        primitiveFailures=sum(row['fg']['failed'] for row in rows),
                        packedBytes=(HERE/filename).stat().st_size,
                        packedSha256=hashlib.sha256((HERE/filename).read_bytes()).hexdigest(),
                        traceSha256=packed['traceSha256'])
        summary['scenarios'].append(scenario)
        print(json.dumps({k: scenario[k] for k in ('name', 'states', 'bom', 'pulseTicks', 'pulseIntervalsMs', 'primitiveFailures', 'packedBytes')}), flush=True)
        del packed, trace
    clean, wrong = summary['scenarios']
    summary['sourceChangedDuringExecution'] = summary['sourceSha256'] != evidence()
    summary['experimentLoss'] = (clean['oracle']['loss'] + clean['audit']['loss'] +
                                 clean['primitiveFailures'] + wrong['audit']['loss'] +
                                 wrong['primitiveFailures'] +
                                 int(clean['pulseTicks'] != [1000, 2000]) +
                                 int(wrong['pulseTicks'] != [999, 1999]) +
                                 int(wrong['oracle']['loss'] != 4) +
                                 int(summary['sourceChangedDuringExecution']))
    summary['status'] = 'PASS' if summary['experimentLoss'] == 0 else 'FAIL'
    summary['meaning'] = 'PASS means the clean composition passed and the deliberately wrong composition was correctly rejected.'
    (HERE/'device-summary.json').write_text(json.dumps(summary, indent=2))
    if summary['experimentLoss']:
        raise SystemExit('Device experiment failed; inspect device-summary.json')


if __name__ == '__main__':
    main()
