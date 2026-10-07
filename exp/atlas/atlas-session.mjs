import {AtlasRuntime} from './runtime-adapter.mjs';
import {GRID,number,clone,trainingFixture,program_id,program_size} from './calculations.mjs';
export {createCapabilityProtocol} from './capability-protocol.mjs';

function node(id,calculation,left,right,output){return {id,calculation,inputs:[left,right],output};}
function bootstrap(){return {nodes:[
  node('fit','fit_motion','/parts/training','/parts/config','/models/fitted'),
  node('native_prediction','predict_motion','/models/fitted','/parts/queries','/reference/native'),
  node('reference_program','reference_program','/models/fitted','/parts/config','/programs/reference'),
  node('reference_prediction','evaluate_program','/programs/reference','/parts/queries','/reference/expression'),
  node('reference_context','reference_context','/reference/native','/parts/grid','/reference/context'),
  node('reference_crosscheck','probe_predictions','/reference/expression','/reference/context','/evidence/reference_crosscheck')
],outputs:{model:'/models/fitted',reference:'/programs/reference',crosscheck:'/evidence/reference_crosscheck'}};}
function appendRound(recipe,index,constraints){
  const base='/search/rounds/'+index;
  const specs=[
    ['generate','generate_candidates','/programs/reference',constraints,'generation'],
    ['select','select_candidate',base+'/generation','/parts/config','program'],
    ['predict','evaluate_program',base+'/program','/parts/queries','predictions'],
    ['full_probe','probe_predictions',base+'/predictions','/reference/context','probe'],
    ['comparison','comparison_context',base+'/predictions','/reference/context','comparison'],
    ['retain','retain_counterexample',base+'/probe',base+'/comparison','counterexample'],
    ['constraints','update_constraints',constraints,base+'/counterexample','constraints'],
    ['sizes','size_comparison',base+'/program','/programs/reference','sizes'],
    ['accept','accept_candidate',base+'/probe',base+'/sizes','acceptance']
  ];
  recipe.nodes.push(...specs.map(([name,calculation,left,right,out])=>node('round_'+index+'_'+name,calculation,left,right,base+'/'+out)));
  Object.assign(recipe.outputs,{acceptance:base+'/acceptance',program:base+'/program',constraints:base+'/constraints'});
  return base;
}
function finalComposition(result){return {composition_part:clone(result.composition_part),part_addresses:clone(result.composition_part.value.has),outputs:clone(result.composition_part.value.outputs)};}

export function createAtlasCompositionDefinition(options={}){
  const gain=number(options.gain??2,'gain'),bias=number(options.bias??1,'bias');
  const queries={transitions:Array.from({length:10},(_,index)=>({x:7*index-13,action:index+1}))};
  const sources={
    '/parts/training':trainingFixture(gain,bias),'/parts/config':{},'/parts/queries':queries,
    '/parts/observed':{values:queries.transitions.map(row=>row.x+2*row.action+1),tolerance:1e-9},
    '/parts/prior':{alpha:1,beta:1},'/parts/policy':{min_cases:10,min_mean:number(options.min_mean??0.8,'min_mean'),...(options.formula===undefined?{}:{formula:options.formula})},
    '/parts/specification':{expected_gain:2,expected_bias:1,tolerance:1e-9}
  };
  const recipe={nodes:[
    node('decision','probe_decision','/models/posterior','/parts/policy','/evidence/decision'),
    node('parameter_probe','probe_model','/models/fitted','/parts/specification','/evidence/parameters'),
    node('posterior','update_beta','/parts/prior','/evidence/predictions','/models/posterior'),
    node('prediction_probe','probe_predictions','/models/predicted','/parts/observed','/evidence/predictions'),
    node('predict','predict_motion','/models/fitted','/parts/queries','/models/predicted'),
    node('fit','fit_motion','/parts/training','/parts/config','/models/fitted')
  ],outputs:{decision:'/evidence/decision',parameter_probe:'/evidence/parameters',posterior:'/models/posterior',prediction_probe:'/evidence/predictions',model:'/models/fitted'}};
  return clone({format:'kompozed.atlas.recipe.v1',recipe,sources,implementationIdentity:options.implementationIdentity??null});
}
export const createSampleDefinition=createAtlasCompositionDefinition;

