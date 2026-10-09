import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunity, renderCommunity} from './community.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {getItem:key=>values.get(key) ?? null, setItem:(key,value)=>values.set(key,String(value)), removeItem:key=>values.delete(key), values};
}
const ok = result => assert.equal(result.ok, true, JSON.stringify(result));

test('seeds a bounded topic index and applies category plus text search', () => {
  const forum = createCommunity({storage:memoryStorage()});
  const result = forum.list({category:'Resources',query:'style'});
  assert.ok(result.length > 0);
  assert.ok(result.every(topic=>topic.category==='Resources' && /read/i.test(`${topic.title} ${topic.body} ${topic.replies.map(r=>r.body).join(' ')}`)));
  assert.ok(forum.snapshot().threads.length <= 100);
});

test('requires teacher fixture for topic and reply writes, then persists valid writes', () => {
  const storage=memoryStorage();
  const forum=createCommunity({storage});
  assert.equal(forum.createThread({title:'Hello',body:'Body',category:'Community',author:'Teacher'}).error,'authentication_required');
  const created=forum.createThread({title:' Hello ',body:' Body ',category:'Community',author:'Teacher',role:'teacher'});
  ok(created);
  assert.equal(created.value.title,'Hello');
  ok(forum.reply(created.value.id,{body:' Reply ',author:'Teacher',role:'teacher'}));
  assert.equal(forum.getThread(created.value.id).replies.at(-1).body,'Reply');
  assert.ok(storage.values.size>0);
});

test('flags and moderator hide/unhide a thread; hidden threads stay out of public index', () => {
  const forum=createCommunity({storage:memoryStorage()});
  const thread=forum.snapshot().threads[0];
  ok(forum.flag(thread.id,{role:'teacher'}));
  assert.equal(forum.getThread(thread.id).reported,true);
  ok(forum.moderate(thread.id,{hidden:true,role:'moderator'}));
  assert.equal(forum.list().some(item=>item.id===thread.id),false);
  assert.equal(forum.reply(thread.id,{body:'Stale-page reply',role:'teacher'}).error,'thread_unavailable');
  assert.equal(forum.flag(thread.id,{role:'teacher'}).error,'thread_unavailable');
  assert.equal(forum.vote(thread.id,{role:'teacher'}).error,'thread_unavailable');
  assert.equal(forum.list({role:'moderator'}).find(item=>item.id===thread.id).hidden,true);
  ok(forum.moderate(thread.id,{hidden:false,role:'moderator'}));
  assert.equal(forum.getThread(thread.id).hidden,false);
});

test('render keeps fixture-hostile text as literal node content and exposes delegated events', () => {
  const forum=createCommunity({storage:memoryStorage()});
  const created=forum.createThread({title:'<script>alert(1)</script>',body:'literal & <b>tag</b>',category:'Questions',role:'teacher'});
  ok(created);
  const tree=renderCommunity({route:{page:'thread',threadId:created.value.id},state:forum.snapshot(),session:{role:'teacher'}});
  const all=[];
  const walk=node=>{if(!node||typeof node!=='object')return;all.push(node);for(const child of node.children||[])walk(child)};
  walk(tree);
  assert.ok(all.some(node=>node.children?.includes('<script>alert(1)</script>')));
  assert.ok(all.some(node=>node.attrs?.['data-event']==='forum-flag-thread'));
  assert.ok(all.some(node=>node.attrs?.['data-submit']==='forum-reply'));
});

test('restores only validated bounded state, tolerates storage failure, and reset restores seeds', () => {
  const storage=memoryStorage({['hh-forum-v1']:'{"threads":[{"id":"bad"}]}' });
  const forum=createCommunity({storage});
  assert.ok(forum.snapshot().threads.every(thread=>thread.title && Array.isArray(thread.replies)));
  const broken={getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}};
  const degraded=createCommunity({storage:broken});
  assert.equal(degraded.snapshot().storageStatus,'unavailable');
  assert.ok(degraded.snapshot().threads.length>0);
  ok(degraded.reset());
  assert.ok(degraded.snapshot().threads.length>0);
});

