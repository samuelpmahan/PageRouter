"""Independent Python realization of the pinned six-node Atlas motion composition."""
import ast
import hashlib
import json
import math
import re
import sys
from pathlib import Path

FORMAT = 'kompozed.atlas.cross-language-case.v1'
OBSERVATION = 'kompozed.atlas.cross-language-observation.v1'
ASSUMPTION = 'conditionally independent Bernoulli cases with one shared pass probability'
NODES = [
    ('decision', 'probe_decision', ['/models/posterior', '/parts/policy'], '/evidence/decision'),
    ('parameter_probe', 'probe_model', ['/models/fitted', '/parts/specification'], '/evidence/parameters'),
    ('posterior', 'update_beta', ['/parts/prior', '/evidence/predictions'], '/models/posterior'),
    ('prediction_probe', 'probe_predictions', ['/models/predicted', '/parts/observed'], '/evidence/predictions'),
    ('predict', 'predict_motion', ['/models/fitted', '/parts/queries'], '/models/predicted'),
    ('fit', 'fit_motion', ['/parts/training', '/parts/config'], '/models/fitted'),
]
OUTPUTS = {'decision': '/evidence/decision', 'parameter_probe': '/evidence/parameters',
           'posterior': '/models/posterior', 'prediction_probe': '/evidence/predictions', 'model': '/models/fitted'}
SOURCES = {'/parts/training', '/parts/config', '/parts/queries', '/parts/observed',
           '/parts/prior', '/parts/policy', '/parts/specification'}


def js_number(value):
    if value == 0:
        return '0'
    if isinstance(value, int) or value.is_integer():
        return str(int(value))
    text = repr(value)
    if 'e' in text:
        mantissa, exponent = text.split('e')
        exponent = int(exponent)
        if -6 <= exponent < 21:
            from decimal import Decimal
            return format(Decimal(text), 'f')
        return mantissa + 'e' + ('+' if exponent >= 0 else '') + str(exponent)
    return text


def canonical(value):
    if value is None or isinstance(value, (str, bool)):
        return json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if isinstance(value, (int, float)):
        finite(value, 'canonical number')
        return js_number(value)
    if isinstance(value, list):
        return '[' + ','.join(canonical(item) for item in value) + ']'
    if isinstance(value, dict):
        return '{' + ','.join(canonical(key) + ':' + canonical(value[key]) for key in sorted(value)) + '}'
    raise TypeError('case must contain only finite JSON values')


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise TypeError(f'{name} must be a finite number')
    return value


def obj(value, name):
    if not isinstance(value, dict):
        raise TypeError(f'{name} must be an object')
    return value


def rows(value, target=False):
    data = obj(value, 'transitions source').get('transitions')
    if not isinstance(data, list) or not data:
        raise TypeError('transitions must be a nonempty list')
    result = []
    for row in data:
        row = obj(row, 'transition')
        item = {'x': finite(row.get('x'), 'x'), 'action': finite(row.get('action'), 'action')}
        if target:
            item['next_x'] = finite(row.get('next_x'), 'next_x')
        result.append(item)
    return result


def preflight(record):
    obj(record, 'case')
    if set(record) != {'format', 'recipe', 'sources', 'implementationIdentity', 'case_id'} or record['format'] != FORMAT:
        raise TypeError('unsupported cross-language case format or fields')
    recipe = obj(record['recipe'], 'recipe')
    expected = [{'id': node, 'calculation': calculation, 'inputs': inputs, 'output': output}
                for node, calculation, inputs, output in NODES]
    if recipe != {'nodes': expected, 'outputs': OUTPUTS}:
        raise TypeError('case recipe disagrees with pinned six-node Atlas contract')
    source = obj(record['sources'], 'sources')
    if set(source) != SOURCES:
        raise TypeError('case source addresses disagree with pinned Atlas contract')
    case_id = record['case_id']
    if not isinstance(case_id, str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', case_id):
        raise TypeError('case_id must be a SHA-256 digest')
    payload = {key: record[key] for key in ('recipe', 'sources', 'implementationIdentity')}
    actual = 'sha256:' + hashlib.sha256(canonical(payload).encode('utf-8')).hexdigest()
    if actual != case_id:
        raise TypeError('case identity disagrees with recipe, sources, or implementation identity')
    # Validate all inputs before any Calculation runs or writes output.
    training = rows(source['/parts/training'], True)
    queries = rows(source['/parts/queries'])
    if len(training) < 2 or len(queries) != 10:
        raise ValueError('motion contract requires at least two training rows and exactly ten queries')
    for address in SOURCES - {'/parts/training', '/parts/queries'}:
        obj(source[address], address)
    canonical(source)
    return source, training, queries


def decide(expression, checks):
    if not isinstance(expression, str) or len(expression) > 4096:
        raise TypeError('decision expression must be bounded text')
    tree = ast.parse(expression, mode='eval')

    def evaluate(node):
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Name) and node.id in checks:
            return checks[node.id]
        if isinstance(node, ast.Constant) and isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not evaluate(node.operand)
        if isinstance(node, ast.BoolOp) and isinstance(node.op, (ast.And, ast.Or)):
            values = [evaluate(item) for item in node.values]
            return all(values) if isinstance(node.op, ast.And) else any(values)
        raise SyntaxError('unsupported decision expression syntax')

    return evaluate(tree)


