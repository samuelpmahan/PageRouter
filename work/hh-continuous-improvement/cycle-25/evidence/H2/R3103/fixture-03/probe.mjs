import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const visit = async () => {};
const provider = createFixtureProvider({fixture: true, storage: null});
const runtime = createServiceRuntime(provider);
await runtime.ready;
const receiptsBefore = runtime.inspect().receipts.length;
let tree = null;
const controller = createPublicController({runtime, storage: null,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
await controller.navigate('#/forum');
const community = controller.community;
assert.equal(controller.state.community.storageStatus, 'memory_only');
assert.equal(provider.mode, 'fixture');
assert.equal(provider.fixture, true);

const nodeList = root => {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    found.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return found;
};
const cardIds = () => nodeList(tree).filter(node => node.attrs?.class?.includes('community-topic '))
  .map(node => node.attrs['data-thread-id']);
const reportedButton = () => nodeList(tree).find(node => node.tag === 'button' && node.attrs?.id === 'forum-reported-only');
const genericClick = async node => {
  const dataset = Object.fromEntries(Object.entries(node.attrs).filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), String(value)]));
  const payload = { ...dataset, threadId: dataset.threadId || dataset.postId, postId: dataset.postId || dataset.threadId,
    replyId: dataset.replyId || dataset.commentId, commentId: dataset.commentId || dataset.replyId };
  return controller.dispatch(dataset.event, payload);
};

await controller.dispatch('forum-role', {role: 'teacher'});
const topicIds = [];
for (let i = 0; i < 12; i += 1) {
  const result = await controller.dispatch('forum-topic', {title: `R3103 Needle ${i}`, body: `needle lifecycle text ${i}`,
    category: 'Questions'});
  assert.equal(result.ok, true);
  topicIds.push(result.value.id);
}
const otherCategory = await controller.dispatch('forum-topic', {title: 'R3103 unrelated category', body: 'needle but community category', category: 'Community'});
assert.equal(otherCategory.ok, true);
const replyOnTopic0 = await controller.dispatch('forum-reply', {threadId: topicIds[0], content: 'needle reply on topic zero'});
const replyOnTopic11 = await controller.dispatch('forum-reply', {threadId: topicIds[11], content: 'needle reply-only report'});
assert.equal(replyOnTopic0.ok, true);
assert.equal(replyOnTopic11.ok, true);
const reply0Id = replyOnTopic0.value.id;
const reply11Id = replyOnTopic11.value.id;
assert.equal((await controller.dispatch('forum-flag-thread', {threadId: topicIds[0]})).ok, true);
assert.equal((await controller.dispatch('forum-flag-reply', {threadId: topicIds[0], replyId: reply0Id})).ok, true);
for (const threadId of topicIds.slice(1, 11)) assert.equal((await controller.dispatch('forum-flag-thread', {threadId})).ok, true);
assert.equal((await controller.dispatch('forum-flag-reply', {threadId: topicIds[11], replyId: reply11Id})).ok, true);
assert.equal(community.snapshot().storageStatus, 'memory_only');

await controller.navigate('#/forum');
await controller.dispatch('forum-role', {role: 'moderator'});
const clickResult = await genericClick(reportedButton());
assert.equal(clickResult.ok, true, 'actual rendered event/data payload toggles reported-only mode');
assert.equal(controller.state.community.reportedOnly, true);
assert.equal(controller.state.community.message, 'Showing reported forum items.');
assert.equal(await controller.dispatch('forum-category', {category: 'Questions'}).then(result => result.ok), true);
assert.equal(cardIds().length, 10, 'reported filter precedes the existing 10-item page slice');
assert.ok(cardIds().every(id => topicIds.includes(id)), 'unreported topic is absent from reported-only result');
assert.ok(nodeList(tree).some(node => node.attrs?.['data-event'] === 'forum-load-more'));
await controller.dispatch('forum-load-more');
assert.equal(cardIds().length, 12, 'load-more reveals all reports after filtered pagination');
assert.deepEqual(new Set(cardIds()), new Set(topicIds), 'reported topic records and reply-only report both qualify');

