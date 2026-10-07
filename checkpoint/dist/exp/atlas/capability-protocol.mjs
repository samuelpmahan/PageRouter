import {Part,PxC} from '../../vendor/hh/services/pxc.mjs';
import {AtlasRuntime,preflightRecipe} from './runtime-adapter.mjs';
import {canonical,clone} from './calculations.mjs';

const FORMAT='kompozed.atlas.recipe.v1';
const IMPLEMENTATION='exp/atlas/capability-protocol.mjs';
const RUNGS=['parse','validate','interpret','execute'];
const PREVIOUS={validate:'parse',interpret:'validate',execute:'interpret'};
const IMPLEMENTATION_INPUTS={source:'/protocol/implementations/source',protocol:'/protocol/implementations/protocol',kernel:'/protocol/implementations/kernel',domain:'/protocol/implementations/domain'};
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));}
// Accept only lossless finite JSON data. In particular, never invoke caller accessors.
function finiteCopy(value,seen=new Set()){
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError('JSON numbers must be finite');return value;}
  if(!Array.isArray(value)&&!plain(value))throw new TypeError('input must contain only finite JSON data');
  if(seen.has(value))throw new TypeError('cyclic input is not JSON');
  if(Object.getOwnPropertySymbols(value).length)throw new TypeError('symbol properties are not JSON');
  seen.add(value);
  try{
    if(Array.isArray(value)){
      if(Object.keys(value).length!==value.length)throw new TypeError('sparse or extended arrays are not JSON');
      return Array.from({length:value.length},(_,index)=>{
        const descriptor=Object.getOwnPropertyDescriptor(value,String(index));
        if(!descriptor||!Object.hasOwn(descriptor,'value'))throw new TypeError('accessors are not JSON');
        return finiteCopy(descriptor.value,seen);
      });
    }
    return Object.fromEntries(Object.getOwnPropertyNames(value).map(key=>{
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError('accessors or hidden properties are not JSON');
      return [key,finiteCopy(descriptor.value,seen)];
    }));
  }finally{seen.delete(value);}
}
function errorRecord(error,code){return {code,name:typeof error?.name==='string'?error.name:'Error',message:typeof error?.message==='string'?error.message:String(error)};}
function failure(rung,error,code,extra={}){return {rung,status:'failed',ok:false,error:errorRecord(error,code),...extra};}
function success(rung,value){return {rung,status:'ok',ok:true,...value};}

