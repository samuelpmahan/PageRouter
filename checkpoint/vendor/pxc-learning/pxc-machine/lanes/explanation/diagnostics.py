"""Explain observed differences using address/state dependencies and explicit obligations.

The diagnostic calculations use the same Part/Calculation/FG pipeline as the CPU.
Their inputs are trace evidence and independently supplied plans, not prose labels.
"""
from copy import deepcopy
from collections import Counter, defaultdict
from dataclasses import asdict, replace
from functools import lru_cache
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1]
sys.path.insert(0, str(BASE))
from core import compile_net, execute_plan, audit_trace, evaluate
from circuits import build_cpu
from pipeline import Pipeline


def dependencies(calc, t, dictionary):
    addresses, rule = [dictionary[i] for i in calc['inputs']], calc['rule']
    if rule == 'delay':
        return [{'address': addresses[0 if t else 1], 't': max(0, t-1)}]
    if rule == 'check:delay':
        return [{'address': addresses[0 if t else 2], 't': max(0, t-1)},
                {'address': addresses[1], 't': t}]
    return [{'address': address, 't': t} for address in addresses]


def index_trace(trace, expected_plan=None):
    records = {}
    for state in trace.get('states', []):
        seek, emitted = defaultdict(list), defaultdict(list)
        for row in state.get('seekLog', []):
            seek[row[0]].append(row)
        for row in state.get('pxcLog', []):
            emitted[row[0]].append(row)
        records[state['t']] = {'seek': seek, 'emitted': emitted,
                               'evaluated': Counter(state.get('evaluated', [])), 'reused': Counter(state.get('reused', []))}
    return {'addresses': {a: i for i, a in enumerate(trace.get('addresses', []))},
            'producers': {trace['addresses'][c['output']]: c for c in trace.get('calculations', [])},
            'expectedProducers': {(expected_plan or trace)['addresses'][c['output']]: c for c in (expected_plan or trace).get('calculations', [])},
            'states': {s['t']: s for s in trace.get('states', [])}, 'records': records}


def inspect_part(trace, expected_plan, t, address, index=None):
    index = index or index_trace(trace, expected_plan)
    state, i = index['states'].get(t), index['addresses'].get(address)
    calc = index['producers'].get(address)
    value = state['values'][i] if state and i is not None and i < len(state.get('values', [])) else None
    missing = []
    if type(value) is not int or value not in (0, 1):
        missing.append('bit observation')
    mode = 'given'
    if calc and state:
        if ([trace['addresses'][i] for i in calc['inputs']] != calc['inputAddresses'] or
            trace['addresses'][calc['output']] != calc['outputAddress']):
            missing.append('consistent address/index declaration')
        ci = calc['index']
        records = index['records'][t]
        seek, emitted = records['seek'].get(ci, []), records['emitted'].get(ci, [])
        mode = 'evaluated' if seek == [[ci, 0]] else 'reused' if seek == [[ci, 1]] else 'unknown'
        if mode == 'evaluated' and (emitted != [[ci, value]] or records['evaluated'][ci] != 1):
            missing.append('matching execution record')
        if mode == 'reused' and (emitted or not t or records['reused'][ci] != 1):
            missing.append('valid reuse record')
        if mode == 'unknown':
            missing.append('unique seek record')
    elif calc:
        missing.append('state record')
    expected_calc = index['expectedProducers'].get(address)
    if expected_calc and calc is None:
        missing.append('producer declaration')
    if calc:
        consumed = dependencies(calc, t, trace['addresses'])
        args = []
        for dependency in consumed:
            source_state = index['states'].get(dependency['t'])
            source_index = index['addresses'].get(dependency['address'])
            args.append(source_state['values'][source_index] if source_state is not None and source_index is not None else None)
        try:
            if evaluate(calc['rule'], tuple(args)) != value:
                missing.append('execution value agrees with declared rule')
        except (ValueError, TypeError):
            missing.append('fulfilled rule inputs')
    return {'t': t, 'address': address, 'value': value, 'available': not missing, 'missing': missing,
            'calculation': calc['address'] if calc else None, 'rule': calc['rule'] if calc else 'given',
            'mode': mode, 'inputs': dependencies(calc, t, trace['addresses']) if calc else [],
            'expectedInputs': dependencies(expected_calc, t, expected_plan['addresses']) if expected_calc else []}