test('rejects duplicate IDs and oversized timestamps during restore, and exposes volatile writes', () => {
  const base={id:'same',title:'Good',body:'Body',category:'Questions',author:'Teacher',createdAt:'2026-10-01T09:00:00.000Z',hidden:false,reported:false,replies:[]};
  const invalid={version:1,nextId:1,threads:[base,{...base,createdAt:'x'.repeat(5000)}]};
  const storage=memoryStorage({'hh-forum-v1':JSON.stringify(invalid)});
  const forum=createCommunity({storage});
  assert.equal(forum.snapshot().threads[0].id,'topic-forum-styling-guide','invalid duplicate IDs and timestamp data fall back to fixtures');
  assert.equal(forum.snapshot().storageStatus,'unavailable');
  const memoryOnly=createCommunity({storage:null});
  const created=memoryOnly.createThread({title:'Local',body:'Only in memory',category:'Community',role:'teacher'});
  ok(created);
  assert.equal(created.warning,'volatile_storage');
  assert.equal(memoryOnly.snapshot().storageStatus,'memory_only');
  assert.equal(memoryOnly.reset().value.storageStatus,'memory_only');
});

test('rejects malformed duplicate restores and reports failed writes without losing the in-memory result', () => {
  const blocked={getItem(){return null},setItem(){throw Error('quota exceeded')},removeItem(){throw Error('blocked')}};
  const forum=createCommunity({storage:blocked});
  const result=forum.createThread({title:'Can still read',body:'Stored only for this page',category:'Community',role:'teacher'});
  ok(result);
  assert.equal(result.warning,'storage_unavailable');
  assert.ok(forum.getThread(result.value.id,{role:'teacher'}));
  assert.equal(forum.snapshot().storageStatus,'unavailable');
});

test('keeps generated IDs monotonic across reload, and enforces title and per-persona vote bounds', () => {
  const storage=memoryStorage();
  const first=createCommunity({storage});
  assert.equal(first.createThread({title:'x'.repeat(256),body:'Body',category:'Community',role:'teacher'}).error,'input_too_long');
  const post=first.createThread({title:'Local title',body:'Local body',category:'Community',role:'teacher'});
  ok(post);
  const second=createCommunity({storage});
  const next=second.createThread({title:'Second title',body:'Second body',category:'Questions',role:'teacher'});
  ok(next);
  assert.notEqual(next.value.id,post.value.id);
  const up=second.vote(post.value.id,{role:'teacher',personaId:'teacher-1'});ok(up);
  assert.deepEqual([up.value.upvotes,up.value.downvotes,up.value.voted],[1,0,'upvote']);
  const removed=second.vote(post.value.id,{role:'teacher',personaId:'teacher-1'});ok(removed);
  assert.deepEqual([removed.value.upvotes,removed.value.downvotes,removed.value.voted],[0,0,null]);
  const down=second.vote(post.value.id,{role:'teacher',personaId:'teacher-1',direction:'downvote'});ok(down);
  assert.deepEqual([down.value.upvotes,down.value.downvotes,down.value.voted],[0,1,'downvote']);
  ok(second.vote(post.value.id,{role:'teacher',personaId:'teacher-1',direction:'upvote'}));
  const restored=createCommunity({storage});
  assert.deepEqual(restored.getThread(post.value.id).votes,['teacher-1']);
  assert.deepEqual(restored.getThread(post.value.id).downvotes,[]);
});

test('round-trips human-readable fixture persona IDs and rejects malformed persisted flags', () => {
  const storage=memoryStorage();
  const first=createCommunity({storage});
  const post=first.createThread({title:'Human fixture id',body:'Saved by local teacher',category:'Community',role:'teacher',authorId:'teacher 7'});
  ok(post);
  ok(first.vote(post.value.id,{role:'teacher',personaId:'teacher 7'}));
  const restored=createCommunity({storage});
  assert.equal(restored.getThread(post.value.id,{role:'teacher'}).authorId,'teacher 7');
  assert.deepEqual(restored.getThread(post.value.id,{role:'teacher'}).votes,['teacher 7']);
  const invalidTopic={...restored.getThread(post.value.id,{role:'teacher'}),hidden:'false'};
  const invalidStore=memoryStorage({'hh-forum-v1':JSON.stringify({version:1,nextId:1,threads:[invalidTopic]})});
  assert.equal(createCommunity({storage:invalidStore}).snapshot().threads[0].id,'topic-forum-styling-guide');
});

test('surfaces a throwing default sessionStorage getter without breaking the local store', () => {
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
  if(descriptor&&!descriptor.configurable)return;
  try{
    Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw Error('storage access denied')}});
    const forum=createCommunity();
    assert.equal(forum.snapshot().storageStatus,'unavailable');
    const result=forum.createThread({title:'Still usable',body:'Memory action succeeds',category:'Community',role:'teacher'});
    ok(result);
    assert.equal(result.warning,'storage_unavailable');
    assert.ok(forum.getThread(result.value.id,{role:'teacher'}));
  } finally {
    if(descriptor)Object.defineProperty(globalThis,'sessionStorage',descriptor);
    else delete globalThis.sessionStorage;
  }
});

