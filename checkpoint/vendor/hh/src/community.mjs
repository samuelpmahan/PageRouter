/** Local, bounded forum preview. It has no network or account-service dependency. */
import {node as h} from './teacher-journey.mjs';

export const COMMUNITY_CATEGORIES = Object.freeze(['Classroom','Resources','Questions','Community']);
const DEFAULT_KEY='hh-forum-v1';
const MAX_THREADS=100, MAX_REPLIES=500, MAX_TITLE=255, MAX_BODY=10000;
const MAX_STORAGE_CHARS=1_000_000;
const roles=new Set(['teacher','moderator','anonymous']);
const seedThreads=[
  {id:'topic-forum-styling-guide',title:'Forum Styling Guide',body:'To style your text, wrap your words in the tags shown below.\n\n1. Bold Text...\nRead these local examples to explore discussion formatting.',category:'Resources',author:'User 5',authorId:'seed-user-5',votes:['seed-upvote-1'],createdAt:'2026-04-16T02:41:00.000Z',hidden:false,reported:false,replies:[]},
  {id:'topic-teachers-lounge-open',title:"The Teachers' Lounge is Open",body:"We're thrilled to launch this dedicated space just for educators like you! The Homeroom Heroes Forum is designed to be your quick, reliable resource for peer-to-peer support, sharing creative solutions.",category:'Community',author:'User 5',authorId:'seed-user-5',votes:['seed-upvote-1'],createdAt:'2025-11-12T04:51:00.000Z',hidden:false,reported:false,replies:[]},
  {id:'topic-official-bug-forum',title:'Official Bug Forum',body:'Please comment below if you run into any significant bugs. We are doing our best to patch bugs as we find them. This is a synthetic local discussion example.',category:'Questions',author:'User 5',authorId:'seed-user-5',votes:['seed-upvote-1','seed-upvote-2'],createdAt:'2025-11-12T04:50:00.000Z',hidden:false,reported:false,replies:[{id:'reply-bug-example-1',body:'This is a local example comment.',author:'User 5',authorId:'seed-user-5',createdAt:'2025-11-12T05:00:00.000Z',hidden:false,reported:false},{id:'reply-bug-example-2',body:'Comments are kept in this tab only.',author:'User 5',authorId:'seed-user-5',createdAt:'2025-11-12T05:05:00.000Z',hidden:false,reported:false}]}
];
const clone=value=>JSON.parse(JSON.stringify(value));
const cleanText=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
const safeRole=role=>roles.has(role)?role:'anonymous';
const validId=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/i.test(value);
const validActorId=value=>typeof value==='string'&&value.trim().length>0&&value.length<=80&&!/[\u0000-\u001f]/.test(value);
const validTimestamp=value=>typeof value==='string'&&value.length<=32&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const validTopic=t=>t&&typeof t==='object'&&validId(t.id)&&typeof t.title==='string'&&t.title.length>0&&t.title.length<=MAX_TITLE&&typeof t.body==='string'&&t.body.length>0&&t.body.length<=MAX_BODY&&COMMUNITY_CATEGORIES.includes(t.category)&&typeof t.author==='string'&&t.author.length>0&&t.author.length<=80&&(!('authorId'in t)||validActorId(t.authorId))&&validTimestamp(t.createdAt)&&typeof t.hidden==='boolean'&&typeof t.reported==='boolean'&&Array.isArray(t.votes||[])&&(t.votes||[]).length<=MAX_THREADS&&(t.votes||[]).every(validActorId)&&Array.isArray(t.downvotes||[])&&(t.downvotes||[]).length<=MAX_THREADS&&(t.downvotes||[]).every(validActorId)&&!(t.votes||[]).some(id=>(t.downvotes||[]).includes(id))&&Array.isArray(t.replies)&&t.replies.length<=MAX_REPLIES&&t.replies.every(validReply);
function validReply(r){return !!r&&typeof r==='object'&&validId(r.id)&&typeof r.body==='string'&&r.body.length>0&&r.body.length<=MAX_BODY&&typeof r.author==='string'&&r.author.length>0&&r.author.length<=80&&(!('authorId'in r)||validActorId(r.authorId))&&validTimestamp(r.createdAt)&&typeof r.hidden==='boolean'&&typeof r.reported==='boolean'}
function sanitizeTopic(t){return {id:t.id,title:t.title,body:t.body,category:t.category,author:t.author,authorId:t.authorId||'legacy',votes:Array.isArray(t.votes)?t.votes.filter(validActorId).slice(0,MAX_THREADS):[],downvotes:Array.isArray(t.downvotes)?t.downvotes.filter(validActorId).slice(0,MAX_THREADS):[],createdAt:t.createdAt,hidden:!!t.hidden,reported:!!t.reported,replies:t.replies.map(r=>({id:r.id,body:r.body,author:r.author,authorId:r.authorId||'legacy',createdAt:r.createdAt,hidden:!!r.hidden,reported:!!r.reported}))}}
const resultError=error=>({ok:false,error});

