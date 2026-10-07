"""Lower finite functional definitions into the existing addressed Pipeline.

This experiment adds executable composition definitions, not a general language.
Type names refer to trusted local predicates. They do not prove behavior.
"""
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'pxc-machine'))
from pipeline import Pipeline


def describe(definition_id, definitions, _chain=()):
    if definition_id in _chain:
        raise ValueError(f'recursive definition without a finite instance: {definition_id}')
    if definition_id not in definitions:
        raise ValueError(f'missing definition: {definition_id}')
    definition = definitions[definition_id]
    result = {key: deepcopy(definition[key]) for key in ('kind', 'label', 'inputs', 'outputs')}
    result['id'] = definition_id
    if definition['kind'] == 'functionalGuarantee':
        result['returns'] = deepcopy(definition['returns'])
    else:
        result['implementation'] = definition['implementation']
    result['children'] = [dict(instance=step['id'], bind=deepcopy(step['bind']),
        after=list(step.get('after', [])), **describe(step['use'], definitions, (*_chain, definition_id)))
        for step in definition.get('steps', [])]
    return result


def _check_ports(value, ports, schemas, location):
    if type(value) is not dict or set(value) != set(ports):
        raise ValueError(f'{location}: expected ports {sorted(ports)}')
    for name, kind in ports.items():
        if kind not in schemas:
            raise ValueError(f'{location}.{name}: unknown schema {kind}')
        try:
            valid = schemas[kind](value[name])
        except Exception as error:
            raise ValueError(f'{location}.{name}: schema {kind}: {error}') from error
        if valid is not True:
            raise ValueError(f'{location}.{name}: does not satisfy {kind}')


def run(definition_id, inputs, *, definitions, implementations, schemas):
    definitions = deepcopy(definitions)
    if definition_id not in definitions:
        raise ValueError(f'missing definition: {definition_id}')
    _check_ports(inputs, definitions[definition_id]['inputs'], schemas, 'inputs')
    p, features = Pipeline(), []
    bound = {name: (p.input('request/' + name, deepcopy(value)),
                    definitions[definition_id]['inputs'][name]) for name, value in inputs.items()}

    def build(identity, path, incoming, chain=(), sequencing=()):
        if identity in chain:
            raise ValueError(f'recursive definition without a finite instance: {identity}')
        if identity not in definitions:
            raise ValueError(f'missing definition: {identity}')
        definition = definitions[identity]
        if set(incoming) != set(definition['inputs']):
            raise ValueError(f'{path}: bindings do not match input ports')
        for name, (_, kind) in incoming.items():
            if kind != definition['inputs'][name]:
                raise ValueError(f'{path}.{name}: incompatible meanings {kind} -> {definition["inputs"][name]}')
        for kind in (*definition['inputs'].values(), *definition['outputs'].values()):
            if kind not in schemas:
                raise ValueError(f'{path}: unknown schema {kind}')
        declaration = p.input(path + '/definition', definition)
        output = path + '/result'

        if definition['kind'] == 'calculation':
            implementation = definition['implementation']
            if implementation not in implementations:
                raise ValueError(f'{path}: missing implementation {implementation}')
            names = list(definition['inputs'])
            def compute(*values):
                arguments = dict(zip(names, values[:len(names)]))
                _check_ports(arguments, definition['inputs'], schemas, path + '/inputs')
                # Isolate ordinary JSON state so a script cannot mutate its caller's Parts.
                # This is not a sandbox for globals, external I/O or arbitrary Python code.
                result = implementations[implementation](**deepcopy(arguments))
                _check_ports(result, definition['outputs'], schemas, path + '/outputs')
                return deepcopy(result)
            p.declare(output, identity,
                      [incoming[name][0] for name in names] + list(sequencing) + [declaration], compute)
            root = output
        elif definition['kind'] == 'functionalGuarantee':
            features.append(dict(id=identity, path=path, label=definition['label'],
                                 inputs=deepcopy(definition['inputs']), outputs=deepcopy(definition['outputs'])))
            steps = {step['id']: step for step in definition.get('steps', [])}
            if len(steps) != len(definition.get('steps', [])):
                raise ValueError(f'{path}: duplicate step identifiers')
            linked, visiting = {}, set()

            def resolve(reference):
                if not isinstance(reference, str) or '.' not in reference:
                    raise ValueError(f'{path}: invalid reference {reference!r}')
                owner, port = reference.split('.', 1)
                if owner == '$input':
                    if port not in incoming:
                        raise ValueError(f'{path}: missing input {port}')
                    return incoming[port]
                if owner not in steps:
                    raise ValueError(f'{path}: missing step {owner}')
                result = link(owner)[0]
                if port not in result:
                    raise ValueError(f'{path}: missing output {reference}')
                return result[port]

            def link(name):
                if name in linked:
                    return linked[name]
                if name in visiting:
                    raise ValueError(f'{path}: same-state dependency cycle at {name}')
                if name not in steps:
                    raise ValueError(f'{path}: missing sequence predecessor {name}')
                visiting.add(name)
                step = steps[name]
                arguments = {port: resolve(reference) for port, reference in step['bind'].items()}
                predecessors = [link(other)[1] for other in step.get('after', [])]
                linked[name] = build(step['use'], path + '/' + name, arguments,
                                     (*chain, identity), (*sequencing, *predecessors))
                visiting.remove(name)
                return linked[name]

            for name in steps:
                link(name)
            if set(definition['returns']) != set(definition['outputs']):
                raise ValueError(f'{path}: returns do not match output ports')
            returns = {name: resolve(ref) for name, ref in definition['returns'].items()}
            for name, (_, kind) in returns.items():
                if kind != definition['outputs'][name]:
                    raise ValueError(f'{path}.{name}: returned meaning {kind} differs from declared output')
            names = list(returns)
            def complete(*values):
                result = dict(zip(names, values[:len(names)]))
                _check_ports(result, definition['outputs'], schemas, path + '/outputs')
                return deepcopy(result)
            # Every declared step is required in this finite composition, including
            # checks whose result is not a returned port. Unused definitions stay idle.
            p.declare(output, 'compose:' + identity,
                      [returns[n][0] for n in names] + [item[1] for item in linked.values()] +
                      list(sequencing) + [declaration], complete)
            root = path + '/capability'
            # Adapter to the existing Pipeline representation: completion assembles
            # the resulting Part and checks its port schema. Behavioral checks are
            # ordinary declared steps, with implementation-specific failure policy.
            p.guarantee(root, declaration, output, [output + '/calc'])
        else:
            raise ValueError(f'{path}: unknown definition kind {definition["kind"]}')
        ports = {}
        for name, kind in definition['outputs'].items():
            address = path + '/ports/' + name
            p.declare(address, 'project-port', [output], lambda result, name=name: result[name])
            ports[name] = (address, kind)
        return ports, output, root

    _, output, root = build(definition_id, 'capability', bound)
    p.seek([root])
    return dict(outputs=deepcopy(p.values[output]), features=features, order=p.order, log=p.log,
                declarations={address: asdict(part) for address, part in p.parts.items()},
                definition=describe(definition_id, definitions))
