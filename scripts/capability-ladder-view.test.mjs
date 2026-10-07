import test from 'node:test';
import assert from 'node:assert/strict';
import {createAtlasView} from '../src/atlas-view.mjs';

const unescape = text => text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
class Surface {
  isConnected = true;
  set innerHTML(value) {this.html=value;this.elements=new Map();}
  get innerHTML() {return this.html ?? '';}
  querySelector(selector) {
    if(!this.elements.has(selector)) {
      if(selector==='#atlas-ladder-mount') this.elements.set(selector,new Surface());
      else {
        const match = selector==='#atlas-ladder-definition' ? this.html.match(/<textarea[^>]*id="atlas-ladder-definition"[^>]*>([\s\S]*?)<\/textarea>/) : null;
        this.elements.set(selector,{value:match?unescape(match[1]):selector==='#atlas-gain'?'2':selector==='#atlas-bias'?'1':'',checkValidity:()=>true});
      }
    }
    return this.elements.get(selector);
  }
}
const sample={format:'test-definition',recipe:{nodes:[],outputs:{}},sources:{'/literal':{text:'</textarea><img src=x onerror="boom">'}}};
const part=(rung,value={})=>Object.freeze({address:'/protocol/'+rung,value:Object.freeze({rung,status:'ok',ok:true,...value}),inputs:[],producer:{kind:'capability',calculation:rung,implementation:'exact-source'},kernel_composition:{calculation_address:'/calculation/'+rung,inputs:{}}});
function setup(protocol) {
  const view=createAtlasView({session:{inspect:()=>({parts:[]})},protocol,sampleDefinition:sample});
  const root=new Surface();view.mount(root);return {view,root,ladder:root.querySelector('#atlas-ladder-mount')};
}
function runtime() {
  const parsed=part('parse',{envelope:sample}),validated=part('validate',{envelope:sample,validation:{node_count:6}}),interpreted=part('interpret',{envelope:sample,plan:{order:['fit','predict']}}),executed=part('execute',{execution:{parts:{},outputs:{decision:{value:{accepted:true}}},composition_part:{address:'/composition'},receipt:{executed_count:6,cache_hit_count:0}}});
  return {parsed,validated,interpreted,executed,parse:async()=>parsed,validate:async value=>{assert.equal(value,parsed);return validated;},interpret:async value=>{assert.equal(value,validated);return interpreted;},execute:async value=>{assert.equal(value,interpreted);return executed;},run:async()=>part('run',{stages:{parse:parsed,validate:validated,interpret:interpreted,execute:executed},execution:executed.value.execution}),inspect:()=>({parts:[],counts:{domain_body_executions:6}}),reset:()=>{},capabilities:()=>[]};
}

test('Atlas mount exposes an inert ladder with escaped editable literal seeds',()=>{
  let calls=0;const p=runtime();p.parse=()=>{calls++;};p.run=()=>{calls++;};
  const {ladder}=setup(p);
  assert.match(ladder.innerHTML,/Capability ladder/);
  assert.equal(calls,0);
  assert.deepEqual(JSON.parse(ladder.querySelector('#atlas-ladder-definition').value),sample);
  assert.doesNotMatch(ladder.innerHTML,/<img src=x/);
  assert.match(ladder.innerHTML,/id="atlas-ladder-validate" disabled/);
});

test('staged actions retain authentic predecessor handles and invalidate downstream Parts on draft edit',async()=>{
  const p=runtime(),{ladder}=setup(p);
  for(const rung of ['parse','validate','interpret','execute']) await ladder.querySelector('#atlas-ladder-'+rung).onclick();
  assert.match(ladder.innerHTML,/6 calculation bodies executed · 0 cache hits/);
  assert.match(ladder.innerHTML,/data-state="ok"/);
  const input=ladder.querySelector('#atlas-ladder-definition');input.value='{"draft":"human edit"}';input.oninput({target:input});
  assert.match(ladder.innerHTML,/id="atlas-ladder-rung-execute"[^>]*data-state="waiting"/);
  assert.match(ladder.innerHTML,/id="atlas-ladder-replay" disabled/);
  assert.match(ladder.innerHTML,/id="atlas-ladder-download-result" disabled/);
  assert.equal(ladder.querySelector('#atlas-ladder-definition').value,'{"draft":"human edit"}');
});

