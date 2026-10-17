import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationTimelineView} from '../src/operation-timeline-view.mjs';
import {createOperationIndex} from '../exp/operation-index/core.mjs';
import {runCvCounterexample,CV_FIXTURE_SOURCE} from '../exp/operation-index/cv-demo.mjs';

class Surface {
  isConnected = true;
  set innerHTML(value) { this.html = value; }
  get innerHTML() { return this.html ?? ''; }
  querySelector(selector) {
    const id = selector.slice(1);
    const match = this.html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    const value = match?.[1].match(/<option value="([^"]+)" selected>/)?.[1] ?? 'all';
    if (!this.elements) this.elements = new Map();
    if (!this.elements.has(selector)) this.elements.set(selector, {value, onclick: null, onchange: null});
    return this.elements.get(selector);
  }
}

test('timeline renders persisted run boundaries and exports the shared JSON index', () => {
  const index = createOperationIndex({now: () => 'observed', idFactory: () => 'run-1'});
  index.record({runtime:'atlas',action:'search',source:{digest:'abc'},startedAt:'start',finishedAt:'end',status:'succeeded',operations:[{id:'op-1',kind:'calculation',status:'cached',calculation:'fit_motion',cacheHit:true,inputAddresses:['/train'],outputAddress:'/model'}],edges:[],evidence:{receipt:{trace:[]}}});
  let exports = 0;
  const view = createOperationTimelineView({index,onExport:()=>exports++}),root = new Surface();
  view.mount(root);
  assert.match(root.innerHTML,/Operation timeline/);
  assert.match(root.innerHTML,/atlas · search/);
  assert.match(root.innerHTML,/start → end/);
  assert.match(root.innerHTML,/fit_motion/);
  assert.match(root.innerHTML,/cache hit/);
  root.querySelector('#operation-export').onclick();
  assert.equal(exports,1);
  view.unmount();
});

test('timeline follows new index records and filters by runtime without losing persisted history', () => {
  const index = createOperationIndex({now: () => 'observed', idFactory: (()=>{let n=0;return()=>`run-${++n}`;})()});
  const view = createOperationTimelineView({index}),root = new Surface();view.mount(root);
  index.record({runtime:'capability-lab',action:'run',source:{sourceCommit:'pin'},startedAt:'a',finishedAt:'b',status:'failed',operations:[],edges:[],evidence:{error:{message:'failed'}}});
  assert.match(root.innerHTML,/capability-lab · run/);
  assert.match(root.innerHTML,/failed/);
  const filter = root.querySelector('#operation-runtime-filter');filter.value='atlas';filter.onchange({target:filter});
  assert.match(root.innerHTML,/No runs match these filters/);
  assert.equal(index.list().length,1);
});

test('timeline runs the CV ordering fixture and exposes both observed outcomes', async () => {
  const index=createOperationIndex({now:()=> 'observed',idFactory:(()=>{let n=0;return()=>`cv-${++n}`;})()});
  const onRunCv=()=>runCvCounterexample({index,source:CV_FIXTURE_SOURCE});
  const root=new Surface(),view=createOperationTimelineView({index,onRunCv});view.mount(root);
  await root.querySelector('#operation-cv-run').onclick();
  assert.match(root.innerHTML,/Eligibility before ranking/);
  assert.match(root.innerHTML,/near-acceptable/);
  assert.match(root.innerHTML,/cv-\d+/);
  assert.match(root.innerHTML,/semantic candidate/);
  assert.equal(index.list().length,4);
});
