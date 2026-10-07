import {Part,PxC} from '../../vendor/hh/services/pxc.mjs';
import {canonical,clone} from './calculations.mjs';
import {createAtlasCompositionDefinition} from './atlas-session.mjs';
import {AtlasRuntime} from './runtime-adapter.mjs';
import {atlasFGAssociations} from './atlas-fg.mjs';

const FORMAT='kompozed.atlas.cross-language-case.v1';
const OBSERVATION='kompozed.atlas.cross-language-observation.v1';
const PATHS={model:'model',parameter_probe:'parameter_probe',predictions:'predictions',prediction_probe:'prediction_probe',posterior:'posterior',decision:'decision'};
const CASE_FIELDS=['format','recipe','sources','implementationIdentity','case_id'];
const HEX=bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('');
async function digest(value){return 'sha256:'+HEX(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))));}
function payload(record){return {recipe:record.recipe,sources:record.sources,implementationIdentity:record.implementationIdentity};}
function requireObject(value,name){if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError(`${name} must be an object`);return value;}
function exactFields(value,fields,name){if(canonical(Object.keys(value).sort())!==canonical([...fields].sort()))throw new TypeError(`${name} has unexpected fields`);}
function contract(record){
  requireObject(record,'case');exactFields(record,CASE_FIELDS,'case');
  if(record.format!==FORMAT)throw new TypeError('unsupported cross-language case format');
  const expected=createAtlasCompositionDefinition();
  if(canonical(record.recipe)!==canonical(expected.recipe))throw new TypeError('case recipe disagrees with pinned six-node Atlas contract');
  requireObject(record.sources,'case sources');
  if(canonical(Object.keys(record.sources).sort())!==canonical(Object.keys(expected.sources).sort()))throw new TypeError('case source addresses disagree with pinned Atlas contract');
  if(typeof record.case_id!=='string'||!/^sha256:[a-f0-9]{64}$/.test(record.case_id))throw new TypeError('case_id must be a SHA-256 digest');
}
export async function validateAtlasCase(record){
  contract(record);
  if(await digest(payload(record))!==record.case_id)throw new TypeError('case identity disagrees with recipe, sources, or implementation identity');
  atlasFGAssociations(record);
  return record;
}
export async function captureAtlasCase(options={}){
  const definition=createAtlasCompositionDefinition(options);
  const record={format:FORMAT,recipe:definition.recipe,sources:definition.sources,implementationIdentity:definition.implementationIdentity};
  return {...record,case_id:await digest(payload(record))};
}
export async function runAtlasJs(caseRecord){
  await validateAtlasCase(caseRecord);
  const fgAssociations=atlasFGAssociations(caseRecord);
  const runtime=new AtlasRuntime(undefined,{implementationIdentity:caseRecord.implementationIdentity});
  const result=await runtime.execute(caseRecord.recipe,caseRecord.sources);
  const value=name=>result.outputs[name].value;
  return {format:OBSERVATION,language:'javascript',case_id:caseRecord.case_id,
    fg_associations:{decision:fgAssociations.decision,parameter_probe:fgAssociations.parameter_probe},
    observables:{model:value('model'),parameter_probe:value('parameter_probe'),predictions:result.parts['/models/predicted'].value.values,
      prediction_probe:value('prediction_probe'),posterior:value('posterior'),decision:value('decision')},
    execution:{kernel:'vendor/hh/services/pxc.mjs',adapter:'exp/atlas/runtime-adapter.mjs',receipt:result.receipt}};
}
function firstDifference(left,right,path=''){
  if(typeof left==='number'&&typeof right==='number'){
    if(!Number.isFinite(left)||!Number.isFinite(right)||Math.abs(left-right)>1e-9)return {path,reason:`numeric disagreement: JavaScript ${left}, Python ${right}`,javascript:left,python:right};
    return null;
  }
  if(Array.isArray(left)||Array.isArray(right)){
    if(!Array.isArray(left)||!Array.isArray(right))return {path,reason:'array/type disagreement',javascript:left,python:right};
    if(left.length!==right.length)return {path,reason:`array length disagreement: JavaScript ${left.length}, Python ${right.length}`,javascript:left.length,python:right.length};
    for(let i=0;i<left.length;i++){const difference=firstDifference(left[i],right[i],`${path}[${i}]`);if(difference)return difference;}
    return null;
  }
  if(left&&typeof left==='object'||right&&typeof right==='object'){
    if(!left||!right||typeof left!=='object'||typeof right!=='object')return {path,reason:'object/type disagreement',javascript:left,python:right};
    const keys=[...new Set([...Object.keys(left),...Object.keys(right)])].sort();
    for(const key of keys){const child=path?`${path}.${key}`:key;if(!Object.hasOwn(left,key)||!Object.hasOwn(right,key))return {path:child,reason:'missing observable field',javascript:left[key]??null,python:right[key]??null};
      const difference=firstDifference(left[key],right[key],child);if(difference)return difference;}
    return null;
  }
  return Object.is(left,right)?null:{path,reason:`value disagreement: JavaScript ${JSON.stringify(left)}, Python ${JSON.stringify(right)}`,javascript:left,python:right};
}
export async function compareAtlasObservations(caseRecord,jsObservation,pythonObservation){
  await validateAtlasCase(caseRecord);
  for(const [name,observation,language] of [['JavaScript',jsObservation,'javascript'],['Python',pythonObservation,'python']]){
    requireObject(observation,`${name} observation`);
    if(observation.format!==OBSERVATION||observation.language!==language)throw new TypeError(`${name} observation format/language mismatch`);
    if(observation.case_id!==caseRecord.case_id)throw new TypeError(`${name} observation case identity mismatch`);
    requireObject(observation.observables,`${name} observables`);
    for(const key of Object.keys(PATHS))if(!Object.hasOwn(observation.observables,key))throw new TypeError(`${name} missing observable ${key}`);
  }
  const kernel=new PxC();
  kernel.set('/cross/javascript',new Part(clone(jsObservation.observables)));
  kernel.set('/cross/python',new Part(clone(pythonObservation.observables)));
  const fg=({left,right})=>{
    for(const key of Object.keys(PATHS)){
      const difference=firstDifference(left[key],right[key],key);
      if(difference)return {accepted:false,compared_case_count:left.predictions.length,first_difference:difference};
    }
    return {accepted:true,compared_case_count:left.predictions.length,first_difference:null};
  };
  kernel.set('/cross/fg',new Part(fg));
  const output=await kernel.compose({into:'/cross/agreement',calculation:'/cross/fg',inputs:{left:'/cross/javascript',right:'/cross/python'}});
  return {format:'kompozed.atlas.cross-language-comparison.v1',case_id:caseRecord.case_id,
    agreement:output.value,producer:{calculation:'atlas_cross_language_fg',calculation_part:'/cross/fg',output_part:'/cross/agreement',kernel:'vendor/hh/services/pxc.mjs'},
    js:jsObservation,python:pythonObservation};
}
