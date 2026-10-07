"""Executed higher-order Calculations connect declarations to the visible machine."""
from dataclasses import asdict
import json
from core import Part, Calculation, FunctionalGuarantee, compile_net, execute_plan, audit_trace
from circuits import assemble, build_cpu, DEMOS, OPCODES
from oracle import run_reference
from synthesis import synthesize


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


class Pipeline:
    def __init__(self):
        self.values, self.parts, self.log, self.functions = {}, {}, [], {}

    def input(self, address, value):
        if address in self.parts:
            raise ValueError(f'duplicate pipeline Part {address}')
        self.parts[address] = Part(address)
        self.values[address] = value
        return address

    def declare(self, address, rule, inputs, fn):
        inputs = tuple(inputs)
        calculation = Calculation(address+'/calc', (), rule, inputs, address)
        if address in self.parts or calculation.address in self.parts:
            raise ValueError(f'duplicate pipeline Part {address}')
        self.parts[calculation.address] = calculation
        self.parts[address] = Part(address, (calculation.address,))
        self.functions[calculation.address] = fn
        return address

    def guarantee(self, address, left, right, validators):
        if address in self.parts:
            raise ValueError(f'duplicate pipeline Part {address}')
        self.parts[address] = FunctionalGuarantee(address,tuple(validators),left,right,tuple(validators))

    def seek(self, roots):
        order, visiting, done = [], set(), set()
        def visit(address):
            if address in done:
                return
            if address in visiting:
                raise ValueError(f'pipeline dependency cycle at {address}')
            if address not in self.parts:
                raise ValueError(f'missing pipeline Part {address}')
            visiting.add(address)
            part=self.parts[address]
            if isinstance(part,FunctionalGuarantee):
                if part.left not in self.parts or part.right not in self.parts:
                    raise ValueError(f'missing FG endpoint for {address}')
                if not part.validators or any(not isinstance(self.parts.get(v),Calculation) for v in part.validators):
                    raise ValueError(f'missing validator Calculation for {address}')
            dependencies=part.inputs if isinstance(part,Calculation) else part.validators if isinstance(part,FunctionalGuarantee) else part.depends
            for dependency in dependencies:
                visit(dependency)
            if isinstance(part,Calculation):
                order.append(address)
            visiting.remove(address); done.add(address)
        for root in roots:
            visit(root)
        self.requested=list(roots); self.order=order
        for address in order:
            calculation=self.parts[address]
            if calculation.output in self.values:
                continue
            result=self.functions[address](*(self.values[a] for a in calculation.inputs))
            self.values[calculation.output]=result
            self.log.append(dict(calculation=address,rule=calculation.rule,inputs=list(calculation.inputs),output=calculation.output))
        return {root:self.parts[root] for root in roots}


def compare_reference(trace, reference):
    mismatches = []
    for observed, expected in zip(trace['states'], reference):
        buses = observed['buses']
        for name in ('A', 'PC', 'OUT', 'HALT'):
            if buses[name] != expected[name]:
                mismatches.append(dict(t=observed['t'], part=name, expected=expected[name], actual=buses[name]))
        for i,byte in enumerate(expected['RAM']):
            name = f'RAM{i:02}'
            if buses[name] != byte:
                mismatches.append(dict(t=observed['t'], part=name, expected=byte, actual=buses[name]))
    if len(trace['states']) != len(reference):
        mismatches.append(dict(kind='state-closure', expected=len(reference), actual=len(trace['states'])))
    return dict(status='PASS' if not mismatches else 'FAIL', loss=len(mismatches), mismatches=mismatches,
                scope='every architectural register and RAM word at every observed state; independent integer interpreter')


def expand_inputs(schedule, steps):
    if type(schedule) is not list or any(type(v) is not int or not 0 <= v <= 255 for v in schedule):
        raise ValueError('input schedule must be an array of byte integers (0..255)')
    # The workbench declares a held input port. Core execution still receives every bit explicitly.
    return [(schedule[min(t, len(schedule)-1)] if schedule else 0) for t in range(steps+1)]


