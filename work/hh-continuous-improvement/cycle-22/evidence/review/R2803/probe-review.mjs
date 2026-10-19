import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: null}));
const community = createCommunity({storage: null});
let tree = null;
const controller = createPublicController({runtime, community, storage: null,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
};
const replyForm = () => find(tree, node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-reply');
const formState = () => {
  const form = replyForm();
  const textarea = find(form, node => node.tag === 'textarea' && node.attrs?.name === 'content');
  return {threadId: form?.attrs?.['data-thread-id'] ?? null,
    content: textarea?.children?.join('') ?? textarea?.attrs?.value ?? '', present: !!form};
};
const totalReplies = () => community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0);
const threadId = 'topic-official-bug-forum';
const otherThreadId = 'topic-teachers-lounge-open';

await controller.initialize(`#/posts/${threadId}`);
await controller.dispatch('forum-role', {role: 'teacher'});
const seededReplies = totalReplies();
for (let index = 0; index < 498; index += 1) {
  const added = community.reply(threadId, {body: `review cap setup ${index}`, role: 'teacher', authorId: 'review-fixture'});
  if (!added.ok) throw new Error(`cap setup failed at ${index}: ${added.error}`);
}
const serviceReceiptsBefore = runtime.inspect().receipts.length;
const body = 'Valid reviewer reply retained at cap; explicit retry after one slot opens.';
const rejected = await controller.dispatch('forum-reply', {threadId, content: body});
const afterReject = formState();
const draftAfterReject = structuredClone(controller.state.community.replyDraft);
const countAfterReject = totalReplies();
await controller.navigate(`#/community/thread/${threadId}`);
const sameThreadAlias = formState();
const freedReply = community.getThread(threadId, {role: 'teacher'}).replies.at(-1);
const freeSlot = community.deleteReply(threadId, freedReply.id, {role: 'teacher', personaId: 'demo-teacher'});
const corrected = await controller.dispatch('forum-reply', {threadId, content: body});
const afterCorrection = formState();
const createdMatches = community.getThread(threadId, {role: 'teacher'}).replies.filter(reply => reply.body === body).length;

const isolationBody = 'A second valid body rejected at capacity should not migrate threads.';
const secondRejected = await controller.dispatch('forum-reply', {threadId, content: isolationBody});
const draftBeforeSwitch = structuredClone(controller.state.community.replyDraft);
await controller.navigate(`#/posts/${otherThreadId}`);
const otherThreadState = formState();
const draftAfterSwitch = controller.state.community.replyDraft ?? null;
const serviceReceiptsAfter = runtime.inspect().receipts.length;

console.log(JSON.stringify({
  setup: {mode: 'fixture / volatile memory only', seededReplies, setupRepliesAdded: 498,
    cap: community.snapshot().limits.replies, totalAtFirstSubmit: countAfterReject,
    storageStatus: community.snapshot().storageStatus},
  rejection: {ok: rejected.ok, error: rejected.error, bodyLength: body.length,
    replyDraft: draftAfterReject, renderedForm: afterReject, totalRepliesAfter: countAfterReject},
  sameThreadAlias: {route: controller.state.route, renderedForm: sameThreadAlias,
    retainedExactBody: sameThreadAlias.content === body},
  explicitCorrection: {slotFreed: freeSlot.ok, ok: corrected.ok, body: corrected.value?.body,
    createdMatches, replyDraftAfter: controller.state.community.replyDraft,
    renderedFormAfter: afterCorrection, totalReplies: totalReplies()},
  otherThreadIsolation: {secondRejection: secondRejected.error, draftBeforeSwitch,
    routeAfterSwitch: controller.state.route, renderedForm: otherThreadState,
    draftAfterSwitch, noLeak: otherThreadState.content === '' && draftAfterSwitch === null},
  authority: {role: 'synthetic teacher preview', serviceReceiptCountBefore: serviceReceiptsBefore,
    serviceReceiptCountAfter: serviceReceiptsAfter, serviceReceiptDelta: serviceReceiptsAfter - serviceReceiptsBefore,
    forumStorageStatus: community.snapshot().storageStatus, network: 'none'},
}, null, 2));
