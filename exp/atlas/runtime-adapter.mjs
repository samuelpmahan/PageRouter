import {Part,PxC} from '../../vendor/hh/services/pxc.mjs';
import {canonical,clone,calculationRegistry} from './calculations.mjs';

const KERNEL={file:'vendor/hh/services/pxc.mjs',export:'PxC.compose'};
const ADAPTER={file:'exp/atlas/runtime-adapter.mjs',export:'AtlasRuntime.execute',revision:1};
function address(value){
  if(typeof value!=='string'||!value.startsWith('/')||value==='/'||value.endsWith('/')||value.split('/').slice(1).some(item=>!item||item==='.'||item==='..')||/[\u0000-\u001f\\]/.test(value))throw new TypeError(`noncanonical Part address ${String(value)}`);
  return value;
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export function compileRecipe(recipe,registry,seedAddresses=[]){
  if(!recipe||!Array.isArray(recipe.nodes)||!recipe.outputs||typeof recipe.outputs!=='object'||Array.isArray(recipe.outputs))throw new TypeError('recipe requires nodes[] and outputs{}');
  const seeds=new Set(seedAddresses.map(address)),ids=new Map(),owners=new Map();
  const nodes=recipe.nodes.map(node=>{
    if(!node||typeof node.id!=='string'||!node.id||ids.has(node.id))throw new TypeError('missing or duplicate node id');
    if(!Object.hasOwn(registry,node.calculation)||typeof registry[node.calculation]!=='function')throw new TypeError(`unknown calculation ${String(node.calculation)}`);
    if(!Array.isArray(node.inputs)||node.inputs.length!==2)throw new TypeError('exactly two input addresses required');
    const entry={id:node.id,calculation:node.calculation,inputs:node.inputs.map(address),output:address(node.output)};
    if(seeds.has(entry.output)||owners.has(entry.output)||entry.output.startsWith('/calculations/')||entry.output.startsWith('/implementations/')||entry.output==='/atlas/recipe'||entry.output.startsWith('/compositions/'))throw new TypeError('occupied or reserved output address');
    ids.set(entry.id,entry);owners.set(entry.output,entry.id);return entry;
  });
  const outputs=Object.create(null);
  for(const [name,value]of Object.entries(recipe.outputs)){
    if(!name)throw new TypeError('empty output name');const path=address(value);
    if(!seeds.has(path)&&!owners.has(path))throw new TypeError(`missing output ${path}`);outputs[name]=path;
  }
  const dependencies=new Map(nodes.map(node=>[node.id,new Set()])),consumers=new Map(nodes.map(node=>[node.id,new Set()]));
  for(const node of nodes)for(const path of node.inputs){const owner=owners.get(path);if(owner){dependencies.get(node.id).add(owner);consumers.get(owner).add(node.id);}else if(!seeds.has(path))throw new TypeError(`missing input ${path}`);}
  const ready=nodes.filter(node=>dependencies.get(node.id).size===0).map(node=>node.id).sort(),order=[];
  while(ready.length){const id=ready.shift();order.push(ids.get(id));for(const consumer of [...consumers.get(id)].sort()){dependencies.get(consumer).delete(id);if(!dependencies.get(consumer).size){ready.push(consumer);ready.sort();}}}
  if(order.length!==nodes.length)throw new TypeError('recipe contains a dependency cycle');
  return {order,outputs};
}

// Shared syntax/graph preflight; no registered Calculation body is invoked here.
export function preflightRecipe(recipe,sourceValues,registry){
  const sources=clone(sourceValues),safeRecipe=clone(recipe);
  if(!sources||typeof sources!=='object'||Array.isArray(sources))throw new TypeError('sources must be an address/value object');
  const compiled=compileRecipe(safeRecipe,registry,Object.keys(sources));
  for(const path of Object.keys(sources))if(path.startsWith('/calculations/')||path.startsWith('/implementations/')||path.startsWith('/compositions/')||path==='/atlas/recipe')throw new TypeError('seed uses a reserved adapter namespace');
  return {sources,recipe:safeRecipe,compiled};
}

// One persistent adapter cache; one fresh real HH PxC address space per graph evaluation.
// HH's immutable occupied addresses require a new namespace when a recipe grows or seeds change.
// Every graph output is nevertheless produced by HH PxC.compose with actual Part references.
export class AtlasRuntime {
  constructor(registry=calculationRegistry(),{implementationIdentity=null}={}){
    this.implementationIdentity=implementationIdentity===null?null:freeze(clone(implementationIdentity));
    this.registry={...registry};this.cache=new Map();this.compositionCache=new Map();this.functionIds=new WeakMap();this.nextFunctionId=1;this.last=null;this.kernelParts=[];this.running=false;
    this.stats={body_executions:0,cache_hits:0,composition_body_executions:0,composition_cache_hits:0};
  }
  reference(file,exportName){
    const digest=this.implementationIdentity?.files?.[file]?.sha256;
    if(digest!==undefined&&!/^[a-f0-9]{64}$/.test(digest))throw new TypeError('invalid implementation source digest');
    return {file,...(exportName?{export:exportName}:{}),revision:1,identity_address:'/implementations/source',...(digest?{source_digest:digest}:{identity_status:'unbound-local'})};
  }
  functionIdentity(fn){if(!this.functionIds.has(fn))this.functionIds.set(fn,this.nextFunctionId++);return this.functionIds.get(fn);}
  plan(recipe,sourceValues){
    const {sources,compiled}=preflightRecipe(recipe,sourceValues,this.registry);
    return clone({order:compiled.order,bindings:compiled.order.map(node=>({node_id:node.id,calculation:node.calculation,calculation_address:'/calculations/'+node.calculation,input_bindings:{left:node.inputs[0],right:node.inputs[1]},output_address:node.output,implementation:this.reference('exp/atlas/calculations.mjs',node.calculation)})),outputs:compiled.outputs,source_addresses:Object.keys(sources).sort()});
  }
  async execute(recipe,sourceValues,{plan=null}={}){
    if(this.running)throw new Error('AtlasRuntime executes one graph at a time');
    this.running=true;
    try{return await this.evaluate(recipe,sourceValues,plan);}finally{this.running=false;}
  }
  async evaluate(recipe,sourceValues,plan=null){
    // Full graph and finite JSON validation occurs before any Calculation body executes.
    const {sources,recipe:safeRecipe,compiled}=preflightRecipe(recipe,sourceValues,this.registry);
    const authoritativePlan=this.plan(safeRecipe,sources),selectedPlan=plan===null?authoritativePlan:clone(plan);
    if(canonical(selectedPlan)!==canonical(authoritativePlan))throw new TypeError('execution plan does not match authoritative fixed Calculation bindings');
    const adapterIdentity=this.reference(ADAPTER.file,ADAPTER.export),kernelIdentity=this.reference(KERNEL.file,KERNEL.export),calculationImplementation=name=>this.reference('exp/atlas/calculations.mjs',name);
    const kernel=new PxC(),parts={},trace=[],wrapperState={current:null};
    const addSource=(path,value,producer={kind:'ingest',implementation:{...adapterIdentity,export:'AtlasRuntime.evaluate.ingest'}})=>{
      kernel.set(path,new Part(freeze(clone(value))));parts[path]={address:path,value:clone(value),inputs:[],producer};
    };
    for(const [path,value]of Object.entries(sources))addSource(path,value);
    addSource('/atlas/recipe',safeRecipe);
    addSource('/implementations/source',this.implementationIdentity??{status:'unbound-local',claim:'No build source identity supplied; local file references are not cryptographic identities.'},{kind:'implementation_identity',implementation:adapterIdentity});
    addSource('/implementations/kernel',kernelIdentity,{kind:'implementation',implementation:kernelIdentity});
    addSource('/implementations/adapter',adapterIdentity,{kind:'implementation',implementation:adapterIdentity});
    addSource('/implementations/calculations',{...this.reference('exp/atlas/calculations.mjs'),exports:Object.keys(this.registry).sort()},{kind:'implementation',implementation:this.reference('exp/atlas/calculations.mjs')});
    for(const [name,fn]of Object.entries(this.registry)){
      const path='/calculations/'+name,identity=this.functionIdentity(fn),impl=calculationImplementation(name);
      const wrapped=({left,right})=>{
        const node=wrapperState.current;
        const key=canonical({calculation:name,function_identity:identity,implementation:impl,input_addresses:node.inputs,arguments:[left,right]});
        const hit=this.cache.has(key);node.cache_hit=hit;
        let value;
        if(hit){value=clone(this.cache.get(key));this.stats.cache_hits++;}
        else {this.stats.body_executions++;value=clone(fn(clone(left),clone(right)));this.cache.set(key,clone(value));}
        // Adapter provenance annotations are per-call metadata, not additional algorithm execution.
        if(name==='evaluate_program'){
          value.program_address=node.inputs[0];value.prediction_address=node.output;
          value.producer=clone(node.producer);
        }
        if(name==='retain_counterexample'&&value!==null){
          const prediction=right.predictions;
          value.program_address=prediction.program_address;value.prediction_address=prediction.prediction_address;value.producer=clone(prediction.producer);
        }
        return freeze(value);
      };
      kernel.set(path,new Part(wrapped));
      parts[path]={address:path,value:{kind:'calculation',implementation:impl,function_identity:identity},inputs:['/implementations/calculations','/implementations/adapter'],producer:{kind:'registered_calculation',implementation:impl,adapter:adapterIdentity}};
    }
    try{
    for(const [index,node] of selectedPlan.order.entries()){
      const producer={kind:'calculation',node_id:node.id,calculation:node.calculation,implementation:calculationImplementation(node.calculation),input_addresses:[...node.inputs],output_address:node.output,kernel:kernelIdentity,adapter:adapterIdentity};
      wrapperState.current={...node,producer,cache_hit:false};
      const binding=selectedPlan.bindings[index];
      const entry={node_id:node.id,calculation:node.calculation,input_addresses:[...node.inputs],output_address:node.output,implementation:calculationImplementation(node.calculation),cache_hit:false,status:'pending'};
      trace.push(entry);let output;
      try{output=await kernel.compose({into:binding.output_address,calculation:binding.calculation_address,inputs:binding.input_bindings});entry.status='produced';}
      catch(error){entry.status='failed';entry.error={name:error?.name??'Error',message:String(error?.message??error)};throw error;}
      finally{entry.cache_hit=wrapperState.current.cache_hit;}
      parts[node.output]={address:node.output,value:clone(output.value),inputs:[...node.inputs,'/calculations/'+node.calculation],producer};
    }
    // The durable final graph directly contains every data/calculation/implementation/recipe Part.
    const compositionCalculation='/calculations/atlas_composition';
    parts[compositionCalculation]={address:compositionCalculation,value:{kind:'calculation',implementation:adapterIdentity},inputs:['/implementations/adapter','/implementations/kernel'],producer:{kind:'registered_calculation',implementation:adapterIdentity}};
    const knownAddresses=Object.keys(parts).sort(),compositionValue={has:knownAddresses,outputs:clone(compiled.outputs),recipe_address:'/atlas/recipe'};
    const compositionKey=canonical({value:compositionValue,parts});
    const compositionHit=this.compositionCache.has(compositionKey);
    const composeBody=()=>{
      if(compositionHit){this.stats.composition_cache_hits++;return freeze(clone(this.compositionCache.get(compositionKey)));}
      this.stats.composition_body_executions++;this.compositionCache.set(compositionKey,clone(compositionValue));return freeze(clone(compositionValue));
    };
    kernel.set(compositionCalculation,new Part(composeBody));
    const compositionAddress='/compositions/current';
    const compositionOutput=await kernel.compose({into:compositionAddress,calculation:compositionCalculation,inputs:Object.fromEntries(knownAddresses.map((path,index)=>['part_'+index,path]))});
    parts[compositionAddress]={address:compositionAddress,value:clone(compositionOutput.value),inputs:knownAddresses,producer:{kind:'composition',implementation:adapterIdentity,input_addresses:knownAddresses,kernel:kernelIdentity}};
    const kernelReceipts=kernel.receipts();
    const kernelAddresses=new Map(kernel.entries().map(([path,part])=>[part,path]));
    for(const [path,part]of kernel.entries()){
      if(part.composition)parts[path].kernel_composition={calculation_address:kernelAddresses.get(part.composition.calculation),inputs:Object.fromEntries(Object.entries(part.composition.inputs).map(([name,input])=>[name,kernelAddresses.get(input)]))};
    }
    const receipt={format:'kompozed.atlas.receipt.v1',executed_count:trace.filter(row=>!row.cache_hit).length,cache_hit_count:trace.filter(row=>row.cache_hit).length,trace,kernel_receipt_count:kernelReceipts.length,composition_execution_count:compositionHit?0:1,composition_cache_hit_count:compositionHit?1:0,composition_part:compositionAddress,output_parts:clone(compiled.outputs),counts_scope:'executed_count/cache_hit_count count registered algorithm bodies; composition body counted separately. HH produces a fresh receipt on every compose, including cache reads.'};
    const outputs=Object.fromEntries(Object.entries(compiled.outputs).map(([name,path])=>[name,clone(parts[path])]));
    this.last={parts,outputs,composition_part:parts[compositionAddress],receipt,kernel_receipts:kernelReceipts.map(row=>({status:row.status,into:row.into,calculation_address:kernelAddresses.get(row.composition.calculation),input_addresses:Object.values(row.composition.inputs).map(part=>kernelAddresses.get(part))}))};
    this.kernelParts=kernel.entries();
    return clone({parts,outputs,composition_part:parts[compositionAddress],receipt});
    }catch(error){
      const kernelAddresses=new Map(kernel.entries().map(([path,part])=>[part,path]));
      for(const [path,part]of kernel.entries())if(part.composition)parts[path].kernel_composition={calculation_address:kernelAddresses.get(part.composition.calculation),inputs:Object.fromEntries(Object.entries(part.composition.inputs).map(([name,input])=>[name,kernelAddresses.get(input)]))};
      const kernelReceipts=kernel.receipts().map(row=>({status:row.status,into:row.into,calculation_address:kernelAddresses.get(row.composition.calculation),input_addresses:Object.values(row.composition.inputs).map(part=>kernelAddresses.get(part)),...(row.status==='failed'?{error:{name:row.error?.name??'Error',message:String(row.error?.message??row.error)}}:{})}));
      this.last={parts,outputs:{},composition_part:null,receipt:{format:'kompozed.atlas.receipt.v1',status:'failed',executed_count:trace.filter(row=>!row.cache_hit).length,cache_hit_count:trace.filter(row=>row.cache_hit).length,trace,kernel_receipt_count:kernelReceipts.length,error:{name:error?.name??'Error',message:String(error?.message??error)}},kernel_receipts:kernelReceipts};
      this.kernelParts=kernel.entries();
      throw error;
    }
  }
  // Borrow the immutable, actual HH Parts for a containing composition; no new execution.
  borrowKernelParts(){return Object.freeze(this.kernelParts.map(entry=>Object.freeze([...entry])));}
  inspect(){
    return clone({format:'kompozed.atlas.inspection.v1',parts:this.last?.parts??{},receipt:this.last?.receipt??null,kernel_receipts:this.last?.kernel_receipts??[],cache:{entries:this.cache.size,composition_entries:this.compositionCache.size,...this.stats},boundaries:{kernel:'Real vendor/hh/services/pxc.mjs Part and PxC.compose',adapter:'Canonical addresses, DAG preflight, fixed registry, provenance metadata and deterministic memoization are atlas-local additions. A fresh HH namespace is rebuilt per evaluation; the adapter runtime/cache persist.',identity:'Existing HH evaluator identity is unchanged. Registry memo keys also include actual in-session function identity.',producer_map:'One producer per Part; predictions/retained failures carry actual prediction producers. No duplicated per-leaf map is emitted.'}});
  }
  reset(){if(this.running)throw new Error('cannot reset while executing');this.cache.clear();this.compositionCache.clear();this.last=null;this.kernelParts=[];this.stats={body_executions:0,cache_hits:0,composition_body_executions:0,composition_cache_hits:0};}
}
