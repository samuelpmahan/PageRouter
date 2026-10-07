"""Execute interrupt declarations through the existing primitive-only Pipeline."""
from dataclasses import asdict
import gzip
import hashlib
import json
from pathlib import Path

from core import compile_net, execute_plan
from circuits import add_bus
from pipeline import Pipeline
from .assembler import assemble_interrupts
from .checks import (check_display_mapping, check_interrupt_context,
                     check_pending_semantics, check_trace_structure)
from .machine import build_interrupt_cpu, retarget_wire
from .reference import expected_buses, run_reference_interrupts

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1]
SOURCE = (HERE / 'demo.asm').read_text()
DEFAULT = dict(name='timer-drawing', source=SOURCE, steps=104,
               initial={'RAM': [0] * 15 + [1]}, inputs=[0] * 105, irqs=[0] * 105)


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def write_gzip(path, value):
    encoded = json.dumps(value, separators=(',', ':'), sort_keys=True).encode()
    path.write_bytes(gzip.compress(encoded, compresslevel=6, mtime=0))


def source_identities():
    files = ['core.py', 'circuits.py', 'pipeline.py',
             *['extensions/interrupts/' + name for name in
               ('assembler.py', 'machine.py', 'reference.py', 'checks.py', 'experiment.py', 'demo.asm')]]
    return {name: hashlib.sha256((BASE / name).read_bytes()).hexdigest() for name in files}


def build_machine(program, initial, mutant):
    net = build_interrupt_cpu(program, initial)
    if mutant == 'wrong-return-pc':
        wrong, _ = add_bus(net, 'mutant/return-pc-plus-one', net.buses['SAVED_PC'],
                           [net.const(1), net.const(0), net.const(0), net.const(0)])
        net.groups['cpu/interrupts']['children'].append('mutant/return-pc-plus-one')
        for bit, source in enumerate(wrong):
            retarget_wire(net, f'cpu/irq/return-pc/{bit}', source)
    elif mutant is not None:
        raise ValueError(f'Unknown circuit mutant: {mutant}')
    return net


def bind_stimuli(machine, inputs, irqs):
    return [{**{address: (byte >> i) & 1 for i, address in enumerate(machine.buses['IN'])},
             machine.buses['EXT_IRQ'][0]: irq} for byte, irq in zip(inputs, irqs)]


def compare_architecture(trace, reference):
    issues = []
    if len(trace['states']) != len(reference):
        issues.append(dict(kind='state-closure', expected=len(reference), actual=len(trace['states'])))
    for actual, required in zip(trace['states'], reference):
        for name, expected in expected_buses(required).items():
            value = actual['buses'].get(name)
            if type(value) is not type(expected) or value != expected:
                issues.append(dict(t=actual['t'], kind='architecture', field=name,
                                   expected=expected, actual=value))
    # ImplSpecific comparison policy: retain failures and continue. A failed
    # semantic guarantee must remain inspectable beside successful gate checks.
    return dict(status='FAIL' if issues else 'PASS', loss=len(issues), issues=issues,
                statesCompared=min(len(trace['states']), len(reference)),
                busesPerState=len(expected_buses(reference[0])))


def primitive_summary(trace):
    failures = [dict(t=state['t'], addresses=state['fg']['failures'])
                for state in trace['states'] if state['fg']['failed']]
    return dict(status='FAIL' if failures else 'PASS',
                loss=sum(state['fg']['failed'] for state in trace['states']),
                issues=failures, guaranteesPerState=len(trace['fgs']),
                observations=sum(state['fg']['total'] for state in trace['states']))


def run_case(case=DEFAULT, *, mutant=None, delta=False):
    """Requested FunctionalGuarantees determine the executed Calculation closure."""
    steps = case['steps']
    if type(steps) is not int or not 0 <= steps <= 128:
        raise ValueError('Experiment steps must be in 0..128')
    initial = case.get('initial', {})
    inputs, irqs = case.get('inputs', [0] * (steps + 1)), case.get('irqs', [0] * (steps + 1))
    for values, limit in ((inputs, 256), (irqs, 2)):
        if len(values) != steps + 1 or any(type(v) is not int or not 0 <= v < limit for v in values):
            raise ValueError('Every requested state needs a valid explicit input and IRQ observation')
    p = Pipeline()
    for name, value in (('case', case), ('steps', steps), ('initial', initial),
                        ('inputs', inputs), ('irqs', irqs), ('mutant', mutant), ('delta', delta)):
        p.input('request/' + name, value)
    if 'source' in case:
        p.declare('source', 'read-case-source', ['request/case'], lambda item: item['source'])
        p.declare('program', 'assemble-interrupt-program', ['source'], assemble_interrupts)
    else:
        p.declare('program', 'read-case-rom-bytes', ['request/case'], lambda item: list(item['program']))
    p.declare('machine', 'compose-interrupt-circuit', ['program', 'request/initial', 'request/mutant'], build_machine)
    p.declare('plan', 'compile-with-primitive-fg-closure', ['machine'], compile_net)
    p.declare('stimuli', 'bind-explicit-input-bits', ['machine', 'request/inputs', 'request/irqs'], bind_stimuli)
    p.declare('execution', 'execute-gate-plan', ['plan', 'request/steps', 'stimuli', 'request/delta'], execute_plan)
    p.declare('reference', 'independent-integer-interpreter',
              ['program', 'request/steps', 'request/initial', 'request/inputs', 'request/irqs'],
              lambda program, count, init, ins, irq: run_reference_interrupts(
                  program, count, initial=init, inputs=ins, irqs=irq))
    p.declare('instructionConformance', 'compare-all-architectural-observations',
              ['execution', 'reference'], compare_architecture)
    p.declare('interruptContext', 'check-entry-and-return-contract', ['execution'], check_interrupt_context)
    p.declare('pendingSemantics', 'check-masking-coalescing-and-timer', ['execution'], check_pending_semantics)
    p.declare('displayMapping', 'check-framebuffer-scan-contract', ['execution'], check_display_mapping)
    p.declare('executionEvidence', 'audit-requested-primitive-execution',
              ['execution', 'plan', 'request/steps', 'stimuli'], check_trace_structure)
    p.declare('primitiveGuarantees', 'collect-observed-primitive-verdicts', ['execution'], primitive_summary)
    contracts = {
        'interruptContext': 'Accept saves PC/A before the interrupted instruction; IRET restores both.',
        'pendingSemantics': 'One pending bit coalesces requests; active handlers never nest; HALT never wakes.',
        'displayMapping': 'Row r selects RAM[r], bit x selects column x, and scan advances modulo eight.',
        'primitiveGuarantees': 'Every attached NAND, wire and delay validator is true at every requested state.',
    }
    for name, meaning in contracts.items():
        p.input('contract/' + name, meaning)
    targets = [('instructionConformance', 'reference'), ('executionEvidence', 'plan'),
               *[(name, 'contract/' + name) for name in contracts]]
    roots = []
    for name, right in targets:
        root = 'fg/' + name
        p.guarantee(root, 'execution', right, [name + '/calc'])
        roots.append(root)
    p.seek(roots)
    return dict(case=case, mutant=mutant, pipeline=p, **p.values)


