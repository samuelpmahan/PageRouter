import {AnnotationFG} from '../cooperative/annotation-fg.mjs';
import {deriveFGAssociations} from '../cooperative/fg-association.mjs';
import {canonical,calculationRegistry} from './calculations.mjs';
import {createAtlasCompositionDefinition} from './atlas-session.mjs';
import {preflightRecipe} from './runtime-adapter.mjs';

// This is the six-node Atlas composition's declared FG, built with the existing
// AnnotationFG composer. Addresses remain the existing PxC recipe addresses.
const contract={
  fit:{consumes:[['training','motion-transitions'],['config','fit-config']],emits:['model','motion-model']},
  predict:{consumes:[['model','motion-model'],['queries','motion-queries']],emits:['predictions','motion-predictions']},
  prediction_probe:{consumes:[['predictions','motion-predictions'],['observed','motion-observations']],emits:['evidence','prediction-evidence']},
  posterior:{consumes:[['prior','beta-prior'],['evidence','prediction-evidence']],emits:['posterior','beta-posterior']},
  decision:{consumes:[['posterior','beta-posterior'],['policy','decision-policy']],emits:['decision','policy-decision']},
  parameter_probe:{consumes:[['model','motion-model'],['specification','model-specification']],emits:['evidence','parameter-evidence']},
};
const sourcePorts={
  '/parts/training':'training','/parts/config':'config','/parts/queries':'queries',
  '/parts/observed':'observed','/parts/prior':'prior','/parts/policy':'policy',
  '/parts/specification':'specification'
};
const outputPorts={decision:'decision',parameter_probe:'parameter_probe'};

export function atlasFGAssociations(definition){
  const expected=createAtlasCompositionDefinition();
  if(canonical(definition?.recipe)!==canonical(expected.recipe))throw new TypeError('Atlas FG recipe wiring disagrees with the pinned six-node contract');
  if(canonical(Object.keys(definition?.sources??{}).sort())!==canonical(Object.keys(expected.sources).sort()))throw new TypeError('Atlas FG source addresses disagree with the pinned contract');
  preflightRecipe(definition.recipe,definition.sources,calculationRegistry());
  const owners=new Map(definition.recipe.nodes.map(node=>[node.output,node]));
  const leaves=Object.fromEntries(Object.entries(contract).map(([id,spec])=>[id,AnnotationFG.leaf({id,
    consumes:spec.consumes.map(([name,type])=>({name,type})),emits:[{name:spec.emits[0],type:spec.emits[1]}],
    guarantees:[{calculation:definition.recipe.nodes.find(node=>node.id===id)?.calculation,outputType:spec.emits[1]}]} )]));
  const bindings=[],consumes=[];
  for(const node of definition.recipe.nodes){
    const spec=contract[node.id];
    for(let i=0;i<node.inputs.length;i++){
      const address=node.inputs[i],target={node:node.id,port:spec.consumes[i][0]},owner=owners.get(address);
      if(owner)bindings.push({from:{node:owner.id,port:contract[owner.id].emits[0]},to:target});
      else consumes.push({name:sourcePorts[address],type:spec.consumes[i][1],target});
    }
  }
  const emits=Object.entries(outputPorts).map(([name,node])=>({name,type:contract[node].emits[1],source:{node,port:contract[node].emits[0]}}));
  const fg=AnnotationFG.compose({id:'atlas-motion-composition',children:Object.values(leaves),bindings,consumes,emits,
    guarantees:[{scope:'six-node motion fixture',authority:'declared Atlas recipe and fixed Calculation registry'}]});
  const addresses=Object.fromEntries(definition.recipe.nodes.map(node=>[node.id,'/calculations/'+node.calculation]));
  const inputAddresses=Object.fromEntries(Object.entries(sourcePorts).map(([address,port])=>[port,address]));
  return {fg,decision:deriveFGAssociations({fg,output:'decision',addresses,inputAddresses}),
    parameter_probe:deriveFGAssociations({fg,output:'parameter_probe',addresses,inputAddresses})};
}