def audit_evidence(trace, plan, steps, stimuli):
    try:
        return audit_trace(trace, plan, steps, stimuli)
    except (KeyError, TypeError, IndexError, ValueError) as error:
        return {'status': 'UNVERIFIED', 'loss': 1, 'issues': [{'kind': 'unreadable-evidence', 'reason': str(error)}]}


def compare_parts(expected_plan, expected, observed_plan, observed, steps):
    left_index, right_index = index_trace(expected, expected_plan), index_trace(observed, observed_plan)
    differences, buses = [], []
    # Explicit requested steps prevent two equally truncated traces from passing.
    # Source Parts first, then actual topological execution order. Creation order is not causal order.
    produced = {c['outputAddress'] for c in expected_plan['calculations']}
    addresses = [expected_plan['addresses'][i] for i in expected_plan['plan']['required']
                 if expected_plan['addresses'][i] not in produced]
    addresses += [expected_plan['calculations'][i]['outputAddress'] for i in expected_plan['plan']['order']]
    for t in range(steps + 1):
        for address in addresses:
            left = inspect_part(expected, expected_plan, t, address, left_index)
            right = inspect_part(observed, observed_plan, t, address, right_index)
            kind = ('missing-evidence' if not left['available'] or not right['available'] else
                    'wrong-value' if left['value'] != right['value'] else
                    'wrong-origin' if left['inputs'] != right['inputs'] or left['rule'] != right['rule'] else None)
            if kind:
                differences.append({'kind': kind, 't': t, 'address': address, 'expected': left, 'actual': right})
        for name, indices in expected_plan['buses'].items():
            left_state, right_state = left_index['states'].get(t, {}), right_index['states'].get(t, {})
            left, right = left_state.get('buses', {}).get(name), right_state.get('buses', {}).get(name)
            if left != right or left is None:
                buses.append({'t': t, 'bus': name, 'expected': left, 'actual': right})
    return {'differences': differences, 'buses': buses}


def validate_obligations(plan, trace, steps):
    index = index_trace(trace, plan)
    observed_fgs = {f['address']: f for f in trace.get('fgs', [])}
    closure_cache, visiting = {}, set()
    def missing_closure(t, address):
        key = (t, address)
        if key in closure_cache:
            return closure_cache[key]
        if key in visiting:
            return {key}
        visiting.add(key)
        part = inspect_part(trace, plan, t, address, index)
        gaps = set() if part['available'] else {key}
        for dependency in part['inputs']:
            gaps.update(missing_closure(dependency['t'], dependency['address']))
        visiting.remove(key); closure_cache[key] = gaps
        return gaps
    records = []
    for t in range(steps + 1):
        for fg in plan['fgs']:
            observed_fg = observed_fgs.get(fg['address'])
            links_match = observed_fg == fg
            validators = [inspect_part(trace, plan, t, plan['addresses'][i], index) for i in fg['verdicts']]
            missing = set().union(*(missing_closure(t, v['address']) for v in validators))
            known = links_match and bool(validators) and not missing
            status = ('UNVERIFIED' if not known else 'FAIL' if any(v['value'] != 1 for v in validators) else 'PASS')
            records.append({'t': t, 'address': fg['address'], 'left': fg['left'], 'right': fg['right'],
                            'status': status, 'validators': validators, 'declaredLinksPresent': links_match,
                            'missingClosure': [{'t': tick, 'address': address} for tick, address in sorted(missing)]})
    return records


def explain_difference(comparison, expected_plan):
    differences = {(d['t'], d['address']): d for d in comparison['differences']}
    first = comparison['buses'][0] if comparison['buses'] else None
    start = None
    if first:
        for i in expected_plan['buses'][first['bus']]:
            key = (first['t'], expected_plan['addresses'][i])
            if key in differences:
                start = differences[key]; break
    if start is None:
        start = next(iter(differences.values()), None)
    if start is None:
        return {'complete': True, 'path': [], 'frontier': None,
                'meaning': 'No difference in the declared observed scope.'}
    path, visited = [], set()
    current = start
    while current:
        key = (current['t'], current['address'])
        if key in visited:
            raise ValueError('cycle in resolved state dependencies')
        visited.add(key); path.append(current)
        left, right = current['expected'], current['actual']
        parents = [differences[(d['t'], d['address'])] for d in left['inputs']
                   if (d['t'], d['address']) in differences]
        if current['kind'] == 'missing-evidence':
            local_gaps = set(left['missing'] + right['missing']) - {'fulfilled rule inputs'}
            if parents and not local_gaps:
                current = min(parents, key=lambda d: (d['t'], d['address'])); continue
            frontier = {**current, 'kind': 'missing-evidence'}; complete = False; break
        if left['inputs'] != right['inputs'] or left['rule'] != right['rule']:
            frontier = {**current, 'kind': 'changed-origin'}; complete = True; break
        if not parents:
            frontier = {**current, 'kind': 'local-value-divergence'}; complete = True; break
        # One deterministic path is shown. Other differing branches remain in differences.
        current = min(parents, key=lambda d: (d['t'], d['address']))
    return {'complete': complete, 'path': path, 'frontier': frontier,
            'meaning': 'First observed causal frontier on this path. This does not infer a physical or authoring root cause.'}


