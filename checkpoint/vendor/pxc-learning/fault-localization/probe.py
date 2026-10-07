"""Flip one live simulated RAM bit; locate it without revealing the injection.

Run: python3 outputs/fault-localization/probe.py
Uses the existing CPU, executor, FGs and auditor unchanged. Python's trace hook
pauses execution after a stored bit and its write log have been produced, then
flips that live value before its consumers run. This is a simulator fault model,
not a physical-memory upset and not an edit to a completed execution history.
"""
import gzip
import hashlib
import inspect
import json
from pathlib import Path
import random
import sys

HERE = Path(__file__).resolve().parent
MACHINE = HERE.parent / 'pxc-machine'
sys.path.insert(0, str(MACHINE))
import core
from circuits import assemble, build_cpu
from lanes.explanation.diagnostics import diagnose


def execute_with_flip(plan, steps, stimuli, at, address):
    """Isolated instrumentation: no production source or evaluator replacement."""
    source, start = inspect.getsourcelines(core.execute_plan)
    anchors = [start + i for i, line in enumerate(source)
               if line.strip() == 'previous_args[ci] = args']
    assert len(anchors) == 1, 'Injection anchor changed; review before running'
    output = plan['addresses'].index(address)
    injection = []

    def observe(frame, event, arg):
        if (event == 'line' and frame.f_lineno == anchors[0]
                and not injection and frame.f_locals['t'] == at
                and frame.f_locals['calc']['output'] == output):
            assert frame.f_locals['calc']['rule'] == 'delay'
            values = frame.f_locals['values']
            before = values[output]
            values[output] ^= 1
            injection.append(dict(t=at, part=address, before=before,
                                  after=values[output]))
        return observe

    def enter(frame, event, arg):
        return observe if frame.f_code is core.execute_plan.__code__ else None

    old_hook = sys.gettrace()
    assert old_hook is None, 'Run this probe outside an active debugger'
    try:
        sys.settrace(enter)
        trace = core.execute_plan(plan, steps, stimuli)
    finally:
        sys.settrace(old_hook)
    assert len(injection) == 1, 'Fault was not injected'
    return trace, injection[0]


def locate(plan, trace, steps, stimuli):
    """Only declarations and observed history; no fault metadata or clean run."""
    audit = core.audit_trace(trace, plan, steps, stimuli)
    calculations = {c['address']: c for c in plan['calculations']}
    storage_violations = []
    for issue in audit['issues']:
        if issue['kind'] != 'calculation-value':
            continue
        calc = calculations[issue['calculation']]
        if calc['rule'] != 'delay':
            continue
        t = issue['t']
        previous = trace['states'][t-1]['values'] if t else None
        values = trace['states'][t]['values']
        expected = core.evaluate('delay', core.arguments(calc, values, previous))
        storage_violations.append(dict(t=t, part=calc['outputAddress'],
                                       expected=expected,
                                       observed=values[calc['output']]))
    return dict(audit=audit, storageViolations=storage_violations,
                earliest=storage_violations[0] if storage_violations else None)


def save_trace(name, value):
    # Fixed gzip timestamp also makes rerun artifacts byte-reproducible.
    raw = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    (HERE / name).write_bytes(gzip.compress(raw, mtime=0))


def main():
    seed, steps = 20261004, 10
    rng = random.Random(seed)
    at, word, bit = rng.randrange(3, 9), rng.randrange(16), rng.randrange(8)
    address = f'cpu/ram/word/{word}/q/{bit}'
    initial = dict(RAM=[rng.randrange(256) for _ in range(16)])
    source = 'loop: NOP\nJMP loop'
    plan = core.compile_net(build_cpu(assemble(source), initial))
    stimuli = [{plan['addresses'][i]: 0 for i in plan['inputs']}
               for _ in range(steps+1)]
    clean = core.execute_plan(plan, steps, stimuli)
    faulty, injection = execute_with_flip(plan, steps, stimuli, at, address)
    clean_location = locate(plan, clean, steps, stimuli)
    located = locate(plan, faulty, steps, stimuli)
    assert clean_location['audit']['status'] == 'PASS'
    assert clean_location['earliest'] is None
    expected = dict(t=injection['t'], part=injection['part'],
                    expected=injection['before'], observed=injection['after'])
    assert located['storageViolations'] == [expected]
    assert all(s['fg']['failed'] == (1 if s['t'] == at else 0)
               for s in faulty['states'])
    index = plan['addresses'].index(address)
    assert all(clean['states'][t]['values'][index] != faulty['states'][t]['values'][index]
               for t in range(at, steps+1)), 'Corruption should persist in held RAM'
    assert [s['buses']['OUT'] for s in clean['states']] == [s['buses']['OUT'] for s in faulty['states']]
    diagnosis = diagnose(plan, clean, plan, faulty, steps, stimuli)
    first = diagnosis['firstDifference']
    assert (first['t'], first['address']) == (at, address)
    bus = f'RAM{word:02}'
    report = dict(
        question='Can existing FGs locate an injected memory upset without knowing its site?',
        prediction='The delay FG fails at the first corrupted state; OUT alone misses it.',
        seed=seed, steps=steps, source=source, initial=initial,
        injection=injection, located=located,
        cleanAudit=clean_location['audit']['status'],
        cleanByte=clean['states'][at]['buses'][bus],
        faultyByte=faulty['states'][at]['buses'][bus],
        outputUnchanged=True, corruptionPersistsThrough=steps,
        failedFGs=[dict(t=s['t'], failures=s['fg']['failures'])
                   for s in faulty['states'] if s['fg']['failed']],
        followingStateFGFailures=faulty['states'][at+1]['fg']['failed'],
        existingDiagnosticFirstDifference=first,
        existingDiagnosticStatus=diagnosis.get('status'),
        limits=[
            'Single simulated live bit flip at one explicit calculation boundary.',
            'Logical Part and first recorded state, not physical RAM address or wall-clock instant.',
            'Plan, prior observations, checker and retained logs assumed trustworthy.',
            'OUT-only observations cannot distinguish these runs.',
            'A transient reversed before any observation or effect can be invisible.',
            'A value/log contradiction alone does not prove which physical mechanism failed.',
        ],
        sourceSHA256={str(p.relative_to(HERE.parent)): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in (Path(__file__), MACHINE/'core.py', MACHINE/'circuits.py')},
    )
    save_trace('clean-trace.json.gz', clean)
    save_trace('faulty-trace.json.gz', faulty)
    (HERE/'result.json').write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
