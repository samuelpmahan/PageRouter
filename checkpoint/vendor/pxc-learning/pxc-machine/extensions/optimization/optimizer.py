"""Mechanical NAND reuse under declared, exhaustively checked Boolean rules.

This optimizes an ideal logical graph, not a physical netlist. Delay identities
are never merged. Bus/group boundaries keep their addresses using alias wires.
"""
from copy import deepcopy
from itertools import product
from pathlib import Path
import json
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import Net, Part, Calculation, FunctionalGuarantee, compile_net, execute_plan, audit_trace
from pipeline import Pipeline, compare_reference
from oracle import run_reference

DEFAULT_RULES = dict(nandInputOrder='commutative', nandReuse='equal-canonical-inputs',
                     wire='identity', delay='preserve-individual-cell', boundaries='explicit-alias')
INVENTORY = dict(nand=[1, 1, 1, 0], wire=[0, 1],
                 state='q(t+1)=source(t); each delay is a distinct cell')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def verify_rules(rules, inventory):
    if canonical(rules) != canonical(DEFAULT_RULES) or canonical(inventory) != canonical(INVENTORY):
        raise ValueError('only the declared, finite NAND-permutation/reuse and wire-identity rules are supported')
    net = Net('literal rewrite-rule validation')
    a, b = net.input('a'), net.input('b')
    for name, left, right in [('direct', a, b), ('permuted', b, a), ('repeated', a, b)]:
        net.bus(name, [net.nand(name, left, right)])
    net.bus('wireA', [net.wire('wa', a)]); net.bus('wireB', [net.wire('wb', b)])
    stimuli = [dict(a=a, b=b) for a, b in product((0, 1), repeat=2)]
    plan = compile_net(net); trace = execute_plan(plan, 3, stimuli)
    rows, loss = [], 0
    for supplied, state in zip(stimuli, trace['states']):
        values = state['buses']; expected = inventory['nand'][2*supplied['a']+supplied['b']]
        row_loss = sum(values[name] != expected for name in ('direct', 'permuted', 'repeated'))
        row_loss += values['wireA'] != supplied['a']; row_loss += values['wireB'] != supplied['b']
        row_loss += state['fg']['failed']; loss += row_loss
        rows.append(dict(inputs=supplied, expected=expected, observed=values, loss=row_loss))
    audit = audit_trace(trace, plan, 3, stimuli); loss += audit['loss']
    return dict(status='PASS' if not loss else 'FAIL', loss=loss, rowsChecked=4, rows=rows,
                audit=audit, ruleScope='same-state pure NAND and wire values over all integer-bit inputs')


def _supported(net):
    hardware = [c for c in net.producers.values() if not c.rule.startswith('check:')]
    if any(c.rule not in ('nand', 'wire', 'delay') for c in hardware):
        raise ValueError('optimizer requires the declared NAND/wire/delay inventory')
    # We regenerate exactly these primitive FGs. Reject richer contracts rather
    # than silently discard validators we do not know how to transport.
    expected = {c.output+'/fg' for c in hardware}
    if {fg.address for fg in net.guarantees} != expected or len(net.guarantees) != len(expected):
        raise ValueError('custom or missing hardware FGs require an explicit transport rule')
    by_fg = {fg.address:fg for fg in net.guarantees}
    if {c.output for c in net.producers.values() if c.rule.startswith('check:')} != {c.output+'/valid' for c in hardware}:
        raise ValueError('validator closure differs from the accepted primitive obligations')
    for calc in hardware:
        validator = net.producers.get(calc.output+'/valid')
        fg = by_fg[calc.output+'/fg']
        expected_inputs = ((*calc.inputs, calc.output, 'const/1', 'const/1', 'const/1', 'const/0')
            if calc.rule == 'nand' else (calc.inputs[0], calc.output, calc.inputs[1])
            if calc.rule == 'delay' else (calc.inputs[0], calc.output))
        expected_validator = Calculation(calc.output+'/valid/calc', (), 'check:'+calc.rule,
                                         expected_inputs, calc.output+'/valid')
        expected_fg = FunctionalGuarantee(calc.output+'/fg', (expected_validator.address,),
            calc.output+'/operands', calc.output, (expected_validator.address,))
        expected_parts = [calc, Part(calc.output, (calc.address,)), expected_validator,
            Part(expected_validator.output, (expected_validator.address,)), expected_fg,
            Part(expected_fg.left, tuple(a for a in expected_inputs if a != calc.output))]
        if (validator != expected_validator or fg != expected_fg or calc.depends != () or
                any(net.parts.get(part.address) != part for part in expected_parts)):
            raise ValueError('primitive FG declaration does not match the accepted inventory')
    for address in (*net.constants, *net.inputs):
        if net.parts.get(address) != Part(address):
            raise ValueError('source Part has undeclared dependency semantics')
    for group in net.groups.values():
        if net.parts.get(group['address']) != Part(group['address'], tuple(group['outputs'])):
            raise ValueError('group Part dependency declaration differs from its boundary')
    return hardware


