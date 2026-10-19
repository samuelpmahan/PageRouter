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
  const result = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    result.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return result;
}

function postFields(tree) {
  const all = nodes(tree);
  const form = all.find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-edit-post');
  if (!form) return null;
  const fieldNodes = nodes(form);
  const title = fieldNodes.find(node => node.tag === 'input' && node.attrs?.name === 'title');
  const content = fieldNodes.find(node => node.tag === 'textarea' && node.attrs?.name === 'content');
  return {postId: form.attrs?.['data-post-id'], title: title?.attrs?.value ?? '', content: (content?.children || []).join('')};
}

const storage = memoryStorage();
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
const community = createCommunity({storage});
let tree = null;
const controller = createPublicController({runtime, storage, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
const first = community.createThread({title: 'R2903 first saved title', body: 'R2903 first saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
const second = community.createThread({title: 'R2903 second saved title', body: 'R2903 second saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
assert.equal(first.ok, true);
assert.equal(second.ok, true);
const firstId = first.value.id;
const secondId = second.value.id;
await controller.initialize(`#/posts/${firstId}`);
await controller.dispatch('forum-role', {role: 'teacher'});
const receiptsBeforeForumActions = runtime.inspect().receipts.length;
const savedStorageBeforeReject = storage.getItem('hh-forum-v1');
const firstSaved = community.getThread(firstId, {role: 'teacher'});

await controller.dispatch('forum-edit-post', {threadId: firstId});
const aliasBody = 'Meaningful body supplied through the legacy content alias.';
const nullBodyAlias = await controller.dispatch('forum-edit-post', {threadId: firstId, title: '   ', body: null, content: aliasBody});
assert.equal(nullBodyAlias.ok, false);
assert.equal(nullBodyAlias.error, 'title_and_body_required');
const nullAliasDraft = {postId: firstId, title: '   ', content: aliasBody};
assert.deepEqual(controller.state.community.postEditDraft, nullAliasDraft);
const nullAliasEditor = postFields(tree);
assert.deepEqual(nullAliasEditor, nullAliasDraft);
assert.deepEqual(community.getThread(firstId, {role: 'teacher'}), firstSaved);
assert.equal(storage.getItem('hh-forum-v1'), savedStorageBeforeReject);
assert.equal(runtime.inspect().receipts.length, receiptsBeforeForumActions);

await controller.navigate(`#/community/thread/${firstId}`);
const sameThreadAliasPreserved = JSON.stringify(controller.state.community.postEditDraft) === JSON.stringify(nullAliasDraft);
const sameThreadAliasEditor = postFields(tree);
assert.equal(sameThreadAliasPreserved, true, 'same-thread route alias preserves the current edit draft');
assert.deepEqual(sameThreadAliasEditor, nullAliasDraft);

const omittedBody = await controller.dispatch('forum-edit-post', {threadId: firstId, title: '   '});
assert.equal(omittedBody.ok, false);
assert.equal(omittedBody.error, 'title_and_body_required');
const omittedBodyDraft = {postId: firstId, title: '   ', content: firstSaved.body};
assert.deepEqual(controller.state.community.postEditDraft, omittedBodyDraft, 'omitted body uses the existing saved-body default');
const omittedBodyEditor = postFields(tree);
assert.deepEqual(omittedBodyEditor, omittedBodyDraft);
assert.deepEqual(community.getThread(firstId, {role: 'teacher'}), firstSaved);
assert.equal(storage.getItem('hh-forum-v1'), savedStorageBeforeReject);
assert.equal(runtime.inspect().receipts.length, receiptsBeforeForumActions);

const sourceDraftBeforeRouteChange = structuredClone(controller.state.community.postEditDraft);
await controller.navigate(`#/posts/${secondId}`);
const changedThreadCleared = controller.state.community.postEditDraft === null && controller.state.community.editingPostId === null;
assert.equal(changedThreadCleared, true, 'changing thread clears the old post edit draft');
await controller.dispatch('forum-edit-post', {threadId: secondId});
assert.deepEqual(postFields(tree), {postId: secondId, title: second.value.title, content: second.value.body});

const staleThreadState = structuredClone(controller.state.community);
staleThreadState.editingPostId = secondId;
staleThreadState.postEditDraft = sourceDraftBeforeRouteChange;
const staleThreadTree = renderCommunity({route: {page: 'post', threadId: secondId}, state: staleThreadState,
  session: {role: 'teacher', personaId: 'demo-teacher'}});
assert.deepEqual(postFields(staleThreadTree), {postId: secondId, title: second.value.title, content: second.value.body},
  'a mismatched stale draft is not projected into another post editor');

const foreignState = structuredClone(controller.state.community);
foreignState.editingPostId = secondId;
foreignState.postEditDraft = {postId: secondId, title: 'FOREIGN TITLE SECRET', content: 'FOREIGN BODY SECRET'};
const foreignTree = renderCommunity({route: {page: 'post', threadId: secondId}, state: foreignState,
  session: {role: 'teacher', personaId: 'foreign-teacher'}});
assert.equal(JSON.stringify(foreignTree).includes('FOREIGN BODY SECRET'), false,
  'a different teacher does not receive the matching post edit draft');
assert.equal(nodes(foreignTree).some(node => node.attrs?.['data-event'] === 'forum-edit-post'), false,
  'foreign teacher has no edit control');
const moderatorTree = renderCommunity({route: {page: 'post', threadId: secondId}, state: foreignState,
  session: {role: 'moderator'}});
assert.equal(JSON.stringify(moderatorTree).includes('FOREIGN BODY SECRET'), false,
  'moderator projection does not expose the teacher-only draft');
assert.equal(nodes(moderatorTree).some(node => node.attrs?.['data-event'] === 'forum-edit-post'), true,
  'existing moderator edit control remains available');

const beforeForeignMutation = community.getThread(secondId, {role: 'teacher'});
const foreignSave = community.updatePost(secondId, {title: 'Unauthorized title', body: 'Unauthorized body', role: 'teacher', personaId: 'foreign-teacher'});
assert.deepEqual(foreignSave, {ok: false, error: 'owner_required'});
assert.deepEqual(community.getThread(secondId, {role: 'teacher'}), beforeForeignMutation);
assert.equal(storage.getItem('hh-forum-v1'), savedStorageBeforeReject,
  'rejected edits and foreign service writes leave the synthetic forum store unchanged');
assert.equal(runtime.inspect().receipts.length, receiptsBeforeForumActions,
  'forum edit and rejection paths do not invoke account services');

process.stdout.write(JSON.stringify({
  job_id: 'R2903',
  worker: 'H2',
  probe: {
    fixture: 'synthetic local teacher posts with Map-backed in-memory storage; no browser/backend/network/new dependency',
    null_body_content_alias: {error: nullBodyAlias.error, draft: nullAliasDraft, editor: nullAliasEditor},
    same_thread_alias_preserved: sameThreadAliasPreserved,
    omitted_body: {error: omittedBody.error, draft: omittedBodyDraft, editor: omittedBodyEditor},
    changed_thread_cleared: changedThreadCleared,
    stale_cross_thread_not_projected: true,
    foreign_and_moderator_drafts_not_projected: true,
    foreign_service_result: foreignSave,
    persisted_storage_unchanged: storage.getItem('hh-forum-v1') === savedStorageBeforeReject,
    account_receipts_unchanged: runtime.inspect().receipts.length === receiptsBeforeForumActions,
  },
  source: {
    base_head: 'a7ef289c6232a6bb1daa7c805765179b5b502068',
    implementation: {
      controller: 'checkpoint/vendor/hh/src/public-controller.mjs#forumAction',
      renderer: 'checkpoint/vendor/hh/src/community.mjs#postDetail/postEditForm',
      authority: 'checkpoint/vendor/hh/src/community.mjs#createCommunity.updatePost',
    },
  },
}, null, 2) + '\n');
