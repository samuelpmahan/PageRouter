"""NAND + ideal clocked storage. Declarations never execute themselves.

Runtime arithmetic is bit logic only. Host arithmetic below handles addresses,
indices and presentation. The independent CPU oracle lives elsewhere.
"""
from collections import Counter, deque
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'lyceum'))
from common import Part, Calculation, FunctionalGuarantee


def bit(value):
    if type(value) is not int or value not in (0, 1):
        raise ValueError(f'expected integer bit, received {value!r}')
    return value


class Net:
    def __init__(self, name):
        self.name = name
        self.parts, self.producers, self.constants = {}, {}, {}
        self.inputs, self.buses, self.groups, self.guarantees = [], {}, {}, []

    def _part(self, part):
        if part.address in self.parts:
            raise ValueError(f'duplicate Part {part.address}')
        self.parts[part.address] = part

    def const(self, value):
        address = f'const/{bit(value)}'
        if address not in self.parts:
            self._part(Part(address))
            self.constants[address] = value
        return address

    def input(self, address):
        self._part(Part(address)); self.inputs.append(address)
        return address

    def _derive(self, address, rule, inputs):
        calc = Calculation(address+'/calc', (), rule, tuple(inputs), address)
        self._part(calc); self._part(Part(address, (calc.address,)))
        self.producers[address] = calc
        return address

    def _fg(self, output, rule, inputs):
        left = output+'/operands'
        self._part(Part(left, tuple(a for a in inputs if a != output)))
        verdict = self._derive(output+'/valid', rule, inputs)
        validator = self.producers[verdict].address
        fg = FunctionalGuarantee(output+'/fg', (validator,), left, output, (validator,))
        self._part(fg); self.guarantees.append(fg)

    def nand(self, address, a, b):
        self._derive(address, 'nand', (a, b))
        # Literal truth-table cells are actual input Parts, independent of NAND's implementation.
        table = tuple(self.const(x) for x in (1, 1, 1, 0))
        self._fg(address, 'check:nand', (a, b, address, *table))
        return address

    def wire(self, address, source):
        self._derive(address, 'wire', (source,))
        self._fg(address, 'check:wire', (source, address))
        return address

    def delay(self, address, source, initial=0):
        init = self.const(initial)
        self._derive(address, 'delay', (source, init))
        self._fg(address, 'check:delay', (source, address, init))
        return address

    def group(self, address, kind, inputs, outputs, children=()):
        self._part(Part(address, tuple(outputs)))
        self.groups[address] = dict(address=address, kind=kind, inputs=list(inputs), outputs=list(outputs), children=list(children))
        return address

    def bus(self, name, addresses):
        if name in self.buses:
            raise ValueError(f'duplicate bus {name}')
        self.buses[name] = list(addresses)
        return self.buses[name]


def compile_net(net, roots=None):
    """Compile value requirements AND attached FG validators into a stable DAG.

    A DAG is a graph without same-state dependency cycles. Delay edges point to
    the preceding state, so legitimate feedback does not create such a cycle.
    """
    addresses = list(net.constants) + list(net.inputs) + list(net.producers)
    index = {address: i for i, address in enumerate(addresses)}
    for calc in net.producers.values():
        for source in calc.inputs:
            if source not in index:
                raise ValueError(f'missing Part {source}, consumed by {calc.address}')
    for name, values in net.buses.items():
        if any(a not in index for a in values):
            raise ValueError(f'missing bus Part in {name}')
    by_output = {c.output: c for c in net.producers.values()}
    by_calculation = {c.address:c for c in net.producers.values()}
    checks = {}
    for fg in net.guarantees:
        if fg.left not in net.parts or fg.right not in net.parts:
            raise ValueError(f'missing FG endpoint for {fg.address}')
        if not fg.validators or any(v not in by_calculation for v in fg.validators):
            raise ValueError(f'missing validator for {fg.address}: {fg.validators}')
        checks.setdefault(fg.right, []).extend(by_calculation[v].output for v in fg.validators)
    roots = list(roots) if roots is not None else list(dict.fromkeys(
        [a for a,c in by_output.items() if not c.rule.startswith('check:')] + list(net.inputs) +
        [a for bus in net.buses.values() for a in bus]))
    required, pending = set(), list(roots)
    while pending:
        address = pending.pop()
        if address in required:
            continue
        if address not in index:
            raise ValueError(f'missing requested Part {address}')
        required.add(address)
        if address in by_output:
            pending.extend(by_output[address].inputs)
        if address in checks:
            pending.extend(checks[address])
    calcs = [c for c in net.producers.values() if c.output in required]
    calc_index = {c.output: i for i,c in enumerate(calcs)}
    indegree, children = [0]*len(calcs), [[] for _ in calcs]
    for i,c in enumerate(calcs):
        current = c.inputs[1:] if c.rule in ('delay', 'check:delay') else c.inputs
        for source in dict.fromkeys(current):
            if source in calc_index:
                parent = calc_index[source]
                indegree[i] += 1; children[parent].append(i)
    queue = deque(i for i,n in enumerate(indegree) if n == 0)
    order = []
    while queue:
        i = queue.popleft(); order.append(i)
        for child in children[i]:
            indegree[child] -= 1
            if indegree[child] == 0:
                queue.append(child)
    if len(order) != len(calcs):
        unresolved = [calcs[i].output for i,n in enumerate(indegree) if n]
        raise ValueError('same-state dependency cycle: '+', '.join(unresolved[:5]))
    calculations = [dict(index=i, address=c.address, rule=c.rule, inputs=[index[a] for a in c.inputs],
                         inputAddresses=list(c.inputs), output=index[c.output], outputAddress=c.output) for i,c in enumerate(calcs)]
    fgs = []
    for fg in net.guarantees:
        outputs = [by_calculation[v].output for v in fg.validators]
        if fg.right not in required:
            continue
        fgs.append(dict(address=fg.address,left=fg.left,right=fg.right,
                        validators=[calc_index[a] for a in outputs],verdicts=[index[a] for a in outputs],
                        validator=calc_index[outputs[0]],verdict=index[outputs[0]]))
    counts = Counter(c.rule for c in calcs)
    visible_buses={name:bus for name,bus in net.buses.items() if all(a in required for a in bus)}
    return dict(schema='pxc-machine/v1', name=net.name, addresses=addresses, calculations=calculations,
                fgs=fgs, groups=list(net.groups.values()),
                composites={fg.left:list(net.parts[fg.left].depends) for fg in net.guarantees},
                buses={n:[index[a] for a in b] for n,b in visible_buses.items()}, busAddresses=visible_buses,
                bom=dict(nand=counts['nand'], delay=counts['delay'], wire=counts['wire'], validators=sum(n for k,n in counts.items() if k.startswith('check:'))),
                plan=dict(order=order, roots=[index[a] for a in roots], required=[index[a] for a in addresses if a in required]),
                constants={index[a]:v for a,v in net.constants.items()}, inputs=[index[a] for a in net.inputs if a in required])