await controller.dispatch('forum-category', {category: 'Community'});
assert.equal(cardIds().length, 0, 'category is conjunctive with reported-only');
assert.ok(nodeList(tree).some(node => node.children?.includes('No reported items found')));
await controller.dispatch('forum-category', {category: 'Questions'});
await controller.dispatch('forum-search', {query: 'absent-term'});
assert.equal(cardIds().length, 0, 'search re-filters reported items');
await controller.dispatch('forum-search', {query: 'needle'});
assert.equal(cardIds().length, 12, 'restoring matching query repopulates report results');
await controller.dispatch('forum-search', {query: ''});
assert.equal(cardIds().length, 12, 'clearing query restores paged reported results after load-more');

assert.equal((await controller.dispatch('forum-hide-reply', {threadId: topicIds[11], replyId: reply11Id})).ok, true);
assert.ok(cardIds().includes(topicIds[11]), 'hidden moderator-visible reported reply remains admitted');
assert.equal((await controller.dispatch('forum-unhide-reply', {threadId: topicIds[11], replyId: reply11Id})).ok, true);
assert.ok(!cardIds().includes(topicIds[11]), 'restoring a reply clears its sole report and removes its parent');

assert.equal((await controller.dispatch('forum-hide-reply', {threadId: topicIds[0], replyId: reply0Id})).ok, true);
assert.ok(cardIds().includes(topicIds[0]), 'topic-level report retains parent while its other report is hidden');
assert.equal((await controller.dispatch('forum-unhide-reply', {threadId: topicIds[0], replyId: reply0Id})).ok, true);
assert.ok(cardIds().includes(topicIds[0]), 'reply restore leaves parent because topic report remains');
assert.equal((await controller.dispatch('forum-hide-thread', {threadId: topicIds[0]})).ok, true);
assert.ok(cardIds().includes(topicIds[0]), 'hidden moderator-visible reported topic remains admitted');
assert.equal((await controller.dispatch('forum-unhide-thread', {threadId: topicIds[0]})).ok, true);
assert.ok(!cardIds().includes(topicIds[0]), 'topic restore clears its report; parent leaves when no reply report remains');

await controller.dispatch('forum-role', {role: 'teacher'});
assert.equal(controller.state.community.reportedOnly, false, 'leaving moderator role clears the filter');
const teacherUnauthorized = await controller.dispatch('forum-reported-only', {enabled: true});
assert.equal(teacherUnauthorized.ok, false);
assert.equal(teacherUnauthorized.error, 'moderator_required');
controller.state.community.reportedOnly = true;
await controller.dispatch('forum-search', {query: 'needle'});
await controller.dispatch('forum-category', {category: 'Questions'});
assert.ok(!nodeList(tree).some(node => node.attrs?.['data-event'] === 'forum-reported-only'), 'renderer omits control for teacher with forged state');
assert.ok(cardIds().includes(topicIds[11]), 'forged teacher state does not apply the reported-only projection');

const receiptsAfter = runtime.inspect().receipts.length;
assert.equal(receiptsAfter, receiptsBefore, 'no teacher service port was invoked');
console.log(JSON.stringify({
  probe: 'R3103 independent actual fixture-provider/controller lifecycle',
  fixture: {mode: provider.mode, fixture: provider.fixture, communityStorage: community.snapshot().storageStatus},
  runtimeServiceReceipts: {before: receiptsBefore, after: receiptsAfter, servicePortCalls: 0},
  filter: {actualGenericButtonPayloadToggled: true, queryRefilter: true, categoryRefilter: true,
    filteredBeforePageSlice: true, firstPage: 10, loadMorePage: 12, replyOnlyReportAdmitted: true,
    hiddenReportedReplyAndTopicAdmitted: true},
  restoration: {replyOnlyReportRemovedOnRestore: true, mixedReportsClearIndependently: true,
    parentRetainedUntilLastReportRestored: true},
  authority: {roleExitClearsFilter: true, nonModeratorEventRejected: true,
    forgedTeacherStateDoesNotFilterOrRenderControl: true},
  assertions: 'all passed',
}, null, 2));