def summarize(comparison, obligations, expected_audit, observed_audit, explanation):
    loss = {'wrongValue': sum(d['kind'] == 'wrong-value' for d in comparison['differences']),
            'wrongOrigin': sum(d['kind'] == 'wrong-origin' for d in comparison['differences']),
            'missingEvidence': sum(d['kind'] == 'missing-evidence' for d in comparison['differences']),
            'failedFG': sum(f['status'] == 'FAIL' for f in obligations),
            'unverifiedFG': sum(f['status'] == 'UNVERIFIED' for f in obligations),
            'auditLoss': expected_audit['loss'] + observed_audit['loss']}
    failed = loss['wrongValue'] or loss['wrongOrigin'] or loss['failedFG']
    unknown = loss['missingEvidence'] or loss['unverifiedFG'] or loss['auditLoss']
    return {'status': 'FAIL' if failed else 'UNVERIFIED' if unknown else 'PASS', 'loss': loss,
            'firstBusDifference': next(iter(comparison['buses']), None),
            'firstDifference': next(iter(comparison['differences']), None), 'explanation': explanation,
            'obligations': obligations, 'retainedFailures': [f for f in obligations if f['status'] == 'FAIL'],
            'audits': {'expected': expected_audit, 'observed': observed_audit},
            'scope': 'Requested states, named Part values, resolved input origins, and declared FG evidence. No analog timing claim.'}


def diagnose(expected_plan, expected, observed_plan, observed, steps, stimuli=None):
    p = Pipeline()
    for name, value in [('expectedPlan', expected_plan), ('expectedTrace', expected), ('observedPlan', observed_plan),
                        ('observedTrace', observed), ('steps', steps), ('stimuli', stimuli)]:
        p.input('request/' + name, value)
    p.declare('comparison', 'compare-address-state-observations',
              ['request/expectedPlan', 'request/expectedTrace', 'request/observedPlan', 'request/observedTrace', 'request/steps'], compare_parts)
    p.declare('obligations', 'check-independent-fg-obligations',
              ['request/expectedPlan', 'request/observedTrace', 'request/steps'], validate_obligations)
    for side in ('expected', 'observed'):
        p.declare(side + 'Audit', 'replay-trace-evidence',
                  ['request/' + side + 'Trace', 'request/' + side + 'Plan', 'request/steps', 'request/stimuli'], audit_evidence)
    p.declare('explanation', 'follow-differing-state-dependencies', ['comparison', 'request/expectedPlan'], explain_difference)
    p.declare('diagnosis', 'summarize-evidence-loss',
              ['comparison', 'obligations', 'expectedAudit', 'observedAudit', 'explanation'], summarize)
    p.guarantee('fg/diagnostic-evidence', 'request/expectedTrace', 'request/observedTrace', ['diagnosis/calc'])
    p.seek(['fg/diagnostic-evidence'])
    result = p.values['diagnosis']
    result['pipeline'] = {'declarations': {a: asdict(v) for a, v in p.parts.items()},
                          'requested': p.requested, 'order': p.order, 'log': p.log}
    return result


def predecessor():
    checkpoint = BASE.parent / 'pxc-checkpoints' / '001'
    manifest_path = checkpoint / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    names = ['pxc-machine/core.py', 'pxc-machine/circuits.py', 'pxc-machine/pipeline.py',
             'pxc-machine/generated-checks.json', 'lyceum/common.py']
    verified = {name: hashlib.sha256((checkpoint / name).read_bytes()).hexdigest() for name in names}
    if any(verified[name] != manifest['files'][name] for name in names):
        raise ValueError('Checkpoint predecessor hash mismatch')
    return {'checkpoint': '001', 'manifest': str(manifest_path), 'verifiedSha256': verified}


