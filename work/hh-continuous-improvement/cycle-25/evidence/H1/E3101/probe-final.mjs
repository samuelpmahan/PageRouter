import assert from 'node:assert/strict';
import {createCommunity} from '../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';
import {createFixtureProvider, createServiceRuntime} from '../../PageRouter/checkpoint/vendor/hh/services/index.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function nodes(tree) {
  const found = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    found.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(tree);
  return found;
}

const storage = memoryStorage();
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
const community = createCommunity({storage});
let tree = null;
const controller = createPublicController({runtime, storage, community,
  onChange(state, route) {
    tree = renderPublicSite({route, state, journey: state.journey});
  },
});

await controller.initialize('#/create-post');
assert.equal(community.snapshot().storageStatus, 'available', 'the volatile Storage-shaped fixture reports its mode accurately');

const anonymousReport = await controller.dispatch('forum-flag-thread', {threadId: 'topic-official-bug-forum'});
assert.equal(anonymousReport.error, 'authentication_required');
assert.equal(controller.state.community.message, 'authentication_required');
assert.ok(nodes(tree).some(node => node.attrs?.['aria-live'] === 'polite' && node.children?.includes('authentication required')),
  'unauthorized report feedback is projected accessibly');

await controller.dispatch('forum-role', {role: 'teacher'});
const created = await controller.dispatch('forum-topic', {
  title: 'E3101 synthetic report lifecycle', body: 'A volatile topic for reporting and recovery.',
  category: 'Questions',
});
assert.equal(created.ok, true);
const threadId = created.value.id;
const reply = await controller.dispatch('forum-reply', {threadId, content: 'A synthetic reply for the same lifecycle.'});
assert.equal(reply.ok, true);
const replyId = reply.value.id;

assert.equal((await controller.dispatch('forum-flag-thread', {threadId})).ok, true);
assert.equal((await controller.dispatch('forum-flag-reply', {threadId, replyId})).ok, true);
let teacherThread = community.getThread(threadId, {role: 'teacher'});
assert.equal(teacherThread.reported, true);
assert.equal(teacherThread.replies.find(item => item.id === replyId).reported, true);
await controller.navigate('#/forum');
const reportedTopicCard = nodes(tree).find(node => node.attrs?.['data-thread-id'] === threadId && node.attrs?.class?.includes('community-topic '));
assert.ok(nodes(reportedTopicCard).some(node => node.attrs?.class === 'community-reported' && node.children?.includes('Reported')),
  'teacher forum-card projection visibly labels the reported topic');
await controller.navigate(`#/posts/${threadId}`);
const reportedReplyCard = nodes(tree).find(node => node.attrs?.['data-reply-id'] === replyId);
assert.ok(nodes(reportedReplyCard).some(node => node.attrs?.class === 'community-reported' && node.children?.includes('Reported')),
  'teacher detail projection visibly labels the reported reply');
assert.ok(!nodes(tree).some(node => node.attrs?.class === 'community-reported' && node.attrs?.['data-thread-id'] === threadId),
  'topic-level report badge is not projected on the discussion detail itself');

const teacherHide = await controller.dispatch('forum-hide-thread', {threadId});
assert.equal(teacherHide.error, 'moderator_required');
assert.equal(controller.state.community.message, 'moderator_required');
await controller.navigate('#/forum');
await controller.dispatch('forum-role', {role: 'moderator'});
const moderatorReportedTopicCard = nodes(tree).find(node => node.attrs?.['data-thread-id'] === threadId && node.attrs?.class?.includes('community-topic '));
assert.ok(nodes(moderatorReportedTopicCard).some(node => node.attrs?.class === 'community-reported' && node.children?.includes('Reported')),
  'moderator forum-card projection exposes the topic report marker');
await controller.navigate(`#/posts/${threadId}`);
const moderatorReportedReplyCard = nodes(tree).find(node => node.attrs?.['data-reply-id'] === replyId);
assert.ok(nodes(moderatorReportedReplyCard).some(node => node.attrs?.class === 'community-reported' && node.children?.includes('Reported')),
  'moderator detail projection exposes the reply report marker');
const moderatorHideReply = await controller.dispatch('forum-hide-reply', {threadId, replyId});
assert.equal(moderatorHideReply.ok, true);
assert.equal(moderatorHideReply.value.hidden, true);
assert.ok(nodes(tree).some(node => node.children?.includes('Hidden')),
  'moderator projection labels the hidden reply');
