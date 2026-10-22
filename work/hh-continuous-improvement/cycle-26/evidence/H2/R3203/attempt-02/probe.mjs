import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const allNodes = tree => {
  const out = [];
  const walk = n => { if (!n || typeof n !== 'object') return; out.push(n); for (const child of n.children || []) walk(child); };
  walk(tree);
  return out;
};
const eventNode = (tree, event, predicate = () => true) => allNodes(tree).find(n => n.attrs?.['data-event'] === event && predicate(n));
const byId = (tree, id) => allNodes(tree).find(n => n.attrs?.id === id);
const text = tree => {
  const out = [];
  const walk = n => { if (typeof n === 'string') out.push(n); else if (n && typeof n === 'object') for (const child of n.children || []) walk(child); };
  walk(tree);
  return out.join(' ');
};
// Mirror checkpoint/vendor/hh/src/app.mjs dataPayload() over actual rendered-tree attrs.
const payloadOf = node => {
  const data = Object.fromEntries(Object.entries(node.attrs || {}).filter(([key]) => key.startsWith('data-'))
    .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase()), String(value)]));
  return {...data, threadId: data.threadId || data.postId || data.threadId, postId: data.postId || data.threadId,
    replyId: data.replyId || data.commentId, commentId: data.commentId || data.replyId};
};
const renderedDispatch = (controller, node) => controller.dispatch(node.attrs['data-event'], payloadOf(node));

const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: null}));
const community = createCommunity({storage: null});
const controller = createPublicController({runtime, storage: null, community});
await controller.initialize('#/forum');
const startupReceipts = runtime.inspect().receipts.length;
assert.equal(startupReceipts, 2, 'fixture initialization should create the two expected startup receipts');
const initial = community.snapshot();
assert.equal(initial.storageStatus, 'memory_only');
const initialCounts = {threads: initial.threads.length, replies: initial.threads.reduce((n, t) => n + t.replies.length, 0)};
assert.deepEqual(initialCounts, {threads: 3, replies: 2}, 'expected seed dataset after controller initialization');

const targetId = 'topic-official-bug-forum';
const topicSeed = community.getThread(targetId, {role: 'teacher'});
assert.deepEqual(topicSeed.votes, ['seed-upvote-1', 'seed-upvote-2']);
assert.deepEqual(topicSeed.downvotes || [], []);
const view = (journey = controller.state.journey) => renderPublicSite({route: controller.route,
  state: controller.state, journey});
const voteLabel = tree => allNodes(tree).find(n => n.attrs?.class === 'community-current-vote')?.children?.join('') ?? null;
const activeControls = tree => ({
  index: eventNode(tree, 'forum-vote', n => n.attrs?.['data-post-id'] === targetId),
  up: byId(tree, 'upvote-btn'),
  down: byId(tree, 'downvote-btn'),
});
const detailLink = tree => eventNode(tree, 'forum-open-thread', n => n.attrs?.['data-thread-id'] === targetId);
const openTarget = async () => { const link = detailLink(view()); assert.ok(link); await renderedDispatch(controller, link); };
const backToIndex = async () => {
  const link = allNodes(view()).find(n => n.tag === 'a' && n.attrs?.href === '#/forum' && n.children?.includes('← Back to Forum'));
  assert.ok(link);
  await controller.navigate(link.attrs.href);
};

await controller.dispatch('forum-role', {role: 'teacher'});
let controls = activeControls(view());
assert.equal(controls.index?.attrs['aria-pressed'], 'false');
await openTarget();
controls = activeControls(view());
assert.equal(voteLabel(view()), 'Your vote: No vote');
assert.equal(controls.up.attrs['aria-pressed'], 'false');
assert.equal(controls.down.attrs['aria-pressed'], 'false');

// Downvote -> same-choice removal -> upvote, dispatched through actual rendered controls.
await renderedDispatch(controller, activeControls(view()).down);
assert.equal(voteLabel(view()), 'Your vote: Downvote');
assert.equal(activeControls(view()).down.attrs['aria-pressed'], 'true');
assert.equal(activeControls(view()).up.attrs['aria-pressed'], 'false');
assert.deepEqual({votes: community.getThread(targetId).votes, downvotes: community.getThread(targetId).downvotes},
  {votes: ['seed-upvote-1', 'seed-upvote-2'], downvotes: ['demo-teacher']});
