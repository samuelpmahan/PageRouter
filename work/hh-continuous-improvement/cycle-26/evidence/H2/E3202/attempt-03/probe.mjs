import assert from 'node:assert/strict';
import {createCommunity, renderCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';

const nodes = tree => {
  const out = [];
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    out.push(n);
    for (const child of n.children || []) walk(child);
  };
  walk(tree);
  return out;
};
const textOf = tree => {
  const out = [];
  const walk = n => {
    if (typeof n === 'string') out.push(n);
    else if (n && typeof n === 'object') for (const child of n.children || []) walk(child);
  };
  walk(tree);
  return out.join(' ');
};
const getCards = tree => nodes(tree).filter(n => n.tag === 'article' && n.attrs?.['data-thread-id']).map(n => ({
  id: n.attrs['data-thread-id'], text: textOf(n),
}));
const eventNode = (tree, event, id) => nodes(tree).find(n => n.attrs?.['data-event'] === event &&
  (!id || n.attrs['data-thread-id'] === id || n.attrs['data-post-id'] === id));

const community = createCommunity({storage: null});
const counts = () => community.snapshot().threads.length;
const replyCounts = () => community.snapshot().threads.reduce((n, t) => n + t.replies.length, 0);
const before = {threads: counts(), replies: replyCounts(), storage: community.snapshot().storageStatus};
assert.equal(before.storage, 'memory_only');
const runtime = {
  ready: Promise.resolve(),
  invoke() { throw new Error('probe must not invoke teacher services'); },
  snapshot() { return {registration: {status: 'none', email: ''}, session: {status: 'anonymous'}, ownProfile: {status: 'unknown', profile: null}}; },
};
const controller = createPublicController({runtime, storage: null, community});
const view = () => renderCommunity({route: controller.route.communityRoute, state: controller.state.community,
  session: {role: controller.state.journey.communityRole}});
await controller.navigate('#/community');
await controller.dispatch('forum-role', {role: 'teacher'});
const a = await controller.dispatch('forum-topic', {title: 'E3202 Alpha feedback', body: 'volatile alpha dataset item', category: 'Questions'});
const b = await controller.dispatch('forum-topic', {title: 'E3202 Beta feedback', body: 'volatile beta dataset item', category: 'Questions'});
assert.equal(a.ok, true);
assert.equal(b.ok, true);
const alphaId = a.value.id;
const betaId = b.value.id;
const createdCounts = {threads: counts(), replies: replyCounts()};
// Successful topic submission navigates to its detail page; return via the public index route.
await controller.navigate('#/community');

// Use the actual rendered forum-vote payload fields: data-post-id + data-direction.
const alphaUp = eventNode(view(), 'forum-vote', alphaId);
assert.ok(alphaUp, 'teacher index renders an upvote event for a topic');
assert.equal(alphaUp.attrs['data-post-id'], alphaId);
assert.equal(alphaUp.attrs['data-direction'], undefined, 'index upvote uses default direction');
const firstVote = await controller.dispatch('forum-vote', {postId: alphaUp.attrs['data-post-id']});
assert.equal(firstVote.ok, true);
assert.deepEqual(community.getThread(alphaId).votes, ['demo-teacher']);
assert.deepEqual(community.getThread(alphaId).downvotes, []);
assert.equal(firstVote.value.score, 1);

// Detail arrows expose direction; the opposite direction corrects the same persona vote.
await controller.dispatch('forum-open-thread', {threadId: alphaId});
assert.deepEqual(controller.route.communityRoute, {page: 'post', threadId: alphaId});
const downArrow = nodes(view()).find(n => n.attrs?.['data-event'] === 'forum-vote' &&
  n.attrs?.['data-post-id'] === alphaId && n.attrs?.['data-direction'] === 'downvote');
assert.ok(downArrow);
assert.equal(downArrow.attrs['data-direction'], 'downvote');
const correction = await controller.dispatch('forum-vote', {postId: downArrow.attrs['data-post-id'], direction: downArrow.attrs['data-direction']});
assert.equal(correction.ok, true);
assert.equal(correction.value.score, -1);
assert.deepEqual(community.getThread(alphaId).votes, []);
assert.deepEqual(community.getThread(alphaId).downvotes, ['demo-teacher']);
assert.equal(controller.state.community.message, 'Local forum preview updated.');
const downAfterCorrection = nodes(view()).find(n => n.attrs?.['data-event'] === 'forum-vote' &&
  n.attrs?.['data-post-id'] === alphaId && n.attrs?.['data-direction'] === 'downvote');
const upAfterCorrection = nodes(view()).find(n => n.attrs?.['data-event'] === 'forum-vote' &&
  n.attrs?.['data-post-id'] === alphaId && n.attrs?.['data-direction'] === 'upvote');
const currentVoteFeedback = {
  downArrowPressed: downAfterCorrection?.attrs?.['aria-pressed'] ?? null,
  upArrowPressed: upAfterCorrection?.attrs?.['aria-pressed'] ?? null,
  downArrowClass: downAfterCorrection?.attrs?.class ?? null,
  upArrowClass: upAfterCorrection?.attrs?.class ?? null,
  message: controller.state.community.message,
};

// Toggle back to upvote (correction), then sort uses the documented Upvotes count.
const corrected = await controller.dispatch('forum-vote', {postId: alphaId, direction: 'upvote'});
assert.equal(corrected.ok, true);
assert.equal(corrected.value.score, 1);
assert.deepEqual(community.getThread(alphaId).votes, ['demo-teacher']);
assert.deepEqual(community.getThread(alphaId).downvotes, []);
await controller.dispatch('forum-vote', {postId: alphaId, direction: 'upvote'}); // same-persona toggle removes vote
assert.deepEqual(community.getThread(alphaId).votes, []);
assert.equal((await controller.dispatch('forum-vote', {postId: betaId})).ok, true);
assert.equal((await controller.dispatch('forum-vote', {postId: betaId})).ok, true);
const betaUp2 = community.getThread(betaId);
assert.equal(betaUp2.votes.length, 1, 'same-persona repeat toggles rather than duplicates');
assert.equal(betaUp2.downvotes.length, 0);

