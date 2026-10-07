import test from 'node:test';
import assert from 'node:assert/strict';
import { localAddress, scopedStorage } from '../experience-mount.mjs';

test('interactive and numbered handles resolve only their own domain addresses',()=>{
  const interactive='mock.upload-disc-to-shelf', run=interactive+'.1';
  assert.equal(localAddress(interactive,interactive+'.px.shelf.0'),'ds.px.shelf.0');
  assert.equal(localAddress(run,run+'.fn.renderDepiction'),'fn.renderDepiction');
  assert.throws(()=>localAddress(interactive,run+'.px.shelf.0'),/outside/);
  assert.throws(()=>localAddress(run,interactive+'.px.shelf.0'),/outside/);
  assert.throws(()=>localAddress(interactive,'mock.explore-shelf.px.shelf.0'),/outside/);
});
test('namespaced archives preserve other Experiences and refuse stale owners or quota failures',()=>{
  const data=new Map([['discstudio.pxc.shelf.v1','real user shelf']]);
  const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};
  const a=scopedStorage(storage,'mount-a'),b=scopedStorage(storage,'mount-b'),stale=scopedStorage(storage,'mount-a');
  a.setItem('discstudio.pxc.shelf.v1','one');b.setItem('ignored','two');
  assert.equal(data.get('discstudio.pxc.shelf.v1'),'real user shelf');
  assert.equal(a.getItem(''),'one');assert.equal(b.getItem(''),'two');
  assert.throws(()=>stale.setItem('','lost update'),/another tab/);
  const denied=scopedStorage({getItem:()=> 'original',setItem:()=>{throw Error('quota');}},'denied');
  assert.throws(()=>denied.setItem('','new'),/quota/);assert.equal(denied.getItem(''),'original');
});
