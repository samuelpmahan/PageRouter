import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../run.mjs';
import { workspace, setManifest, cli } from './scaffold-helpers.mjs';

// Test the actual packaged modules, not a parallel copy of the source.
const repo=workspace();
after(()=>fs.rmSync(repo,{recursive:true,force:true}));
const registry=JSON.parse(fs.readFileSync(path.join(root,'.tidy/manifest.json')));
setManifest(repo,{'pxcube-build-bag':registry.types['pxcube-build-bag']});
fs.cpSync(path.join(root,'experiences/build-bag'),path.join(repo,'experiences/build-bag'),{recursive:true});
const packaged=cli(repo,'package',path.join(repo,'experiences/build-bag'));
assert.equal(packaged.status,0,packaged.stderr);
const entry=path.join(repo,'experiences/build-bag/dist/model.mjs');
const {openDemo}=await import(pathToFileURL(entry));
const {restore}=await import(pathToFileURL(path.join(path.dirname(entry),'studio/upload-disc-to-shelf/persistence.js')));
const {pack,unpack,archiveStorage}=await import(pathToFileURL(path.join(path.dirname(entry),'archive-storage.mjs')));
const memory=()=>{let raw=null;return{getItem:()=>raw,setItem:(_key,value)=>{raw=value;}};};

test('exact-copy bag order, duplicate refusal, reload and isolated worlds',async()=>{
  const storage=memory(),demo=await openDemo(storage),rows=demo.experience.shelf();
  assert.equal(rows.length,8);
  const chosen=[rows[2].address,rows[0].address,rows[1].address];
  await demo.patch({name:'Windy afternoon',selection:chosen});
  assert.deepEqual(await demo.reorder(2,0),[chosen[2],chosen[0],chosen[1]]);
  const address=await demo.createBag(),bag=demo.value(address);
  assert.deepEqual(bag.versions.map(v=>v.address),chosen);
  assert.deepEqual(bag.discIds,chosen.map(a=>demo.value(a).id));
  assert.equal(demo.pxc.get(address).composition.calculation,demo.pxc.get('fn.createBag'));
  await assert.rejects(demo.experience.createBag('Duplicated',[chosen[0],chosen[0]]),/more than once/);
  await assert.rejects(demo.experience.createBag('Stale',['ds.px.disc.missing']),/stale or absent/);
  assert.equal(demo.experience.bags().length,1);
  const restored=await openDemo(storage);
  assert.deepEqual(restored.experience.bags().map(r=>r.bag),[bag]);
  assert.deepEqual(restored.context.selection,chosen);
  assert.equal((await openDemo(memory())).experience.bags().length,0);
});

test('compressed storage preserves every archive byte, replays Parts, and refuses stale writers',async()=>{
  const bytes=new Map(),backing={getItem:key=>bytes.get(key)??null,setItem:(key,value)=>bytes.set(key,value)};
  const storage=await archiveStorage(backing,'one'),demo=await openDemo(storage);
  const raw=storage.getItem(''),packed=bytes.get('one');
  assert.equal(await unpack(packed),raw);
  assert.equal(await unpack(await pack('é and 🌈\n'+raw)),'é and 🌈\n'+raw);
  assert.ok(packed.length<raw.length/5);
  const restored=await openDemo(await archiveStorage(backing,'one'));
  assert.deepEqual(restored.experience.shelf(),demo.experience.shelf());
  const stale=await archiveStorage(backing,'one');
  await demo.patch({name:'The live writer'});
  const committed=bytes.get('one');stale.setItem('','other bytes');await assert.rejects(stale.flush(),/another tab/);
  assert.equal(bytes.get('one'),committed);
  console.log(JSON.stringify({archiveCharacters:raw.length,compressedCharacters:packed.length,roundTrip:'identical'}));
});

test('render uses actual source Parts; captures replay and cannot drift with live design',async()=>{
  const storage=memory(),demo=await openDemo(storage);
  const before=structuredClone(demo.experience.shelf()[0]);
  const first=await demo.render(before.address,demo.context.design);
  assert.equal(first.graphic.width,1920);assert.equal(first.graphic.height,1080);
  assert.match(first.graphic.svg,new RegExp(before.seed.name));
  assert.equal(demo.pxc.get(first.fieldsAddress).composition.inputs.disc,demo.pxc.get(before.address));
  const {capture}=await demo.capture(first,'mock.create-graphics');
  const next=await demo.render(before.address,{...demo.context.design,orientation:'portrait',accent:'#ff4f9b',title:'A new design'});
  assert.equal(next.graphic.width,1080);assert.notEqual(next.graphic.svg,capture.graphic.svg);
  assert.deepEqual(demo.experience.shelf()[0],before);
  const restored=await openDemo(storage);
  assert.deepEqual(restored.value(restored.context.graphics[0]),capture);
  assert.equal((await restored.render(before.address,capture.design)).graphic.svg,capture.graphic.svg);
  const target=await openDemo(memory());
  assert.equal(await target.importCapture(capture),true);
  assert.equal(await target.importCapture(capture),false);
  assert.equal(target.context.graphics.length,1);
  await assert.rejects(target.importCapture({...capture,graphic:{...capture.graphic,svg:capture.graphic.svg+'changed'}}),/hash/);
  assert.equal(target.context.graphics.length,1);
  assert.equal(await target.importCapture({...capture,source:{...capture.source,graphic:capture.source.graphic+'.another'}}),true);
  assert.equal(target.context.graphics.length,2,'equal image bytes do not collapse different source Parts');
});

