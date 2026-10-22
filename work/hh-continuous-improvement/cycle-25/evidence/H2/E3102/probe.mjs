import assert from 'node:assert/strict';
import {createCommunity, renderCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';

const treeText = tree => {
  const parts = [];
  const walk = node => {
    if (typeof node === 'string') { parts.push(node); return; }
    if (!node || typeof node !== 'object') return;
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return parts.join(' ');
};
const nodes = tree => {
  const result = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    result.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  return result;
};
const hasEvent = (tree, event) => nodes(tree).some(node => node.attrs?.['data-event'] === event);
const hasLabel = (tree, label) => treeText(tree).includes(label);
const detail = (forum, id, role) => renderCommunity({
  route: {page: 'post', threadId: id}, state: forum.snapshot(), session: {role},
});

const forum = createCommunity({storage: null});
const initial = forum.snapshot();
assert.equal(initial.storageStatus, 'memory_only');
assert.equal(forum.createThread({title: 'Synthetic report probe', body: 'volatile fixture body', category: 'Questions', role: 'anonymous'}).error, 'authentication_required');
assert.equal(forum.createThread({title: 'Synthetic report probe', body: 'volatile fixture body', category: 'Questions', role: 'foreign'}).error, 'authentication_required');
const created = forum.createThread({title: 'Synthetic report probe', body: 'volatile fixture body', category: 'Questions', role: 'teacher', authorId: 'teacher-probe'});
assert.equal(created.ok, true);
assert.equal(created.warning, 'volatile_storage');
const threadId = created.value.id;
const reply = forum.reply(threadId, {body: 'synthetic reply to report', role: 'teacher', authorId: 'teacher-probe'});
assert.equal(reply.ok, true);
const replyId = reply.value.id;

const unauthThreadReport = forum.flag(threadId, {role: 'anonymous'});
const foreignThreadReport = forum.flag(threadId, {role: 'foreign'});
assert.equal(unauthThreadReport.error, 'authentication_required');
assert.equal(foreignThreadReport.error, 'authentication_required');
const topicReport = forum.flag(threadId, {role: 'teacher'});
const replyReport = forum.flag(threadId, {replyId, role: 'teacher'});
assert.equal(topicReport.ok, true);
assert.equal(replyReport.ok, true);
assert.equal(topicReport.warning, 'volatile_storage');
assert.equal(replyReport.warning, 'volatile_storage');
assert.equal(forum.getThread(threadId).reported, true);
assert.equal(forum.getThread(threadId).replies.find(item => item.id === replyId).reported, true);

const teacherDetail = detail(forum, threadId, 'teacher');
const anonymousDetail = detail(forum, threadId, 'anonymous');
const foreignDetail = detail(forum, threadId, 'foreign');
const moderatorDetail = detail(forum, threadId, 'moderator');
assert.ok(hasLabel(teacherDetail, 'Reported'));
assert.ok(hasLabel(anonymousDetail, 'Reported'));
assert.equal(hasEvent(teacherDetail, 'forum-flag-thread'), false, 'already reported topic has no repeat report control');
assert.equal(hasEvent(teacherDetail, 'forum-flag-reply'), false, 'already reported reply has no repeat report control');
assert.equal(hasEvent(teacherDetail, 'forum-hide-thread'), false);
assert.equal(hasEvent(foreignDetail, 'forum-hide-thread'), false);
assert.equal(hasEvent(moderatorDetail, 'forum-hide-thread'), true);
assert.equal(hasEvent(moderatorDetail, 'forum-hide-reply'), true);
assert.ok(hasLabel(moderatorDetail, 'synthetic reply to report'));
const reportedIndex = renderCommunity({route: {page: 'forum'}, state: forum.snapshot(), session: {role: 'moderator'}});
assert.ok(nodes(reportedIndex).some(node => node.attrs?.['data-thread-id'] === threadId), 'moderator index exposes reported topic');
assert.ok(hasLabel(reportedIndex, 'Reported'));

assert.equal(forum.moderate(threadId, {hidden: true, role: 'teacher'}).error, 'moderator_required');
const hiddenReply = forum.moderate(threadId, {replyId, hidden: true, role: 'moderator'});
assert.equal(hiddenReply.ok, true);
assert.equal(forum.getThread(threadId).replies.some(item => item.id === replyId), false, 'teacher projection omits hidden reply');
assert.equal(forum.getThread(threadId, {role: 'moderator'}).replies.find(item => item.id === replyId).hidden, true);
const teacherAfterReplyHide = detail(forum, threadId, 'teacher');
const moderatorAfterReplyHide = detail(forum, threadId, 'moderator');
assert.equal(hasLabel(teacherAfterReplyHide, 'synthetic reply to report'), false);
assert.equal(hasLabel(moderatorAfterReplyHide, 'Hidden'), true);
assert.equal(hasEvent(moderatorAfterReplyHide, 'forum-unhide-reply'), true);
assert.equal(forum.flag(threadId, {replyId, role: 'teacher'}).error, 'reply_unavailable');
const restoredReply = forum.moderate(threadId, {replyId, hidden: false, role: 'moderator'});
assert.equal(restoredReply.ok, true);
assert.equal(restoredReply.value.reported, false, 'restore clears reply report marker');

const hiddenTopic = forum.moderate(threadId, {hidden: true, role: 'moderator'});
assert.equal(hiddenTopic.ok, true);
assert.equal(forum.list({role: 'teacher'}).some(item => item.id === threadId), false);
assert.equal(forum.list({role: 'anonymous'}).some(item => item.id === threadId), false);
assert.equal(forum.list({role: 'foreign'}).some(item => item.id === threadId), false);
assert.equal(forum.getThread(threadId), null);
assert.equal(forum.getThread(threadId, {role: 'foreign'}), null);
assert.equal(forum.reply(threadId, {body: 'stale page', role: 'teacher'}).error, 'thread_unavailable');
assert.equal(forum.flag(threadId, {role: 'teacher'}).error, 'thread_unavailable');
assert.equal(forum.moderate(threadId, {hidden: false, role: 'teacher'}).error, 'moderator_required');
const teacherUnavailable = detail(forum, threadId, 'teacher');
const anonymousUnavailable = detail(forum, threadId, 'anonymous');
assert.ok(hasLabel(teacherUnavailable, 'This conversation is unavailable'));
assert.ok(hasLabel(anonymousUnavailable, 'This conversation is unavailable'));
const moderatorHiddenIndex = renderCommunity({route: {page: 'forum'}, state: forum.snapshot(), session: {role: 'moderator'}});
const moderatorHiddenDetail = detail(forum, threadId, 'moderator');
assert.ok(nodes(moderatorHiddenIndex).some(node => node.attrs?.['data-thread-id'] === threadId));
assert.ok(hasLabel(moderatorHiddenIndex, 'Hidden'));
assert.equal(hasEvent(moderatorHiddenDetail, 'forum-unhide-thread'), true);
const restoredTopic = forum.moderate(threadId, {hidden: false, role: 'moderator'});
assert.equal(restoredTopic.ok, true);
assert.equal(restoredTopic.value.reported, false, 'restore clears topic report marker');
assert.ok(forum.getThread(threadId));

const runtime = {
  ready: Promise.resolve(),
  invoke() { throw new Error('community probe must not invoke teacher services'); },
  snapshot() { return {
    registration: {status: 'none', email: ''},
    session: {status: 'anonymous'},
    ownProfile: {status: 'unknown', profile: null},
  }; },
};
const controller = createPublicController({runtime, storage: null});
await controller.navigate('#/community');
await controller.dispatch('forum-role', {role: 'teacher'});
const controllerTopic = await controller.dispatch('forum-topic', {title: 'Controller report fixture', body: 'controller volatile text', category: 'Questions'});
assert.equal(controllerTopic.ok, true);
const controllerThreadId = controllerTopic.value.id;
await controller.dispatch('forum-reply', {threadId: controllerThreadId, content: 'controller reply fixture'});
const controllerReplyId = controller.state.community.threads.find(item => item.id === controllerThreadId).replies[0].id;
const controllerTopicReport = await controller.dispatch('forum-flag-thread', {threadId: controllerThreadId});
const controllerReplyReport = await controller.dispatch('forum-flag-reply', {threadId: controllerThreadId, replyId: controllerReplyId});
assert.equal(controllerTopicReport.ok, true);
assert.equal(controllerReplyReport.ok, true);
assert.equal(controller.state.community.message, 'Local forum preview updated.');
assert.equal(controller.state.community.storageStatus, 'memory_only');
assert.equal(controller.state.journey.outcome?.remote, undefined);
await controller.dispatch('forum-role', {role: 'moderator'});
const controllerModerationView = renderCommunity({route: controller.route.communityRoute, state: controller.state.community,
  session: {role: controller.state.journey.communityRole}});
assert.ok(hasLabel(controllerModerationView, 'Reported'));
assert.equal(hasEvent(controllerModerationView, 'forum-hide-thread'), true);
assert.equal(hasEvent(controllerModerationView, 'forum-hide-reply'), true);
assert.equal((await controller.dispatch('forum-hide-thread', {threadId: controllerThreadId})).ok, true);
assert.equal(controller.state.community.threads.find(item => item.id === controllerThreadId).hidden, true);
assert.equal(controller.state.community.message, 'Local forum preview updated.');

console.log(JSON.stringify({
  probe: 'E3102 actual HH community source / volatile synthetic fixture',
  storageStatus: initial.storageStatus,
  created: {threadId, replyId, warning: created.warning},
  reports: {topic: topicReport.ok, reply: replyReport.ok, warning: topicReport.warning},
  moderation: {hideReply: hiddenReply.ok, restoreReply: restoredReply.ok, hideTopic: hiddenTopic.ok, restoreTopic: restoredTopic.ok},
  visibility: {reportedTopicVisibleToTeacherAndAnonymous: true, reportedTopicVisibleInModeratorIndex: true,
    hiddenTopicExcludedForTeacherAnonymousForeign: true, hiddenTopicRetainedForModerator: true,
    hiddenReplyOmittedForTeacherAndRetainedForModerator: true, directHiddenTopicUnavailableToTeacherAnonymous: true},
  renderedControls: {moderatorHideRestoreTopicAndReply: true, teacherForeignModeratorActionsAbsent: true,
    reportedBadgesVisible: true, reportControlsDisappearAfterReport: true},
  semantics: {reportAndModerationLocalOnly: true, restoreClearsReportMarker: true,
    dedicatedReportQueue: false, moderatorIndexShowsReportedTopicsButReplyRequiresOpeningTopic: true},
  controller: {eventPathReportsTopicAndReply: true, eventPathUsesVolatileState: true,
    truthfulLocalFeedback: 'Local forum preview updated.', teacherServiceInvocations: 0,
    moderatorHideEventRefreshesProjection: true},
  assertions: 'all passed',
}, null, 2));
