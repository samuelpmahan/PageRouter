"""A predecessor component earns catalog admission through the same finite FGs.

Names are labels. A builder key identifies executable code to measure; measured
behavior, complete verification, and the declared bound decide admission.
"""
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
from pathlib import Path
import json
import re
import subprocess
import sys

import composition as finite
from circuits import full_adder
from pipeline import Pipeline

HERE=Path(__file__).resolve().parent
BASE=HERE.parents[1]
DEFAULT_CATALOG=[{'id':'checkpoint-full-adder','label':'full adder','builder':'base-full-adder'},
                 {'id':'wrong-full-adder','label':'full adder','builder':'wrong-output-wires'}]
BUILDERS=('base-full-adder','wrong-output-wires')
SOURCE_FILES=[str(path) for path in [BASE/'core.py',BASE/'circuits.py',BASE/'pipeline.py',BASE/'synthesis.py',
                                   HERE/'composition.py',HERE/'library.py']]


def validate_catalog(catalog):
    if type(catalog) is not list or len(catalog)>16:
        raise ValueError('catalog must be a list of at most sixteen local candidates')
    identifiers=[]
    for entry in catalog:
        if type(entry) is not dict or set(entry)!={'id','label','builder'}:
            raise ValueError('catalog entry needs exactly id, label, builder')
        if (type(entry['id']) is not str or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*',entry['id']) or
                type(entry['label']) is not str or not entry['label'] or entry['builder'] not in BUILDERS):
            raise ValueError('catalog entry needs a unique simple id, display label, and supported local builder')
        identifiers.append(entry['id'])
    if len(identifiers)!=len(set(identifiers)):
        raise ValueError('catalog candidate ids must be unique')
    return deepcopy(catalog)


def source_provenance(paths):
    if paths!=SOURCE_FILES:
        raise ValueError('source provenance must name exactly the local executable source files')
    return {'files':{str(Path(path).relative_to(BASE)):sha256(Path(path).read_bytes()).hexdigest() for path in paths},
            'meaning':'on-disk executable source receipt; separate from finite semantic equality'}


def construct_library(requirement,inventory,entry):
    finite.validate_inventory(inventory)
    if len(requirement['inputs'])!=3 or len(requirement['outputs'])!=2:
        return None
    net=finite.Net(entry['label'])
    ports=[net.input('input/'+str(i)) for i in range(3)]
    if entry['builder']=='base-full-adder':
        outputs=full_adder(net,'library/body',*ports)
    elif entry['builder']=='wrong-output-wires':
        outputs=(ports[0],ports[2])
    else:
        raise ValueError('unknown executable builder')
    boundary=[net.wire('output/'+str(i),value) for i,value in enumerate(outputs)]
    for label,address in zip(requirement['outputs'],boundary): net.bus(label,[address])
    net.group('library/component','CATALOG_COMPONENT',ports,boundary)
    return net


def verify_library(requirement,plan,trace):
    if plan is None:
        return {'status':'UNVERIFIED','loss':1,'rows':[],'mismatches':[], 'primitiveFailures':0,
                'semantic':None,'reason':'this catalog builder requires three inputs and two outputs'}
    return finite.verify(requirement,plan,trace)


def qualify_library(meaning,verification,bom,constraints):
    if bom is None:
        return {'status':'FAIL','behavior':False,'size':False,'loss':1,
                'reason':'rejected because the catalog builder has incompatible input/output widths',
                'try':'use a compatible catalog entry or one of the generic constructors'}
    return finite.qualify(meaning,verification,bom,constraints)


def collect_candidates(generic,catalog,*library_values):
    candidates=[]
    for candidate in generic['candidates']:
        candidates.append({'id':'generic/'+candidate['strategy'],'label':candidate['strategy'],
                           'origin':'generic-construction',**candidate})
    for entry,values in zip(catalog,library_values):
        candidates.append({'id':'library/'+entry['id'],'label':entry['label'],'origin':'catalog-candidate',
                           'builder':entry['builder'],**values})
    return candidates