test('working-mode restore recomputes stale derived geometry without losing user state',async()=>{
  const storage=memory(),demo=await openDemo(storage),source=demo.experience.shelf()[0],rendered=await demo.render(source.address,demo.context.design),kept=await demo.capture(rendered,'mock.create-graphics');
  const before=structuredClone(kept.capture),archive=JSON.parse(storage.getItem(''));
  const names=new Map(archive.nodes.filter(node=>node.function).map(node=>[node.id,node.function]));
  const canvasNode=archive.nodes.find(node=>names.get(node.calculation)==='fn.studio.canvasScene');
  assert.ok(canvasNode,'fixture includes the changed canvas calculation');
  if(Array.isArray(canvasNode.material?.object))canvasNode.material.object=canvasNode.material.object.filter(([key])=>key!=='compositionEnvelope');
  storage.setItem('',JSON.stringify(archive));
  const restored=await openDemo(storage);
  assert.deepEqual(restored.context.design,demo.context.design,'user-owned design survives the migration');
  assert.deepEqual(restored.value(restored.context.graphics[0]),before,'unchanged capture remains stable when current graph semantics produce the same bytes');
  const refreshed=await restored.render(restored.context.selectedDisc,restored.context.design);
  assert.equal(refreshed.graphic.width,1920);
  assert.match(refreshed.graphic.svg,/Buzzz/);
  const clean=await openDemo(memory()),cleanRender=await clean.render(clean.context.selectedDisc,clean.context.design);
  assert.equal(refreshed.graphic.svg,cleanRender.graphic.svg,'working restore uses current geometry output');
  await restored.patch({name:'Migrated geometry'});
  const secondReload=await openDemo(storage);
  assert.deepEqual(secondReload.value(secondReload.context.graphics[0]),before,'the migrated archive remains reloadable with the capture intact');
});

test('working-mode restore recomputes non-geometry derived drift while frozen restore rejects it',async()=>{
  const storage=memory(),demo=await openDemo(storage),source=demo.experience.shelf()[0],rendered=await demo.render(source.address,demo.context.design);
  await demo.patch({name:'Integrity fixture'});
  const archive=JSON.parse(storage.getItem('')),names=new Map(archive.nodes.filter(node=>node.function).map(node=>[node.id,node.function]));
  const graphicNode=archive.nodes.find(node=>names.get(node.calculation)==='fn.studio.graphic');
  assert.ok(graphicNode,'fixture includes a non-geometry calculated graphic');
  if(Array.isArray(graphicNode.material?.object))graphicNode.material.object=graphicNode.material.object.filter(([key])=>key!=='svg');
  storage.setItem('',JSON.stringify(archive));
  const working=await openDemo(storage);
  const current=await working.render(working.context.selectedDisc,working.context.design);
  assert.equal(current.graphic.width,1920,'working mode recomputes the derived graphic');
  await assert.rejects(restore(storage.getItem(''),demo.pxc),/Restored Calculation output differs from saved material/,'frozen mode remains strict');
});

test('search excludes nicknames and preserves mold / plastic / descending weight order',async()=>{
  const demo=await openDemo(memory());
  const view=await demo.experience.queryShelf({query:'Buzzz · ESP'});
  assert.equal(view.rows.length,2);
  assert.deepEqual(view.groups[0].rows.map(row=>row.disc.weight),[175,170]);
  const row=demo.experience.shelf()[0];
  const edited=await demo.experience.updateDepiction(row.address,{});
  assert.equal(demo.value(edited).id,row.disc.id);
  const constrained=await demo.experience.queryShelf({speedRange:[7,8]});
  assert.ok(constrained.rows.length>0);
  assert.ok(constrained.rows.every(row=>(row.disc.speed??row.seed.speed)>=7&&(row.disc.speed??row.seed.speed)<=8));
});