export function createCommunity(options={}) {
  const key=options.key||DEFAULT_KEY;
  let storage=options.storage, storageError='';
  if(!Object.hasOwn(options,'storage'))try{storage=globalThis.sessionStorage}catch(error){storageError=String(error?.message||error)}
  let data=clone(seedThreads), storageStatus=storageError?'unavailable':storage?'available':'memory_only', counter=0;
  const threadCount=()=>data.length;
  const replyCount=()=>data.reduce((n,t)=>n+t.replies.length,0);
  try {
    const stored=storage?.getItem(key);
    if(stored){
      if(typeof stored!=='string'||stored.length>MAX_STORAGE_CHARS)throw Error('stored forum data exceeds the local size limit');
      const parsed=JSON.parse(stored);
      let valid=false;
      if(parsed&&parsed.version===1&&Array.isArray(parsed.threads)&&parsed.threads.length<=MAX_THREADS&&parsed.threads.every(t=>t&&Array.isArray(t.replies)&&t.replies.length<=MAX_REPLIES)){
        const totalReplies=parsed.threads.reduce((count,t)=>count+t.replies.length,0);
        if(totalReplies<=MAX_REPLIES&&parsed.threads.every(validTopic)){
          const allIds=parsed.threads.flatMap(t=>[t.id,...t.replies.map(reply=>reply.id)]);
          const localIds=allIds.map(id=>/^(?:topic|reply)-local-(\d+)$/.exec(id)).filter(Boolean).map(match=>Number(match[1]));
          valid=Number.isSafeInteger(parsed.nextId)&&parsed.nextId>=0&&parsed.nextId<=1_000_000_000&&parsed.nextId>=(localIds.length?Math.max(...localIds):0)&&new Set(allIds).size===allIds.length;
          if(valid){data=parsed.threads.map(sanitizeTopic);counter=parsed.nextId}
        }
      }
      if(!valid){storageStatus='unavailable';storageError='Saved forum data was invalid; local fixtures were loaded.'}
    }
  } catch(error) {storageStatus='unavailable';storageError=String(error?.message||error)}
  function persist(){
    try {const serialized=JSON.stringify({version:1,nextId:counter,threads:data});if(serialized.length>MAX_STORAGE_CHARS)throw Error('forum data exceeds the local storage size limit');storage?.setItem(key,serialized);if(storage){storageStatus='available';storageError=''}}
    catch(error){storageStatus='unavailable';storageError=String(error?.message||error)}
  }
  const findThread=id=>data.find(t=>t.id===String(id));
  const accessibleThread=(id,role)=>{const topic=findThread(id);return topic&&(safeRole(role)==='moderator'||!topic.hidden)?topic:null};
  function snapshot(){return {threads:clone(data),storageStatus,storageError,limits:{threads:MAX_THREADS,replies:MAX_REPLIES}}}
  function persistenceWarning(){return storageStatus==='unavailable'?'storage_unavailable':storageStatus==='memory_only'?'volatile_storage':undefined}
  function list({category='All',query='',role='anonymous'}={}) {
    const normalized=cleanText(query,MAX_BODY).toLocaleLowerCase();
    return clone(data.filter(t=>{
      if(t.hidden&&safeRole(role)!=='moderator')return false;
      if(category!=='All'&&!COMMUNITY_CATEGORIES.includes(category))return false;
      if(category!=='All'&&t.category!==category)return false;
      const replyText=t.replies.filter(r=>!r.hidden||safeRole(role)==='moderator').map(r=>r.body).join(' ');
      return !normalized||`${t.title} ${t.body} ${replyText}`.toLocaleLowerCase().includes(normalized);
    }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
  }
  function getThread(id,{role='anonymous'}={}) {
    const topic=findThread(id);
    if(!topic||topic.hidden&&safeRole(role)!=='moderator')return null;
    const copy=clone(topic);
    if(safeRole(role)!=='moderator')copy.replies=copy.replies.filter(r=>!r.hidden);
    return copy;
  }
  function createThread({title,body,category,author='Demo Teacher',authorId='demo-teacher',role='anonymous'}={}) {
    if(safeRole(role)!=='teacher')return resultError('authentication_required');
    const cleanedTitle=cleanText(title,MAX_TITLE),cleanedBody=cleanText(body,MAX_BODY),cleanedAuthor=cleanText(author,80)||'Demo Teacher';
    if(!cleanedTitle||!cleanedBody)return resultError('title_and_body_required');
    if(typeof title==='string'&&title.trim().length>MAX_TITLE||typeof body==='string'&&body.trim().length>MAX_BODY)return resultError('input_too_long');
    if(!COMMUNITY_CATEGORIES.includes(category))return resultError('invalid_category');
    if(threadCount()>=MAX_THREADS)return resultError('thread_limit_reached');
    const topic={id:`topic-local-${++counter}`,title:cleanedTitle,body:cleanedBody,category,author:cleanedAuthor,authorId:cleanText(authorId,80)||'demo-teacher',votes:[],downvotes:[],createdAt:new Date().toISOString(),hidden:false,reported:false,replies:[]};
    data.push(topic);persist();const warning=persistenceWarning();return {ok:true,value:clone(topic),...(warning?{warning}:{})};
  }
  function reply(threadId,{body,author='Demo Teacher',authorId='demo-teacher',role='anonymous'}={}) {
    if(safeRole(role)!=='teacher')return resultError('authentication_required');
    const topic=accessibleThread(threadId,role);if(!topic)return resultError('thread_unavailable');
    const cleaned=cleanText(body,MAX_BODY);if(!cleaned)return resultError('reply_required');
    if(typeof body==='string'&&body.trim().length>MAX_BODY)return resultError('input_too_long');
    if(replyCount()>=MAX_REPLIES)return resultError('reply_limit_reached');
    const value={id:`reply-local-${++counter}`,body:cleaned,author:cleanText(author,80)||'Demo Teacher',authorId:cleanText(authorId,80)||'demo-teacher',createdAt:new Date().toISOString(),hidden:false,reported:false};
    topic.replies.push(value);persist();const warning=persistenceWarning();return {ok:true,value:clone(value),...(warning?{warning}:{})};
  }
  function flag(threadId,{replyId,role='anonymous'}={}) {
    if(safeRole(role)!=='teacher')return resultError('authentication_required');
    const topic=accessibleThread(threadId,role);if(!topic)return resultError('thread_unavailable');
    const target=replyId?topic.replies.find(r=>r.id===replyId):topic;
    if(!target)return resultError('reply_not_found');
    if(target.hidden&&safeRole(role)!=='moderator')return resultError('reply_unavailable');
    target.reported=true;persist();const warning=persistenceWarning();return {ok:true,value:clone(target),...(warning?{warning}:{})};
  }
  function moderate(id,{hidden,role='anonymous',replyId}={}) {
    if(safeRole(role)!=='moderator')return resultError('moderator_required');
    const topic=findThread(id);if(!topic)return resultError('thread_not_found');
    const target=replyId?topic.replies.find(r=>r.id===replyId):topic;
    if(!target)return resultError('reply_not_found');
    target.hidden=!!hidden;if(!hidden)target.reported=false;persist();const warning=persistenceWarning();return {ok:true,value:clone(target),...(warning?{warning}:{})};
  }
  function vote(id,{role='anonymous',personaId='demo-teacher',direction='upvote'}={}){
    if(safeRole(role)!=='teacher')return resultError('authentication_required');
    const topic=accessibleThread(id,role);if(!topic)return resultError('thread_unavailable');
    const voter=cleanText(personaId,80);if(!voter)return resultError('invalid_persona');
    topic.votes=Array.isArray(topic.votes)?topic.votes:[];
    topic.downvotes=Array.isArray(topic.downvotes)?topic.downvotes:[];
    if(!['upvote','downvote'].includes(direction))return resultError('invalid_vote');
    const target=direction==='upvote'?topic.votes:topic.downvotes,other=direction==='upvote'?topic.downvotes:topic.votes;
    if(target.includes(voter))target.splice(target.indexOf(voter),1);else{if(target.length>=MAX_THREADS)return resultError('vote_limit_reached');other.splice(other.indexOf(voter),other.includes(voter)?1:0);target.push(voter)}
    persist();const warning=persistenceWarning();return {ok:true,value:{id:topic.id,upvotes:topic.votes.length,downvotes:topic.downvotes.length,score:topic.votes.length-topic.downvotes.length,voted:topic.votes.includes(voter)?'upvote':topic.downvotes.includes(voter)?'downvote':null},...(warning?{warning}:{})};
  }
  function updatePost(id,{title,body,role='anonymous',personaId='demo-teacher'}={}){
    const topic=findThread(id);if(!topic)return resultError('thread_not_found');
    if(topic.hidden&&safeRole(role)!=='moderator')return resultError('thread_unavailable');
    if(safeRole(role)!=='moderator'&&!(safeRole(role)==='teacher'&&topic.authorId===personaId))return resultError('owner_required');
    const nextTitle=title===undefined?topic.title:cleanText(title,MAX_TITLE),nextBody=body===undefined?topic.body:cleanText(body,MAX_BODY);
    if(!nextTitle||!nextBody)return resultError('title_and_body_required');
    if(typeof title==='string'&&title.trim().length>MAX_TITLE||typeof body==='string'&&body.trim().length>MAX_BODY)return resultError('input_too_long');
    topic.title=nextTitle;topic.body=nextBody;persist();const warning=persistenceWarning();return {ok:true,value:clone(topic),...(warning?{warning}:{})};
  }
  function deletePost(id,{role='anonymous',personaId='demo-teacher'}={}){
    const index=data.findIndex(t=>t.id===String(id));if(index<0)return resultError('thread_not_found');
    if(data[index].hidden&&safeRole(role)!=='moderator')return resultError('thread_unavailable');
    if(safeRole(role)!=='moderator'&&!(safeRole(role)==='teacher'&&data[index].authorId===personaId))return resultError('owner_required');
    const [removed]=data.splice(index,1);persist();const warning=persistenceWarning();return {ok:true,value:clone(removed),...(warning?{warning}:{})};
  }
  function updateReply(id,replyId,{body,role='anonymous',personaId='demo-teacher'}={}){
    const topic=findThread(id);if(!topic)return resultError('thread_not_found');
    if(topic.hidden&&safeRole(role)!=='moderator')return resultError('thread_unavailable');
    const item=topic.replies.find(r=>r.id===String(replyId));if(!item)return resultError('reply_not_found');
    if(item.hidden&&safeRole(role)!=='moderator')return resultError('reply_unavailable');
    if(safeRole(role)!=='moderator'&&!(safeRole(role)==='teacher'&&item.authorId===personaId))return resultError('owner_required');
    const next=cleanText(body,MAX_BODY);if(!next)return resultError('reply_required');if(typeof body==='string'&&body.trim().length>MAX_BODY)return resultError('input_too_long');
    item.body=next;persist();const warning=persistenceWarning();return {ok:true,value:clone(item),...(warning?{warning}:{})};
  }
  function deleteReply(id,replyId,{role='anonymous',personaId='demo-teacher'}={}){
    const topic=findThread(id);if(!topic)return resultError('thread_not_found');
    if(topic.hidden&&safeRole(role)!=='moderator')return resultError('thread_unavailable');
    const index=topic.replies.findIndex(r=>r.id===String(replyId));if(index<0)return resultError('reply_not_found');
    if(topic.replies[index].hidden&&safeRole(role)!=='moderator')return resultError('reply_unavailable');
    if(safeRole(role)!=='moderator'&&!(safeRole(role)==='teacher'&&topic.replies[index].authorId===personaId))return resultError('owner_required');
    const [removed]=topic.replies.splice(index,1);persist();const warning=persistenceWarning();return {ok:true,value:clone(removed),...(warning?{warning}:{})};
  }
  function reset(){data=clone(seedThreads);counter=0;try{storage?.removeItem(key);storageStatus=storage?'available':'memory_only';storageError=''}catch(error){storageStatus='unavailable';storageError=String(error?.message||error)}const warning=persistenceWarning();return {ok:true,value:snapshot(),...(warning?{warning}:{})}}
  function exportData(){return JSON.stringify({version:1,nextId:counter,threads:data},null,2)}
  return Object.freeze({snapshot,list,getThread,createThread,reply,flag,moderate,vote,updatePost,deletePost,updateReply,deleteReply,reset,exportData});
}

const button=(label,event,attrs={})=>h('button',{type:'button','data-event':event,...attrs},label);
const p=(text,cls)=>h('p',{class:cls},text);
function formatDate(value){const date=new Date(value);const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getUTCMonth()];const time=date.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'UTC'});return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${time}`}
const categorySelect=(selected)=>h('label',{class:'community-filter'},h('span',{},'Category'),h('select',{id:'community-category-select','data-event':'forum-category','aria-label':'Filter topics by category'},['All',...COMMUNITY_CATEGORIES].map(name=>h('option',{value:name,selected:name===selected},name))));
const roleOf=session=>safeRole(session?.role);
function notice(text,kind='info'){return text?h('div',{class:`community-notice ${kind}`,role:'status','aria-live':'polite'},text):null}
function storageNotice(state){
  if(state.storageStatus==='unavailable')return notice('Browser storage is unavailable. New changes remain in this tab only.','warning');
  if(state.storageStatus==='memory_only')return notice('This preview has no session storage. Changes remain in memory until the tab closes.','warning');
  return null;
}
function stateNotice(state){return state.message?notice(String(state.message).replaceAll('_',' ')):null}
function moderationControls(topic,session){
  if(roleOf(session)!=='moderator')return null;
  return topic.hidden?button('Restore topic','forum-unhide-thread',{'data-thread-id':topic.id,class:'community-action'}):button('Hide topic','forum-hide-thread',{'data-thread-id':topic.id,class:'community-action'});
}
function topicCard(topic,session){
  const actor=topic.author.startsWith('User ')?`User: ${topic.author.slice(5)}`:topic.author;
  const replyCount=topic.replies.filter(reply=>!reply.hidden).length;
  const excerpt=topic.body.length>200?`${topic.body.slice(0,200)}...`:topic.body;
  const voteBadge=roleOf(session)==='teacher'
    ?h('button',{type:'button','data-event':'forum-vote','data-post-id':topic.id,'data-thread-id':topic.id,'aria-label':'Upvote discussion',class:'community-stat-button'},h('span',{class:'community-card-icon','aria-hidden':'true'},'👍'),h('span',{},String((topic.votes||[]).length)))
    :h('span',{class:'community-stat-button'},h('span',{class:'community-card-icon','aria-hidden':'true'},'👍'),h('span',{},String((topic.votes||[]).length)));
  const commentsBadge=h('a',{href:`#/posts/${encodeURIComponent(topic.id)}`,'data-event':'forum-open-thread','data-thread-id':topic.id,class:'community-stat-button','aria-label':`${replyCount} comments`},h('span',{class:'community-card-icon','aria-hidden':'true'},'💬'),h('span',{},String(replyCount)));
  return h('article',{class:`community-topic ${topic.hidden?'is-hidden':''}`,'data-thread-id':topic.id},
    h('div',{class:'community-topic-card-heading'},
      h('h2',{},h('a',{href:`#/posts/${encodeURIComponent(topic.id)}`,'data-event':'forum-open-thread','data-thread-id':topic.id},topic.title)),
      h('div',{class:'community-card-stats'},voteBadge,commentsBadge)),
    h('div',{class:'community-topic-meta'},`Posted by ${actor} on ${formatDate(topic.createdAt)}`,topic.reported?h('span',{class:'community-reported'},'Reported'):null,topic.hidden?h('span',{class:'community-hidden'},'Hidden'):null),
    h('div',{class:'community-topic-divider'}),p(excerpt,'community-topic-body'));
}
function topicComposer(){return h('form',{class:'community-composer','data-submit':'forum-topic'},h('h2',{},'New Discussion'),h('label',{class:'community-field'},h('span',{},'Discussion Title'),h('input',{name:'title',maxlength:String(MAX_TITLE),required:true,'aria-label':'Discussion title',placeholder:'Enter a concise and descriptive title'})),h('label',{class:'community-field'},h('span',{},'Category'),h('select',{name:'category',required:true,'aria-label':'Topic category'},COMMUNITY_CATEGORIES.map(c=>h('option',{value:c},c)))),h('label',{class:'community-field'},h('span',{},'Content'),h('textarea',{name:'content',maxlength:String(MAX_BODY),rows:'10',required:true,'aria-label':'Discussion content',placeholder:'Write the full body of your forum post here. Be respectful and informative.'})),h('button',{type:'submit'},'Submit New Post'))}
function replyComposer(threadId){return h('form',{id:'comment-form',class:'community-comment-form','data-submit':'forum-reply','data-thread-id':threadId},h('label',{class:'community-comment-field',for:'comment-content'},h('textarea',{id:'comment-content',name:'content',maxlength:String(MAX_BODY),rows:'5',required:true,'aria-label':'Share your thoughts',placeholder:'Share your thoughts…'})),h('button',{type:'submit',id:'post-comment-btn'},'Post Comment'))}
function replyCard(reply,topic,session,state){const role=roleOf(session),own=role==='teacher'&&reply.authorId===(session.personaId||'demo-teacher'),editing=state.editingReplyId===reply.id;return h('article',{class:`community-reply ${reply.hidden?'is-hidden':''}`,'data-reply-id':reply.id},h('div',{class:'community-reply-meta'},h('strong',{},reply.author),reply.reported?h('span',{class:'community-reported'},'Reported'):null,reply.hidden?h('span',{class:'community-hidden'},'Hidden'):null),editing?h('form',{id:`edit-comment-form-${reply.id}`,class:'community-composer community-edit-form','data-submit':'forum-edit-comment','data-thread-id':topic.id,'data-reply-id':reply.id,'data-comment-id':reply.id},h('label',{class:'community-field'},h('span',{},'Edit comment'),h('textarea',{id:`edit-comment-content-${reply.id}`,name:'content',maxlength:String(MAX_BODY),rows:'4',required:true,'aria-label':'Edit comment content'},reply.body)),h('button',{type:'submit',id:`save-edit-comment-btn-${reply.id}`},'Save comment'),button('Cancel','forum-cancel-edit',{id:`cancel-edit-comment-btn-${reply.id}`,class:'community-action'})):p(reply.body,'community-reply-body'),role==='teacher'&&!reply.reported?button('Report comment','forum-flag-reply',{'data-thread-id':topic.id,'data-reply-id':reply.id,class:'community-action'}):null,own||role==='moderator'?button('Edit comment','forum-edit-comment',{'data-thread-id':topic.id,'data-reply-id':reply.id,'data-comment-id':reply.id,id:`edit-comment-btn-${reply.id}`,class:'community-action'}):null,own||role==='moderator'?button('Delete comment','forum-delete-comment',{'data-thread-id':topic.id,'data-reply-id':reply.id,'data-comment-id':reply.id,class:'community-action'}):null,role==='moderator'?(reply.hidden?button('Restore comment','forum-unhide-reply',{'data-thread-id':topic.id,'data-reply-id':reply.id,class:'community-action'}):button('Hide comment','forum-hide-reply',{'data-thread-id':topic.id,'data-reply-id':reply.id,class:'community-action'})):null)}
function postEditForm(topic){return h('form',{id:'edit-post-form',class:'community-composer community-edit-form','data-submit':'forum-edit-post','data-thread-id':topic.id,'data-post-id':topic.id},h('h2',{},'Edit discussion'),h('label',{class:'community-field'},h('span',{},'Discussion title'),h('input',{id:'edit-post-title',name:'title',maxlength:String(MAX_TITLE),required:true,'aria-label':'Edit discussion title',value:topic.title})),h('label',{class:'community-field'},h('span',{},'Content'),h('textarea',{id:'edit-post-content',name:'content',maxlength:String(MAX_BODY),rows:'8',required:true,'aria-label':'Edit discussion content'},topic.body)),h('button',{type:'submit',id:'save-edit-post-btn'},'Save changes'),button('Cancel','forum-cancel-edit',{id:'cancel-edit-post-btn',class:'community-action'}))}
const voteArrow=direction=>h('svg',{viewBox:'0 0 24 24',width:'20',height:'20','aria-hidden':'true',focusable:'false'},h('path',{d:direction==='up'?'M5 14l7-7 7 7':'M5 10l7 7 7-7',fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'}));
function postDetail(topic,session,state){const role=roleOf(session),own=role==='teacher'&&topic.authorId===(session.personaId||'demo-teacher'),replies=(topic.replies||[]).filter(r=>!r.hidden||role==='moderator'),author=topic.author.startsWith('User ')?topic.author.slice(5):topic.author;return h('div',{},storageNotice(state),stateNotice(state),h('section',{class:'community-detail-page'},h('h1',{id:'page-title'},'Discussion Detail'),h('div',{class:'community-heading-divider'}),h('a',{href:'#/forum',class:'community-back-link'},'← Back to Forum'),h('article',{class:'community-detail-card'},h('div',{class:'community-detail-meta'},h('div',{class:'community-detail-votes'},button(voteArrow('up'),'forum-vote',{'data-post-id':topic.id,'data-thread-id':topic.id,'data-direction':'upvote',id:'upvote-btn','aria-label':'Upvote discussion',class:'community-vote-arrow'}),h('strong',{},String((topic.votes||[]).length)),button(voteArrow('down'),'forum-vote',{'data-post-id':topic.id,'data-thread-id':topic.id,'data-direction':'downvote',id:'downvote-btn','aria-label':'Downvote discussion',class:'community-vote-arrow'})),h('span',{},`Posted by ${author} on ${formatDate(topic.createdAt)}`)),h('div',{class:'community-detail-divider'}),h('h2',{class:'community-detail-title'},topic.title),state.editingPostId===topic.id?postEditForm(topic):h('div',{class:'community-detail-body'},topic.body),own||role==='moderator'?button('Edit post','forum-edit-post',{'data-post-id':topic.id,'data-thread-id':topic.id,id:'edit-post-btn',class:'community-action'}):null,own||role==='moderator'?button('Delete post','forum-delete-post',{'data-post-id':topic.id,'data-thread-id':topic.id,class:'community-action'}):null,role==='teacher'&&!topic.reported?button('Report post','forum-flag-thread',{'data-thread-id':topic.id,class:'community-action'}):null,moderationControls(topic,session),h('div',{class:'community-detail-divider'}),h('h2',{class:'community-leave-comment'},'Leave a Comment'),replyComposer(topic.id),h('h2',{class:'community-comment-count'},`${replies.length} Comments`),h('aside',{class:'community-advertisement'},'Advertisement'),replies.length?replies.map(reply=>replyCard(reply,topic,session,state)):p('No comments yet. Be the first to start the discussion!','community-detail-empty'))))}
function postErrorPage(message){return h('section',{class:'community-detail-page'},h('h1',{id:'page-title'},'Discussion Detail'),h('div',{class:'community-heading-divider'}),h('a',{href:'#/forum',class:'community-back-link'},'← Back to Forum'),h('article',{class:'community-detail-card community-missing-card'},p(message,'community-missing-message')))}
export function renderCommunity({route={page:'index'},state={},session={role:'anonymous'}}={}) {
  const role=roleOf(session), threads=state.threads||[], rawPage=route.page||'index';
  const page=rawPage==='forum'?'index':rawPage==='post'?'thread':rawPage==='create-post'?'compose':rawPage;
  const rolePicker=h('label',{class:'community-role-picker'},h('span',{},'Simulated preview role'),h('select',{id:'community-role-select','data-event':'forum-role','aria-label':'Choose simulated preview role'},['anonymous','teacher','moderator'].map(value=>h('option',{value,selected:value===role},value==='anonymous'?'Visitor':value==='teacher'?'Teacher':'Moderator'))));
  const category=route.category||state.category||'All',query=route.query||state.query||'',sort=state.sort||'date-newest',pageSize=Math.max(1,Math.min(100,Number(state.pageSize)||10));
  let content;
  if(page==='compose'){
    content=h('div',{},storageNotice(state),stateNotice(state),h('section',{class:'community-panel community-compose-page'},h('a',{href:'#/forum',class:'community-back-link'},"← The Teachers' Lounge"),h('h1',{id:'page-title'},'Create New Post'),role==='teacher'?topicComposer():h('section',{class:'community-auth-required'},h('h2',{},'Log in to create a post'),p('A teacher preview role is required to start a discussion.'),h('a',{href:'#/login',class:'community-text-link'},'Open login'))));
  } else if(page==='thread'){
    const topic=threads.find(t=>t.id===route.threadId);
    if(!route.threadId)content=postErrorPage('Error: Post ID is missing from the URL. Please ensure you are navigating from the forum list.');
    else if(!topic||topic.hidden&&role!=='moderator')content=postErrorPage('Error: This conversation is unavailable in this local preview.');
    else content=postDetail(topic,session,state);
  } else {
    const normalizedQuery=String(query).slice(0,MAX_BODY).toLocaleLowerCase();
    const matching=threads.filter(t=>!t.hidden||role==='moderator').filter(t=>(category==='All'||t.category===category)).filter(t=>!normalizedQuery||`${t.title} ${t.body} ${(t.replies||[]).filter(r=>!r.hidden||role==='moderator').map(r=>r.body).join(' ')}`.toLocaleLowerCase().includes(normalizedQuery));
    const visible=matching.slice().sort(sort==='upvotes'?(a,b)=>(b.votes||[]).length-(a.votes||[]).length:sort==='date-oldest'?(a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)):(a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
    const shown=normalizedQuery?visible:visible.slice(0,pageSize);
    content=h('div',{},storageNotice(state),stateNotice(state),h('section',{class:'community-panel community-index'},
      h('div',{class:'community-heading'},h('div',{},h('h1',{id:'page-title'},"The Teachers' Lounge"))),
      h('div',{class:'community-toolbar'},h('label',{class:'community-search'},h('span',{},'Search discussions'),h('input',{type:'text',id:'post-search-input',value:query,maxlength:String(MAX_BODY),placeholder:'Search posts by keyword…','data-event':'forum-search','aria-label':'Search discussions'})),button('Clear','forum-clear-search',{id:'forum-clear-search',class:'community-clear-button'})),
      h('div',{class:'community-sortbar'},h('strong',{},'Sort By:'),h('div',{class:'community-sort-controls'},
        button('Date (Newest)','forum-sort',{id:'sort-date-newest',class:`community-sort-button ${sort==='date-newest'?'active':''}`,'data-sort':'date-newest','aria-pressed':sort==='date-newest'?'true':'false'}),
        button('Date (Oldest)','forum-sort',{id:'sort-date-oldest',class:`community-sort-button ${sort==='date-oldest'?'active':''}`,'data-sort':'date-oldest','aria-pressed':sort==='date-oldest'?'true':'false'}),
        button('Upvotes','forum-sort',{id:'sort-upvotes',class:`community-sort-button ${sort==='upvotes'?'active':''}`,'data-sort':'upvotes','aria-pressed':sort==='upvotes'?'true':'false'}),
        h('a',{href:'#/create-post','data-event':'forum-compose-topic',id:'create-post-btn',class:'community-primary-button'},'+ New Post'))),
      state.composer==='topic'&&role==='teacher'?topicComposer():null,
      h('div',{class:'community-results','aria-live':'polite'},shown.length?shown.map(t=>topicCard(t,session)):h('div',{class:'community-empty-state'},h('h3',{},normalizedQuery?'No discussions found':'No posts found'),p(normalizedQuery?'Try a different keyword!':'Be the first to start a discussion!'))),
      shown.length<visible.length?button('Load 10 More Discussions','forum-load-more',{class:'community-load-more'}):null));
  }
  return h('div',{'data-community':'true','data-role':role},h('main',{class:'community-shell',id:'community-main',tabindex:'-1'},content),h('footer',{class:'community-footer'},h('span',{},'© 2024 Homeroom Heroes. All rights reserved.'),h('details',{class:'community-preview-controls'},h('summary',{},'Local preview controls'),p('Synthetic data only. Changes stay in this tab; no live service is connected.','community-preview-explanation'),rolePicker,categorySelect(category),role==='moderator'?button('Reset forum preview','forum-reset',{class:'community-utility'}):null,button('Export forum data','forum-export',{class:'community-utility'}))));
}