await renderedDispatch(controller, activeControls(view()).down);
assert.equal(voteLabel(view()), 'Your vote: No vote');
assert.deepEqual({votes: community.getThread(targetId).votes, downvotes: community.getThread(targetId).downvotes},
  {votes: ['seed-upvote-1', 'seed-upvote-2'], downvotes: []});
await renderedDispatch(controller, activeControls(view()).up);
assert.equal(voteLabel(view()), 'Your vote: Upvote');
assert.equal(activeControls(view()).up.attrs['aria-pressed'], 'true');
assert.equal(activeControls(view()).down.attrs['aria-pressed'], 'false');
assert.deepEqual(community.getThread(targetId).votes, ['seed-upvote-1', 'seed-upvote-2', 'demo-teacher']);

// The projection follows the active persona, not another teacher's vote.
const alternateJourney = {...controller.state.journey, session: {...controller.state.journey.session, personaId: 'teacher-alt'}};
assert.equal(voteLabel(view(alternateJourney)), 'Your vote: No vote');
assert.equal(activeControls(view(alternateJourney)).up.attrs['aria-pressed'], 'false');

await backToIndex();
assert.equal(controller.state.community.sort, 'date-newest');
assert.equal(activeControls(view()).index.attrs['aria-pressed'], 'true');
await openTarget();
assert.equal(voteLabel(view()), 'Your vote: Upvote', 'reopening detail projects the existing vote state');
assert.equal(activeControls(view()).up.attrs['aria-pressed'], 'true');
const teacherVotePayload = payloadOf(activeControls(view()).down);
const reopenedVoteText = voteLabel(view());
await backToIndex();

// Non-teacher projections remain unchanged and event guards still reject votes.
await controller.dispatch('forum-role', {role: 'anonymous'});
assert.equal(voteLabel(view()), null);
assert.equal(eventNode(view(), 'forum-vote', n => n.attrs?.['data-post-id'] === targetId), undefined);
await openTarget();
assert.equal(voteLabel(view()), null);
assert.equal(byId(view(), 'upvote-btn').attrs['aria-pressed'], undefined);
const staleRenderedUp = activeControls(view()).up;
assert.equal((await renderedDispatch(controller, staleRenderedUp)).error, 'authentication_required');
await backToIndex();
await controller.dispatch('forum-role', {role: 'moderator'});
assert.equal(voteLabel(view()), null);
await openTarget();
assert.equal(voteLabel(view()), null);
assert.equal(byId(view(), 'upvote-btn').attrs['aria-pressed'], undefined);
assert.equal((await renderedDispatch(controller, activeControls(view()).up)).error, 'authentication_required');

// Moderator hide still governs access; replay a previously rendered teacher vote payload after hiding.
const hide = eventNode(view(), 'forum-hide-thread', n => n.attrs?.['data-thread-id'] === targetId);
assert.ok(hide);
assert.equal((await renderedDispatch(controller, hide)).ok, true);
await controller.dispatch('forum-role', {role: 'teacher'});
assert.equal((await controller.dispatch('forum-vote', teacherVotePayload)).error, 'thread_unavailable');
assert.equal(community.getThread(targetId), null);
assert.equal(text(view()).includes('This conversation is unavailable'), true);

const final = community.snapshot();
const finalCounts = {threads: final.threads.length, replies: final.threads.reduce((n, t) => n + t.replies.length, 0)};
assert.deepEqual(finalCounts, initialCounts, 'forum votes and moderation do not add/remove seed rows');
assert.equal(runtime.inspect().receipts.length, startupReceipts, 'forum actions add no service receipts');
assert.equal(controller.state.community.sort, 'date-newest');
console.log(JSON.stringify({
  job_id: 'R3203', worker: 'H2', result: 'pass',
  initialization: {storage: initial.storageStatus, counts: initialCounts, runtimeReceiptsAfterInitialize: startupReceipts},
  voteProjection: {sequence: ['No vote', 'Downvote', 'No vote', 'Upvote'], afterBackAndReopen: reopenedVoteText,
    activePersona: 'demo-teacher', otherPersona: 'teacher-alt sees No vote'},
  roleAndHiddenGuards: {anonymousHasNoVoteStatusOrControl: true, moderatorHasNoVoteStatusOrPressedState: true,
    anonymousAndModeratorVoteDenied: true, hiddenTopicUnavailableAndVoteDenied: true},
  final: {counts: finalCounts, runtimeReceipts: runtime.inspect().receipts.length, sort: controller.state.community.sort,
    storage: final.storageStatus},
}, null, 2));
