"""Complete finite requirements -> independent constructions -> NAND graph -> FGs.

Construction is an executed higher-order Calculation. Runtime values come only
from the existing PxC NAND/wire engine. No full-adder/mux/decoder special cases.
"""
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
from itertools import product
import json
from pathlib import Path
import re
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import Net, compile_net, execute_plan, audit_trace
from circuits import not_, mux, reduce_gate
from pipeline import Pipeline

STRATEGIES = ('sum-of-products', 'shannon')
INVENTORY = {'primitives': [{'op':'nand', 'arity':2, 'truthTable':[1,1,1,0]}],
             'constants':[0,1], 'wire':True}
DEFAULT_CONSTRAINTS = {'maxNand':10000}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def validate_requirement(value):
    if type(value) is not dict or set(value) != {'name','inputs','outputs','rows'}:
        raise ValueError('requirement needs exactly name, inputs, outputs, rows')
    if type(value['name']) is not str or not value['name']:
        raise ValueError('name must be nonempty display text')
    for field, lower, upper in [('inputs',1,5),('outputs',1,32)]:
        labels=value[field]
        if (type(labels) is not list or not lower<=len(labels)<=upper or
                any(type(x) is not str or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*',x) for x in labels) or
                len(labels)!=len(set(labels))):
            raise ValueError(f'{field} need {lower}..{upper} unique simple port labels')
    domain=list(product((0,1),repeat=len(value['inputs'])))
    if type(value['rows']) is not list or len(value['rows'])!=len(domain):
        raise ValueError('rows must cover the complete finite domain exactly once')
    rows={}
    for row in value['rows']:
        if type(row) is not dict or set(row)!={'inputs','outputs'}:
            raise ValueError('each row needs exactly inputs and outputs')
        for field in ('inputs','outputs'):
            bits=row[field]
            if (type(bits) is not list or len(bits)!=len(value[field]) or
                    any(type(v) is not int or v not in (0,1) for v in bits)):
                raise ValueError(f'row {field} must match its declared width using integer bits')
        key=tuple(row['inputs'])
        if key in rows:
            raise ValueError('duplicate input row; every domain row must appear once')
        rows[key]=deepcopy(row)
    if set(rows)!=set(domain):
        raise ValueError('missing finite domain row')
    return dict(name=value['name'],inputs=list(value['inputs']),outputs=list(value['outputs']),
                rows=[rows[key] for key in domain])


def validate_inventory(value):
    if canonical(value)!=canonical(INVENTORY):
        raise ValueError('supported inventory is literal two-input NAND, constants 0/1, and wires')
    return deepcopy(value)


def validate_constraints(value):
    if (type(value) is not dict or set(value)!={'maxNand'} or
            type(value['maxNand']) is not int or not 0<=value['maxNand']<=10000):
        raise ValueError('constraint maxNand must be an integer from 0 through 10000 (inclusive)')
    return dict(value)


def semantic(requirement, rows):
    # Labels can change. Positional input/output roles and every output bit cannot.
    payload={'model':'complete-finite-boolean-combinational-v1',
             'inputCount':len(requirement['inputs']),'outputCount':len(requirement['outputs']),
             'portBinding':'ordered positions; display labels excluded', 'rows':rows}
    encoded=canonical(payload)
    return {'canonical':encoded,'hash':sha256(encoded.encode('utf-8')).hexdigest(),
            'scope':'all declared input combinations and ordered output bits; no physical timing claim'}


def construct(requirement, inventory, strategy):
    requirement=validate_requirement(requirement); validate_inventory(inventory)
    if strategy not in STRATEGIES:
        raise ValueError('unknown construction strategy')
    net=Net(requirement['name']+' / '+strategy)
    inputs=[net.input('input/'+str(i)) for i in range(len(requirement['inputs']))]
    inverses={}
    def inverse(source):
        if source not in inverses:
            inverses[source]=not_(net,'invert/'+str(len(inverses)),source)
        return inverses[source]
    if strategy=='sum-of-products':
        # Each positive row is a minterm: all its literals must hold. Outputs OR
        # their minterms. Shared rows and inverted literals are actual shared DAG nodes.
        terms={}
        def term(bits):
            key=tuple(bits)
            if key not in terms:
                literals=[source if value else inverse(source) for source,value in zip(inputs,bits)]
                terms[key]=reduce_gate(net,'minterm/'+''.join(map(str,bits)),literals,'AND')
            return terms[key]
        outputs=[]
        for oi in range(len(requirement['outputs'])):
            positive=[row for row in requirement['rows'] if row['outputs'][oi]]
            if not positive:
                value=net.const(0)
            elif len(positive)==len(requirement['rows']):
                value=net.const(1)
            else:
                value=reduce_gate(net,'sum/'+str(oi),[term(row['inputs']) for row in positive],'OR')
            outputs.append(value)
    else:
        # Shannon expansion: f = mux(f when x=0, f when x=1, x).
        # Equal cofactors share a node. This is independent of minterm construction.
        memo={}; serial=0
        def split(index, values):
            nonlocal serial
            key=(index,values)
            if key in memo:
                return memo[key]
            if len(set(values))==1:
                value=net.const(values[0])
            else:
                half=len(values)//2
                low,high=split(index+1,values[:half]),split(index+1,values[half:])
                if low==high:
                    value=low
                elif low==net.const(0) and high==net.const(1):
                    value=inputs[index]
                elif low==net.const(1) and high==net.const(0):
                    value=inverse(inputs[index])
                else:
                    name='split/'+str(serial); serial+=1
                    value=mux(net,name,low,high,inputs[index])
            memo[key]=value
            return value
        outputs=[split(0,tuple(row['outputs'][oi] for row in requirement['rows']))
                 for oi in range(len(requirement['outputs']))]
    boundary=[net.wire('output/'+str(i),value) for i,value in enumerate(outputs)]
    for label,address in zip(requirement['outputs'],boundary):
        net.bus(label,[address])
    net.group('component','FINITE_COMPOSITION',inputs,boundary)
    return net


def compile_component(net):
    # Only required output closure contributes to the runtime graph and BOM.
    return compile_net(net,[address for bus in net.buses.values() for address in bus])


def runtime_plan(plan):
    """JSON object keys are strings. Restore only constant indices; check aliases.

    Numerical dependency indices are authoritative. Readable address fields must
    describe those same indices, or compilation/inspection could disagree.
    """
    plan=deepcopy(plan)
    plan['constants']={int(i):value for i,value in plan['constants'].items()}
    addresses=plan['addresses']
    if len(addresses)!=len(set(addresses)):
        raise ValueError('plan binding contains duplicate addresses')
    for ci,calc in enumerate(plan['calculations']):
        if (calc['index']!=ci or calc['inputAddresses']!=[addresses[i] for i in calc['inputs']] or
                calc['outputAddress']!=addresses[calc['output']]):
            raise ValueError('plan binding disagrees between numerical and named dependencies')
        if calc['rule'] not in ('nand','wire','check:nand','check:wire'):
            raise ValueError('plan contains a primitive outside the declared finite inventory')
    if plan['busAddresses']!={name:[addresses[i] for i in indices] for name,indices in plan['buses'].items()}:
        raise ValueError('plan binding disagrees between numerical and named output buses')
    return plan


def execute_requirement(plan, requirement):
    plan=runtime_plan(plan)
    stimuli=[{'input/'+str(i):v for i,v in enumerate(row['inputs'])} for row in requirement['rows']]
    return execute_plan(plan,len(stimuli)-1,stimuli)


def verify(requirement, plan, trace):
    plan=runtime_plan(plan); trace=runtime_plan(trace)
    mismatches=[]; observed=[]; primitive_failures=0; domain_bound=True
    expected_stimuli=[{'input/'+str(i):value for i,value in enumerate(row['inputs'])}
                       for row in requirement['rows']]
    audit=audit_trace(trace,plan,len(requirement['rows'])-1,expected_stimuli)
    if len(trace['states'])!=len(requirement['rows']):
        mismatches.append({'kind':'domain-closure','expected':len(requirement['rows']), 'actual':len(trace['states'])})
    for t,(row,state) in enumerate(zip(requirement['rows'],trace['states'])):
        for position,expected in enumerate(row['inputs']):
            address='input/'+str(position)
            index=plan['addresses'].index(address)
            # Unused inputs have no execution obligation; they cannot influence outputs.
            if index in plan['inputs'] and state['values'][index]!=expected:
                domain_bound=False
                mismatches.append({'kind':'input-binding','t':t,'address':address,
                                   'expected':expected,'actual':state['values'][index]})
        for index,expected in plan['constants'].items():
            if state['values'][index]!=expected:
                domain_bound=False
                mismatches.append({'kind':'constant-binding','t':t,'address':plan['addresses'][index],
                                   'expected':expected,'actual':state['values'][index]})
        actual=[state['values'][plan['buses'][label][0]] for label in requirement['outputs']]
        observed.append({'inputs':list(row['inputs']), 'outputs':actual})
        primitive_failures+=state['fg']['failed']
        for oi,(expected,value) in enumerate(zip(row['outputs'],actual)):
            if value!=expected:
                mismatches.append({'kind':'output-value','t':t,'inputs':row['inputs'],
                    'outputPosition':oi,'output':requirement['outputs'][oi],
                    'address':plan['busAddresses'][requirement['outputs'][oi]][0],
                    'expected':expected,'actual':value})
    valid_domain=(domain_bound and len(observed)==len(requirement['rows']) and
                  all(type(v) is int and v in (0,1) for row in observed for v in row['outputs']))
    loss=len(mismatches)+primitive_failures+audit['loss']
    return {'status':'PASS' if loss==0 else 'FAIL','loss':loss,'rows':observed,
            'mismatches':mismatches,'primitiveFailures':primitive_failures,'audit':audit,
            'semantic':semantic(requirement,observed) if valid_domain else None,
            'rowStateBinding':'row index is logical state t; each row supplies a new complete input vector'}


def measure_bom(plan):
    # Derive from compiled executable graph, never the strategy's claimed size.
    counts={key:0 for key in ('nand','wire','delay','validators')}
    for calc in plan['calculations']:
        rule=calc['rule']
        if rule.startswith('check:'): counts['validators']+=1
        else: counts[rule]+=1
    if counts!=plan['bom']:
        raise ValueError('compiled BOM disagrees with declared primitive graph')
    return counts


def qualify(requirement_meaning, verification, bom, constraints):
    behavior=(verification['status']=='PASS' and verification['semantic'] is not None and
              verification['semantic']['hash']==requirement_meaning['hash'] and
              verification['semantic']['canonical']==requirement_meaning['canonical'])
    size=bom['nand']<=constraints['maxNand']
    reasons=[]
    if not behavior: reasons.append('measured complete behavior or its verification differs from the requirement')
    if not size: reasons.append(f"measured NAND count {bom['nand']} exceeds inclusive bound {constraints['maxNand']}")
    return {'status':'PASS' if behavior and size else 'FAIL','behavior':behavior,'size':size,
            'loss':int(not behavior)+max(0,bom['nand']-constraints['maxNand']),
            'reason':'qualifies' if not reasons else 'rejected because '+'; '.join(reasons),
            'try':None if not reasons else ('inspect the first output counterexample' if not behavior else
                'raise the declared bound or add another independently verified construction strategy')}


def choose(strategies, boms, qualifications):
    qualifying=[strategy for strategy,q in zip(strategies,qualifications) if q['status']=='PASS']
    rejected=[{'strategy':s,**q} for s,q in zip(strategies,qualifications) if q['status']!='PASS']
    selected=min(qualifying,key=lambda s:(boms[strategies.index(s)]['nand'],s)) if qualifying else None
    return {'status':'PASS' if selected else 'FAIL','selectedStrategy':selected,
            'qualifying':qualifying,'rejected':rejected,
            'reason':('selected the qualifying construction with the lowest measured NAND count; alphabetical tie-break'
                      if selected else 'no composition selected because both constructed candidates failed declared obligations'),
            'try':None if selected else 'inspect each retained candidate; change the constraint or extend the constructor inventory',
            'optimality':'minimum among these two candidates only; global minimum is not claimed'}


def compose(requirement, constraints=None, inventory=None):
    p=Pipeline()
    inputs={'request/requirement':deepcopy(requirement),
            'request/inventory':deepcopy(INVENTORY if inventory is None else inventory),
            'request/constraints':deepcopy(DEFAULT_CONSTRAINTS if constraints is None else constraints),
            'request/strategies':list(STRATEGIES)}
    for address,value in inputs.items(): p.input(address,value)
    p.declare('requirement','validate-complete-requirement',['request/requirement'],validate_requirement)
    p.declare('inventory','validate-primitive-inventory',['request/inventory'],validate_inventory)
    p.declare('constraints','validate-component-bound',['request/constraints'],validate_constraints)
    p.declare('meaning','canonical-finite-meaning',['requirement'],lambda r:semantic(r,r['rows']))
    fg_roots=[]
    for strategy in STRATEGIES:
        prefix='candidate/'+strategy
        p.input(prefix+'/strategy',strategy)
        p.declare(prefix+'/net','construct-finite-requirement',
                  ['requirement','inventory',prefix+'/strategy'],construct)
        p.declare(prefix+'/plan','compile-fg-closure',[prefix+'/net'],compile_component)
        p.declare(prefix+'/trace','execute-complete-domain',[prefix+'/plan','requirement'],execute_requirement)
        p.declare(prefix+'/verification','compare-literal-rows-and-replay',
                  ['requirement',prefix+'/plan',prefix+'/trace'],verify)
        p.declare(prefix+'/bom','measure-compiled-graph',[prefix+'/plan'],measure_bom)
        p.declare(prefix+'/qualification','validate-behavior-and-bound',
                  ['meaning',prefix+'/verification',prefix+'/bom','constraints'],qualify)
        p.guarantee(prefix+'/fg/behavior','requirement',prefix+'/trace',[prefix+'/verification/calc'])
        p.guarantee(prefix+'/fg/qualification','meaning',prefix+'/plan',[prefix+'/qualification/calc'])
        fg_roots.extend([prefix+'/fg/behavior',prefix+'/fg/qualification'])
    p.declare('selection','compare-qualified-candidates',
              ['request/strategies',*[f'candidate/{s}/bom' for s in STRATEGIES],
               *[f'candidate/{s}/qualification' for s in STRATEGIES]],
              lambda strategies,bom_a,bom_b,q_a,q_b:choose(strategies,[bom_a,bom_b],[q_a,q_b]))
    p.guarantee('fg/composition','requirement','selection',['selection/calc'])
    p.seek([*fg_roots,'fg/composition'])
    candidates=[]
    value_paths={'requirement':'requirement','inventory':'inventory','constraints':'constraints',
                 'meaning':'semanticRequirement','selection':'selection'}
    for i,strategy in enumerate(STRATEGIES):
        prefix='candidate/'+strategy
        candidate={'strategy':strategy}
        for field in ('plan','trace','verification','bom','qualification'):
            candidate[field]=p.values[prefix+'/'+field]
            value_paths[prefix+'/'+field]=f'candidates/{i}/{field}'
        net=p.values[prefix+'/net']
        candidate['declarations']={a:asdict(part) for a,part in net.parts.items()}
        candidate['declaredPrimitiveCounts']={rule:sum(c.rule==rule for c in net.producers.values())
                                              for rule in ('nand','wire')}
        value_paths[prefix+'/net']=f'candidates/{i}/declarations + plan'
        candidates.append(candidate)
    return {'schema':'pxc-composition-lane/v1','requirement':p.values['requirement'],
            'inventory':p.values['inventory'],'constraints':p.values['constraints'],
            'semanticRequirement':p.values['meaning'],'candidates':candidates,'selection':p.values['selection'],
            'pipeline':{'inputValues':inputs,'declarations':{a:asdict(part) for a,part in p.parts.items()},
                        'requested':p.requested,'order':p.order,'log':p.log,'valuePaths':value_paths,
                        'literalValues':{f'candidate/{s}/strategy':s for s in STRATEGIES}},
            'limits':['Complete finite Boolean combinational functions with 1..5 inputs and 1..32 outputs.',
                      'Two independent construction algorithms share the same primitive evaluator and literal validation engine.',
                      'Physical timing, transistor mapping, global minimality and arbitrary program equivalence are outside this contract.',
                      'Replay creates a new Pipeline; no mutation of an already evaluated pipeline is required.']}


def replay(input_values):
    required={'request/requirement','request/inventory','request/constraints','request/strategies'}
    if type(input_values) is not dict or set(input_values)!=required:
        raise ValueError('replay needs exactly every declared request input Part')
    if input_values['request/strategies']!=list(STRATEGIES):
        raise ValueError('replay supports the two declared construction strategies')
    return compose(input_values['request/requirement'],input_values['request/constraints'],input_values['request/inventory'])


def instantiate(net, prefix, inputs, report):
    """Revalidate selected actual graph, then lower it into a consuming Net.

    Inputs/outputs bind by declared position. This rejects a modified candidate
    carrying a stale PASS or fingerprint. New primitives receive fresh local FGs.
    """
    requirement=validate_requirement(report['requirement'])
    validate_inventory(report['inventory']); constraints=validate_constraints(report['constraints'])
    strategy=report['selection']['selectedStrategy']
    if report['selection']['status']!='PASS' or strategy not in STRATEGIES:
        raise ValueError('cannot instantiate: no qualifying selected candidate')
    if len(inputs)!=len(requirement['inputs']) or any(a not in net.parts for a in inputs):
        raise ValueError('consumer inputs must bind every declared input position to an existing Part')
    matches=[c for c in report['candidates'] if c['strategy']==strategy]
    if len(matches)!=1:
        raise ValueError('selected candidate must appear exactly once')
    plan=runtime_plan(matches[0]['plan'])
    verified=verify(requirement,plan,execute_requirement(plan,requirement))
    qualification=qualify(semantic(requirement,requirement['rows']),verified,measure_bom(plan),constraints)
    if qualification['status']!='PASS':
        raise ValueError('cannot instantiate: '+qualification['reason'])
    # Copy only value-producing primitives. Existing validator metadata cannot
    # smuggle behavior in: Net recreates each primitive's local validator.
    mapping={f'input/{i}':address for i,address in enumerate(inputs)}
    for index,value in plan['constants'].items():
        mapping[plan['addresses'][int(index)]]=net.const(value)
    for ci in plan['plan']['order']:
        calc=plan['calculations'][ci]
        if calc['rule'].startswith('check:'):
            continue
        args=[mapping[plan['addresses'][i]] for i in calc['inputs']]
        address=prefix+'/'+plan['addresses'][calc['output']]
        if calc['rule']=='nand': mapping[calc['outputAddress']]=net.nand(address,*args)
        elif calc['rule']=='wire': mapping[calc['outputAddress']]=net.wire(address,*args)
        else: raise ValueError('finite candidate contains a non-inventory primitive')
    outputs=[mapping[plan['busAddresses'][label][0]] for label in requirement['outputs']]
    net.group(prefix,'FINITE_COMPOSITION',inputs,outputs)
    return outputs