// Direct community API validates distinct personas and rejects unauthenticated/moderator voters.
assert.equal(community.vote(alphaId, {role: 'anonymous', personaId: 'anon-1'}).error, 'authentication_required');
assert.equal(community.vote(alphaId, {role: 'moderator', personaId: 'mod-1'}).error, 'authentication_required');
assert.equal(community.vote(alphaId, {role: 'teacher', personaId: 'teacher-two', direction: 'downvote'}).ok, true);
assert.equal(community.getThread(alphaId).downvotes.length, 1);
assert.equal(community.vote(alphaId, {role: 'teacher', personaId: 'teacher-one', direction: 'upvote'}).ok, true);
assert.equal(community.getThread(alphaId).votes.length, 1);
assert.equal(community.vote(alphaId, {role: 'teacher', personaId: 'teacher-one', direction: 'upvote'}).value.voted, null);

// actual rendered sort payload is data-sort, event handler stores it, and the index order follows upvote count.
const sortButton = eventNode(view(), 'forum-sort');
const renderedUpvotes = nodes(view()).find(n => n.attrs?.['data-event'] === 'forum-sort' && n.attrs?.['data-sort'] === 'upvotes');
assert.ok(renderedUpvotes);
const sortResult = await controller.dispatch('forum-sort', {sort: renderedUpvotes.attrs['data-sort']});
assert.equal(sortResult.ok, true);
const sorted = getCards(view());
assert.equal(sorted[0].id, betaId, 'Upvotes sort ranks the topic with more upvotes first');
assert.equal(controller.state.community.sort, 'upvotes');

// Follow the rendered card link payload to detail and navigate back; sorting and volatile votes persist.
const open = eventNode(view(), 'forum-open-thread', betaId);
assert.ok(open);
const openResult = await controller.dispatch('forum-open-thread', {threadId: open.attrs['data-thread-id']});
assert.equal(openResult.ok, true);
assert.deepEqual(controller.route.communityRoute, {page: 'post', threadId: betaId});
assert.ok(textOf(view()).includes('E3202 Beta feedback'));
await controller.navigate('#/community');
assert.equal(controller.state.community.sort, 'upvotes');
assert.equal(getCards(view())[0].id, betaId);
assert.equal(community.getThread(betaId).votes.length, 1);

// A different teacher persona votes again, making beta retain first place. Hide guards block teacher access/vote.
assert.equal(community.vote(betaId, {role: 'teacher', personaId: 'teacher-two', direction: 'upvote'}).ok, true);
assert.equal(community.getThread(betaId).votes.length, 2);
assert.equal(community.moderate(alphaId, {hidden: true, role: 'teacher'}).error, 'moderator_required');
assert.equal(community.moderate(alphaId, {hidden: true, role: 'moderator'}).ok, true);
assert.equal(community.vote(alphaId, {role: 'teacher', personaId: 'teacher-one'}).error, 'thread_unavailable');
assert.equal(community.getThread(alphaId), null);
assert.equal(community.getThread(alphaId, {role: 'moderator'}).hidden, true);
await controller.dispatch('forum-role', {role: 'anonymous'});
assert.equal(eventNode(view(), 'forum-vote', betaId), undefined, 'anonymous view has no vote control');
assert.equal((await controller.dispatch('forum-vote', {postId: betaId})).error, 'authentication_required');
await controller.dispatch('forum-role', {role: 'moderator'});
assert.equal(eventNode(view(), 'forum-vote', betaId), undefined, 'moderator view has no vote control');
assert.equal((await controller.dispatch('forum-vote', {postId: betaId})).error, 'authentication_required');
const hiddenModeratorCard = getCards(view()).find(card => card.id === alphaId);
assert.ok(hiddenModeratorCard?.text.includes('Hidden'));
await controller.dispatch('forum-role', {role: 'teacher'});
assert.equal(getCards(view()).some(card => card.id === alphaId), false, 'hidden topic is excluded from teacher index');

const after = {threads: counts(), replies: replyCounts(), storage: community.snapshot().storageStatus};
assert.deepEqual(after, {threads: before.threads + 2, replies: before.replies, storage: 'memory_only'});
console.log(JSON.stringify({
  probe: 'E3202 synthetic volatile HH community teacher vote/correction/sort/open/back',
  storage: {before, after},
  datasetReceipts: {created: createdCounts, fixtureThreads: [{id: alphaId, title: a.value.title}, {id: betaId, title: b.value.title}]},
  voteLifecycle: {upvote: firstVote.value, correctionToDownvote: correction.value, correctionBackToUpvote: corrected.value,
    samePersonaToggle: 'removed', currentVoteFeedback,
    distinctPersonaVotes: {alpha: community.getThread(alphaId, {role: 'moderator'}).votes.length,
      beta: community.getThread(betaId).votes.length}, feedback: controller.state.community.message},
  sortAndNavigation: {sort: controller.state.community.sort, topAfterOpenBack: getCards(view())[0].id,
    detailOpened: controller.route.communityRoute.page === 'forum'},
  guards: {anonymousAndModeratorCannotVote: true, distinctPersonaAccepted: true, teacherCannotHide: true,
    hiddenThreadUnavailableToTeacherAndExcludedFromIndex: true, hiddenThreadVisibleToModerator: true},
  serviceInvocations: 0,
  assertions: 'all passed',
}, null, 2));