def build_run(request):
    if type(request) is not dict:
        raise ValueError('request must be an object')
    if set(request) - {'source', 'steps', 'inputs', 'delta', 'initial'}:
        raise ValueError('unknown run field')
    source, steps = request.get('source', ''), request.get('steps', 32)
    if type(source) is not str or len(source) > 10000:
        raise ValueError('source must be text, at most 10,000 characters')
    if type(steps) is not int or not 0 <= steps <= 128:
        raise ValueError('workbench steps must be an integer from 0 through 128')
    if type(request.get('delta', False)) is not bool:
        raise ValueError('delta must be Boolean')
    p = Pipeline()
    for name,value in [('source',source), ('steps',steps), ('initial',request.get('initial') or {}),
                       ('inputSchedule',request.get('inputs', [])), ('delta',request.get('delta',False))]:
        p.input('request/'+name, value)
    p.declare('program', 'assemble', ['request/source'], assemble)
    p.input('requirement/xor', [0,1,1,0])
    p.input('constraint/nand-bound', 4)
    p.declare('xorRecipe', 'construct-from-truth-table', ['requirement/xor','constraint/nand-bound'], synthesize)
    p.declare('machine', 'compose-cpu', ['program','request/initial','xorRecipe'],
        lambda program,initial,recipe: build_cpu(program, initial=initial,xor_recipe=recipe))
    p.declare('plan', 'compile-with-fg-closure', ['machine'], compile_net)
    p.declare('inputBytes', 'hold-input-port', ['request/inputSchedule','request/steps'], expand_inputs)
    p.declare('stimuli', 'bind-input-bits', ['machine','inputBytes'],
        lambda machine, inputs: [{address:(byte >> i)&1 for i,address in enumerate(machine.buses['IN'])} for byte in inputs])
    p.declare('execution', 'seek-states', ['plan','request/steps','stimuli','request/delta'], execute_plan)
    p.declare('reference', 'independent-instruction-reference', ['program','request/steps','request/initial','inputBytes'],
        lambda program, steps, initial, inputs: run_reference(program, steps, initial=initial, inputs=inputs))
    p.declare('comparison', 'compare-architectural-states', ['execution','reference'], compare_reference)
    p.declare('traceAudit', 'replay-execution-evidence', ['execution','plan','request/steps','stimuli'], audit_trace)
    p.guarantee('fg/cpu-conformance','execution','reference',['comparison/calc'])
    p.guarantee('fg/execution-evidence','execution','plan',['traceAudit/calc'])
    p.seek(['fg/cpu-conformance','fg/execution-evidence'])
    program,recipe,input_bytes,trace,reference,comparison,audit=(p.values[a] for a in
        ('program','xorRecipe','inputBytes','execution','reference','comparison','traceAudit'))
    # The values below are exactly the products of the executed Calculations above.
    # Large Part values use explicit JSON paths into this returned artifact.
    trace.update(program=program, source=source, inputBytes=input_bytes, reference=reference, oracle=comparison, audit=audit,
                 composition=recipe,
                 declarations={address:asdict(part) for address,part in p.parts.items()},
                 pipeline=dict(requested=p.requested,order=p.order,log=p.log, values={'request/source':source,'request/steps':steps,
                    'request/initial':request.get('initial') or {},'request/inputSchedule':request.get('inputs', []),
                    'request/delta':request.get('delta',False),'requirement/xor':[0,1,1,0],'constraint/nand-bound':4},
                    valuePaths={'xorRecipe':'composition','program':'program','execution':'states','reference':'reference','comparison':'oracle','traceAudit':'audit','inputBytes':'inputBytes'},
                    note='Machine and plan Parts are represented by the shared addresses/calculations/fgs/groups/buses/plan fields. Circuit values are states[t].values.'),
                 meaning=dict(inputPolicy='An empty schedule supplies zero; otherwise the last supplied byte is held.',
                    hardware='Ideal synchronous Boolean model; NAND + wire + clocked-bit delay. No analog gate timing.',
                    equality='Architectural registers and RAM at the same logical state.',
                    sourceIdentity='Implementation identity is provenance, not semantic equivalence.'))
    return trace


def catalog():
    return dict(schema='pxc-machine/v1', demos=[dict(id=name, **demo) for name,demo in DEMOS.items()],
                instructions=[dict(opcode=i,name=name,description=('operand is a four-bit immediate' if name=='LDI' else 'see instruction table in README')) for i,name in enumerate(OPCODES)])
