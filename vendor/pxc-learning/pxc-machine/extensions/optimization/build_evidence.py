"""Run predecessor, transformed graph, and independent CPU oracle on real cases."""
from copy import deepcopy
from dataclasses import asdict, replace
from hashlib import sha256
from itertools import product
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1]
sys.path.insert(0, str(BASE))
from core import Net, Part, compile_net, execute_plan, audit_trace
from circuits import assemble, build_cpu, DEMOS
from machine_checks import cases
from optimizer import build_pipeline, compare_observations, optimize_net, validate_structure
from pipeline import Pipeline


def unsafe_merge_probe():
    """An actual bad rewrite: NAND(a,c) replaced with existing NAND(a,b)."""
    original, candidate = Net('correct distinct expressions'), Net('unsafe merge')
    for net in (original, candidate):
        a, b, c = [net.input(x) for x in ('a', 'b', 'c')]
        first = net.nand('ab', a, b)
        second = net.nand('ac', a, c) if net is original else net.wire('ac', first)
        net.bus('AB', [first]); net.bus('AC', [second])
    p = Pipeline()
    p.input('predecessor/net', original); p.input('candidate/net', candidate)
    p.input('stimuli', [dict(a=a, b=b, c=c) for a, b, c in product((0, 1), repeat=3)])
    p.input('steps', 7)
    for side in ('predecessor', 'candidate'):
        p.declare(side+'/plan', 'compile-regenerated-fgs', [side+'/net'], compile_net)
        p.declare(side+'/trace', 'execute', [side+'/plan', 'steps', 'stimuli'], execute_plan)
        p.declare(side+'/audit', 'audit', [side+'/trace', side+'/plan', 'steps', 'stimuli'], audit_trace)
    p.declare('comparison', 'compare-observable-boundaries', ['predecessor/trace', 'candidate/trace'], compare_observations)
    p.guarantee('fg/substitution', 'predecessor/trace', 'candidate/trace', ['comparison/calc'])
    p.seek(['fg/substitution', 'predecessor/audit', 'candidate/audit'])
    return dict(kind='actual unsafe circuit rewrite',
        rewrite='NAND(a,c) incorrectly reused NAND(a,b), ignoring different second input',
        beforeBOM=p.values['predecessor/plan']['bom'], afterBOM=p.values['candidate/plan']['bom'],
        comparison=p.values['comparison'],
        primitiveFailures=sum(s['fg']['failed'] for side in ('predecessor', 'candidate') for s in p.values[side+'/trace']['states']),
        auditLoss=sum(p.values[side+'/audit']['loss'] for side in ('predecessor', 'candidate')),
        pipeline=dict(declarations={a:asdict(part) for a,part in p.parts.items()}, order=p.order, log=p.log),
        traces={side:p.values[side+'/trace'] for side in ('predecessor', 'candidate')})


def review_probes():
    def specimen():
        net = Net('FG transport review specimen')
        a, b = net.input('a'), net.input('b')
        first = net.nand('first', a, b)
        boundary = net.wire('boundary', first)
        q = net.delay('q', boundary)
        net.bus('OUT', [boundary, q])
        return net
    result = {}
    original = specimen()
    original.parts['first/operands'] = Part('first/operands', ('a',))
    try:
        optimize_net(original)
        result['alteredIncomingFG'] = dict(rejected=False)
    except ValueError as error:
        result['alteredIncomingFG'] = dict(rejected=True, reason=str(error))
    original = specimen(); candidate, report = optimize_net(original)
    for output, inputs in [('boundary', ('const/0',)), ('boundary/valid', ('const/0', 'boundary'))]:
        calc = replace(candidate.producers[output], inputs=inputs)
        candidate.producers[output] = calc; candidate.parts[calc.address] = calc
    candidate.parts['boundary/operands'] = Part('boundary/operands', ('const/0',))
    report['sourceToResult']['boundary']['visible'] = 'first'
    verdict = validate_structure(original, candidate, report)
    result['hiddenChangedBoundary'] = dict(rejected=verdict['loss'] > 0, verdict=verdict)
    original = specimen(); candidate, report = optimize_net(original)
    candidate.guarantees = []
    verdict = validate_structure(original, candidate, report)
    result['erasedCandidateFGs'] = dict(rejected=verdict['loss'] > 0, verdict=verdict)
    original = specimen(); candidate, report = optimize_net(original)
    report['beforeBOM']['nand'] = 9000; report['afterBOM']['nand'] = 0; report['nandSaved'] = 9000
    verdict = validate_structure(original, candidate, report)
    result['forgedCostClaim'] = dict(rejected=verdict['loss'] > 0, verdict=verdict)
    return result


def suite(random_count=32, seed=20261005):
    yield from cases(random_count=random_count, steps=8, seed=seed)
    for name, demo in DEMOS.items():
        supplied = demo['inputs']
        steps = len(supplied)-1
        inputs = [supplied[min(i, len(supplied)-1)] if supplied else 0 for i in range(steps+1)]
        yield dict(id='demo-'+name, program=assemble(demo['source']), steps=steps, inputs=inputs, initial={})