def select_candidate(candidates):
    qualified=[c for c in candidates if c['qualification']['status']=='PASS']
    winner=min(qualified,key=lambda c:(c['bom']['nand'],c['id'])) if qualified else None
    rejected=[{'id':c['id'],**c['qualification']} for c in candidates if c['qualification']['status']!='PASS']
    # ImplSpecific hook: keep rejected candidates as observable comparison inputs.
    # Failure does not erase their actual graph, counterexamples, or BOM.
    return {'status':'PASS' if winner else 'FAIL','selectedId':winner['id'] if winner else None,
            'qualifying':[c['id'] for c in qualified],'rejected':rejected,
            'because':('selected the qualifying graph with the lowest measured NAND count'
                       if winner else 'no measured candidate satisfies both behavior and the declared bound'),
            'try':None if winner else 'inspect retained counterexamples, add a verified candidate, or change the declared bound',
            'optimality':'lowest measured NAND count among supplied candidates only'}


def choose_component(requirement,constraints=None,catalog=None,inventory=None,source_files=None):
    p=Pipeline()
    inputs={'request/requirement':deepcopy(requirement),
            'request/constraints':deepcopy(finite.DEFAULT_CONSTRAINTS if constraints is None else constraints),
            'request/catalog':deepcopy(DEFAULT_CATALOG if catalog is None else catalog),
            'request/inventory':deepcopy(finite.INVENTORY if inventory is None else inventory),
            'request/sourceFiles':deepcopy(SOURCE_FILES if source_files is None else source_files)}
    for address,value in inputs.items():p.input(address,value)
    p.declare('catalog','validate-local-catalog',['request/catalog'],validate_catalog)
    # Catalog validation executes before using its length to declare candidate work.
    p.seek(['catalog'])
    p.declare('requirement','validate-complete-requirement',['request/requirement'],finite.validate_requirement)
    p.declare('constraints','validate-component-bound',['request/constraints'],finite.validate_constraints)
    p.declare('inventory','validate-primitive-inventory',['request/inventory'],finite.validate_inventory)
    p.declare('sourceProvenance','inspect-declared-source-files',['request/sourceFiles'],source_provenance)
    p.declare('meaning','canonical-finite-meaning',['requirement'],lambda r:finite.semantic(r,r['rows']))
    p.declare('generic','construct-and-qualify-generic-candidates',['requirement','constraints','inventory'],finite.compose)
    roots=[]; prefixes=[]; literals={}
    for i in range(len(p.values['catalog'])):
        prefix='library/'+str(i); prefixes.append(prefix)
        literals[prefix+'/ordinal']=i;p.input(prefix+'/ordinal',i)
        p.declare(prefix+'/entry','select-catalog-entry',['catalog',prefix+'/ordinal'],lambda catalog,index:catalog[index])
        p.declare(prefix+'/net','construct-catalog-entry',['requirement','inventory',prefix+'/entry'],construct_library)
        p.declare(prefix+'/plan','compile-fg-closure',[prefix+'/net'],lambda net:finite.compile_component(net) if net else None)
        p.declare(prefix+'/trace','execute-complete-domain',[prefix+'/plan','requirement'],
                  lambda plan,req:finite.execute_requirement(plan,req) if plan else None)
        p.declare(prefix+'/verification','compare-literal-rows-and-replay',
                  ['requirement',prefix+'/plan',prefix+'/trace'],verify_library)
        p.declare(prefix+'/bom','measure-compiled-graph',[prefix+'/plan'],lambda plan:finite.measure_bom(plan) if plan else None)
        p.declare(prefix+'/qualification','admit-by-behavior-and-bound',
                  ['meaning',prefix+'/verification',prefix+'/bom','constraints'],qualify_library)
        fields=('plan','trace','verification','bom','qualification')
        p.declare(prefix+'/candidate','retain-measured-candidate',[prefix+'/'+field for field in fields],
                  lambda plan,trace,verification,bom,qualification:
                      dict(plan=plan,trace=trace,verification=verification,bom=bom,qualification=qualification))
        p.guarantee(prefix+'/fg/admission','requirement',prefix+'/plan',[prefix+'/qualification/calc'])
        roots.append(prefix+'/fg/admission')
    p.declare('candidates','collect-comparison-candidates',
              ['generic','catalog',*[prefix+'/candidate' for prefix in prefixes]],collect_candidates)
    p.declare('selection','select-qualifying-component',['candidates'],select_candidate)
    p.guarantee('fg/component-choice','requirement','selection',['selection/calc'])
    p.seek([*roots,'fg/component-choice','sourceProvenance','meaning'])
    value_paths={'catalog':'catalog','requirement':'requirement','constraints':'constraints','inventory':'inventory',
                 'sourceProvenance':'sourceProvenance','meaning':'semanticRequirement','generic':'generic',
                 'candidates':'candidates','selection':'selection'}
    library_declarations={}
    for index,prefix in enumerate(prefixes):
        net=p.values[prefix+'/net']
        library_declarations[prefix]={'parts':{address:asdict(part) for address,part in net.parts.items()} if net else None}
        value_paths[prefix+'/net']='libraryDeclarations/'+prefix+'/parts + candidates/'+str(index+2)+'/plan'
        value_paths[prefix+'/entry']='catalog/'+str(index)
        value_paths[prefix+'/candidate']='candidates/'+str(index+2)
        for field in ('plan','trace','verification','bom','qualification'):
            value_paths[prefix+'/'+field]='candidates/'+str(index+2)+'/'+field
    return {'schema':'pxc-verified-library-choice/v1','requirement':p.values['requirement'],
            'constraints':p.values['constraints'],'catalog':p.values['catalog'],'inventory':p.values['inventory'],
            'semanticRequirement':p.values['meaning'],'sourceProvenance':p.values['sourceProvenance'],
            'generic':p.values['generic'],'candidates':p.values['candidates'],'selection':p.values['selection'],
            'libraryDeclarations':library_declarations,
            'pipeline':{'inputValues':inputs,'literalValues':literals,'declarations':{a:asdict(part) for a,part in p.parts.items()},
                        'requested':p.requested,'order':p.order,'log':p.log,'valuePaths':value_paths},
            'scope':'same complete finite Boolean value contract; label and source provenance do not establish admission'}


