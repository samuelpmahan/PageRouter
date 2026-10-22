import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openWorkspace, archiveKey } from '../../experiences/thro/dist/workspace.mjs';
import { Part } from '../../experiences/thro/dist/studio/part-first-kernel/src/pxc.mjs';
import { openDemo, captureIdentity } from '../../experiences/thro/dist/model.mjs';
import { createArchiveCodec } from '../../experiences/thro/dist/archive-codec.mjs';
import { pack, unpack } from '../../experiences/thro/dist/archive-storage.mjs';

const base=new URL('../../experiences/thro/',import.meta.url);
const fixture=JSON.parse(fs.readFileSync(new URL('prepared-fixture.json',base))).discs.map(disc=>({...disc,
  depiction:{kind:'photo',src:`data:image/webp;base64,${fs.readFileSync(new URL(disc.file,base)).toString('base64')}`,name:disc.name}}));
const storage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
const locks={request:(_name,_options,action)=>action()};
const graphic={svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="40" height="20"/></svg>',width:1920,height:1080,provenance:{schema:'synthetic-retained-reuse@1',fixtureOnly:true}};
const renderGraphic=async input=>input.design.study.startsWith('discstudio:')?structuredClone(graphic):null;
const previewSources=(model,result)=>({design:model.value(result.designAddress),disc:model.value(result.discAddress),resolved:model.value(result.resolvedAddress)});

test('retained capture eligibility rejects uncertain sources before adding an alias', async()=>{
  const workspace=await openWorkspace({storage:storage(),locks,fixture,renderGraphic});
  await workspace.change({design:{...workspace.model.context.design,study:'discstudio:b01',rendererBuild:'28ac2b39fab85255',orientation:'landscape'}});
  const first=await workspace.keep(await workspace.single(workspace.model.context.selectedDisc)),model=workspace.model;
  assert.equal(typeof model.tryRetainCapture,'function','the opt-in retained capture hook must exist');
  const result=await workspace.single(model.context.selectedDisc),sources=previewSources(model,result);
  const cases=[
    ['physical version',capture=>{capture.source.disc=model.experience.shelf()[1].address;}],
    ['resolved facts',capture=>{capture.specimen.resolved.name+=' changed';}],
    ['design',capture=>{capture.design.title+=' changed';}],
    ['full graphic',capture=>{capture.graphic.provenance.unrecognized='changed';}],
    ['hash',capture=>{capture.hash='0'.repeat(64);}],
    ['unbound graphic',capture=>{capture.source.graphic='ds.px.missing.graphic';}],
    ['unbound design',capture=>{capture.source.design='ds.px.missing.design';}],
  ];
  for(const [index,[name,mutate]] of cases.entries()){
    const invalid=structuredClone(first.capture);mutate(invalid);
    const address=`ds.px.synthetic.invalid-${index}.capture`;
    model.pxc.set(address,new Part(invalid));await model.patch({graphics:[address]});
    const before=model.pxc.entries().map(([address])=>address),head=model.contextAddress;
    assert.equal(await model.tryRetainCapture(result,{previewSources:sources,mount:'thro.prepared-samples'}),null,name);
    assert.deepEqual(model.pxc.entries().map(([address])=>address),before,`${name} cannot write an alias`);
    assert.equal(model.contextAddress,head);
  }
});

test('an actual imported literal capture opts out and the workspace falls back to a fresh Keep',async()=>{
  const backing=storage(),codec=createArchiveCodec({pack,unpack});
  let workspace=await openWorkspace({storage:backing,locks,fixture,renderGraphic});
  await workspace.change({design:{...workspace.model.context.design,study:'discstudio:b01',rendererBuild:'28ac2b39fab85255',orientation:'landscape'}});
  const first=await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  const staged={raw:await codec.unpackArchive(backing.getItem(archiveKey)),getItem(){return this.raw;},setItem(_key,value){this.raw=value;}};
  const model=await openDemo(staged,{renderGraphic});
  assert.equal(await model.importCapture(structuredClone(first.capture)),true);
  assert.deepEqual(model.context.imported,[captureIdentity(first.capture)]);
  const preview=await model.render(model.context.selectedDisc,model.context.design);
  assert.equal(await model.tryRetainCapture({...preview,design:model.context.design},{previewSources:previewSources(model,preview),mount:'thro.prepared-samples'}),null);
  backing.setItem(archiveKey,await codec.packArchive(staged.raw));
  workspace=await openWorkspace({storage:backing,locks,fixture,renderGraphic});
  const kept=await workspace.keep(await workspace.single(workspace.model.context.selectedDisc));
  assert.equal(workspace.model.context.graphics.length,3,'original, imported, and explicit new history entries all remain');
  assert.ok(!workspace.model.pxc.entries().some(([address])=>address.endsWith('.retainedGraphic')));
  assert.notStrictEqual(workspace.model.pxc.get(kept.capture.source.graphic),workspace.model.pxc.get(first.capture.source.graphic));
  assert.deepEqual(workspace.model.value(first.address),first.capture);
});
