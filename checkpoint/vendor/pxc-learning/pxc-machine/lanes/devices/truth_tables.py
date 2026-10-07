"""Retain the observed rows behind the exhaustive component checks."""
from pathlib import Path
import hashlib
import json

from device import decimal_next, display
from device_oracle import expected_truth_rows, seven_segment
from core import Net, compile_net, execute_plan, audit_trace
from run import evidence

HERE = Path(__file__).resolve().parent


def main():
    source = evidence()
    source['lanes/devices/truth_tables.py'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    report = {'schema': 'pxc-device-component-tables/v1', 'sourceSha256': source,
              'loss': 0, 'tables': [],
              'retention': 'All requested input/output rows and audit results retained. Internal gate logs are reproducible by this script, not copied into this projection.'}
    net = Net('decimal-transition-table')
    q = [net.input(f'q/{i}') for i in range(4)]
    run, reset = net.input('run'), net.input('reset')
    nxt, carry = decimal_next(net, 'decimal', q, run, reset)
    net.bus('NEXT', nxt); net.bus('CARRY', [carry])
    plan = compile_net(net)
    table = {'name': 'decimal-transition', 'bom': plan['bom'], 'rows': []}
    for case in expected_truth_rows():
        stimulus = {f'q/{i}': (case['state'] >> i) & 1 for i in range(4)}
        stimulus.update(run=case['run'], reset=case['reset'])
        trace = execute_plan(plan, 0, [stimulus])
        observed = trace['states'][0]
        actual = {'next': observed['buses']['NEXT'], 'carry': observed['buses']['CARRY']}
        expected = {'next': case['next'], 'carry': case['carry']}
        audit = audit_trace(trace, plan, 0, [stimulus])
        loss = sum(actual[k] != expected[k] for k in expected) + audit['loss'] + observed['fg']['failed']
        table['rows'].append({'input': {k: case[k] for k in ('state', 'run', 'reset')},
                              'expected': expected, 'actual': actual, 'loss': loss,
                              'primitiveFG': observed['fg'], 'audit': audit})
        report['loss'] += loss
    report['tables'].append(table)
    net = Net('multiplexed-display-table')
    digits = [[net.input(f'digit/{d}/{b}') for b in range(4)] for d in range(8)]
    scan = [net.input(f'scan/{b}') for b in range(3)]
    selected, segments, enable = display(net, 'display', digits, scan)
    net.bus('VALUE', selected); net.bus('SEGMENTS', segments); net.bus('ENABLE', enable)
    plan = compile_net(net)
    table = {'name': 'display-digit-scan', 'bom': plan['bom'], 'rows': []}
    for index in range(8):
        for value in range(16):
            values = [value if d == index else d for d in range(8)]
            stimulus = {f'digit/{d}/{b}': (values[d] >> b) & 1 for d in range(8) for b in range(4)}
            stimulus.update({f'scan/{b}': (index >> b) & 1 for b in range(3)})
            trace = execute_plan(plan, 0, [stimulus])
            observed = trace['states'][0]
            actual = observed['buses']
            expected = {'VALUE': value, 'SEGMENTS': seven_segment(value, int(index == 3)), 'ENABLE': 1 << index}
            audit = audit_trace(trace, plan, 0, [stimulus])
            loss = sum(actual[k] != expected[k] for k in expected) + audit['loss'] + observed['fg']['failed']
            table['rows'].append({'input': {'digits': values, 'scan': index}, 'expected': expected,
                                  'actual': actual, 'loss': loss, 'primitiveFG': observed['fg'], 'audit': audit})
            report['loss'] += loss
    report['tables'].append(table)
    report['sourceChangedDuringExecution'] = any(evidence()[key] != value for key, value in source.items()
                                                if key != 'lanes/devices/truth_tables.py')
    report['loss'] += int(report['sourceChangedDuringExecution'])
    report['status'] = 'PASS' if report['loss'] == 0 else 'FAIL'
    (HERE/'component-truth-tables.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'status': report['status'], 'loss': report['loss'], 'rows': sum(len(t['rows']) for t in report['tables'])}))
    if report['loss']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
