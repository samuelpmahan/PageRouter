"""Bounded integration gate, with an actual faulty return circuit retained."""
import gc
import gzip
import hashlib
import json
from dataclasses import asdict

from core import compile_net, execute_plan
from .assembler import assemble_interrupts
from .checks import (check_display_mapping, check_instruction_conformance,
                     check_interrupt_context, check_pending_semantics, check_trace_structure)
from .experiment import (DEFAULT, HERE, build_machine, primitive_summary, run_case,
                         source_identities, write_gzip, write_json)

CHECKS = ('instructionConformance', 'interruptContext', 'pendingSemantics',
          'displayMapping', 'executionEvidence', 'primitiveGuarantees')


def summary(result):
    return {name: {key: value for key, value in result[name].items() if key != 'issues'}
            for name in CHECKS}


def valid(checks):
    return all(checks[name]['status'] == 'PASS' and checks[name]['loss'] == 0 for name in CHECKS)


def recheck(trace, plan, case, stimuli):
    return dict(instructionConformance=check_instruction_conformance(
                    trace, case['program'], case['steps'], initial=case.get('initial'),
                    inputs=case.get('inputs'), irqs=case.get('irqs')),
                interruptContext=check_interrupt_context(trace),
                pendingSemantics=check_pending_semantics(trace),
                displayMapping=check_display_mapping(trace),
                executionEvidence=check_trace_structure(trace, plan, case['steps'], stimuli),
                primitiveGuarantees=primitive_summary(trace))


def check_each_external_pulse(trace, requirement, irqs):
    """Case-specific alternative promise: all three arrivals served by state 16."""
    deadline = requirement['deadlineState']
    arrivals = [t for t, bit in enumerate(irqs[:deadline]) if bit and (t == 0 or not irqs[t - 1])]
    entries = [state['t'] + 1 for state in trace['states']
               if state['t'] < deadline and state['buses']['ACCEPT']]
    issues = []
    if arrivals != requirement['arrivalStates']:
        issues.append(dict(kind='arrival-obligation', expected=requirement['arrivalStates'], actual=arrivals))
    if trace['states'][-1]['t'] < deadline:
        issues.append(dict(kind='deadline-not-observed', expected=deadline, actual=trace['states'][-1]['t']))
    expected = requirement['expectedAccepts']
    if len(entries) != expected:
        issues.append(dict(t=deadline, kind='service-count', field='acceptCount', expected=expected, actual=len(entries)))
    return dict(status='FAIL' if issues else 'PASS', loss=len(issues), issues=issues,
                arrivalStates=arrivals, entryStates=entries, deadlineState=deadline,
                expectedAccepts=expected, actualAccepts=len(entries),
                meaning='Alternative promise: every separate external pulse is serviced by this deadline. No timer request occurs in this case.')