test('matches captured public forum titles, newest/oldest/upvote ordering, and visible source controls', () => {
  const state=createCommunity({storage:null}).snapshot();
  const cardIds=sort=>{const tree=renderCommunity({route:{page:'forum'},state:{...state,sort},session:{role:'anonymous'}});const found=[];const walk=node=>{if(!node||typeof node!=='object')return;if(node.attrs?.class?.includes('community-topic '))found.push(node.attrs['data-thread-id']);for(const child of node.children||[])walk(child)};walk(tree);return found};
  assert.deepEqual(cardIds('date-newest'),['topic-forum-styling-guide','topic-teachers-lounge-open','topic-official-bug-forum']);
  assert.deepEqual(cardIds('date-oldest'),['topic-official-bug-forum','topic-teachers-lounge-open','topic-forum-styling-guide']);
  assert.deepEqual(cardIds('upvotes'),['topic-official-bug-forum','topic-forum-styling-guide','topic-teachers-lounge-open']);
  const tree=renderCommunity({route:{page:'forum'},state,session:{role:'anonymous'}}),nodes=[];const walk=node=>{if(!node||typeof node!=='object')return;nodes.push(node);for(const child of node.children||[])walk(child)};walk(tree);
  for(const id of ['post-search-input','sort-date-newest','sort-date-oldest','sort-upvotes','create-post-btn'])assert.ok(nodes.some(node=>node.attrs?.id===id));
  assert.ok(nodes.some(node=>node.attrs?.['data-event']==='forum-role'));
  assert.equal(nodes.find(node=>node.attrs?.id==='community-main')?.attrs?.tabindex,'-1');
  for(const id of ['community-role-select','community-category-select','forum-clear-search'])assert.ok(nodes.some(node=>node.attrs?.id===id));
  const ids=nodes.map(node=>node.attrs?.id).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length,'every focus-restorable forum control ID is unique on the index');
});

test('keeps the full local post while rendering the source-length forum excerpt and icon controls', () => {
  const forum=createCommunity({storage:null}),body='Local synthetic excerpt text. '.repeat(12);
  const created=forum.createThread({title:'Local long excerpt fixture',body,category:'Community',role:'teacher'});
  ok(created);
  const state=forum.snapshot(),index=renderCommunity({route:{page:'forum'},state,session:{role:'teacher'}}),nodes=[];
  const walk=node=>{if(!node||typeof node!=='object')return;nodes.push(node);for(const child of node.children||[])walk(child)};walk(index);
  const topic=nodes.find(node=>node.attrs?.['data-thread-id']===created.value.id&&node.attrs?.class?.includes('community-topic'));
  const excerptNodes=[];const walkTopic=node=>{if(!node||typeof node!=='object')return;if(node.attrs?.class==='community-topic-body')excerptNodes.push(node);for(const child of node.children||[])walkTopic(child)};walkTopic(topic);
  assert.equal(excerptNodes.length,1);
  assert.equal(excerptNodes[0].children[0].length,203);
  assert.ok(excerptNodes[0].children[0].endsWith('...'));
  assert.ok(nodes.some(node=>node.attrs?.['data-event']==='forum-vote'&&node.attrs?.['data-post-id']===created.value.id));
  assert.ok(nodes.some(node=>node.attrs?.class==='community-card-icon'&&node.children?.includes('💬')));
  const detail=renderCommunity({route:{page:'post',threadId:created.value.id},state,session:{role:'teacher'}}),detailNodes=[];
  const walkDetail=node=>{if(!node||typeof node!=='object')return;detailNodes.push(node);for(const child of node.children||[])walkDetail(child)};walkDetail(detail);
  assert.ok(JSON.stringify(detail).includes(body.trim()),'post detail retains the full body');
});