@lru_cache(maxsize=1)
def build_cases():
    source = json.loads((BASE / 'generated-checks.json').read_text())['mutation']
    case = source['shrunkCase']
    clean_net = build_cpu(case['program'], initial=case['initial'])
    wrong_net = build_cpu(case['program'], initial=case['initial'])
    original = wrong_net.producers['cpu/a/next/0']
    changed = replace(original, inputs=(wrong_net.buses['A'][0],))
    wrong_net.producers[original.output] = changed; wrong_net.parts[original.address] = changed
    clean_plan, wrong_plan = compile_net(clean_net), compile_net(wrong_net)
    def run(plan, inputs):
        return execute_plan(plan, case['steps'], [{address: (byte >> i) & 1
                    for i, address in enumerate(clean_net.buses['IN'])} for byte in inputs])
    clean, wrong = run(clean_plan, case['inputs']), run(wrong_plan, case['inputs'])
    zero_clean, zero_wrong = run(clean_plan, [0]*4), run(wrong_plan, [0]*4)
    missing = deepcopy(clean)
    ci = next(c['index'] for c in clean_plan['calculations'] if c['outputAddress'] == 'cpu/a/next/0/valid')
    missing['states'][0]['pxcLog'] = [r for r in missing['states'][0]['pxcLog'] if r[0] != ci]
    cases = {}
    for name, title, reference, observed, plan in [
        ('clean', 'Matching execution', clean, clean, clean_plan),
        ('wrong-value', 'Actual wire fault: A stays zero', clean, wrong, wrong_plan),
        ('wrong-origin', 'Equal bits conceal a different wire source', zero_clean, zero_wrong, wrong_plan),
        ('missing-evidence', 'PASS summary with a missing validator execution', clean, missing, clean_plan)]:
        requested_bytes = [0]*4 if name == 'wrong-origin' else case['inputs']
        stimuli = [{address: (byte >> i) & 1 for i, address in enumerate(clean_net.buses['IN'])} for byte in requested_bytes]
        cases[name] = {'id': name, 'title': title, 'expectedPlan': clean_plan, 'expected': reference,
                       'observedPlan': plan, 'observed': observed,
                       'diagnosis': diagnose(clean_plan, reference, plan, observed, case['steps'], stimuli)}
    return cases


def compact_case(case):
    diagnosis = case['diagnosis']
    # All obligations are counted; only non-PASS rows and selected scope rows need display.
    compact = {**diagnosis, 'obligations': [f for f in diagnosis['obligations'] if f['status'] != 'PASS'],
               'obligationCounts': {status: sum(f['status'] == status for f in diagnosis['obligations'])
                                     for status in ('PASS', 'FAIL', 'UNVERIFIED')}}
    buses = case['expectedPlan']['busAddresses']
    return {'id': case['id'], 'title': case['title'], 'diagnosis': compact, 'buses': buses,
            'states': [{'t': left['t'], 'expected': left['buses'], 'actual': right['buses'],
                        'claimedFG': right['fg']} for left, right in zip(case['expected']['states'], case['observed']['states'])]}