def events_from_trace(trace):
    events = []
    for i, state in enumerate(trace['states']):
        new = state['buses']
        if new['TIMER'] == 31:
            events.append(dict(t=state['t'], type='timer', part='TIMER',
                               text='Timer is 31: IRQ is asserted for the next transition.'))
        if i == 0:
            continue
        old = trace['states'][i - 1]['buses']
        if old['ACCEPT']:
            events.append(dict(t=state['t'], type='accept', part='SAVED_PC',
                               text=f"Saved PC={new['SAVED_PC']} and A={new['SAVED_A']}; entered handler at PC=8."))
        if old['RETURN']:
            events.append(dict(t=state['t'], type='return', part='PC',
                               text=f"Restored PC={new['PC']} and A={new['A']}; foreground resumes."))
        for row in range(8):
            name = f'RAM{row:02}'
            if old[name] != new[name]:
                events.append(dict(t=state['t'], type='pixel', part=name,
                                   text=f"Framebuffer row {row}: {old[name]:08b} → {new[name]:08b}."))
    return events


def project_run(result):
    trace, p = result['execution'], result['pipeline']
    names = ('instructionConformance', 'interruptContext', 'pendingSemantics',
             'displayMapping', 'executionEvidence', 'primitiveGuarantees')
    checks = {name: result[name] for name in names}
    return dict(schema='pxc-interrupts/v1', source=result['case'].get('source'),
                program=result['program'], steps=result['case']['steps'],
                initial=result['case'].get('initial', {}),
                states=[dict(t=s['t'], **s['buses'], RAM=[s['buses'][f'RAM{i:02}'] for i in range(16)])
                        for s in trace['states']], checks=checks, events=events_from_trace(trace),
                bom=result['plan']['bom'], mutants=[],
                addresses={**result['plan']['busAddresses'],
                           'RAM': [result['plan']['busAddresses'][f'RAM{i:02}'] for i in range(16)]},
                pipeline=dict(declarations={address: asdict(part) for address, part in p.parts.items()},
                              requested=p.requested, order=p.order, log=p.log,
                              note='Each requested FG visits its validator Calculation and all data dependencies.'),
                sourceIdentities=source_identities(),
                meaning=dict(
                    clock='Logical synchronous ticks; no physical frequency, propagation delay or real video output.',
                    time='State t is committed storage plus combinational observations. IRQ/ACCEPT/RETURN at t decide transition t → t+1.',
                    interrupt='Acceptance precedes the interrupted instruction, saves PC and A, and enters ROM address 8. IRET restores PC/A; no nesting.',
                    pending='One pending bit records at least one request. Multiple arrivals while pending coalesce; requests are not queued individually.',
                    halt='HALT never wakes on IRQ. Timer, pending capture and display scan continue.',
                    display='RAM[0..7] are eight pixel rows; bit x is column x. The three-bit scan counter chooses one row per tick.',
                    timer='Five-bit free-running timer requests at 31, then wraps to zero. Default requests occur at t=31,63,95.',
                    failurePolicy='ImplSpecific: retain failed comparison observations and report them alongside primitive guarantees.',
                    sourceIdentity='SHA-256 labels exact local source bytes used for this run; hashes do not prove semantic equivalence.'))


def main():
    result = run_case()
    run = project_run(result)
    write_json(HERE / 'run.json', run)
    write_gzip(HERE / 'dual-input.json.gz', dict(trace=result['execution'],
                                               stimuli=result['stimuli'], steps=DEFAULT['steps']))
    print(json.dumps(dict(status='PASS' if all(c['status'] == 'PASS' for c in run['checks'].values()) else 'FAIL',
                          states=len(run['states']), checks=run['checks'], events=run['events'], bom=run['bom'])))
    return 0 if all(c['status'] == 'PASS' for c in run['checks'].values()) else 1


if __name__ == '__main__':
    raise SystemExit(main())