test('renders source-shaped forum controls and author-owned post/comment operations work locally', () => {
  const forum=createCommunity({storage:memoryStorage()});
  const created=forum.createThread({title:'A source-shaped discussion',body:'Local test body',category:'Questions',role:'teacher',authorId:'teacher-7'});
  ok(created);
  const added=forum.reply(created.value.id,{body:'Local comment',role:'teacher',authorId:'teacher-7'});
  ok(added);
  ok(forum.updatePost(created.value.id,{title:'Edited locally',role:'teacher',personaId:'teacher-7'}));
  assert.equal(forum.updatePost(created.value.id,{title:'Not owner',role:'teacher',personaId:'teacher-8'}).error,'owner_required');
  ok(forum.updateReply(created.value.id,added.value.id,{body:'Edited comment',role:'teacher',personaId:'teacher-7'}));
  const pageThreads=Array.from({length:12},(_,i)=>({...created.value,id:`topic-preview-${i}`,createdAt:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00.000Z`,replies:[]}));
  const index=renderCommunity({route:{page:'forum'},state:{...forum.snapshot(),threads:pageThreads},session:{role:'teacher',personaId:'teacher-7'}});
  const nodes=[];const walk=node=>{if(!node||typeof node!=='object')return;nodes.push(node);for(const child of node.children||[])walk(child)};walk(index);
  assert.equal(nodes.filter(node=>node.attrs?.class?.includes('community-topic ')).length,10);
  for(const event of ['forum-search','forum-sort','forum-load-more'])assert.ok(nodes.some(node=>node.attrs?.['data-event']===event));
  const searchTree=renderCommunity({route:{page:'forum'},state:{...forum.snapshot(),query:'local'},session:{role:'teacher'}});
  const searchNodes=[];const walkSearch=node=>{if(!node||typeof node!=='object')return;searchNodes.push(node);for(const child of node.children||[])walkSearch(child)};walkSearch(searchTree);
  assert.ok(searchNodes.some(node=>node.attrs?.['data-event']==='forum-clear-search'));
  const detail=renderCommunity({route:{page:'post',threadId:created.value.id},state:{...forum.snapshot(),editingPostId:created.value.id,editingReplyId:added.value.id},session:{role:'teacher',personaId:'teacher-7'}});
  const detailNodes=[];const walkDetail=node=>{if(!node||typeof node!=='object')return;detailNodes.push(node);for(const child of node.children||[])walkDetail(child)};walkDetail(detail);
  assert.ok(detailNodes.some(node=>node.attrs?.['data-submit']==='forum-reply'));
  assert.ok(detailNodes.some(node=>node.attrs?.['data-submit']==='forum-edit-post'));
  assert.ok(detailNodes.some(node=>node.attrs?.['data-submit']==='forum-edit-comment'));
  assert.ok(detailNodes.some(node=>node.attrs?.id==='comment-content'&&node.attrs?.name==='content'));
  assert.ok(detailNodes.some(node=>node.attrs?.['data-direction']==='downvote'));
  assert.ok(detailNodes.some(node=>node.attrs?.id==='upvote-btn'));
  assert.ok(detailNodes.some(node=>node.attrs?.id==='downvote-btn'));
  assert.ok(detailNodes.some(node=>node.attrs?.id==='comment-form'));
  for(const id of ['community-main','comment-content','post-comment-btn','edit-post-form','edit-post-title','edit-post-content','save-edit-post-btn','edit-comment-form-'+added.value.id,'edit-comment-content-'+added.value.id,'save-edit-comment-btn-'+added.value.id])assert.ok(detailNodes.some(node=>node.attrs?.id===id));
  const detailIds=detailNodes.map(node=>node.attrs?.id).filter(Boolean);
  assert.equal(new Set(detailIds).size,detailIds.length,'detail and active edit control IDs are unique');
  const missing=renderCommunity({route:{page:'post'},state:forum.snapshot(),session:{role:'anonymous'}});
  const missingNodes=[];const walkMissing=node=>{if(!node||typeof node!=='object')return;missingNodes.push(node);for(const child of node.children||[])walkMissing(child)};walkMissing(missing);
  assert.ok(missingNodes.some(node=>node.attrs?.id==='page-title'&&node.children?.includes('Discussion Detail')));
  assert.ok(missingNodes.some(node=>node.attrs?.href==='#/forum'&&node.children?.includes('← Back to Forum')));
  assert.ok(missingNodes.some(node=>node.attrs?.class?.includes('community-missing-card')));
  assert.ok(missingNodes.some(node=>node.children?.includes('Error: Post ID is missing from the URL. Please ensure you are navigating from the forum list.')));
  assert.ok(detailNodes.some(node=>node.attrs?.['data-event']==='forum-edit-comment'));
  ok(forum.deleteReply(created.value.id,added.value.id,{role:'teacher',personaId:'teacher-7'}));
  ok(forum.deletePost(created.value.id,{role:'teacher',personaId:'teacher-7'}));
  assert.equal(forum.getThread(created.value.id),null);
});