def main():
    run = json.loads((HERE / 'run.json').read_text())
    pack = json.loads(gzip.decompress((HERE / 'dual-input.json.gz').read_bytes()))
    trace, stimuli = pack['trace'], pack['stimuli']
    case = dict(DEFAULT, program=run['program'])
    plan = compile_net(build_machine(case['program'], case['initial'], None))
    baseline_checks = recheck(trace, plan, case, stimuli)
    fresh = run['sourceIdentities'] == source_identities()
    sequence = dict(entries=baseline_checks['interruptContext']['entryStates'],
                    returns=baseline_checks['interruptContext']['returnStates'],
                    pixelWrites=[dict(t=b['t'], byte=b['buses']['RAM00'])
                                 for a, b in zip(trace['states'], trace['states'][1:])
                                 if a['buses']['RAM00'] != b['buses']['RAM00']])
    expected_sequence = dict(entries=[32, 64, 96], returns=[37, 69, 101],
                             pixelWrites=[dict(t=t, byte=b) for t, b in ((36, 1), (68, 3), (100, 7))])
    source_binding = run['program'] == assemble_interrupts(DEFAULT['source']) and run['source'] == DEFAULT['source']
    horizon_binding = pack['steps'] == run['steps'] == DEFAULT['steps']
    baseline_ok = fresh and source_binding and horizon_binding and valid(baseline_checks) and sequence == expected_sequence
    receipt = dict(schema='pxc-interrupt-verification/v1',
                   baseline=dict(status='PASS' if baseline_ok else 'FAIL',
                                 sourceBytesMatch=fresh, sourceAssemblesToROM=source_binding,
                                 requestedHorizonMatches=horizon_binding, checks=summary(baseline_checks),
                                 observed=sequence, expected=expected_sequence),
                   sourceIdentities={**source_identities(),
                                     'extensions/interrupts/verify.py': hashlib.sha256((HERE / 'verify.py').read_bytes()).hexdigest()})
    print('baseline:', receipt['baseline']['status'], flush=True)

    delta = execute_plan(plan, case['steps'], stimuli, True)
    delta_checks = recheck(delta, plan, case, stimuli)
    bit_count = sum(len(state['values']) for state in trace['states'])
    bit_loss = sum(a != b for full, reused in zip(trace['states'], delta['states'])
                   for a, b in zip(full['values'], reused['values']))
    closure_ok = len(trace['states']) == len(delta['states']) and all(
        len(a['values']) == len(b['values']) for a, b in zip(trace['states'], delta['states']))
    delta_ok = bit_loss == 0 and closure_ok and valid(delta_checks)
    receipt['fullVsDelta'] = dict(status='PASS' if delta_ok else 'FAIL',
                                 bitObservationsCompared=bit_count, bitMismatches=bit_loss,
                                 stateClosure=closure_ok, checks=summary(delta_checks),
                                 fullTotals=trace['totals'], deltaTotals=delta['totals'])
    print('full vs delta:', receipt['fullVsDelta']['status'], bit_count, 'bits', flush=True)
    del delta, trace, pack, plan
    gc.collect()

    mutant_case = dict(DEFAULT, steps=40, inputs=[0] * 41, irqs=[0] * 41)
    mutant = run_case(mutant_case, mutant='wrong-return-pc')
    first = mutant['instructionConformance']['issues'][0] if mutant['instructionConformance']['issues'] else None
    mutant_ok = (mutant['primitiveGuarantees']['status'] == 'PASS' and
                 mutant['executionEvidence']['status'] == 'PASS' and
                 mutant['instructionConformance']['status'] == 'FAIL' and
                 mutant['interruptContext']['status'] == 'FAIL' and
                 first is not None and first['t'] == 37 and first['field'] == 'PC')
    mutant_row = dict(name='wrong-return-pc', status=mutant['instructionConformance']['status'],
                      loss=mutant['instructionConformance']['loss'], firstMismatch=first,
                      description='Actual circuit restores SAVED_PC + 1. Primitive equations still pass; return semantics fail.',
                      construction='Four gate-built adder bits retarget cpu/irq/return-pc/0..3 and their attached wire guarantees.',
                      checks=summary(mutant), detectedAsExpected=mutant_ok,
                      evidence='wrong-return-input.json.gz')
    receipt['wrongReturnMutant'] = mutant_row
    write_gzip(HERE / 'wrong-return-input.json.gz', dict(trace=mutant['execution'],
                   stimuli=mutant['stimuli'], steps=mutant_case['steps']))
    print('wrong return detected:', mutant_ok, first, flush=True)
    del mutant
    gc.collect()

    overload_case = dict(DEFAULT, name='three-pulses-one-pending-bit', steps=16,
                         inputs=[0] * 17, irqs=[int(t in (2, 4, 6)) for t in range(17)])
    overload = run_case(overload_case)
    p = overload['pipeline']
    p.input('contract/every-external-pulse-serviced',
            dict(arrivalStates=[2, 4, 6], deadlineState=16, expectedAccepts=3))
    p.declare('everyExternalPulseServiced', 'count-external-pulse-services-by-deadline',
              ['execution', 'contract/every-external-pulse-serviced', 'request/irqs'], check_each_external_pulse)
    p.guarantee('fg/every-external-pulse-serviced', 'execution', 'contract/every-external-pulse-serviced',
                ['everyExternalPulseServiced/calc'])
    p.seek([*p.requested, 'fg/every-external-pulse-serviced'])
    service = p.values['everyExternalPulseServiced']
    entries = overload['interruptContext']['entryStates']
    returns = overload['interruptContext']['returnStates']
    end = overload['execution']['states'][-1]['buses']
    arrivals = [t for t, bit in enumerate(overload_case['irqs'][:-1]) if bit]
    queued_loss = service['loss']
    overload_ok = valid(overload) and arrivals == [2, 4, 6] and entries == [3, 9] and returns == [8, 14]
    overload_ok = overload_ok and end['PENDING'] == 0 and end['ACTIVE'] == 0 and service['status'] == 'FAIL' and queued_loss == 1
    overload_row = dict(name='three-pulses-one-pending-bit', status='PASS' if overload_ok else 'FAIL',
                        checks=summary(overload), arrivalStates=arrivals,
                        entryStates=entries, returnStates=returns,
                        finalPending=end['PENDING'], finalActive=end['ACTIVE'],
                        queuedServiceContract=service,
                        requestedGuarantees=p.requested)
    receipt['overload'] = overload_row
    write_gzip(HERE / 'overload-input.json.gz', dict(case=overload_case,
        trace=overload['execution'], stimuli=overload['stimuli'], steps=overload_case['steps'],
        checks={name: overload[name] for name in CHECKS}, serviceComparison=overload_row,
        pipeline=dict(declarations={address: asdict(part) for address, part in p.parts.items()},
                      requested=p.requested, order=p.order, log=p.log,
                      requirement=p.values['contract/every-external-pulse-serviced'],
                      result=service)))
    overload_row['evidence'] = 'overload-input.json.gz'
    print('overload coalescing:', overload_row['status'], arrivals, '->', entries, flush=True)
    del overload, p
    gc.collect()

    directed_cases = [
        dict(name='masked-request-then-EI', source='NOP\nEI\nHALT\n.ORG 8\nIRET', steps=5,
             irqs=[1, 0, 0, 0, 0, 0]),
        dict(name='halt-keeps-timer-and-scan-running', source='EI', steps=5,
             initial=dict(HALT=1, IE=1, TIMER=30, SCAN_ROW=7,
                          RAM=[1 << i for i in range(8)] + [0] * 8)),
        dict(name='IRET-outside-handler', source='EI\nDI\nIRET\nHALT', steps=5),
    ]
    receipt['directedCases'] = []
    for directed in directed_cases:
        result = run_case(directed)
        receipt['directedCases'].append(dict(name=directed['name'],
            status='PASS' if valid(result) else 'FAIL', checks=summary(result)))
        del result
    gc.collect()

    generated_path = HERE / 'generated-cases.json'
    generated = json.loads(generated_path.read_text())
    rows, observed_opcodes, observed_rows, halted_cases = [], set(), set(), []
    total_states = total_bits = max_addresses = 0
    for generated_case in generated['cases']:
        result = run_case(generated_case)
        states = result['execution']['states']
        observed_opcodes.update(state['buses']['OPCODE'] for state in states)
        observed_rows.update(state['buses']['SCAN_ROW'] for state in states)
        if any(state['buses']['HALT'] for state in states):
            halted_cases.append(generated_case['name'])
        state_count, address_count = len(states), len(result['plan']['addresses'])
        total_states += state_count
        total_bits += state_count * address_count
        max_addresses = max(max_addresses, address_count)
        row = dict(name=generated_case['name'], status='PASS' if valid(result) else 'FAIL',
                   states=state_count, bitObservations=state_count * address_count,
                   entryCount=len(result['interruptContext']['entryStates']),
                   returnCount=len(result['interruptContext']['returnStates']), checks=summary(result))
        rows.append(row)
        print('generated:', row['name'], row['status'], flush=True)
        if row['status'] != 'PASS':
            write_gzip(HERE / (generated_case['name'] + '-failure.json.gz'),
                       dict(case=generated_case, trace=result['execution'], checks={name: result[name] for name in CHECKS}))
        del states, result
        gc.collect()
    generated_ok = len(rows) == 24 and all(row['status'] == 'PASS' for row in rows)
    receipt['generated'] = dict(status='PASS' if generated_ok else 'FAIL',
        seed=generated['seed'], runtime=generated['runtime'], caseCount=len(rows),
        totalStates=total_states, totalBitObservations=total_bits, maxAddressesPerState=max_addresses,
        observedOpcodes=sorted(observed_opcodes), observedScanRows=sorted(observed_rows),
        casesWithHaltedObservations=halted_cases,
        sourceSha256=hashlib.sha256((HERE / 'generate_cases.mjs').read_bytes()).hexdigest(),
        casesSha256=hashlib.sha256(generated_path.read_bytes()).hexdigest(), cases=rows,
        limit='Seeded fast-check samples, not exhaustive CPU proof. Generation samples are reproducible; failing traces are retained. No shrinking is claimed.')
    all_ok = (baseline_ok and delta_ok and mutant_ok and overload_ok and generated_ok and
              all(row['status'] == 'PASS' for row in receipt['directedCases']))
    receipt['status'] = 'PASS' if all_ok else 'FAIL'
    receipt['limits'] = ['All execution is ideal logical Boolean timing; no physical hardware or video signal.',
                         'Full and delta share a primitive evaluator; the separate integer reference supplies independent behavioral checking.',
                         'The faulty-return and queued-service comparisons intentionally fail; their detection is required for this verification gate to pass.']
    write_json(HERE / 'verification.json', receipt)
    run['mutants'] = [mutant_row, dict(name='queue-every-pulse-contract',
        status=service['status'], loss=queued_loss,
        firstMismatch=service['issues'][0] if service['issues'] else None,
        description='Three separate arrivals produce two handler entries because one pending bit coalesces arrivals.',
        declaredPolicyStatus=overload_row['status'], evidence='verification.json#overload')]
    run['verification'] = dict(status=receipt['status'], artifact='verification.json',
                               generatedCases=len(rows), generatedStates=total_states,
                               fullDeltaBitsCompared=bit_count)
    write_json(HERE / 'run.json', run)
    print(json.dumps(dict(status=receipt['status'], generatedCases=len(rows), generatedStates=total_states,
                          mutantFirstMismatch=first, fullDeltaBitsCompared=bit_count)))
    return 0 if all_ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