def _optimize(net, predecessor_plan, rules, inventory, rule_proof):
    if canonical(rules) != canonical(DEFAULT_RULES) or canonical(inventory) != canonical(INVENTORY):
        raise ValueError('unsupported rewrite declarations')
    if rule_proof['status'] != 'PASS' or rule_proof['loss']:
        raise ValueError('rewrite-rule FG did not pass')
    if predecessor_plan != compile_net(net):
        raise ValueError('predecessor plan is not the actual compiled Net')
    hardware = _supported(net)
    result = Net(net.name+' / shared pure expressions')
    mapping, entries, expressions = {}, {}, {}
    for address, value in net.constants.items():
        if result.const(value) != address:
            raise ValueError('unsupported noncanonical constant address')
        mapping[address] = address
    for address in net.inputs:
        mapping[address] = result.input(address)
    delayed = [c for c in hardware if c.rule == 'delay']
    for calc in delayed:
        mapping[calc.output] = calc.output
    boundaries = {a for bus in net.buses.values() for a in bus}
    boundaries.update(a for group in net.groups.values() for a in group['inputs']+group['outputs'])
    hardware_by_output = {c.output:c for c in hardware}
    for ci in predecessor_plan['plan']['order']:
        declaration = predecessor_plan['calculations'][ci]
        calc = hardware_by_output.get(declaration['outputAddress'])
        if calc is None or calc.rule == 'delay':
            continue
        operands = tuple(mapping[a] for a in calc.inputs)
        if calc.rule == 'wire':
            target, reason = operands[0], 'wire identity: output equals its one canonical input'
        else:
            key = ('nand', tuple(sorted(operands)))
            if key in expressions:
                target = expressions[key]
                reason = 'NAND reuse: same rule and same canonical operands, allowing input permutation'
            else:
                target = result.nand(calc.output, *key[1]); expressions[key] = target
                reason = 'retain first NAND expression with these canonical operands'
        mapping[calc.output] = target
        entries[calc.output] = dict(canonical=target, originalRule=calc.rule,
            originalInputs=list(calc.inputs), canonicalInputs=list(operands), reason=reason)
    for calc in delayed:
        initial = net.constants[calc.inputs[1]]
        result.delay(calc.output, mapping[calc.inputs[0]], initial)
        entries[calc.output] = dict(canonical=calc.output, originalRule='delay',
            originalInputs=list(calc.inputs), canonicalInputs=[mapping[a] for a in calc.inputs],
            reason='preserve the individual clocked cell and its initial value')
    aliases = []
    for address in sorted(boundaries):
        if address not in mapping:
            raise ValueError('group/bus boundary must refer to an actual value Part: '+address)
        if mapping[address] != address:
            result.wire(address, mapping[address]); aliases.append(address)
    for name, bus in net.buses.items():
        result.bus(name, bus)
    for group in net.groups.values():
        result.group(group['address'], group['kind'], group['inputs'], group['outputs'], group['children'])
    for address, target in mapping.items():
        entries.setdefault(address, dict(canonical=target, originalRule='input' if address in net.inputs else 'constant',
            originalInputs=[], canonicalInputs=[], reason='preserve explicitly supplied source Part'))
        entries[address]['visible'] = address if address in result.parts else target
        entries[address]['alias'] = address in aliases
    after = compile_net(result)
    report = dict(beforeBOM=dict(predecessor_plan['bom']), afterBOM=dict(after['bom']),
        nandSaved=predecessor_plan['bom']['nand']-after['bom']['nand'], boundaryAliases=aliases,
        sourceToResult=entries, rules=deepcopy(rules), inventory=deepcopy(inventory), ruleProof=rule_proof,
        scope='syntactic pure-expression equivalence under verified NAND permutation and wire identity; no physical synthesis')
    return result, report