// Four concrete, fixed capabilities over the existing Atlas recipe envelope.
// No universal semantic meanings, imported code, registry selection, or arbitrary evaluator.
export function createCapabilityProtocol({implementationIdentity=null}={}){
  const identity=freeze(finiteCopy(implementationIdentity));
  const runtime=new AtlasRuntime(undefined,{implementationIdentity:identity});
  const handles=new WeakMap();let epoch=0,busy=false,kernel,parts,partAddresses,sequence,counts,last;
  const reference=(file,exportName)=>({...runtime.reference(file,exportName),identity_address:IMPLEMENTATION_INPUTS.source});
  const capabilityReference=name=>({...reference(IMPLEMENTATION,'createCapabilityProtocol'),capability:name});
  const implementation=reference(IMPLEMENTATION,'createCapabilityProtocol');
  const kernelIdentity=reference('vendor/hh/services/pxc.mjs','PxC.compose');
  const capabilityDescription=name=>({name,input:name==='parse'?'JSON text or recipe envelope':PREVIOUS[name]+' Part from this protocol',output:name+' Part',calculation_address:'/protocol/calculations/'+name,implementation:capabilityReference(name),scope:name==='parse'?'JSON syntax and finite-data boundary':name==='validate'?'Existing recipe, seeds, fixed registry, addresses and DAG rules':name==='interpret'?'Inspectable dependency order and fixed local Calculation bindings':'Execute the interpreted fixed plan through the existing AtlasRuntime'});
  const add=(address,value,producer)=>{
    const part=new Part(freeze(finiteCopy(value)));kernel.set(address,part);partAddresses.set(part,address);
    parts[address]={address,value:clone(value),inputs:[],producer};return address;
  };
  const priorFailure=(rung,prior,gate)=>{
    if(gate.error)return failure(rung,gate.error,gate.error.code,{skipped:true});
    if(!prior.ok)return failure(rung,new Error('previous rung did not succeed'),'PRIOR_RUNG_FAILED',{skipped:true,prior_rung:prior.rung});
    return null;
  };
  const bodies={
    parse({input}){
      try{
        if(input.error)return failure('parse',input.error,'PARSE_FAILED');
        const envelope=finiteCopy(input.kind==='text'?JSON.parse(input.value):input.value);
        return success('parse',{envelope});
      }catch(error){return failure('parse',error,'PARSE_FAILED');}
    },
    validate({prior,gate}){
      const failed=priorFailure('validate',prior,gate);if(failed)return failed;
      try{
        const envelope=prior.envelope;
        if(!plain(envelope)||envelope.format!==FORMAT||Object.keys(envelope).sort().join(',')!=='format,implementationIdentity,recipe,sources')throw new TypeError('requires the exact Atlas recipe envelope');
        if(canonical(envelope.implementationIdentity)!==canonical(identity))return failure('validate',new Error('imported implementation identity differs from the authoritative local identity'),'IMPLEMENTATION_IDENTITY_MISMATCH');
        const {compiled,sources}=preflightRecipe(envelope.recipe,envelope.sources,runtime.registry);
        return success('validate',{envelope,validation:{node_count:compiled.order.length,source_count:Object.keys(sources).length,output_count:Object.keys(compiled.outputs).length,implementation_identity_matched:true}});
      }catch(error){return failure('validate',error,'VALIDATION_FAILED');}
    },
    interpret({prior,gate}){
      const failed=priorFailure('interpret',prior,gate);if(failed)return failed;
      try{return success('interpret',{envelope:prior.envelope,plan:runtime.plan(prior.envelope.recipe,prior.envelope.sources)});}
      catch(error){return failure('interpret',error,'INTERPRETATION_FAILED');}
    },
    async execute_domain({prior,gate}){
      const failed=priorFailure('execute',prior,gate);if(failed)return failed;
      counts.domain_invocations++;
      try{
        const execution=await runtime.execute(prior.envelope.recipe,prior.envelope.sources,{plan:prior.plan});
        counts.domain_kernel_receipts+=execution.receipt.kernel_receipt_count;
        return success('execute',{execution});
      }catch(error){
        const domain=runtime.inspect();counts.domain_kernel_receipts+=domain.kernel_receipts.length;
        return failure('execute',error,'EXECUTION_FAILED',{execution_failure:{receipt:domain.receipt,kernel_receipts:domain.kernel_receipts}});
      }
    },
    execute({invocation,execution_metadata}){
      return {...invocation,...execution_metadata};
    },
    execution_failure_evidence({receipt_metadata}){
      return {...receipt_metadata,status:'failed',ok:false,rung:'execution_failure_evidence'};
    },
    run(values){
      const {stages,domain_evidence_address}=values.stage_records;
      const final=Object.values(stages).at(-1).value;
      return final.ok?success('run',{stages,execution:final.execution,domain_evidence_address}):failure('run',final.error,final.error.code,{stages,failed_rung:final.rung,domain_evidence_address});
    }
  };
  const initialize=()=>{
    kernel=new PxC();parts={};partAddresses=new Map();sequence=0;last=null;
    counts={protocol_body_executions:0,domain_invocations:0,domain_kernel_receipts:0};
    add(IMPLEMENTATION_INPUTS.source,identity??{status:'unbound-local',claim:'No build identity supplied; local file references are not cryptographic identities.'},{kind:'implementation_identity',implementation});
    add(IMPLEMENTATION_INPUTS.protocol,implementation,{kind:'implementation',implementation});
    add(IMPLEMENTATION_INPUTS.kernel,kernelIdentity,{kind:'implementation',implementation:kernelIdentity});
    add(IMPLEMENTATION_INPUTS.domain,{adapter:reference('exp/atlas/runtime-adapter.mjs','AtlasRuntime.execute'),calculations:reference('exp/atlas/calculations.mjs')},{kind:'implementation',implementation});
    for(const name of [...RUNGS,'execute_domain','execution_failure_evidence','run']){
      const address='/protocol/calculations/'+name,impl=capabilityReference(name);
      const calculate=async values=>{counts.protocol_body_executions++;return freeze(finiteCopy(await bodies[name](values)));};
      const part=new Part(calculate);kernel.set(address,part);partAddresses.set(part,address);
      parts[address]={address,value:{kind:'calculation',capability:name,implementation:impl},inputs:Object.values(IMPLEMENTATION_INPUTS),producer:{kind:'registered_capability',implementation:impl}};
    }
  };
  const ingest=(label,value)=>add('/protocol/inputs/'+(++sequence)+'/'+label,value,{kind:'ingest',implementation});
  const compose=async(name,bindings)=>{
    const address='/protocol/results/'+(++sequence)+'/'+name;
    const bound={...bindings,...IMPLEMENTATION_INPUTS};
    const output=await kernel.compose({into:address,calculation:'/protocol/calculations/'+name,inputs:bound});partAddresses.set(output,address);
    const record={address,value:clone(output.value),inputs:Object.values(bound),producer:{kind:'capability',calculation:name,implementation:capabilityReference(name),kernel:kernelIdentity,input_addresses:Object.values(bound)},kernel_composition:{calculation_address:partAddresses.get(output.composition.calculation),inputs:Object.fromEntries(Object.entries(output.composition.inputs).map(([key,part])=>[key,partAddresses.get(part)]))}};
    parts[address]=record;last=address;
    const publicPart=freeze(clone(record));handles.set(publicPart,{epoch,rung:name,address,part:output});return publicPart;
  };
  const importDomainEvidence=async()=>{
    const inspection=runtime.inspect(),prefix='/protocol/evidence/'+(++sequence),mapping=new Map(runtime.borrowKernelParts().map(([address])=>[address,prefix+address]));
    const domain_namespace={prefix,addresses:Object.fromEntries(mapping)};
    const qualify=(value,field='')=>{
      if(typeof value==='string'){
        if(field==='address'||field.endsWith('_address')||field==='composition_part'||field==='into'||field==='output_parts')return mapping.get(value)??((field==='output_address'||field==='into')&&value.startsWith('/')?prefix+value:value);
        return value;
      }
      if(Array.isArray(value))return field.endsWith('_addresses')?value.map(item=>mapping.get(item)??item):value.map(item=>qualify(item));
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,qualify(item,field==='output_parts'?'output_parts':key)]));
      return value;
    };
    for(const [address,part]of runtime.borrowKernelParts()){
      const alias=mapping.get(address);kernel.set(alias,part);partAddresses.set(part,alias);
      const record=inspection.parts[address];
      parts[alias]={...clone(record),address:alias,domain_address:address,domain_namespace,domain_producer:clone(record.producer),producer:qualify(record.producer),inputs:record.inputs.map(input=>mapping.get(input)??input),...(part.composition?{kernel_composition:{calculation_address:mapping.get(record.kernel_composition.calculation_address),inputs:Object.fromEntries(Object.entries(record.kernel_composition.inputs).map(([name,input])=>[name,mapping.get(input)]))}}:{})};
    }
    const composition=mapping.get('/compositions/current');
    if(composition)return composition;
    const receipt={summary:qualify(inspection.receipt),kernel_receipts:qualify(inspection.kernel_receipts)};
    const bindings=Object.fromEntries([...mapping.values()].map((address,index)=>['partial_part_'+index,address]));
    bindings.receipt_metadata=ingest('failed_domain_receipt',{receipt,domain_namespace,domain_provenance:inspection});
    const evidence=await compose('execution_failure_evidence',bindings);return evidence.address;
  };
  const stage=async(name,input)=>{
    if(name==='parse'){
      let snapshot;try{snapshot={kind:typeof input==='string'?'text':'envelope',value:finiteCopy(input)};}catch(error){snapshot={error:errorRecord(error,'PARSE_FAILED')};}
      return compose(name,{input:ingest('syntax',snapshot)});
    }
    const handle=input&&typeof input==='object'?handles.get(input):null;
    let error=null;
    if(!handle)error=errorRecord(new Error('prior Part is not an authentic handle from this protocol'),'HANDLE_INVALID');
    else if(handle.epoch!==epoch)error=errorRecord(new Error('prior Part belongs to a reset protocol epoch'),'HANDLE_STALE');
    else if(handle.rung!==PREVIOUS[name])error=errorRecord(new Error('prior Part is from the wrong rung'),'HANDLE_WRONG_RUNG');
    const prior=handle&&handle.epoch===epoch?handle.address:ingest('unavailable_prior',{rung:handle?.rung??null,ok:false});
    const bindings={prior,gate:ingest('handle_gate',{error})};
    if(name!=='execute')return compose(name,bindings);
    const invocation=await compose('execute_domain',bindings);
    const evidence=invocation.value.skipped?null:await importDomainEvidence();
    return compose('execute',{...bindings,invocation:invocation.address,execution_metadata:ingest('execution_evidence',{domain_evidence_address:evidence}),...(evidence?{domain_evidence:evidence}:{})});
  };
  const exclusive=async body=>{if(busy)throw new Error('capability protocol is already running');busy=true;try{return await body();}finally{busy=false;}};
  initialize();
  return {
    capabilities(){return clone(RUNGS.map(capabilityDescription));},
    parse(input){return exclusive(()=>stage('parse',input));},
    validate(part){return exclusive(()=>stage('validate',part));},
    interpret(part){return exclusive(()=>stage('interpret',part));},
    execute(part){return exclusive(()=>stage('execute',part));},
    run(input){return exclusive(async()=>{
      const stages={};let prior=input;
      for(const name of RUNGS){const part=await stage(name,prior);stages[name]=part;prior=part;if(!part.value.ok)break;}
      const bindings=Object.fromEntries(Object.entries(stages).map(([name,part])=>[name,part.address]));
      const evidence=stages.execute?.value.domain_evidence_address??null;if(evidence)bindings.domain_evidence=evidence;
      bindings.stage_records=ingest('stage_records',{stages,domain_evidence_address:evidence});
      const parent=await compose('run',bindings);
      // The actual HH run value contains stage records. Register their isolated returned copies
      // against the original internal Parts so explicit replay can accept this nested handle.
      for(const [name,part]of Object.entries(parent.value.stages))handles.set(part,handles.get(stages[name]));
      return parent;
    });},
    inspect(){
      const domain=runtime.inspect();
      return clone({format:'kompozed.atlas.capability-inspection.v1',epoch,busy,last_part:last,parts,receipts:kernel.receipts().map(row=>({status:row.status,into:row.into,value:row.output.value,calculation_address:partAddresses.get(row.composition.calculation),input_addresses:Object.values(row.composition.inputs).map(part=>partAddresses.get(part))})),counts:{...counts,protocol_kernel_receipts:kernel.receipts().length,domain_body_executions:domain.cache.body_executions,domain_cache_hits:domain.cache.cache_hits,domain_composition_body_executions:domain.cache.composition_body_executions,domain_composition_cache_hits:domain.cache.composition_cache_hits},domain,boundaries:{semantic_scope:'Four fixed Atlas capabilities over the existing recipe envelope; semantic meanings remain user-owned.',handles:'Returned immutable Parts are session/epoch handles. JSON copies are inspectable data, not stage authority.',identity:'Imported identity is compared exactly to the current local identity and never becomes evaluator authority.'}});
    },
    reset(){if(busy)throw new Error('cannot reset while capability protocol is running');runtime.reset();epoch++;initialize();}
  };
}
