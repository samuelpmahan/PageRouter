import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity, renderCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function nodes(tree) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    found.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return found;
}

function formFields(tree, submitEvent) {
  const all = nodes(tree);
  const form = all.find(node => node.tag === 'form' && node.attrs?.['data-submit'] === submitEvent);
  if (!form) return null;
  const fields = nodes(form);
  const field = name => fields.find(node => node.attrs?.name === name);
  const input = field('title');
  const content = field('content');
  return {
    title: input?.attrs?.value ?? null,
    body: content?.tag === 'textarea' ? (content.children || []).join('') : null,
  };
}

const accountStorage = memoryStorage();
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: accountStorage}));
const community = createCommunity({storage: null});
let tree = null;
const controller = createPublicController({runtime, storage: accountStorage, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
const accountReceiptsBefore = runtime.inspect().receipts.length;
const postCreated = community.createThread({title: 'Original synthetic title', body: 'Original synthetic post body.', category: 'Questions', role: 'teacher', authorId: 'demo-teacher'});
assert.equal(postCreated.ok, true);
const threadId = postCreated.value.id;
const replyCreated = community.reply(threadId, {body: 'Original synthetic reply body.', role: 'teacher', authorId: 'demo-teacher'});
assert.equal(replyCreated.ok, true);
const replyId = replyCreated.value.id;
assert.equal(community.snapshot().storageStatus, 'memory_only');

await controller.initialize(`#/posts/${threadId}`);
await controller.dispatch('forum-role', {role: 'teacher'});
const ownerEditEvents = nodes(tree).filter(node => ['forum-edit-post', 'forum-edit-comment'].includes(node.attrs?.['data-event']));
assert.equal(ownerEditEvents.length, 2, 'author sees post and reply edit controls');

await controller.dispatch('forum-edit-post', {threadId});
const postOriginal = {title: postCreated.value.title, body: postCreated.value.body};
const attemptedPost = {title: '   ', body: 'Meaningful changed post body that must survive a rejected save.'};
const rejectedPost = await controller.dispatch('forum-edit-post', {threadId, title: attemptedPost.title, body: attemptedPost.body});
assert.deepEqual(rejectedPost, {ok: false, error: 'title_and_body_required'});
const postFieldsAfterReject = formFields(tree, 'forum-edit-post');
assert.equal(controller.state.community.editingPostId, threadId);
assert.deepEqual(postFieldsAfterReject, postOriginal);
assert.deepEqual({title: community.getThread(threadId, {role: 'teacher'}).title, body: community.getThread(threadId, {role: 'teacher'}).body}, postOriginal);

const correctedPost = {title: 'Corrected synthetic title', body: 'Corrected synthetic post body.'};
const savedPost = await controller.dispatch('forum-edit-post', {threadId, ...correctedPost});
assert.equal(savedPost.ok, true);
assert.equal(community.getThread(threadId, {role: 'teacher'}).title, correctedPost.title);
assert.equal(community.getThread(threadId, {role: 'teacher'}).body, correctedPost.body);
assert.equal(controller.state.community.editingPostId, null);

await controller.dispatch('forum-edit-post', {threadId});
const beforePostCancel = community.getThread(threadId, {role: 'teacher'});
await controller.dispatch('forum-cancel-edit');
assert.equal(controller.state.community.editingPostId, null);
assert.equal(formFields(tree, 'forum-edit-post'), null);
assert.equal(community.getThread(threadId, {role: 'teacher'}).body, beforePostCancel.body);

await controller.dispatch('forum-edit-comment', {threadId, replyId});
const replyOriginal = replyCreated.value.body;
const attemptedReply = 'Changed reply that exceeds the service limit: ' + 'x'.repeat(10_001);
const rejectedReply = await controller.dispatch('forum-edit-comment', {threadId, replyId, body: attemptedReply});
assert.deepEqual(rejectedReply, {ok: false, error: 'input_too_long'});
const replyFieldsAfterReject = formFields(tree, 'forum-edit-comment');
assert.equal(controller.state.community.editingReplyId, replyId);
assert.equal(replyFieldsAfterReject.body, replyOriginal);
assert.equal(community.getThread(threadId, {role: 'teacher'}).replies.find(reply => reply.id === replyId).body, replyOriginal);

const correctedReply = 'Corrected synthetic reply body.';
const savedReply = await controller.dispatch('forum-edit-comment', {threadId, replyId, body: correctedReply});
assert.equal(savedReply.ok, true);
assert.equal(community.getThread(threadId, {role: 'teacher'}).replies.find(reply => reply.id === replyId).body, correctedReply);
assert.equal(controller.state.community.editingReplyId, null);

await controller.dispatch('forum-edit-comment', {threadId, replyId});
const beforeReplyCancel = community.getThread(threadId, {role: 'teacher'}).replies.find(reply => reply.id === replyId).body;
await controller.dispatch('forum-cancel-edit');
assert.equal(controller.state.community.editingReplyId, null);
assert.equal(formFields(tree, 'forum-edit-comment'), null);
assert.equal(community.getThread(threadId, {role: 'teacher'}).replies.find(reply => reply.id === replyId).body, beforeReplyCancel);

const beforeForeign = community.getThread(threadId, {role: 'teacher'});
const foreignPost = community.updatePost(threadId, {title: 'Unauthorized post change', body: 'Unauthorized body', role: 'teacher', personaId: 'foreign-teacher'});
const foreignReply = community.updateReply(threadId, replyId, {body: 'Unauthorized reply change', role: 'teacher', personaId: 'foreign-teacher'});
assert.deepEqual(foreignPost, {ok: false, error: 'owner_required'});
assert.deepEqual(foreignReply, {ok: false, error: 'owner_required'});
const afterForeign = community.getThread(threadId, {role: 'teacher'});
assert.deepEqual(afterForeign, beforeForeign);
const foreignTree = renderCommunity({route: {page: 'post', threadId}, state: controller.state.community, session: {role: 'teacher', personaId: 'foreign-teacher'}});
assert.equal(nodes(foreignTree).some(node => ['forum-edit-post', 'forum-edit-comment'].includes(node.attrs?.['data-event'])), false);
assert.equal(runtime.inspect().receipts.length, accountReceiptsBefore, 'forum edit flow does not call HH account services');

process.stdout.write(JSON.stringify({
  job_id: 'E2902',
  worker: 'H2',
  outcome: 'insufficient_evidence',
  summary: 'A rejected author post edit leaves edit mode open but reprojects saved values, discarding the submitted meaningful body; owner save/cancel and foreign-authority controls remain correct. Reply rejection also reprojects its saved value.',
  evidence: {
    volatileCommunity: community.snapshot().storageStatus,
    post: {error: rejectedPost.error, attempted: attemptedPost, afterReject: postFieldsAfterReject, editOpen: controller.state.community.editingPostId === null ? false : true, correctedSave: savedPost.ok, cancelClosed: formFields(tree, 'forum-edit-post') === null},
    reply: {error: rejectedReply.error, attemptedBodyLength: attemptedReply.length, afterReject: replyFieldsAfterReject, editOpenAfterReject: replyFieldsAfterReject !== null, correctedSave: savedReply.ok, cancelClosed: formFields(tree, 'forum-edit-comment') === null},
    ownerControls: ownerEditEvents.length,
    foreign: {postError: foreignPost.error, replyError: foreignReply.error, dataUnchanged: JSON.stringify(afterForeign) === JSON.stringify(beforeForeign), controlsHidden: !nodes(foreignTree).some(node => ['forum-edit-post', 'forum-edit-comment'].includes(node.attrs?.['data-event']))},
    accountReceiptsUnchanged: runtime.inspect().receipts.length === accountReceiptsBefore,
  },
  source: {
    repo_head: 'a7ef289c6232a6bb1daa7c805765179b5b502068',
    controller: 'checkpoint/vendor/hh/src/public-controller.mjs:565-600',
    community_service: 'checkpoint/vendor/hh/src/community.mjs:121-146',
    edit_projection: 'checkpoint/vendor/hh/src/community.mjs:204-207',
  },
}, null, 2) + '\n');