def optimize_net(net, rules=None, inventory=None):
    """Return (new Net, causal rewrite report); never mutate the predecessor."""
    rules = deepcopy(DEFAULT_RULES if rules is None else rules)
    inventory = deepcopy(INVENTORY if inventory is None else inventory)
    proof = verify_rules(rules, inventory)
    return _optimize(net, compile_net(net), rules, inventory, proof)


def validate_structure(before, after, report):
    """Check the local simulation relation plus preserved observable boundaries.

    Each predecessor expression corresponds to the same operation on equivalent
    inputs. Preserved individual delay cells then extend that relation over ticks.
    """
    issues = []
    for label, net in [('predecessor', before), ('candidate', after)]:
        try:
            _supported(net)
        except (ValueError, KeyError, TypeError) as error:
            issues.append(label+' FG transport closure: '+str(error))
    def count(net):
        rules = [c.rule for c in net.producers.values()]
        return dict(nand=rules.count('nand'), delay=rules.count('delay'), wire=rules.count('wire'),
                    validators=sum(rule.startswith('check:') for rule in rules))
    before_bom, after_bom = count(before), count(after)
    saved = before_bom['nand']-after_bom['nand']
    if report.get('beforeBOM') != before_bom or report.get('afterBOM') != after_bom:
        issues.append('reported BOM differs from actual declared Calculations')
    if report.get('nandSaved') != saved:
        issues.append('reported NAND saving differs from the actual count delta')
    if saved < 0 or before_bom['delay'] != after_bom['delay']:
        issues.append('optimization must not increase NAND count or change storage-cell count')
    rows = report['sourceToResult']; mapping = {a:r['canonical'] for a,r in rows.items()}
    if before.buses != after.buses or before.groups != after.groups:
        issues.append('observable bus/group boundary declarations changed')
    before_delays = {c.output for c in before.producers.values() if c.rule == 'delay'}
    after_delays = {c.output for c in after.producers.values() if c.rule == 'delay'}
    if before_delays != after_delays:
        issues.append('individual clocked cells changed')
    for source in (*before.constants, *before.inputs):
        if mapping.get(source) != source:
            issues.append('source Part remapped: '+source)
    if before.constants != after.constants or before.inputs != after.inputs:
        issues.append('source observations or constants changed')
    boundaries = {a for bus in before.buses.values() for a in bus}
    boundaries.update(a for group in before.groups.values() for a in group['inputs']+group['outputs'])
    for address in boundaries:
        target = mapping.get(address)
        alias = after.producers.get(address)
        # The actual address is authoritative. A report cannot redirect an
        # inspector away from a broken but still observable boundary wire.
        if (address not in after.parts or target is None or
                address != target and (alias is None or alias.rule != 'wire' or alias.inputs != (target,))):
            issues.append('observable boundary is not its justified canonical value: '+address)
    for address, calc in before.producers.items():
        if calc.rule.startswith('check:'):
            continue
        target = mapping.get(address); transformed = after.producers.get(target)
        try:
            if calc.rule == 'wire':
                valid = target == mapping[calc.inputs[0]]
            elif calc.rule == 'nand':
                valid = (transformed is not None and transformed.rule == 'nand' and
                    sorted(transformed.inputs) == sorted(mapping[a] for a in calc.inputs))
            else:
                valid = (target == address and transformed is not None and transformed.rule == 'delay' and
                    transformed.inputs == (mapping[calc.inputs[0]], calc.inputs[1]))
            visible = rows[address]['visible']
            if visible not in after.parts:
                valid = False
            if visible != target:
                alias = after.producers.get(visible)
                valid = valid and alias is not None and alias.rule == 'wire' and alias.inputs == (target,)
        except KeyError:
            valid = False
        if not valid:
            issues.append('unjustified rewrite: '+address)
    return dict(status='PASS' if not issues else 'FAIL', loss=len(issues), issues=issues,
                actualBeforeBOM=before_bom, actualAfterBOM=after_bom, actualNandSaved=saved,
                checkedExpressions=sum(not c.rule.startswith('check:') for c in before.producers.values()))


