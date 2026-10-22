import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const targetId = 'topic-official-bug-forum';
let tree = null;
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: null}));
const community = createCommunity({storage: null});
const controller = createPublicController({runtime, storage: null, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});

function nodes(root = tree) {
  const found = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    found.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return found;
}
function byId(id) { return nodes().find(node => node.attrs?.id === id); }
function byEvent(event, predicate = () => true) {
  return nodes().find(node => node.attrs?.['data-event'] === event && predicate(node));
}
function dataPayload(element) {
  const data = Object.fromEntries(Object.entries(element.attrs || {})
    .filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), String(value)]));
  return {...data, threadId: data.threadId || data.postId || data.threadId,
    postId: data.postId || data.threadId, replyId: data.replyId || data.commentId,
    commentId: data.commentId || data.replyId};
}
function idsInIndex() {
  return nodes().filter(node => node.tag === 'article' && node.attrs?.class?.includes('community-topic '))
    .map(node => node.attrs['data-thread-id']);
}
function voteState() {
  const topic = community.getThread(targetId, {role: 'teacher'});
  return {upvotes: topic.votes.length, downvotes: topic.downvotes.length};
}
function renderedVoteSignals() {
  return {upvoteButton: byId('upvote-btn')?.attrs || null,
    downvoteButton: byId('downvote-btn')?.attrs || null,
    upvoteCountText: nodes().find(node => node.tag === 'strong' && /^\d+$/.test(node.children?.[0] || ''))?.children?.[0] ?? null,
    downvoteCountText: null,
    votedStateAttributes: ['aria-pressed', 'aria-checked', 'data-voted'].filter(name =>
      Object.hasOwn(byId('upvote-btn')?.attrs || {}, name) || Object.hasOwn(byId('downvote-btn')?.attrs || {}, name)),
  };
}

await controller.initialize('#/forum');
const startupReceiptCount = runtime.inspect().receipts.length;
await controller.dispatch('forum-role', {role: 'teacher'});

const indexVote = byEvent('forum-vote', node => node.attrs?.['data-post-id'] === targetId);
assert.ok(indexVote, 'teacher index contains the target topic vote button');
const indexVotePayload = dataPayload(indexVote);
assert.deepEqual({event: indexVote.attrs['data-event'], threadId: indexVotePayload.threadId,
  postId: indexVotePayload.postId, direction: indexVotePayload.direction},
{event: 'forum-vote', threadId: targetId, postId: targetId, direction: undefined});
const firstVote = await controller.dispatch(indexVote.attrs['data-event'], indexVotePayload);
assert.equal(firstVote.ok, true);
assert.deepEqual(voteState(), {upvotes: 3, downvotes: 0});

const sortButton = byId('sort-upvotes');
assert.ok(sortButton && sortButton.attrs['data-event'] === 'forum-sort');
await controller.dispatch(sortButton.attrs['data-event'], dataPayload(sortButton));
const sortedIds = idsInIndex();
assert.equal(sortedIds[0], targetId, 'the topic remains first by upvote count');

const topicLink = byEvent('forum-open-thread', node => node.attrs?.['data-thread-id'] === targetId);
assert.ok(topicLink, 'sorted rendered topic has an open-discussion link');
const openResult = await controller.dispatch(topicLink.attrs['data-event'], dataPayload(topicLink));
assert.equal(openResult.ok, true);
assert.deepEqual(controller.state.route.communityRoute, {page: 'post', threadId: targetId});
const beforeCorrection = renderedVoteSignals();
assert.equal(beforeCorrection.upvoteCountText, '3');
assert.equal(voteState().downvotes, 0);

const downvoteButton = byId('downvote-btn');
assert.ok(downvoteButton, 'detail renders a downvote correction control');
const correctionResult = await controller.dispatch(downvoteButton.attrs['data-event'], dataPayload(downvoteButton));
assert.equal(correctionResult.ok, true);
assert.deepEqual(correctionResult.value, {id: targetId, upvotes: 2, downvotes: 1, score: 1, voted: 'downvote'});
const afterCorrection = renderedVoteSignals();
assert.deepEqual(voteState(), {upvotes: 2, downvotes: 1});
assert.equal(afterCorrection.upvoteCountText, '2', 'visible upvote count confirms removal of the prior upvote');
assert.equal(afterCorrection.downvoteCountText, null, 'the pure rendered detail tree has no downvote count');
assert.deepEqual(afterCorrection.votedStateAttributes, [], 'no visible selected/voted state is rendered for either arrow');

const backLink = nodes().find(node => node.tag === 'a' && node.attrs?.href === '#/forum' &&
  node.children?.includes('← Back to Forum'));
assert.ok(backLink, 'detail provides a rendered back-to-forum link');
await controller.navigate(backLink.attrs.href);
assert.equal(controller.state.route.communityRoute.page, 'forum', 'the controller keeps the `forum` alias while the pure renderer displays its index');
assert.equal(controller.state.community.sort, 'upvotes');
assert.equal(idsInIndex()[0], targetId);
const correctedIndexButton = byEvent('forum-vote', node => node.attrs?.['data-post-id'] === targetId);
assert.ok(correctedIndexButton, 'returning to the index retains the topic vote control');
const indexCorrectionResult = await controller.dispatch(correctedIndexButton.attrs['data-event'], dataPayload(correctedIndexButton));
assert.equal(indexCorrectionResult.ok, true);
assert.deepEqual(voteState(), {upvotes: 3, downvotes: 0}, 'index upvote corrects the downvote to an upvote');
assert.equal(byEvent('forum-vote', node => node.attrs?.['data-post-id'] === targetId) != null, true);

const result = {
  job_id: 'E3201', worker: 'H1', flow: 'rendered index upvote -> upvote sort -> open detail -> downvote correction -> back -> index upvote correction',
  topic_id: targetId,
  synthetic_only: true,
  storage: 'null / volatile memory',
  after_first_vote: {state: {upvotes: 3, downvotes: 0}, index_payload: indexVotePayload},
  sorted_index_top_id: sortedIds[0],
  detail_before_correction: beforeCorrection,
  correction_dispatch_result: correctionResult,
  detail_after_correction: afterCorrection,
  after_back_then_index_correction: {state: voteState(), dispatch_result: indexCorrectionResult},
  runtime_receipts_after_forum_actions: runtime.inspect().receipts.length,
  runtime_receipts_at_startup: startupReceiptCount,
  finding: 'vote correction is operable and returns a correct internal voted result; rendered detail confirms the reduced upvote count but does not show the downvote count or selected vote state. No demonstrated flow failure; possible feedback/discoverability gap is bounded to visible vote-state confirmation.',
};
assert.equal(result.runtime_receipts_after_forum_actions, startupReceiptCount, 'forum interactions add no HH account service receipts');
console.log(JSON.stringify(result, null, 2));