def arguments(calc, current, previous):
    """Resolve all semantic inputs, including explicit initial-state inputs."""
    ix, rule = calc['inputs'], calc['rule']
    if rule == 'delay':
        return (current[ix[1]],) if previous is None else (previous[ix[0]],)
    if rule == 'check:delay':
        return (current[ix[2]] if previous is None else previous[ix[0]], current[ix[1]])
    return tuple(current[i] for i in ix)


def evaluate(rule, args):
    if any(type(v) is not int or v not in (0,1) for v in args):
        raise ValueError(f'unfulfilled bit dependency for {rule}: {args}')
    if rule == 'nand':
        return 1 - (args[0] & args[1])
    if rule in ('wire', 'delay'):
        return args[0]
    if rule == 'check:nand':
        a,b,result,*table = args
        return int(result == table[2*a+b])
    if rule in ('check:wire', 'check:delay'):
        return int(args[0] == args[1])
    raise ValueError(f'unknown Calculation {rule}')


def retain_failures(state, failures):
    """ImplSpecific hook: retain failed observations so comparison/UI can explain them."""
    return failures


def run_net(net, steps, stimuli=None, delta=False, on_failure=retain_failures):
    return execute_plan(compile_net(net), steps, stimuli, delta, on_failure)


def execute_plan(plan, steps, stimuli=None, delta=False, on_failure=retain_failures):
    if type(steps) is not int or not 0 <= steps <= 10000:
        raise ValueError('steps must be an integer from 0 through 10000')
    trace = deepcopy(plan)
    states, previous_args = [], {}
    for t in range(steps+1):
        values = [None]*len(trace['addresses'])
        for i,v in trace['constants'].items():
            values[i] = v
        supplied = stimuli[t] if stimuli is not None and t < len(stimuli) else {}
        for i in trace['inputs']:
            address = trace['addresses'][i]
            if address not in supplied:
                raise ValueError(f'missing input {address} at state {t}')
            values[i] = bit(supplied[address])
        prior = states[-1]['values'] if states else None
        evaluated, reused, pxc_log, seek_log = [], [], [], []
        for ci in trace['plan']['order']:
            calc = trace['calculations'][ci]
            args = arguments(calc, values, prior)
            # Reuse exact tuples at a fixed executable rule. No digest can conceal inequality.
            if delta and t and previous_args.get(ci) == args:
                values[calc['output']] = prior[calc['output']]
                reused.append(ci); seek_log.append([ci, 1])
            else:
                value = evaluate(calc['rule'], args)
                values[calc['output']] = value
                evaluated.append(ci); pxc_log.append([ci, value]); seek_log.append([ci, 0])
            previous_args[ci] = args
        failures = [fg['address'] for fg in trace['fgs'] if any(values[i] != 1 for i in fg['verdicts'])]
        state = dict(t=t, values=values, buses={n:sum(values[i] << j for j,i in enumerate(indices)) for n,indices in trace['buses'].items()},
                     evaluated=evaluated, reused=reused, pxcLog=pxc_log, seekLog=seek_log,
                     fg=dict(passed=len(trace['fgs'])-len(failures), failed=len(failures), total=len(trace['fgs']), failures=failures))
        if failures:
            on_failure(state, list(failures))
        states.append(state)
    trace.update(states=states, executionMode='delta' if delta else 'full',
                 clock=dict(unit='logical tick', physicalTiming=False),
                 totals=dict(evaluated=sum(len(s['evaluated']) for s in states), reused=sum(len(s['reused']) for s in states)))
    return trace


