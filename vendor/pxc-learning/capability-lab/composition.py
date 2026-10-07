"""Compose the two experimental capabilities through one declared state path."""
from copy import deepcopy

from cpu import make_cpu
from storage import make_storage


def make_memory_cpu(provider='gates'):
    storage, storage_defs, storage_impl, storage_schemas = make_storage(16, 8)
    cpu, cpu_defs, cpu_impl, cpu_schemas = make_cpu(provider)
    definitions = {**storage_defs, **cpu_defs}
    implementations = {**storage_impl, **cpu_impl}
    schemas = {**storage_schemas, **cpu_schemas}
    definitions['Memory.FromCpu'] = dict(kind='calculation', label='Read the CPU RAM Part',
        inputs={'state': 'CpuState'}, outputs={'memory': 'memory16x8'}, implementation='memory.fromCpu')
    definitions['Memory.IntoCpu'] = dict(kind='calculation', label='Bind resulting RAM into CPU state',
        inputs={'state': 'CpuState', 'memory': 'memory16x8'}, outputs={'state': 'CpuState'},
        implementation='memory.intoCpu')
    implementations['memory.fromCpu'] = lambda state: {'memory': state['RAM']}
    implementations['memory.intoCpu'] = lambda state, memory: {'state': {**state, 'RAM': memory}}
    definitions['MemoryThenCpu.Step'] = dict(
        kind='functionalGuarantee', label='Write memory, then step CPU',
        inputs={'state': 'CpuState', 'program': 'Program16', 'inputByte': 'Byte',
                'address': 'address16', 'value': 'word8', 'write': 'bool'},
        outputs={'state': 'CpuState', 'read': 'word8'},
        steps=[
            dict(id='currentMemory', use='Memory.FromCpu', bind={'state': '$input.state'}),
            dict(id='memory', use=storage, bind={'memory': 'currentMemory.memory',
                'address': '$input.address', 'value': '$input.value', 'write': '$input.write'}),
            dict(id='boundState', use='Memory.IntoCpu',
                 bind={'state': '$input.state', 'memory': 'memory.memory'}),
            dict(id='step', use=cpu, bind={'state': 'boundState.state',
                 'program': '$input.program', 'inputByte': '$input.inputByte'}),
        ], returns={'state': 'step.state', 'read': 'memory.read'})
    return 'MemoryThenCpu.Step', definitions, implementations, schemas


EXAMPLE = dict(state={'A': 0, 'PC': 0, 'OUT': 0, 'HALT': 0, 'RAM': [0] * 16},
               program=[0x23] + [0] * 15, inputByte=0, address=3, value=42, write=True)


def probe():
    from runtime import run
    results = {}
    for provider in ('gates', 'integer'):
        name, definitions, implementations, schemas = make_memory_cpu(provider)
        initial = deepcopy(EXAMPLE)
        result = run(name, initial, definitions=definitions, implementations=implementations, schemas=schemas)
        assert result['outputs']['state']['A'] == 42
        assert result['outputs']['state']['PC'] == 1
        assert result['outputs']['state']['RAM'][3] == 42
        assert result['outputs']['read'] == 42
        assert initial == EXAMPLE
        results[provider] = {'outputs': result['outputs'], 'features': result['features'], 'order': result['order']}
    assert results['gates']['outputs'] == results['integer']['outputs']
    name, definitions, implementations, schemas = make_memory_cpu()
    # Preserve both correct components, but give Step the preceding state.
    definitions[name]['steps'][-1]['bind']['state'] = '$input.state'
    wrong = run(name, deepcopy(EXAMPLE), definitions=definitions, implementations=implementations, schemas=schemas)
    assert wrong['outputs']['state']['A'] == 0
    assert wrong['outputs']['read'] == 42
    return dict(question='Do the memory and CPU capabilities actually compose through their declared state binding?',
        prediction='Store 42 at address 3, then LDA 3 must put 42 in the accumulator.',
        example=EXAMPLE, observations=results,
        wrongBinding={'outputs': wrong['outputs'],
            'because': 'Both components are correct, but CPU Step consumed the preceding state.',
            'try': 'Bind Step to boundState.state, then check accumulator and memory across the composition.'},
        checks={'bothProvidersLoadWrittenValue': True, 'inputsPreserved': True,
                'wrongBindingChangesMeaningDespiteValidComponents': True},
        limitation='The parent load-after-write requirement is independently asserted by this probe; the child contracts alone do not infer it.')


if __name__ == '__main__':
    import json
    from pathlib import Path
    result = probe()
    Path(__file__).with_name('composition-report.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result['checks']))
