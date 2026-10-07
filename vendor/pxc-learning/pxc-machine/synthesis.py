"""Bounded declarative circuit construction, using NAND as the only inventory.

Search is a host-executed meta-Calculation: it produces a circuit declaration.
That declaration subsequently executes through the ordinary PxC bit engine.
Names are evidence labels; the complete finite value behavior determines meaning.
"""
from copy import deepcopy
from dataclasses import asdict
from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path

from core import Net, Part, Calculation, FunctionalGuarantee, compile_net, run_net, bit

DOMAIN = [[0, 0], [0, 1], [1, 0], [1, 1]]
INVENTORY = {'inputCount': 2, 'constants': [], 'primitives': [
    {'op': 'nand', 'arity': 2, 'truthTable': [1, 1, 1, 0]}]}


def _validate_requirement(requirement, inventory, bound):
    table = requirement.get('truthTable')
    if not isinstance(table, list) or len(table) != 4:
        raise ValueError('requirement needs four literal outputs in 00,01,10,11 order')
    for value in table:
        bit(value)
    domain = requirement.get('inputDomain')
    if (not isinstance(domain, list) or any(not isinstance(row, list) or len(row) != 2
            or any(type(value) is not int for value in row) for row in domain) or domain != DOMAIN):
        raise ValueError('only the complete ordered two-bit domain is supported')
    # JSON booleans compare equal to Python integers; identity of the declared
    # finite domain includes its types, not merely Python's loose == behavior.
    if json.dumps(inventory, sort_keys=True) != json.dumps(INVENTORY, sort_keys=True):
        raise ValueError('inventory must contain exactly the declared two-input NAND, no constants')
    if type(bound) is not int or not 0 <= bound <= 4:
        raise ValueError('max_gates must be an integer from zero through four')


def _search(requirement, inventory, bound):
    _validate_requirement(requirement, inventory, bound)
    target = requirement['truthTable']
    primitive = inventory['primitives'][0]['truthTable']
    counts, complete = [], []
    # Every acyclic circuit has a topological ordering. Commutative inputs let
    # us restrict each pair to i<=j. Repeated fanout and tied inputs are allowed.
    def candidates(size, gates=(), signals=((0, 0, 1, 1), (0, 1, 0, 1))):
        if not size:
            yield gates, signals
            return
        for i in range(len(signals)):
            for j in range(i, len(signals)):
                result = tuple(primitive[2*a+b] for a, b in zip(signals[i], signals[j]))
                yield from candidates(size-1, (*gates, (i, j)), (*signals, result))

    for size in range(bound+1):
        count = 0
        for gates, signals in candidates(size):
            # If output were an earlier gate, it would already have appeared
            # at a smaller size. At size zero either external input may win.
            for output in range(2) if size == 0 else (len(signals)-1,):
                count += 1
                if list(signals[output]) == target:
                    counts.append(count)
                    return dict(status='found', gates=[list(g) for g in gates], output=output,
                                gateCount=size, truthTable=list(signals[output]), search=dict(
                                    completedSizes=complete, candidatesBySize=counts, bound=bound,
                                    minimal=True, winningSizeExhausted=False,
                                    scope='acyclic two-input NAND circuits; free fanout; no constant inputs'))
        counts.append(count); complete.append(size)
    return dict(status='not-found', gates=None, output=None, gateCount=None, truthTable=None,
                search=dict(completedSizes=complete, candidatesBySize=counts, bound=bound,
                            minimal=False, winningSizeExhausted=None,
                            scope='acyclic two-input NAND circuits; free fanout; no constant inputs'))


def _check_geometry(recipe):
    if recipe.get('status') != 'found' or not isinstance(recipe.get('gates'), list):
        raise ValueError('a found synthesis recipe is required')
    gates = recipe['gates']
    if type(recipe.get('gateCount')) is not int or recipe['gateCount'] != len(gates):
        raise ValueError('gateCount does not describe the actual recipe')
    for index, pair in enumerate(gates):
        if not isinstance(pair, list) or len(pair) != 2 or any(
                type(source) is not int or not 0 <= source < index+2 for source in pair):
            raise ValueError('each NAND must reference two already declared signals')
    if type(recipe.get('output')) is not int or not 0 <= recipe['output'] < len(gates)+2:
        raise ValueError('output must reference a declared signal')


def _instantiate(net, prefix, a, b, recipe):
    _check_geometry(recipe)
    signals = [a, b]
    for index, (left, right) in enumerate(recipe['gates']):
        signals.append(net.nand(f'{prefix}/gate/{index}', signals[left], signals[right]))
    return signals[recipe['output']]