const moderatorRestoreReply = await controller.dispatch('forum-unhide-reply', {threadId, replyId});
assert.equal(moderatorRestoreReply.ok, true);
assert.equal(moderatorRestoreReply.value.reported, false, 'restore clears the reply report marker');
assert.equal(community.getThread(threadId, {role: 'teacher'}).replies.find(item => item.id === replyId).hidden, false);

assert.equal((await controller.dispatch('forum-hide-thread', {threadId})).ok, true);
assert.equal(community.getThread(threadId, {role: 'teacher'}), null, 'hidden topic is unavailable to a teacher');
await controller.dispatch('forum-role', {role: 'teacher'});
assert.ok(nodes(tree).some(node => node.children?.includes('Error: This conversation is unavailable in this local preview.')),
  'teacher route renders the unavailable recovery state');
await controller.dispatch('forum-role', {role: 'moderator'});
const moderatorRestoreThread = await controller.dispatch('forum-unhide-thread', {threadId});
assert.equal(moderatorRestoreThread.ok, true);
assert.equal(moderatorRestoreThread.value.reported, false, 'restore clears the topic report marker');
await controller.dispatch('forum-role', {role: 'teacher'});
teacherThread = community.getThread(threadId, {role: 'teacher'});
assert.equal(teacherThread.hidden, false);
assert.equal(teacherThread.reported, false);
assert.equal(teacherThread.replies.find(item => item.id === replyId).hidden, false);
assert.equal(teacherThread.replies.find(item => item.id === replyId).reported, false);

const foreign = community.createThread({title: 'Foreign owner boundary', body: 'Synthetic only.', category: 'Questions',
  author: 'Other teacher', authorId: 'foreign-teacher', role: 'teacher'});
assert.equal(foreign.ok, true);
assert.equal(community.updatePost(foreign.value.id, {title: 'Changed', role: 'teacher', personaId: 'demo-teacher'}).error, 'owner_required');
assert.equal(community.deletePost(foreign.value.id, {role: 'teacher', personaId: 'demo-teacher'}).error, 'owner_required');
assert.equal(community.updatePost(threadId, {title: 'Owner edit retained', role: 'teacher', personaId: 'demo-teacher'}).ok, true);
assert.equal(community.moderate(foreign.value.id, {hidden: true, role: 'teacher'}).error, 'moderator_required');

assert.equal(community.snapshot().storageStatus, 'available');
assert.ok(storage.values.size > 0, 'only the injected volatile memory storage was written');
console.log(JSON.stringify({
  job_id: 'E3101',
  worker: 'H1',
  outcome: 'mixed_change',
  summary: 'The actual source-backed synthetic fixture confirms teacher reporting, moderator list visibility, hide/restore recovery, teacher unavailable-state handling, and owner/role boundaries. It also demonstrates that a reported topic badge is absent on its discussion-detail view, while the same topic is marked on the forum card.',
  scope: 'actual HH synthetic fixture runtime + actual community/controller/render modules; volatile Storage-shaped memory only',
  exercised: ['anonymous report rejection + aria-live feedback', 'teacher-created topic/reply', 'teacher reports topic and reply',
    'reported markers in teacher and moderator projections', 'moderator hide/restore reply and topic',
    'teacher hidden-topic unavailable state and restored projection', 'owner vs foreign edit/delete', 'teacher vs moderator authority'],
  source_pins: {
    'checkpoint/vendor/hh/src/community.mjs': '311d598b6d6ffc675dc4ee5b07ac0005c55e6ce7a34f8acfac5384d5789288f4',
    'checkpoint/vendor/hh/src/public-controller.mjs': '97b5c17bf519b7fd05e2933a12dc55ff0e3e0c3e7939db4072368c070b4f67a0',
    'checkpoint/vendor/hh/src/public-site.mjs': 'c50c07ab34e652790bae616277d3418cd850920d0c0721d50bb1e59af4d8502d',
    'checkpoint/vendor/hh/services/fixture-provider.mjs': '99807675ac53b1944c8838b3251139b62174c43f82276ef64cc919ce15e7d16d',
    'checkpoint/vendor/hh/services/runtime.mjs': '1ce3c4510361a2b24df26a3ae09d08093757abee75a5b2ab50353d15ff58b88e',
  },
  limitations: ['No authorization or hide/restore recovery defect reproduced; the specific detail-view report-marker gap is demonstrated.', 'Synthetic source-backed behavior only; not browser, backend, real-account, or production evidence.'],
  identified_gap: 'A reported topic is visibly marked in the forum card but not in the topic header/details on the discussion page. Reported replies do show their badge in detail.',
  proposal: 'Add the existing Reported status marker to the topic-level detail metadata; preserve moderator-only hide/restore controls and existing teacher/owner authority checks.',
}));