test('composed run reveals its reached stages and replay reuses the authentic interpreted Part',async()=>{
  const p=runtime(),{ladder}=setup(p);await ladder.querySelector('#atlas-ladder-run').onclick();
  assert.match(ladder.innerHTML,/id="atlas-ladder-composed-part"/);
  p.execute=async value=>{assert.equal(value,p.interpreted);return part('execute',{execution:{outputs:{},receipt:{executed_count:0,cache_hit_count:6}}});};
  await ladder.querySelector('#atlas-ladder-replay').onclick();
  assert.match(ladder.innerHTML,/0 calculation bodies executed · 6 cache hits/);
});

test('pending ladder work is exclusive and completion after detach updates a new mount',async()=>{
  const p=runtime();let finish,calls=0;p.parse=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const {view,root,ladder}=setup(p),pending=ladder.querySelector('#atlas-ladder-parse').onclick();
  await ladder.querySelector('#atlas-ladder-run').onclick();assert.equal(calls,1);
  const draft=ladder.querySelector('#atlas-ladder-definition').value;view.unmount();root.innerHTML='Other view';ladder.isConnected=false;
  finish(p.parsed);await pending;assert.equal(root.innerHTML,'Other view');
  const reopened=new Surface();view.mount(reopened);const next=reopened.querySelector('#atlas-ladder-mount');
  assert.match(next.innerHTML,/id="atlas-ladder-rung-parse"[^>]*data-state="ok"/);
  assert.equal(next.querySelector('#atlas-ladder-definition').value,draft);
});

test('failed stage stays inspectable while later rungs remain unavailable',async()=>{
  const p=runtime();p.parse=async()=>part('parse',{ok:false,status:'failed',error:{code:'INVALID_JSON',name:'SyntaxError',message:'<bad json>'}});
  const {ladder}=setup(p);await ladder.querySelector('#atlas-ladder-parse').onclick();
  assert.match(ladder.innerHTML,/data-state="failed"/);
  assert.match(ladder.innerHTML,/INVALID_JSON/);assert.doesNotMatch(ladder.innerHTML,/<bad json>/);
  assert.match(ladder.innerHTML,/id="atlas-ladder-validate" disabled/);
});

test('queued inspection toggles from detached roots cannot write into a later mount',()=>{
  const p=runtime(),{view,root,ladder}=setup(p),oldDetails=ladder.querySelector('#atlas-ladder-inspect'),oldToggle=oldDetails.ontoggle;
  const oldAtlasDetails=root.querySelector('#atlas-inspect'),oldAtlasToggle=oldAtlasDetails.ontoggle;
  view.unmount();
  assert.doesNotThrow(()=>oldToggle({target:oldDetails}));
  assert.doesNotThrow(()=>oldAtlasToggle({target:oldAtlasDetails}));
  const reopened=new Surface();view.mount(reopened);const next=reopened.querySelector('#atlas-ladder-mount');
  oldDetails.open=true;oldAtlasDetails.open=true;
  assert.doesNotThrow(()=>oldToggle({target:oldDetails}));
  assert.doesNotThrow(()=>oldAtlasToggle({target:oldAtlasDetails}));
  assert.equal(next.querySelector('#atlas-ladder-inspection').textContent,undefined);
});

test('an invocation rejected after a programmatic draft edit cannot attach stale failure to the new draft',async()=>{
  const p=runtime();let reject;p.parse=()=>new Promise((_,fail)=>{reject=fail;});
  const {ladder}=setup(p),pending=ladder.querySelector('#atlas-ladder-parse').onclick();
  const input=ladder.querySelector('#atlas-ladder-definition');input.value='{"new":"draft"}';input.oninput({target:input});
  reject(Error('old invocation failed'));await pending;
  assert.doesNotMatch(ladder.innerHTML,/old invocation failed/);
  assert.equal(ladder.querySelector('#atlas-ladder-definition').value,'{"new":"draft"}');
  assert.match(ladder.innerHTML,/id="atlas-ladder-rung-parse"[^>]*data-state="waiting"/);
});

test('the real composed protocol lends authentic nested interpreted Parts to UI replay',async()=>{
  const view=createAtlasView({session:{inspect:()=>({parts:[]})}}),root=new Surface();view.mount(root);
  const ladder=root.querySelector('#atlas-ladder-mount');
  await ladder.querySelector('#atlas-ladder-run').onclick();
  assert.match(ladder.innerHTML,/6 calculation bodies executed · 0 cache hits/);
  assert.match(ladder.innerHTML,/id="atlas-ladder-rung-execute"[^>]*data-state="ok"/);
  await ladder.querySelector('#atlas-ladder-replay').onclick();
  assert.match(ladder.innerHTML,/0 calculation bodies executed · 6 cache hits/);
  assert.doesNotMatch(ladder.innerHTML,/PRIOR_RUNG_FAILED|INVALID_HANDLE/);
});