export function createAtlasSession({implementationIdentity=null}={}){
  const runtime=new AtlasRuntime(undefined,{implementationIdentity});let lastGraph=null,busy=false;
  const exclusive=async body=>{if(busy)throw new Error('atlas session is already running');busy=true;try{return await body();}finally{busy=false;}};
  return {
    run(options={}){return exclusive(async()=>{
      const gain=number(options.gain??2,'gain'),bias=number(options.bias??1,'bias'),tolerance=number(options.tolerance??1e-9,'tolerance');
      if(tolerance<0)throw new RangeError('tolerance must be nonnegative');
      const queries={transitions:GRID.flatMap(x=>GRID.map(action=>({x,action})))},sources={
        '/parts/training':trainingFixture(gain,bias),'/parts/config':{},'/parts/queries':queries,
        '/parts/grid':{...queries,tolerance},'/parts/initial_constraints':{counterexamples:[]}
      };
      const recipe=bootstrap(),initial=await runtime.execute(recipe,sources);
      const crosscheck=initial.outputs.crosscheck.value;
      if(crosscheck.failed)throw new Error('reference expression disagrees with native predict_motion');
      const reference=initial.outputs.reference.value,history=[],counterexample_addresses=[];
      let constraints='/parts/initial_constraints',result=initial;
      for(let index=0;index<100;index++){
        const base=appendRound(recipe,index,constraints);result=await runtime.execute(recipe,sources);
        const value=suffix=>result.parts[base+'/'+suffix].value,generation=value('generation'),program=value('program');
        const row={round:index,program,program_id:program_id(program),size_bytes:program_size(program),program_address:base+'/program',prediction_address:base+'/predictions',predictions:value('predictions'),probe_inputs:{predictions_address:base+'/predictions',reference_address:'/reference/context'},full_check:value('probe'),acceptance:value('acceptance'),counterexample_address:value('counterexample')===null?null:base+'/counterexample',counterexample:value('counterexample'),constraint_input_address:constraints,constraint_count:generation.constraint_count,considered_count:generation.considered.length,pruned_count:generation.pruned.length,receipt:result.receipt};
        history.push(row);if(row.counterexample_address)counterexample_addresses.push(row.counterexample_address);
        constraints=base+'/constraints';
        if(row.acceptance.accepted)break;
        if(index===99)throw new Error('search exceeded bounded round guard');
      }
      lastGraph={recipe:clone(recipe),sources:clone(sources)};
      return clone({format:'kompozed.atlas.expression-search.v1',status:'provisional_finite_fixture_agreement',model:initial.outputs.model.value,
        scope:{positions:[...GRID],actions:[...GRID],case_count:queries.transitions.length,tolerance,gain,bias,claim:'Agreement on this exhaustive finite grid at the declared absolute tolerance; not arbitrary-input or all-model equivalence, and not globally minimal size.'},
        metric:'Sorted-key canonical UTF-8 JSON bytes of the complete program (expression and all per-program numeric bindings), using native JavaScript JSON number encoding. Common interpreter/library cost is excluded equally. Integer-valued model bindings encode as 2/1 rather than Python 2.0/1.0.',
        reference:{program:reference,size_bytes:program_size(reference),program_address:'/programs/reference'},reference_crosscheck:crosscheck,reference_values:initial.parts['/reference/context'].value.values,bootstrap_receipt:initial.receipt,
        rounds:history,counterexample_addresses,accepted:{program:history.at(-1).program,size_bytes:history.at(-1).size_bytes,program_address:history.at(-1).program_address},
        final_composition:finalComposition(result),recipe,receipts:{bootstrap:initial.receipt,rounds:history.map(row=>row.receipt)},implementations:{calculations:'exp/atlas/calculations.mjs',adapter:'exp/atlas/runtime-adapter.mjs',session:'exp/atlas/atlas-session.mjs',kernel:'vendor/hh/services/pxc.mjs'}});
    });},
    runComposition(options={}){return exclusive(async()=>{
      const definition=createAtlasCompositionDefinition({...options,implementationIdentity:runtime.implementationIdentity}),{recipe,sources}=definition;
      const gain=options.gain??2,bias=options.bias??1;
      const result=await runtime.execute(recipe,sources);lastGraph={recipe:clone(recipe),sources:clone(sources)};
      return clone({format:'kompozed.atlas.composition.v1',outputs:result.outputs,recipe,receipt:result.receipt,final_composition:finalComposition(result),scope:{gain,bias,reference_gain:2,reference_bias:1,case_count:10,tolerance:1e-9,claim:'Synthetic motion fixture; Beta mean assumes conditionally independent Bernoulli cases sharing one pass probability. Boolean policy is not an equivalence proof.'}});
    });},
    replay(){return exclusive(async()=>{if(!lastGraph)throw new Error('run the atlas before replay');const result=await runtime.execute(lastGraph.recipe,lastGraph.sources);return {receipt:result.receipt,final_composition:finalComposition(result),inspection:runtime.inspect()};});},
    exportRecipe(){
      if(!lastGraph)throw new Error('run the atlas before exporting a recipe');
      return clone({format:'kompozed.atlas.recipe.v1',recipe:lastGraph.recipe,sources:lastGraph.sources,implementationIdentity:runtime.implementationIdentity});
    },
    inspect(){return runtime.inspect();},
    reset(){if(busy)throw new Error('cannot reset while atlas is running');runtime.reset();lastGraph=null;}
  };
}