test('nine card studies retain source Parts and reach export as the exact chosen graphic',async()=>{
  const storage=memory(),demo=await openDemo(storage),source=structuredClone(demo.experience.shelf());
  const studies=await demo.studyCards();
  assert.equal(studies.length,9);
  assert.equal(new Set(studies.map(item=>item.graphic.svg)).size,9);
  const target=await openDemo(memory());
  for(const {study,graphic,address} of studies){
    assert.doesNotMatch(graphic.svg,/SPEED|GLIDE|TURN|FADE/);
    assert.doesNotMatch(graphic.svg,/Add image/,'every graphic uses a supported renderer input');
    assert.doesNotMatch(graphic.svg,/data-node="maker"/,'the mold is the sole headline');
    assert.doesNotMatch(graphic.svg,/(?:width|height)="-/,'thin rules retain valid dimensions');
    const card=demo.pxc.get(address).composition.inputs.card.value;
    assert.deepEqual(card.warnings,[]);
    assert.equal(card.nodes.find(node=>node.id==='plastic').size,card.nodes.find(node=>node.id==='weight').size);
    const rendered=await demo.render(source[0].address,{...demo.context.design,study:study.id});
    const kept=await demo.capture(rendered,'mock.create-graphics');
    await target.importCapture(kept.capture);
    const imported=target.value(target.context.graphics.at(-1));
    assert.equal(imported.graphic.svg,rendered.graphic.svg);
    const independent=await target.render(target.context.selectedDisc,{...target.context.design,study:study.id});
    assert.equal(independent.graphic.svg,rendered.graphic.svg);
  }
  assert.deepEqual(demo.experience.shelf(),source);
  const restored=await openDemo(storage);
  assert.equal(restored.context.graphics.length,9);
});

test('creator queues one Competition image at a time: turns, points, size, accent, exact export',async()=>{
  const storage=memory(),demo=await openDemo(storage),source=structuredClone(demo.experience.shelf());
  const selection=[source[0].address,source[3].address,source[4].address];
  await demo.startCompetition(selection);
  assert.equal(demo.context.graphics.length,0,'starting a lineup does not invent or queue images');
  const original=demo.value(demo.context.competitionAddress),first=await demo.renderCompetition();
  assert.equal(first.graphic.cardCount,3);
  assert.deepEqual(first.graphic.warnings,[]);
  assert.match(first.graphic.svg,/UP NOW/);
  assert.doesNotMatch(first.graphic.svg,/data-node="maker"|SPEED|GLIDE|TURN|FADE/);
  const scene=demo.value(first.sceneAddress),sizes=scene.cards.map(c=>c.width);
  assert.ok(sizes[0]>sizes[1],'the current turn is larger');
  assert.equal(scene.cards[0].entry.score,0);
  const queued1=await demo.captureCompetition(first,'mock.create-graphics');
  assert.equal(demo.context.graphics.length,1);
  await demo.editCompetition({kind:'points',id:original.entries[0].id,points:3});
  await demo.editCompetition({kind:'turn',id:original.entries[1].id});
  await demo.editCompetition({kind:'style',id:original.entries[1].id,style:{scale:1.3,accent:'#ff44aa'}});
  const second=await demo.renderCompetition(),secondScene=demo.value(second.sceneAddress);
  assert.equal(secondScene.cards[0].entry.score,3);
  assert.ok(secondScene.cards[1].width>secondScene.cards[0].width);
  assert.match(second.graphic.svg,/#ff44aa/);
  assert.notEqual(second.graphic.svg,first.graphic.svg);
  assert.equal(demo.context.graphics.length,1,'live changes do not automatically queue images');
  const queued2=await demo.captureCompetition(second,'mock.create-graphics');
  assert.deepEqual(demo.value(queued1.address),queued1.capture);
  const target=await openDemo(memory());
  for(const queued of [queued1,queued2])await target.importCapture(queued.capture);
  assert.deepEqual(target.context.graphics.map(a=>target.value(a).graphic.svg),[first.graphic.svg,second.graphic.svg]);
  const restored=await openDemo(storage);
  assert.deepEqual(restored.context.graphics.map(a=>restored.value(a)),[queued1.capture,queued2.capture]);
  assert.equal((await restored.renderCompetition()).graphic.svg,second.graphic.svg);
  assert.deepEqual(demo.experience.shelf(),source);
  await assert.rejects(demo.editCompetition({kind:'points',id:original.entries[0].id,points:NaN}),/points/);
  assert.equal(demo.context.graphics.length,2);
  await demo.editCompetition({kind:'equal'});
  const equal=demo.value((await demo.renderCompetition()).sceneAddress).cards.map(c=>c.width);
  assert.equal(new Set(equal).size,1);
  const repeat1=await demo.captureCompetition(second,'mock.create-graphics');
  const repeat2=await demo.captureCompetition(second,'mock.create-graphics');
  await target.importCapture(repeat1.capture);await target.importCapture(repeat2.capture);
  assert.equal(target.context.graphics.length,4,'the creator may deliberately queue the same image twice');
});