def replay_choice(input_values):
    names={'request/requirement','request/constraints','request/catalog','request/inventory','request/sourceFiles'}
    if type(input_values) is not dict or set(input_values)!=names:
        raise ValueError('replay requires exactly every declared request input Part')
    return choose_component(input_values['request/requirement'],input_values['request/constraints'],
                            input_values['request/catalog'],input_values['request/inventory'],input_values['request/sourceFiles'])


def instantiate_component(net,prefix,inputs,choice):
    """Connect a freshly revalidated selected graph into a caller-owned Net.

    Finite verification/BOM/equality reuse the preceding lane's Calculations.
    Lowering copies numerical NAND/wire edges only; Net supplies their local FGs.
    """
    requirement=finite.validate_requirement(choice['requirement'])
    finite.validate_inventory(choice['inventory']);constraints=finite.validate_constraints(choice['constraints'])
    selection=choice['selection']
    if selection['status']!='PASS' or not selection['selectedId']:
        raise ValueError('no qualifying selected component')
    matches=[c for c in choice['candidates'] if c['id']==selection['selectedId']]
    if len(matches)!=1:raise ValueError('selected candidate must appear exactly once')
    if len(inputs)!=len(requirement['inputs']) or any(address not in net.parts for address in inputs):
        raise ValueError('consumer must bind every input position to an existing Part')
    plan=finite.runtime_plan(matches[0]['plan'])
    verification=finite.verify(requirement,plan,finite.execute_requirement(plan,requirement))
    qualified=finite.qualify(finite.semantic(requirement,requirement['rows']),verification,
                             finite.measure_bom(plan),constraints)
    if qualified['status']!='PASS':raise ValueError('selected graph rejected: '+qualified['reason'])
    mapping={f'input/{i}':address for i,address in enumerate(inputs)}
    for index,value in plan['constants'].items():mapping[plan['addresses'][index]]=net.const(value)
    for ci in plan['plan']['order']:
        calc=plan['calculations'][ci];rule=calc['rule']
        if rule.startswith('check:'):continue
        source=[mapping[plan['addresses'][i]] for i in calc['inputs']]
        old=plan['addresses'][calc['output']];address=prefix+'/'+old
        if rule=='nand':mapping[old]=net.nand(address,*source)
        elif rule=='wire':mapping[old]=net.wire(address,*source)
        else:raise ValueError('selected graph uses a primitive outside its inventory')
    outputs=[mapping[plan['busAddresses'][name][0]] for name in requirement['outputs']]
    net.group(prefix,'VERIFIED_COMPONENT',inputs,outputs)
    return outputs