def audit_trace(trace, expected_plan=None, expected_steps=None, expected_stimuli=None):
    """Recalculate invocations against separately supplied obligations.

    Self-consistent logs alone cannot prove that their own omissions are absent.
    The requested plan and state count must be explicit validating inputs.
    """
    if expected_plan is None or expected_steps is None:
        return dict(status='UNVERIFIED',loss=1,issues=[dict(kind='missing-independent-obligations')])
    if expected_plan['inputs'] and expected_stimuli is None:
        return dict(status='UNVERIFIED',loss=1,issues=[dict(kind='missing-input-obligations')])
    issues = []
    for field in ('addresses','calculations','fgs','buses','busAddresses','plan','constants','inputs'):
        left,right=trace.get(field),expected_plan.get(field)
        if field=='constants':
            left={str(k):v for k,v in left.items()}; right={str(k):v for k,v in right.items()}
        if left != right:
            issues.append(dict(kind='declaration-mismatch',field=field))
    if len(trace['states']) != expected_steps+1:
        issues.append(dict(kind='state-closure',expected=expected_steps+1,actual=len(trace['states'])))
    for t,state in enumerate(trace['states']):
        if state['t'] != t:
            issues.append(dict(t=t,kind='state-identity'))
        for i,expected in expected_plan['constants'].items():
            actual=state['values'][int(i)]
            if type(actual) is not int or actual != expected:
                issues.append(dict(t=t,kind='constant-observation',part=expected_plan['addresses'][int(i)]))
        supplied=expected_stimuli[t] if expected_stimuli is not None and t<len(expected_stimuli) else {}
        for i in expected_plan['inputs']:
            address=expected_plan['addresses'][i]; actual=state['values'][i]
            if (address not in supplied or type(supplied[address]) is not int or supplied[address] not in (0,1)
                    or type(actual) is not int or actual!=supplied[address]):
                issues.append(dict(t=t,kind='input-observation',part=address))
        prior = trace['states'][t-1]['values'] if t else None
        expected_order = trace['plan']['order']
        actual_order = [row[0] for row in state['seekLog']]
        if expected_order != actual_order:
            issues.append(dict(t=t, kind='seek-closure'))
        if ([ci for ci,event in state['seekLog'] if event == 0] != state['evaluated'] or
            [ci for ci,event in state['seekLog'] if event == 1] != state['reused'] or
            any(event not in (0,1) for ci,event in state['seekLog'])):
            issues.append(dict(t=t, kind='execution-seek-disagreement'))
        emitted = {ci:value for ci,value in state['pxcLog']}
        reused = set(state['reused'])
        if len(emitted) != len(state['pxcLog']) or set(emitted) != set(state['evaluated']):
            issues.append(dict(t=t, kind='execution-closure'))
        if [ci for ci,value in state['pxcLog']] != state['evaluated']:
            issues.append(dict(t=t, kind='execution-order'))
        if set(state['evaluated']) & set(state['reused']) or set(state['evaluated']) | set(state['reused']) != set(expected_order):
            issues.append(dict(t=t, kind='reuse-closure'))
        for ci in expected_order:
            c = trace['calculations'][ci]
            args = arguments(c, state['values'], prior)
            expected = evaluate(c['rule'], args)
            if state['values'][c['output']] != expected or ci in emitted and emitted[ci] != expected:
                issues.append(dict(t=t, kind='calculation-value', calculation=c['address']))
            if ci in reused:
                prevprev = trace['states'][t-2]['values'] if t > 1 else None
                if not t or args != arguments(c, prior, prevprev):
                    issues.append(dict(t=t, kind='unjustified-reuse', calculation=c['address']))
        failures = [fg['address'] for fg in trace['fgs'] if any(state['values'][i] != 1 for i in fg['verdicts'])]
        summary = dict(passed=len(trace['fgs'])-len(failures), failed=len(failures), total=len(trace['fgs']), failures=failures)
        if state['fg'] != summary:
            issues.append(dict(t=t, kind='fg-summary'))
        for name,indices in trace['buses'].items():
            if state['buses'][name] != sum(state['values'][i]<<j for j,i in enumerate(indices)):
                issues.append(dict(t=t, kind='bus-projection', part=name))
    return dict(status='PASS' if not issues else 'FAIL', loss=len(issues), issues=issues)
