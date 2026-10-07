import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtlasView} from '../../src/atlas-view.mjs';

class Surface {
  isConnected = true;
  set innerHTML(value) {this.html = value; this.elements = new Map();}
  get innerHTML() {return this.html;}
  querySelector(selector) {
    if (!this.elements.has(selector)) {
      const value = selector === '#atlas-gain' ? '2' : selector === '#atlas-bias' ? '1' : '';
      this.elements.set(selector,{value,checkValidity:()=>true});
    }
    return this.elements.get(selector);
  }
}
const fixture = {
  reference:{program:{expr:'x'},size_bytes:66,program_address:'/reference'},
  accepted:{program:{expr:'x'},size_bytes:43,program_address:'/accepted'},
  scope:{claim:'Declared grid only',positions:[0,1],actions:[0,1],case_count:4,tolerance:1e-9,gain:2,bias:1},
  metric:'Canonical UTF-8 bytes', rounds:[], recipe:{parts:[]},
  final_composition:{receipt:{executed_count:3,cache_hit_count:0}},
};

test('mount is inert and completion after navigation only updates a later Atlas mount', async()=>{
  let finish, calls=0;
  const view=createAtlasView({session:{run:()=>{calls++;return new Promise(resolve=>{finish=resolve;});},inspect:()=>({parts:[]})}});
  const first=new Surface();view.mount(first);assert.equal(calls,0);
  const pending=first.querySelector('#atlas-run').onclick();assert.equal(calls,1);
  view.unmount();first.innerHTML='Another project view';
  finish(fixture);await pending;
  assert.equal(first.innerHTML,'Another project view');
  const reopened=new Surface();view.mount(reopened);
  assert.match(reopened.innerHTML,/Accepted 43 B program/);
  assert.match(reopened.innerHTML,/3 calculation bodies executed/);
});

test('failed pending invocation survives navigation; replay uses the same session and reset clears it',async()=>{
  let rejectRun, resets=0, replayCalls=0;
  const session={run:()=>new Promise((_,reject)=>{rejectRun=reject;}),inspect:()=>({parts:[]}),replay:async()=>{replayCalls++;return {receipt:{executed_count:0,cache_hit_count:3}};},reset:()=>{resets++;}};
  const view=createAtlasView({session}),first=new Surface();view.mount(first);
  const pending=first.querySelector('#atlas-run').onclick();view.unmount();rejectRun(Error('Retained known failure'));await pending;
  const reopened=new Surface();view.mount(reopened);assert.match(reopened.innerHTML,/Retained known failure/);
  session.run=async()=>fixture;await reopened.querySelector('#atlas-run').onclick();
  await reopened.querySelector('#atlas-replay').onclick();assert.equal(replayCalls,1);assert.match(reopened.innerHTML,/0 calculation bodies executed · 3 cache hits/);
  reopened.querySelector('#atlas-reset').onclick();assert.equal(resets,1);assert.doesNotMatch(reopened.innerHTML,/Accepted 43/);
});

test('invalid model control is rejected before invoking the runtime',()=>{
  let calls=0;const view=createAtlasView({session:{run:()=>{calls++;},inspect:()=>({})}}),root=new Surface();view.mount(root);
  root.querySelector('#atlas-gain').value='';root.querySelector('#atlas-run').onclick();
  assert.equal(calls,0);assert.match(root.innerHTML,/Choose a gain and bias/);
});

test('original composition switches the active result and keeps replay on the same session',async()=>{
  const composition={scope:{gain:2,bias:1,reference_gain:2,reference_bias:1,case_count:10,tolerance:1e-9,claim:'Synthetic fixture only'},outputs:{decision:{value:{accepted:true}},posterior:{value:{mean:11/12}},prediction_probe:{value:{passed:10,failed:0,n:10}}},recipe:{nodes:[]},receipt:{executed_count:6,cache_hit_count:0}};
  let called=0;const view=createAtlasView({session:{run:async()=>fixture,runComposition:async()=>{called++;return composition;},inspect:()=>({parts:[]})}}),root=new Surface();view.mount(root);
  await root.querySelector('#atlas-run').onclick();assert.match(root.innerHTML,/Accepted 43/);
  await root.querySelector('#atlas-composition').onclick();assert.equal(called,1);assert.match(root.innerHTML,/fixture policy passed/);assert.match(root.innerHTML,/Motion → Beta estimate → Boolean policy/);assert.doesNotMatch(root.innerHTML,/Accepted 43/);
});