def report():
    cases = build_cases()
    sources = [HERE/'diagnostics.py', HERE/'test_diagnostics.py', HERE/'viewer.html', BASE/'core.py',
               BASE/'pipeline.py', BASE/'circuits.py', BASE/'generated-checks.json']
    return {'schema': 'pxc-explanation-lane/v1', 'predecessor': predecessor(),
            'sourceSha256': {str(path.relative_to(BASE)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sources},
            'prediction': 'The actual changed wire first changes a producer at t(0), then the accumulator at t(1). Equal zero values still expose origin inequality. An omitted validator cannot earn PASS.',
            'cases': [compact_case(c) for c in cases.values()],
            'counterexample': {'seed': 20261004, 'path': '5:0', 'input': 1, 'source': 'generated-checks.json'},
            'limits': ['The clean trace is a comparison input, not an independent mathematical specification.',
                       'Primitive FGs and the previously verified CPU oracle establish different obligations.',
                       'A causal frontier identifies observed divergence; it does not infer the authoring mistake.',
                       'The missing-evidence case corrupts a retained record; the wire cases execute changed declarations.']}


def api_inspect(case_id, side, t, address):
    if case_id.startswith('library:'):
        evidence = json.loads((HERE.parent / 'composition' / 'library-evidence.json').read_text())
        candidate = next(c for c in evidence['report']['candidates'] if c['id'] == case_id.split(':', 1)[1])
        return inspect_part(candidate['trace'], candidate['plan'], t, address)
    if case_id.startswith('composition:'):
        _, specimen, strategy = case_id.split(':', 2)
        candidate = next(c for c in composition_evidence()['specimens'][specimen]['candidates'] if c['strategy'] == strategy)
        return inspect_part(candidate['trace'], candidate['plan'], t, address)
    if case_id.startswith('device-'):
        trace = device_trace(case_id.removeprefix('device-'))
        from smokelog import transform
        one = {**trace, 'states': [deepcopy(trace['states'][i]) for i in range(max(0, t-1), t+1)]}
        transform(one, False)
        return inspect_part(one, trace, t, address)
    case = build_cases()[case_id]
    if side not in ('expected', 'observed'):
        raise ValueError('side must be expected or observed')
    return inspect_part(case[side], case['expectedPlan' if side == 'expected' else 'observedPlan'], t, address)


@lru_cache(maxsize=2)
def device_trace(name):
    """Read a checked transport artifact; decode selected states only for UI inspection."""
    if name not in ('clean', 'wrong-strobe'):
        raise ValueError('Unknown device scenario')
    directory = HERE.parent / 'devices'
    summary = json.loads((directory / 'device-summary.json').read_text())
    scenario = next(s for s in summary['scenarios'] if s['name'] == name)
    raw = (directory / scenario['trace']).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != scenario.get('packedSha256'):
        raise ValueError('Device transport bytes differ from the verified scenario artifact')
    packed = json.loads(raw)
    if packed['traceSha256'] != scenario['traceSha256']:
        raise ValueError('Device trace digest differs from its retained receipt')
    return packed['trace']


def device_report():
    path = HERE.parent / 'devices' / 'device-summary.json'
    if not path.exists():
        return {'status': 'PENDING', 'message': 'Device evidence is still being generated.'}
    summary = json.loads(path.read_text())
    for scenario in summary['scenarios']:
        trace = device_trace(scenario['name'])
        scenario['busAddresses'] = trace['busAddresses']
    tables = path.with_name('component-truth-tables.json')
    if tables.exists():
        summary['componentTruthTables'] = json.loads(tables.read_text())
    return {**summary, 'artifactStatus': summary.get('status'), 'status': 'READY'}


def composition_evidence():
    return json.loads((HERE.parent / 'composition' / 'evidence.json').read_text())


def composition_report():
    path = HERE.parent / 'composition' / 'evidence.json'
    if not path.exists():
        return {'status': 'PENDING', 'message': 'Composition evidence is still being generated.'}
    evidence = composition_evidence()
    specimens = {}
    for name, specimen in evidence['specimens'].items():
        specimens[name] = {'requirement': specimen['requirement'], 'selection': specimen['selection'],
                          'candidates': [{key: c[key] for key in ('strategy', 'bom', 'verification', 'qualification')}
                                         | {'busAddresses': c['plan']['busAddresses'],
                                            'states': [{'t': s['t'], 'buses': s['buses'], 'fg': s['fg']} for s in c['trace']['states']]}
                                         for c in specimen['candidates']]}
    library_path = path.with_name('library-evidence.json')
    library = None
    if library_path.exists():
        source = json.loads(library_path.read_text())
        library = {'summary': source['summary'], 'requirement': source['report']['requirement'],
                   'selection': source['report']['selection'], 'semanticRequirement': source['report']['semanticRequirement'],
                   'sourceSha256': hashlib.sha256(library_path.read_bytes()).hexdigest(),
                   'candidates': [{key: c[key] for key in ('id', 'label', 'origin', 'bom', 'verification', 'qualification')}
                                   | {'busAddresses': c['plan']['busAddresses'],
                                      'states': [{'t': s['t'], 'buses': s['buses'], 'fg': s['fg']} for s in c['trace']['states']]}
                                  for c in source['report']['candidates']]}
    return {'status': 'READY', 'specimens': specimens, 'summary': evidence['summary'], 'library': library,
            'counterexamples': [{key: c[key] for key in ('id', 'verification', 'because', 'try')} for c in evidence['counterexamples']]}


if __name__ == '__main__':
    result = report()
    (HERE / 'report.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'cases': {c['id']: c['diagnosis']['status'] for c in result['cases']},
                      'predecessor': result['predecessor']['checkpoint']}))
