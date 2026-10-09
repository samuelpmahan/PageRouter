import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunity,renderCommunity} from '../../vendor/hh/src/community.mjs';

// Independent authored-forum acceptance fixtures. No implementation-derived expected values.
const key='hh-independent-forum';
function memoryStorage(initial){const data=new Map(initial===undefined?[]:[[key,initial]]);return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}
function setup(){const storage=memoryStorage();return {storage,forum:createCommunity({storage,key})}}
function post(forum,extra={}){return forum.createThread({title:'Independent classroom question',body:'A literal local question about fractions.',category:'Questions',author:'Alex Fixture',authorId:'alex-fixture',role:'teacher',...extra})}
const fixture={version:1,nextId:1,threads:[{id:'topic-local-1',title:'Literal saved question',body:'Saved local content',category:'Questions',author:'Alex',authorId:'alex',votes:[],createdAt:'2026-10-08T12:00:00.000Z',hidden:false,reported:false,replies:[]}]};

test('forum writes require explicit teacher/moderator roles, never anonymous authority',()=>{
 const {forum}=setup();const before=forum.exportData();
 assert.equal(post(forum,{role:'anonymous'}).ok,false);
 assert.equal(post(forum,{role:'administrator'}).ok,false);
 assert.equal(forum.moderate('missing',{role:'teacher',hidden:true}).ok,false);
 assert.equal(forum.exportData(),before);
});
test('literal topic, reply, search, category, flag and moderation work without network',()=>{
 const {forum}=setup();const result=post(forum);assert.equal(result.ok,true);const id=result.value.id;
 assert.equal(forum.reply(id,{body:'The unique reply word is mangosteen.',author:'Sam',role:'teacher'}).ok,true);
 assert.deepEqual(forum.list({query:'MANGOSTEEN',category:'Questions'}).map(t=>t.id),[id]);
 assert.deepEqual(forum.list({query:'mangosteen',category:'Resources'}),[]);
 assert.equal(forum.flag(id,{role:'teacher'}).ok,true);assert.equal(forum.getThread(id).reported,true);
 assert.equal(forum.moderate(id,{hidden:true,role:'moderator'}).ok,true);
 assert.equal(forum.getThread(id),null);assert.equal(forum.list({query:'mangosteen'}).length,0);
 assert.equal(forum.getThread(id,{role:'moderator'}).hidden,true);
 assert.equal(forum.moderate(id,{hidden:false,role:'moderator'}).ok,true);
 assert.equal(forum.getThread(id).reported,false);
});
test('hidden discussion cannot receive teacher replies, reports or votes through stale IDs',()=>{
 const {forum}=setup();const id=post(forum).value.id;forum.moderate(id,{hidden:true,role:'moderator'});
 const before=forum.exportData();
 assert.equal(forum.reply(id,{body:'A stale URL write',role:'teacher'}).ok,false);
 assert.equal(forum.flag(id,{role:'teacher'}).ok,false);
 assert.equal(forum.vote(id,{role:'teacher',personaId:'other'}).ok,false);
 assert.equal(forum.exportData(),before);
});
test('owner editing and one vote per persona with repeat-toggle preserve permissions',()=>{
 const {forum}=setup();const id=post(forum).value.id;
 assert.equal(forum.updatePost(id,{title:'Intruder edit',role:'teacher',personaId:'intruder'}).ok,false);
 assert.equal(forum.updatePost(id,{title:'An edited question',role:'teacher',personaId:'alex-fixture'}).ok,true);
 assert.equal(forum.getThread(id).title,'An edited question');
 assert.equal(forum.vote(id,{role:'teacher',personaId:'other'}).ok,true);
 assert.equal(forum.getThread(id).votes.length,1);
 assert.equal(forum.vote(id,{role:'teacher',personaId:'other'}).ok,true);
 assert.equal(forum.getThread(id).votes.length,0,'Repeating the same vote toggles it off, rather than accumulating duplicate votes');
});
test('saved state restores exactly, ID sequence remains unique, reset removes local data',()=>{
 const {forum,storage}=setup();const first=post(forum).value.id;forum.reply(first,{body:'Saved reply',role:'teacher'});
 const saved=forum.snapshot().threads;const restored=createCommunity({storage,key});
 const normalized=threads=>threads.map(t=>({...t,downvotes:t.downvotes||[]}));
 assert.deepEqual(normalized(restored.snapshot().threads),normalized(saved),'Saved records, votes and replies survive; legacy missing downvotes means an empty list');
 const second=post(restored,{title:'Second independent question'}).value.id;assert.notEqual(first,second);
 assert.equal(restored.reset().ok,true);assert.equal(storage.getItem(key),null);
 assert.equal(restored.getThread(first),null);
});
test('invalid JSON, duplicate IDs, excess collection size and invalid timestamps restore seeds',()=>{
 const seed=createCommunity({storage:memoryStorage(),key}).snapshot().threads;
 for(const value of ['{broken',JSON.stringify({...fixture,threads:[fixture.threads[0],fixture.threads[0]]}),JSON.stringify({...fixture,threads:Array(101).fill(fixture.threads[0])}),JSON.stringify({...fixture,threads:[{...fixture.threads[0],createdAt:'not-a-date'}]})]){
  assert.deepEqual(createCommunity({storage:memoryStorage(value),key}).snapshot().threads,seed);
 }
});
test('malformed stored booleans are rejected rather than coercing strings to moderation flags',()=>{
 const seed=createCommunity({storage:memoryStorage(),key}).snapshot().threads;
 for(const field of ['hidden','reported']){const malformed=JSON.stringify({...fixture,threads:[{...fixture.threads[0],[field]:'false'}]});
  assert.deepEqual(createCommunity({storage:memoryStorage(malformed),key}).snapshot().threads,seed);
 }
});
test('modest input/count bounds reject rather than silently truncate or mutate',()=>{
 const {forum}=setup();const before=forum.exportData();
 assert.equal(post(forum,{title:'x'.repeat(256)}).ok,false);
 assert.equal(post(forum,{body:'x'.repeat(10001)}).ok,false);
 assert.equal(post(forum,{category:'invented'}).ok,false);assert.equal(forum.exportData(),before);
 while(forum.snapshot().threads.length<100)assert.equal(post(forum).ok,true);
 const capped=forum.exportData();assert.equal(post(forum).ok,false);assert.equal(forum.exportData(),capped);
});
test('declared500 reply and1MB restore limits reject modest boundary fixtures',()=>{
 const replies=Array.from({length:500},(_,i)=>({id:`reply-local-${i+2}`,body:'Literal bounded reply',author:'Alex',authorId:'alex',createdAt:'2026-10-08T12:00:00.000Z',hidden:false,reported:false}));
 const saved=JSON.stringify({...fixture,nextId:501,threads:[{...fixture.threads[0],replies}]});
 const forum=createCommunity({storage:memoryStorage(saved),key});assert.equal(forum.getThread('topic-local-1').replies.length,500);
 const before=forum.exportData();assert.equal(forum.reply('topic-local-1',{body:'One beyond the declaredcap',role:'teacher'}).ok,false);assert.equal(forum.exportData(),before);
 const oversized=createCommunity({storage:memoryStorage('x'.repeat(1_000_001)),key});assert.equal(oversized.snapshot().storageStatus,'unavailable');assert.ok(oversized.snapshot().threads.length<=100);
});
test('storage failure keeps bounded memory changes and exposes the failure',()=>{
 const storage={getItem:()=>null,setItem:()=>{throw Error('Independent blocked storage')},removeItem:()=>{throw Error('Independent blocked storage')}};
 const forum=createCommunity({storage,key});const result=post(forum);assert.equal(result.ok,true);
 assert.equal(result.warning,'storage_unavailable');assert.equal(forum.snapshot().storageStatus,'unavailable');
 assert.equal(forum.getThread(result.value.id).body,'A literal local question about fractions.');
});
test('returned records and pure render tree cannot poison retained forum content',()=>{
 const {forum}=setup();const result=post(forum);const id=result.value.id;result.value.title='Poisoned';
 const snapshot=forum.snapshot();const serialized=JSON.stringify(snapshot);
 const tree=renderCommunity({route:{page:'thread',threadId:id},state:snapshot,session:{role:'teacher'}});
 assert.equal(JSON.stringify(snapshot),serialized);snapshot.threads.find(t=>t.id===id).body='Poisoned';
 assert.equal(forum.getThread(id).title,'Independent classroom question');
 assert.equal(forum.getThread(id).body,'A literal local question about fractions.');
 assert.ok(JSON.stringify(tree).includes('Independent classroom question'));
});