def source_hashes():
    paths = [BASE/name for name in ('core.py', 'circuits.py', 'synthesis.py', 'pipeline.py', 'oracle.py', 'machine_checks.py')]
    paths += [HERE/name for name in ('optimizer.py', 'build_evidence.py', 'test_optimizer.py')]
    paths.append(BASE.parent/'lyceum/common.py')
    return {str(path.relative_to(BASE.parent)):sha256(path.read_bytes()).hexdigest() for path in paths}


def build(random_count=32, seed=20261005):
    starting = source_hashes(); rows = []; example = None
    checks = ['ruleProof', 'structure', 'observations', 'predecessor/audit', 'candidate/audit',
              'predecessor/conformance', 'candidate/conformance']
    opcode_counts = {str(i):0 for i in range(16)}
    case_list = list(suite(random_count, seed))
    for index, case in enumerate(case_list):
        original = build_cpu(case['program'], initial=case['initial'])
        p = build_pipeline(original, case['program'], case['steps'], initial=case['initial'], inputs=case['inputs'])
        report = p.values['report']
        losses = {name:p.values[name]['loss'] for name in checks}
        row = dict(id=case['id'], states=case['steps']+1, losses=losses, totalLoss=sum(losses.values()),
            beforeBOM=report['beforeBOM'], afterBOM=report['afterBOM'], nandSaved=report['nandSaved'],
            boundaryAliases=len(report['boundaryAliases']),
            beforeExecuted=p.values['predecessor/trace']['totals']['evaluated'],
            afterExecuted=p.values['candidate/trace']['totals']['evaluated'])
        rows.append(row)
        for state in p.values['reference'][:-1]:
            if not state['HALT']:
                opcode_counts[str(case['program'][state['PC']] >> 4)] += 1
        if case['id'] == 'demo-countdown':
            example = dict(request=case, report=report, validations={name:p.values[name] for name in checks},
                pipeline=dict(declarations={a:asdict(part) for a,part in p.parts.items()}, order=p.order, log=p.log),
                observations={side:[dict(t=s['t'], buses=s['buses'], fg=s['fg'])
                    for s in p.values[side+'/trace']['states']] for side in ('predecessor', 'candidate')},
                reference=p.values['reference'],
                projection='Complete declarations/rewrite mappings and bus/FG state observations. Detailed bit traces execute in memory and are audited; this artifact does not claim to retain their full logs.')
        print(json.dumps(dict(case=case['id'], loss=row['totalLoss'], nand=report['afterBOM']['nand'], saved=report['nandSaved'])), flush=True)
    mutant = unsafe_merge_probe(); review = review_probes()
    final = source_hashes()
    changed = [name for name in starting if starting[name] != final[name]]
    total_loss = sum(row['totalLoss'] for row in rows)
    mutant_rejected = mutant['comparison']['loss'] > 0 and mutant['primitiveFailures'] == 0 and mutant['auditLoss'] == 0
    cpu_gain = all(row['nandSaved'] > 0 and row['beforeBOM']['delay'] == row['afterBOM']['delay'] for row in rows)
    receipt = dict(schema='pxc-optimization/v1', status='PASS' if not total_loss and not changed and mutant_rejected and cpu_gain and all(v['rejected'] for v in review.values()) else 'FAIL',
        seed=seed, cases=rows, caseCount=len(rows), randomCases=random_count,
        statesPerEngine=sum(row['states'] for row in rows), totalLoss=total_loss,
        opcodeExecutionCounts=opcode_counts,
        nandSavingsRange=[min(row['nandSaved'] for row in rows), max(row['nandSaved'] for row in rows)],
        delayCounts=sorted({row['afterBOM']['delay'] for row in rows}),
        everyCpuCaseReducedNandWithSameStorage=cpu_gain,
        unsafeMerge=dict(comparisonLoss=mutant['comparison']['loss'], primitiveFailures=mutant['primitiveFailures'], auditLoss=mutant['auditLoss']),
        reviewRegressionProbes=review,
        sourceSha256=final, startingSourceSha256=starting, changedSourcesDuringExecution=changed,
        limits=['CPU programs/state sequences are sampled, not exhaustive.',
                'Rule truth tables are exhaustive; the local graph-rewrite relation is checked for every predecessor expression.',
                'This reduces logical NAND count. Alias wires preserve visible addresses and have their own validators.',
                'Clocked cells remain distinct. No propagation delay, physical area, power, or speed claim.',
                'Only standard Net-generated primitive FGs are transported; unsupported custom hardware contracts are rejected.'])
    return receipt, example, mutant


if __name__ == '__main__':
    receipt, example, mutant = build()
    for name, value in [('receipt.json', receipt), ('example.json', example), ('unsafe-merge.json', mutant)]:
        (HERE/name).write_text(json.dumps(value, indent=2, sort_keys=True)+'\n')
    print(json.dumps({key:receipt[key] for key in ('status', 'caseCount', 'statesPerEngine', 'totalLoss', 'nandSavingsRange', 'unsafeMerge')}))
    raise SystemExit(receipt['status'] != 'PASS')