def build_evidence():
    requirement=json.loads((HERE/'requirements.json').read_text())['fullAdder']
    report=choose_component(requirement,{'maxNand':20})
    assert report['selection']['selectedId']=='library/checkpoint-full-adder'
    counts={c['id']:c['bom']['nand'] for c in report['candidates']}
    assert counts=={'generic/sum-of-products':49,'generic/shannon':25,
                   'library/checkpoint-full-adder':15,'library/wrong-full-adder':0}
    small=choose_component(requirement,{'maxNand':14})
    assert small['selection']['status']=='FAIL'
    wrong=next(c for c in report['candidates'] if c['id']=='library/wrong-full-adder')
    assert wrong['verification']['status']=='FAIL' and wrong['verification']['primitiveFailures']==0
    original=json.loads((HERE/'verification.json').read_text())
    predecessor_bytes_preserved=sha256((HERE/'evidence.json').read_bytes()).hexdigest()==original['artifactSha256']['evidence.json']
    assert predecessor_bytes_preserved
    return {'schema':'pxc-verified-library-evidence/v1','report':report,
            'summary':{'status':'PASS','bound':20,'nandCounts':counts,'selectedId':report['selection']['selectedId'],
                       'sameBehaviorHash':next(c for c in report['candidates'] if c['id']==report['selection']['selectedId'])['verification']['semantic']['hash'],
                       'wrongSameLabelRejected':True,'lowerBound14RejectsEveryCandidate':True,
                       'predecessorEvidenceBytesPreserved':predecessor_bytes_preserved},
            'bound14':small['selection'],
            'preservedFailure':{'case':'empty catalog','actual':'KeyError: meaning',
                'because':'the report requested the meaning value but only catalog qualification made it reachable',
                'correction':'seek the displayed meaning Part explicitly, including when no library entries exist'},
            'lesson':{'sam':'Get the math right once and test it; Parts and Calculations make it durable.',
                      'hypothesis':'An existing component can earn reuse through the same finite behavior contract as a generated component.',
                      'observation':'The preceding 15-NAND full adder qualifies under a 20-NAND bound; the two generic constructors do not.',
                      'counterexample':'The wrong candidate shares the full adder display label and has fewer gates, but fails literal behavior.',
                      'because':'Identity, a cheap BOM, and locally correct wires do not establish the requested relationship.',
                      'try':'Execute the complete requirement and its input-bound trace audit before admitting a catalog component.'},
            'sourceProvenance':source_provenance(SOURCE_FILES),
            'limitations':['Only two explicitly local library builders are supported; this is not a general plugin system.',
                           'Admission establishes the declared finite value contract, not physical timing or arbitrary program equivalence.',
                           'Selection is minimum among supplied verified candidates, not proof of a global circuit minimum.']}


if __name__=='__main__':
    result=build_evidence();target=HERE/'library-evidence.json'
    command=[sys.executable,'-m','unittest','discover','-s',str(HERE),'-p','test_library.py','-v']
    test=subprocess.run(command,capture_output=True,text=True)
    result['verification']={'command':command,'exitCode':test.returncode,'stdout':test.stdout,'stderr':test.stderr,
                            'testSourceSha256':sha256((HERE/'test_library.py').read_bytes()).hexdigest()}
    if test.returncode:
        raise RuntimeError(test.stderr)
    target.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result['summary'],indent=2))
