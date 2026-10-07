"""Seeded fast-check cases, executed by both device evaluation modes.

Generation uses the existing local fast-check dependency. These 16 retained
samples are bounded observations, not exhaustive state-space verification.
"""
from pathlib import Path
import hashlib
import json
import subprocess
import time

from run import run_case, evidence
from device import build_stopwatch, inputs
from device_oracle import compare_trace
from core import audit_trace, compile_net

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[3]
SEED = 20261004


def generated_cases():
    node = WORKSPACE / 'work/lyceum-js/node-v24.21.0-linux-x64/bin/node'
    module = WORKSPACE / 'work/lyceum-js/node_modules/fast-check/lib/fast-check.js'
    # Dynamic import accepts a path argument without interpolating shell code.
    script = '''
const {default: fc} = await import(process.argv[1]);
const control = fc.record({run: fc.integer({min: 0, max: 1}),
                           reset: fc.constantFrom(0, 0, 0, 1)});
const arbitrary = fc.integer({min: 8, max: 16}).chain(steps =>
  fc.record({steps: fc.constant(steps), initial_ms: fc.integer({min: 0, max: 99999999}),
             controls: fc.array(control, {minLength: steps+1, maxLength: steps+1})}));
const cases = fc.sample(arbitrary, {seed: Number(process.argv[2]), numRuns: 16});
const boundaries = [9, 99, 999, 99999999, 8, 98, 998, 99999998];
for (let i=0; i<boundaries.length; i++) {
  cases[i].initial_ms = boundaries[i];
  cases[i].controls[0] = {run: 1, reset: 0};
  cases[i].controls[1] = {run: 1, reset: 0};
}
process.stdout.write(JSON.stringify(cases));
'''
    result = subprocess.run([str(node), '--input-type=module', '-e', script,
                             module.as_uri(), str(SEED)], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def sources():
    result = evidence()
    result['lanes/devices/generated_checks.py'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    return result


def main():
    started = time.monotonic()
    before = sources()
    report = {'schema': 'pxc-generated-device-checks/v1',
              'generator': {'name': 'fast-check', 'version': '4.10.2', 'seed': SEED,
                            'sampleCount': 16, 'shrinking': False,
                            'boundaryOverrides': [9, 99, 999, 99999999, 8, 98, 998, 99999998],
                            'boundaryControls': 'First two transitions run with no reset; remaining controls are generated.'},
              'sourceSha256': before, 'cases': [], 'loss': 0}
    for index, case in enumerate(generated_cases()):
        full = run_case(case['steps'], case['controls'], case['initial_ms'], delta=False)
        delta = run_case(case['steps'], case['controls'], case['initial_ms'], delta=True)
        values_full = [state['values'] for state in full['states']]
        values_delta = [state['values'] for state in delta['states']]
        mismatch_states = [tick for tick, pair in enumerate(zip(values_full, values_delta)) if pair[0] != pair[1]]
        equality_loss = len(mismatch_states) + abs(len(values_full) - len(values_delta))
        address_loss = int(full['addresses'] != delta['addresses'])
        omitted = dict(delta, states=delta['states'][:-1])
        omission_oracle = compare_trace(omitted, case['controls'], case['initial_ms'], steps=case['steps'])
        plan = compile_net(build_stopwatch(case['initial_ms']))
        omission_audit = audit_trace(omitted, plan, case['steps'], inputs(case['controls']))
        loss = (equality_loss + address_loss + full['oracle']['loss'] + delta['oracle']['loss'] +
                full['audit']['loss'] + delta['audit']['loss'] +
                int(omission_oracle['loss'] == 0) + int(omission_audit['loss'] == 0))
        row = dict(id=f'generated-{index:02}', **case, loss=loss,
                   stateCount=len(values_full), valueCount=sum(map(len, values_full)),
                   fullValuesSha256=digest(values_full), deltaValuesSha256=digest(values_delta),
                   modeEqualityLoss=equality_loss, addressMismatch=address_loss,
                   mismatchingStates=mismatch_states,
                   fullOracle=full['oracle'], deltaOracle=delta['oracle'],
                   fullAudit=full['audit'], deltaAudit=delta['audit'],
                   fullTotals=full['totals'], deltaTotals=delta['totals'],
                   omittedState={'oracle': omission_oracle, 'audit': omission_audit})
        report['cases'].append(row)
        report['loss'] += loss
        print(json.dumps({'case': row['id'], 'steps': case['steps'], 'loss': loss,
                          'valuesCompared': row['valueCount']}), flush=True)
    after = sources()
    report['sourceChangedDuringExecution'] = before != after
    report['loss'] += int(before != after)
    report['status'] = 'PASS' if not report['loss'] else 'FAIL'
    report['wallSeconds'] = round(time.monotonic() - started, 3)
    report['statesCompared'] = sum(case['stateCount'] for case in report['cases'])
    report['valuesCompared'] = sum(case['valueCount'] for case in report['cases'])
    (HERE / 'generated-checks.json').write_text(json.dumps(report, indent=2))
    if report['loss']:
        raise SystemExit(f"Generated checks failed with loss {report['loss']}")
    print(json.dumps({key: report[key] for key in ['status', 'statesCompared', 'valuesCompared', 'wallSeconds']}))


if __name__ == '__main__':
    main()
