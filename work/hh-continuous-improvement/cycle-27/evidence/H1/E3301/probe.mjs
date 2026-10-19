import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const walk = (node, output = []) => {
  if (node && typeof node === 'object') {
    output.push(node);
    for (const child of node.children || []) walk(child, output);
  }
  return output;
};
const textOf = node => node == null ? '' : typeof node === 'string' ? node :
  (node.children || []).map(textOf).join(' ');
const findBy = (tree, predicate) => walk(tree).find(predicate) || null;

const provider = createFixtureProvider({fixture: true, storage: null});
const runtime = createServiceRuntime(provider);
const community = createCommunity({storage: null});
let tree = null;
const controller = createPublicController({runtime, storage: null, community, onChange(state, route) {
  tree = renderPublicSite({route, state, journey: state.journey});
}});

await controller.initialize('#/forum');
const initReceipts = runtime.pxc.receipts().length;
const initReceiptKinds = runtime.pxc.receipts().map(receipt => receipt?.kind || receipt?.operation || null);
assert.equal(initReceipts, 2, 'fixture initialization should produce its two legitimate receipts');

const rolePicker = findBy(tree, node => node.tag === 'select' && node.attrs?.['data-event'] === 'forum-role');
assert.ok(rolePicker, 'teacher preview picker is rendered');
await controller.dispatch(rolePicker.attrs['data-event'], {role: 'teacher'});
await controller.navigate('#/create-post');
const topicForm = findBy(tree, node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-topic');
assert.ok(topicForm, 'topic form is rendered on create-post route');
const title = 'E3301 volatile delete recovery';
const created = await controller.dispatch(topicForm.attrs['data-submit'], {
  title, content: 'Synthetic own topic for deletion recovery probe.', category: 'Questions',
});
assert.equal(created.ok, true);
const topicId = created.value.id;
await controller.navigate(`#/posts/${encodeURIComponent(topicId)}`);
assert.equal(controller.route.communityRoute.page, 'post');
assert.equal(controller.route.communityRoute.threadId, topicId);
assert.equal(community.getThread(topicId, {role: 'teacher'}).authorId, 'demo-teacher');

await controller.navigate('#/forum');
const search = findBy(tree, node => node.tag === 'input' && node.attrs?.['data-event'] === 'forum-search');
assert.ok(search, 'forum search input is rendered');
await controller.dispatch(search.attrs['data-event'], {query: title});
const resultCard = findBy(tree, node => node.tag === 'article' && node.attrs?.['data-thread-id'] === topicId);
assert.ok(resultCard, 'own topic is visible under matching search');
const openDetail = findBy(resultCard, node => node.tag === 'a' && node.attrs?.['data-event'] === 'forum-open-thread');
assert.ok(openDetail);
await controller.navigate(openDetail.attrs.href);

const deleteButton = findBy(tree, node => node.tag === 'button' && node.attrs?.['data-event'] === 'forum-delete-post');
assert.ok(deleteButton, 'owned-topic Delete post action is rendered');
const deletePayload = {
  postId: deleteButton.attrs['data-post-id'],
  threadId: deleteButton.attrs['data-thread-id'],
};
assert.equal(deletePayload.postId, topicId);
assert.equal(deletePayload.threadId, topicId);
const deletion = await controller.dispatch(deleteButton.attrs['data-event'], deletePayload);
assert.equal(deletion.ok, true);
assert.equal(community.getThread(topicId, {role: 'teacher'}), null);

const afterDelete = {
  route: controller.route,
  message: controller.state.community.message,
  detailText: textOf(tree),
  ownTopicStillInIndexData: controller.state.community.threads.some(topic => topic.id === topicId),
  receipts: runtime.pxc.receipts().length,
};
const backLink = findBy(tree, node => node.tag === 'a' && node.attrs?.class === 'community-back-link');
assert.ok(backLink, 'deleted detail fallback renders its Back to Forum link');
await controller.navigate(backLink.attrs.href);
const emptyState = findBy(tree, node => node.attrs?.class === 'community-empty-state');
const afterBack = {
  route: controller.route,
  query: controller.state.community.query,
  category: controller.state.community.category,
  sort: controller.state.community.sort,
  emptyText: textOf(emptyState),
  indexTopicCards: walk(tree).filter(node => node.tag === 'article' && node.attrs?.class?.includes('community-topic')).length,
  message: controller.state.community.message,
};
assert.ok(emptyState, 'back to the forum renders the empty search state');
const clearSearch = findBy(tree, node => node.tag === 'button' && node.attrs?.['data-event'] === 'forum-clear-search');
assert.ok(clearSearch, 'empty index still exposes Clear search');
await controller.dispatch(clearSearch.attrs['data-event'], {});
const afterClear = {
  route: controller.route,
  query: controller.state.community.query,
  category: controller.state.community.category,
  topicCards: walk(tree).filter(node => node.tag === 'article' && node.attrs?.class?.includes('community-topic')).length,
  deletedTopicPresent: walk(tree).some(node => node.attrs?.['data-thread-id'] === topicId),
  emptyText: textOf(findBy(tree, node => node.attrs?.class === 'community-empty-state')),
  receipts: runtime.pxc.receipts().length,
};
assert.equal(afterClear.topicCards, 3, 'clearing the search recovers the three seeded discussions');
assert.equal(afterClear.deletedTopicPresent, false);
assert.equal(afterClear.receipts, initReceipts, 'community preview actions create no runtime receipts');

console.log(JSON.stringify({
  fixture: {provider: 'createFixtureProvider({fixture:true, storage:null})', runtime: 'createServiceRuntime(provider)', storage: null},
  receiptBaselineAfterInitialize: {count: initReceipts, kinds: initReceiptKinds},
  author: {personaId: 'demo-teacher', topicId, ownership: 'confirmed'},
  renderedDeleteAction: {event: deleteButton.attrs['data-event'], payload: deletePayload},
  afterDelete,
  afterBack,
  afterClear,
  outcome: 'Delete succeeds. Controller remains on deleted detail route; that route renders unavailable fallback plus Back to Forum. Returning preserves the matching search filter and shows the empty state; Clear search recovers the seeded index. No missing renderer/control or unreachable recovery was observed.',
}, null, 2));