def compare_observations(before, after):
    issues = []
    if len(before['states']) != len(after['states']):
        issues.append(dict(kind='state-closure'))
    for left, right in zip(before['states'], after['states']):
        if left['buses'] != right['buses']:
            issues.append(dict(t=left['t'], kind='bus-values', before=left['buses'], after=right['buses']))
    primitive_failures = sum(s['fg']['failed'] for trace in (before, after) for s in trace['states'])
    return dict(status='PASS' if not issues and not primitive_failures else 'FAIL',
                loss=len(issues)+primitive_failures, issues=issues, primitiveFailures=primitive_failures)


def build_pipeline(net, program, steps, *, initial=None, inputs=None):
    """Execute a declared optimization Pipeline and its predecessor/oracle FGs.

    Returns the Pipeline itself: values include both real Net/plan/trace Parts,
    the report and all validator results. Nothing is labeled PASS without execution.
    """
    p = Pipeline()
    for address, value in [('predecessor/net', net), ('request/program', program), ('request/steps', steps),
            ('request/initial', initial or {}), ('request/inputBytes', inputs if inputs is not None else [0]*(steps+1)),
            ('rules', deepcopy(DEFAULT_RULES)), ('inventory', deepcopy(INVENTORY))]:
        p.input(address, value)
    p.declare('predecessor/plan', 'compile-predecessor', ['predecessor/net'], compile_net)
    p.declare('ruleProof', 'verify-finite-rewrite-rules', ['rules', 'inventory'], verify_rules)
    p.declare('optimization', 'share-pure-expressions',
        ['predecessor/net', 'predecessor/plan', 'rules', 'inventory', 'ruleProof'], _optimize)
    p.declare('candidate/net', 'project-optimized-net', ['optimization'], lambda pair: pair[0])
    p.declare('report', 'project-rewrite-evidence', ['optimization'], lambda pair: pair[1])
    p.declare('candidate/plan', 'compile-regenerated-fgs', ['candidate/net'], compile_net)
    p.declare('structure', 'validate-local-rewrite-relation', ['predecessor/net', 'candidate/net', 'report'], validate_structure)
    p.declare('stimuli', 'bind-explicit-input-bits', ['predecessor/net', 'request/inputBytes'],
        lambda original, byte_values: [{a:(byte >> i)&1 for i,a in enumerate(original.buses['IN'])} for byte in byte_values])
    for side in ('predecessor', 'candidate'):
        p.declare(side+'/trace', 'execute-'+side, [side+'/plan', 'request/steps', 'stimuli'], execute_plan)
        p.declare(side+'/audit', 'verify-execution-closure',
            [side+'/trace', side+'/plan', 'request/steps', 'stimuli'], audit_trace)
    p.declare('reference', 'independent-integer-machine',
        ['request/program', 'request/steps', 'request/initial', 'request/inputBytes'],
        lambda program, count, start, byte_values: run_reference(program, count, initial=start, inputs=byte_values))
    for side in ('predecessor', 'candidate'):
        p.declare(side+'/conformance', 'compare-independent-architecture', [side+'/trace', 'reference'], compare_reference)
    p.declare('observations', 'compare-all-observable-buses', ['predecessor/trace', 'candidate/trace'], compare_observations)
    p.guarantee('fg/rewrite-rules', 'rules', 'inventory', ['ruleProof/calc'])
    p.guarantee('fg/optimization', 'predecessor/net', 'candidate/net', ['structure/calc', 'observations/calc'])
    p.guarantee('fg/independent-conformance', 'candidate/trace', 'reference',
        ['predecessor/conformance/calc', 'candidate/conformance/calc'])
    p.guarantee('fg/execution-evidence', 'predecessor/trace', 'candidate/trace',
        ['predecessor/audit/calc', 'candidate/audit/calc'])
    p.seek(['fg/rewrite-rules', 'fg/optimization', 'fg/independent-conformance', 'fg/execution-evidence'])
    return p
