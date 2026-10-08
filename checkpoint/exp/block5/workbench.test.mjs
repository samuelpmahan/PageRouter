import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRoute,routeFor} from '../../src/project-router.mjs';
import {createGridWorld,editGridObject,DEFAULT_GRID_RECIPE,runGridRecipe,canonicalJson,createPixelCache} from './core/index.mjs';

const projects=[{id:'pxcube'},{id:'hh'}];

test('Block5 has a PxCube-only route',()=>{
  assert.equal(routeFor('pxcube','block5'),'#/pxcube/block5');
  assert.deepEqual(parseRoute('#/pxcube/block5',projects),{project:'pxcube',view:'block5',leaf:''});
  assert.throws(()=>routeFor('hh','block5'),/Invalid project route/);
});

const level=[
  {id:'baba',x:1,y:6,kind:'baba'},
  {id:'baba-word',x:1,y:1,kind:'text',word:'BABA'},
  {id:'baba-is',x:2,y:1,kind:'text',word:'IS'},
  {id:'baba-you',x:3,y:1,kind:'text',word:'YOU'},
];

test('editing a word changes parsed game rules without editing the game engine',()=>{
  const world=createGridWorld({width:6,height:8,objects:level});
  assert.deepEqual(world.rules,['BABA IS YOU']);
  const changed=editGridObject(world,'baba-you',{word:'STOP'});
  assert.deepEqual(changed.rules,['BABA IS STOP']);
  assert.deepEqual(world.rules,['BABA IS YOU']);
});

test('ordered direction cards perform successive real grid steps and cached replay preserves exact output',async()=>{
  const world=createGridWorld({width:6,height:8,objects:level});
  const first=DEFAULT_GRID_RECIPE.rules[0];
  const recipe={id:'two-directions',rules:[
    {...structuredClone(first),id:'right-card',parameters:{direction:'R'}},
    {...structuredClone(first),id:'down-card',parameters:{direction:'D'}},
  ]};
  const baseline=await runGridRecipe({initialState:world,recipe,mode:'uncached'});
  assert.deepEqual(baseline.state.objects.find(item=>item.id==='baba')&&{x:baseline.state.objects.find(item=>item.id==='baba').x,y:baseline.state.objects.find(item=>item.id==='baba').y},{x:2,y:7});
  assert.equal(baseline.stream.events.length,2);
  const cached=await runGridRecipe({initialState:world,recipe,mode:'atomic',cache:createPixelCache(),previousRun:baseline});
  assert.equal(canonicalJson({state:cached.state,events:cached.stream.events}),canonicalJson({state:baseline.state,events:baseline.stream.events}));
});
