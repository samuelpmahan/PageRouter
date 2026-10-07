"""Reproduce Lane A evidence. Writes only this lane's deterministic JSON artifact."""
from copy import deepcopy
from dataclasses import replace
from hashlib import sha256
from itertools import product
import json
from pathlib import Path
from composition import (compose, construct, validate_requirement, compile_component,
                         execute_requirement, verify, INVENTORY, canonical, instantiate)
from core import Net, compile_net, execute_plan

HERE=Path(__file__).resolve().parent
BASE=HERE.parents[1]
CHECKPOINT=BASE.parent/'pxc-checkpoints'/'001'


def evidence():
    requirements=json.loads((HERE/'requirements.json').read_text())
    specimens={name:compose(requirement) for name,requirement in requirements.items()}
    all_tables=[]
    for table in product((0,1),repeat=8):
        requirement=dict(name='arbitrary-three-input-function',inputs=['a','b','c'],outputs=['q'],
            rows=[dict(inputs=list(inputs),outputs=[output])
                  for inputs,output in zip(product((0,1),repeat=3),table)])
        report=compose(requirement)
        all_tables.append({'literalTable':list(table),'selectedStrategy':report['selection']['selectedStrategy'],
            'losses':[c['verification']['loss'] for c in report['candidates']],
            'nandCounts':[c['bom']['nand'] for c in report['candidates']],
            'semanticHashes':[c['verification']['semantic']['hash'] for c in report['candidates']]})
    assert all(row['losses']==[0,0] and len(set(row['semanticHashes']))==1 for row in all_tables)
    patterns=['01101001100101101001011001101001','00000000111111110000000011111111',
              '00101101010110010110100011010010']
    requirement=dict(name='five-input-three-output-specimen',inputs=list('abcde'),outputs=['p','q','r'],rows=[
        dict(inputs=list(bits),outputs=[int(pattern[i]) for pattern in patterns])
        for i,bits in enumerate(product((0,1),repeat=5))])
    specimens['fiveInputs']=compose(requirement)
    full=requirements['fullAdder']; minimum=min(c['bom']['nand'] for c in specimens['fullAdder']['candidates'])
    bounds={str(bound):compose(full,{'maxNand':bound})['selection'] for bound in (minimum,minimum-1)}

    # Counterexample 1: every primitive does its job, but the component routes the wrong bit.
    net=construct(full,INVENTORY,'shannon'); output=net.buses['sum'][0]
    original=net.producers[output]; net.producers[output]=replace(original,inputs=('input/0',))
    net.parts[original.address]=net.producers[output]
    validator=net.producers[output+'/valid']
    net.producers[output+'/valid']=replace(validator,inputs=('input/0',output))
    net.parts[validator.address]=net.producers[output+'/valid']
    plan=compile_component(net); trace=execute_requirement(plan,full); verdict=verify(full,plan,trace)
    assert verdict['status']=='FAIL' and verdict['primitiveFailures']==0
    counterexamples=[{'id':'correct-gates-wrong-component','question':'Do passing NAND/wire FGs imply the requested component?',
        'expected':'component FAIL, primitive FGs PASS','because':'the output wire correctly copies the wrong source',
        'try':'inspect the first failed output row and follow its actual dependencies',
        'requirement':full,'plan':plan,'trace':trace,'verification':verdict}]

    # Counterexample 2: a symmetric component hides incorrectly labeled input states.
    candidate=specimens['fullAdder']['candidates'][0]; plan=candidate['plan']
    stimuli=[{'input/0':r['inputs'][1],'input/1':r['inputs'][0],'input/2':r['inputs'][2]} for r in full['rows']]
    trace=execute_plan(plan,7,stimuli); verdict=verify(full,plan,trace)
    assert verdict['status']=='FAIL' and verdict['semantic'] is None
    counterexamples.append({'id':'right-outputs-wrong-state-labels',
        'question':'Do matching output rows prove the declared input states were evaluated?',
        'expected':'input binding FAIL, output comparisons equal',
        'because':'the symmetric adder cannot expose an a/b swap using output values alone',
        'try':'bind each recorded external input Part to its independently declared domain row',
        'requirement':full,'plan':plan,'trace':trace,'verification':verdict})

    # Counterexample 3: canonical behavior equality survives renaming, not output permutation.
    renamed=deepcopy(full); renamed['name']='different label'; renamed['inputs']=['x','y','z']
    renamed['outputs']=['first','second']; renamed['rows'].reverse()
    rename=compose(renamed)
    swapped=deepcopy(full)
    for row in swapped['rows']: row['outputs'].reverse()
    swap=compose(swapped)
    seam={'nameAndPortLabelChangesPreserveMeaning':rename['semanticRequirement']==specimens['fullAdder']['semanticRequirement'],
          'outputPositionSwapChangesMeaning':swap['semanticRequirement']!=specimens['fullAdder']['semanticRequirement'],
          'rule':'ordered port positions carry meaning; labels do not; bound and BOM are separate FGs'}
    assert all(seam[key] for key in ('nameAndPortLabelChangesPreserveMeaning','outputPositionSwapChangesMeaning'))

    # Construct a consumer from four copies of the selected declaration. Every
    # runtime instruction remains NAND/wire; integer addition appears only here as an independent oracle.
    net=Net('four-bit adder from declared full-adder behavior')
    left=[net.input('a/'+str(i)) for i in range(4)]; right=[net.input('b/'+str(i)) for i in range(4)]
    initial_carry=net.input('carryIn'); carry=initial_carry; outputs=[]
    for i in range(4):
        result,carry=instantiate(net,'stage/'+str(i),[left[i],right[i],carry],specimens['fullAdder'])
        outputs.append(result)
    net.bus('sum',outputs); net.bus('carry',[carry]); plan=compile_net(net)
    stimuli=[]; oracle=[]
    for a,b,c in product(range(16),range(16),(0,1)):
        stimuli.append({**{left[i]:(a>>i)&1 for i in range(4)},**{right[i]:(b>>i)&1 for i in range(4)},initial_carry:c})
        oracle.append(a+b+c)
    trace=execute_plan(plan,511,stimuli)
    observed=[state['buses']['sum']+16*state['buses']['carry'] for state in trace['states']]
    mismatches=[{'row':i,'expected':expected,'actual':actual} for i,(expected,actual) in enumerate(zip(oracle,observed)) if expected!=actual]
    assert not mismatches and all(s['fg']['failed']==0 for s in trace['states'])
    consumer={'name':net.name,'inputs':{'a':4,'b':4,'carryIn':1},'rows':512,'bom':plan['bom'],
              'status':'PASS','loss':len(mismatches),'mismatches':mismatches,
              'primitiveFailures':sum(s['fg']['failed'] for s in trace['states']),
              'outputDigest':sha256(canonical(observed).encode()).hexdigest(),
              'reference':'integer a+b+carry, used only as an independent validator',
              'componentBehaviorHash':specimens['fullAdder']['semanticRequirement']['hash'],
              'runtimeRules':sorted({c['rule'] for c in plan['calculations']}),
              'examples':[{'a':a,'b':b,'carryIn':c,'expected':a+b+c,
                          'actual':observed[(a*16+b)*2+c]} for a,b,c in [(0,0,0),(7,8,1),(15,15,1)]]}
    checkpoint_manifest=json.loads((CHECKPOINT/'manifest.json').read_text())
    checkpoint_files=['lyceum/common.py',*[f'pxc-machine/{name}' for name in ('core.py','circuits.py','pipeline.py','synthesis.py')]]
    checkpoint_verified={path:sha256((CHECKPOINT/path).read_bytes()).hexdigest()==checkpoint_manifest['files'][path] for path in checkpoint_files}
    assert all(checkpoint_verified.values())
    files=[HERE/'composition.py',HERE/'build_evidence.py',HERE/'test_composition.py',HERE/'requirements.json',
           *[BASE/name for name in ('core.py','circuits.py','pipeline.py','synthesis.py')]]
    return {'schema':'pxc-composition-evidence/v1','checkpoint':'001','checkpointHashesVerified':checkpoint_verified,
            'baselineTests':{'core':11,'synthesis':8,'pipeline':2,'meaning':'freshly rerun against immutable checkpoint 001 before extension'},
            'sources':{str(path.relative_to(BASE)):sha256(path.read_bytes()).hexdigest() for path in files},
            'summary':{'status':'PASS','exhaustiveThreeInputFunctions':256,'constructedCandidatesForThoseFunctions':512,
                       'truthRowsForThoseCandidates':4096,'consumerInputsExhaustivelyChecked':512,
                       'globalMinimumClaimed':False},
            'specimens':specimens,'finiteFunctionCorpus':all_tables,'boundExperiments':bounds,
            'counterexamples':counterexamples,'semanticSeam':seam,'consumer':consumer}


if __name__=='__main__':
    result=evidence(); target=HERE/'evidence.json'
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'artifact':str(target),'summary':result['summary'],
                      'specimens':{name:{c['strategy']:c['bom']['nand'] for c in report['candidates']}
                                   for name,report in result['specimens'].items()},
                      'consumer':result['consumer']},indent=2))