def _verify(requirement, inventory, candidate):
    if candidate['status'] != 'found':
        return dict(status='UNVERIFIED', reason='no candidate within bound', rows=[], mismatches=[])
    _validate_requirement(requirement, inventory, 4)
    net = Net('synthesized behavior validation')
    a, b = net.input('input/a'), net.input('input/b')
    q = _instantiate(net, 'candidate', a, b, candidate)
    net.bus('OUTPUT', [q])
    rows, mismatches = [], []
    for inputs, expected in zip(requirement['inputDomain'], requirement['truthTable']):
        trace = run_net(net, 0, [{'input/a': inputs[0], 'input/b': inputs[1]}])
        state = trace['states'][0]
        actual = state['buses']['OUTPUT']
        rows.append(dict(inputs=inputs, expected=expected, actual=actual, fg=state['fg'],
                         pxcLog=state['pxcLog'], seekLog=state['seekLog']))
        if actual != expected or state['fg']['failed']:
            mismatches.append(dict(inputs=inputs, expected=expected, actual=actual,
                                   primitiveFailures=state['fg']['failures']))
    declaration = compile_net(net)
    return dict(status='FAIL' if mismatches else 'PASS', rows=rows, mismatches=mismatches,
                observedTable=[row['actual'] for row in rows], bom=declaration['bom'],
                gateCalculations=[c for c in declaration['calculations'] if c['rule'] == 'nand'],
                addresses=declaration['addresses'], calculations=declaration['calculations'],
                fgs=declaration['fgs'])


def _semantic_hash(requirement, proof):
    if proof['status'] != 'PASS':
        return None
    payload = dict(inputDomain=requirement['inputDomain'], valueDomain='integer-bit',
                   outputTruthTable=proof['observedTable'])
    return sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _recipe(candidate, proof, semantic_hash):
    result = deepcopy(candidate)
    if candidate['status'] == 'found' and proof['status'] != 'PASS':
        result['status'] = 'rejected'
    result.update(proof=proof, semanticHash=semantic_hash)
    return result


OPERATIONS = {'synthesize:nand': _search, 'validate:truth-table': _verify,
              'hash:finite-behavior': _semantic_hash, 'compose:recipe': _recipe}


def _invoke(evidence, rule, inputs, output):
    """Declare, resolve and execute one Calculation; record only after invocation."""
    calc = Calculation(output+'/calc', (), rule, tuple(inputs), output)
    args = [evidence['values'][address] for address in calc.inputs]
    result = OPERATIONS[calc.rule](*args)
    evidence['values'][output] = result
    evidence['parts'].extend([asdict(calc), asdict(Part(output, (calc.address,)))])
    evidence['calculations'].append(asdict(calc))
    evidence['pxcLog'].append(dict(calculation=calc.address, output=output, value=deepcopy(result)))
    return result


def replay(evidence, replacements=None):
    """Execute the actual named Calculations from their declared input Parts.

    Replacements permit counterfactual declarations or an explicit trace cut.
    This is execution, not validation of the retained evidence's authenticity.
    """
    result = dict(values=deepcopy(evidence['values']), parts=[], calculations=[], pxcLog=[])
    result['values'].update(deepcopy(replacements or {}))
    for calc in evidence['calculations']:
        _invoke(result, calc['rule'], calc['inputs'], calc['output'])
    return result


def synthesize(table, max_gates=4):
    """Declare four Boolean outputs; construct a qualifying NAND DAG if bounded search finds one."""
    requirement = dict(name='requested behavior', inputDomain=deepcopy(DOMAIN), truthTable=deepcopy(table))
    _validate_requirement(requirement, INVENTORY, max_gates)
    values = {'input/requirement': requirement, 'input/inventory': deepcopy(INVENTORY), 'input/bound': max_gates}
    evidence = dict(values=values, parts=[asdict(Part(address)) for address in values], calculations=[], pxcLog=[])
    _invoke(evidence, 'synthesize:nand', ['input/requirement', 'input/inventory', 'input/bound'], 'result/candidate')
    _invoke(evidence, 'validate:truth-table', ['input/requirement', 'input/inventory', 'result/candidate'], 'result/proof')
    _invoke(evidence, 'hash:finite-behavior', ['input/requirement', 'result/proof'], 'result/semantic-hash')
    result = _invoke(evidence, 'compose:recipe', ['result/candidate', 'result/proof', 'result/semantic-hash'], 'result/recipe')
    fg = FunctionalGuarantee('fg/constructed-behavior', ('result/proof/calc',),
                             'input/requirement', 'result/candidate', ('result/proof/calc',))
    evidence['parts'].append(asdict(fg)); evidence['fgs'] = [asdict(fg)]
    evidence['source'] = {path.name: sha256(path.read_bytes()).hexdigest()
                          for path in (Path(__file__), Path(__file__).with_name('core.py'))}
    # Evidence retains source identity separately and never enters semantic meaning.
    return {**result, 'evidence': evidence}


@lru_cache(maxsize=1)
def _default_xor():
    return synthesize([0, 1, 1, 0])


def instantiate(net, prefix, a, b, recipe=None):
    """Instantiate a synthesized declaration using actual Net NAND Calculations."""
    recipe = _default_xor() if recipe is None else recipe
    _check_geometry(recipe)
    signals = [tuple(row[0] for row in DOMAIN), tuple(row[1] for row in DOMAIN)]
    for left, right in recipe['gates']:
        signals.append(tuple(INVENTORY['primitives'][0]['truthTable'][2*x+y]
                             for x, y in zip(signals[left], signals[right])))
    if list(signals[recipe['output']]) != recipe.get('truthTable'):
        raise ValueError('recipe wiring does not fulfill its claimed behavior')
    return _instantiate(net, prefix, a, b, recipe)


if __name__ == '__main__':
    print(json.dumps(synthesize([0, 1, 1, 0]), indent=2, sort_keys=True))