def evaluate(record):
    source, training, queries = preflight(record)
    config = source['/parts/config']
    min_variance = finite(config.get('min_variance', 1e-12), 'min_variance')
    if min_variance < 0:
        raise ValueError('min_variance must be nonnegative')
    n = len(training)
    mean_action = sum(row['action'] for row in training) / n
    mean_delta = sum(row['next_x'] - row['x'] for row in training) / n
    variance = sum((row['action'] - mean_action) ** 2 for row in training) / n
    if variance <= min_variance:
        raise ValueError('degenerate actions')
    covariance = sum((row['action'] - mean_action) * (row['next_x'] - row['x'] - mean_delta) for row in training) / n
    gain = finite(covariance / variance, 'gain')
    bias = finite(mean_delta - gain * mean_action, 'bias')
    mse = finite(sum((row['next_x'] - row['x'] - (gain * row['action'] + bias)) ** 2 for row in training) / n, 'training_mse')
    model = {'gain': gain, 'bias': bias, 'n': n, 'training_mse': mse,
             'equation': f'delta = {js_number(gain)} * action + {js_number(bias)}'}
    predicted = [finite(row['x'] + gain * row['action'] + bias, 'prediction') for row in queries]
    spec = source['/parts/specification']
    spec_tol = finite(spec.get('tolerance'), 'specification tolerance')
    if spec_tol < 0:
        raise ValueError('negative tolerance')
    gain_matches = abs(gain - finite(spec.get('expected_gain'), 'expected_gain')) <= spec_tol
    bias_matches = abs(bias - finite(spec.get('expected_bias'), 'expected_bias')) <= spec_tol
    parameter_probe = {'gain_matches': gain_matches, 'bias_matches': bias_matches,
                       'passed': gain_matches and bias_matches}
    observed = source['/parts/observed']
    tolerance = finite(observed.get('tolerance'), 'observation tolerance')
    values = observed.get('values')
    if tolerance < 0 or not isinstance(values, list) or len(values) != len(predicted):
        raise ValueError('nonempty equal length values and nonnegative tolerance required')
    errors = [finite(abs(prediction - finite(value, 'observed value')), 'error')
              for prediction, value in zip(predicted, values)]
    flags = [error <= tolerance for error in errors]
    passed = sum(flags)
    probe = {'errors': errors, 'pass_flags': flags, 'passed': passed, 'failed': len(flags) - passed, 'n': len(flags)}
    prior = source['/parts/prior']
    alpha = finite(prior.get('alpha'), 'alpha')
    beta = finite(prior.get('beta'), 'beta')
    if alpha <= 0 or beta <= 0:
        raise ValueError('positive prior parameters required')
    alpha += passed
    beta += len(flags) - passed
    posterior = {'alpha': alpha, 'beta': beta, 'mean': alpha / (alpha + beta), 'n': len(flags),
                 'model_assumption': ASSUMPTION}
    policy = source['/parts/policy']
    min_cases = policy.get('min_cases')
    min_mean = finite(policy.get('min_mean'), 'min_mean')
    if isinstance(min_cases, bool) or not isinstance(min_cases, int) or min_cases < 1 or not 0 <= min_mean <= 1:
        raise ValueError('invalid decision policy')
    checks = {'enough_cases': len(flags) >= min_cases, 'reliability_ok': posterior['mean'] >= min_mean}
    expression = policy.get('formula', 'enough_cases and reliability_ok')
    decision = {'accepted': decide(expression, checks), 'checks': checks, 'expression': expression}
    return {'format': OBSERVATION, 'language': 'python', 'case_id': record['case_id'],
            'observables': {'model': model, 'parameter_probe': parameter_probe, 'predictions': predicted,
                            'prediction_probe': probe, 'posterior': posterior, 'decision': decision},
            'execution': {'implementation': 'exp/atlas/cross_language.py', 'contract': 'pinned six-node Atlas motion composition'}}


def main():
    if len(sys.argv) != 3:
        raise SystemExit('usage: python exp/atlas/cross_language.py CASE.json PYTHON.json')
    record = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    result = evaluate(record)
    Path(sys.argv[2]).write_text(json.dumps(result, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps(result, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    try:
        main()
    except (TypeError, ValueError, SyntaxError, KeyError) as error:
        print(f'{type(error).__name__}: {error}', file=sys.stderr)
        raise SystemExit(1)
