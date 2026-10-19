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

await controller.initialize('#/posts/topic-official-bug-forum');
await controller.dispatch('forum-role', {role: 'teacher'});
const topicId = 'topic-official-bug-forum';
const beforeReplies = community.snapshot().threads.reduce((sum, item) => sum + item.replies.length, 0);
for (let index = 0; index < 498; index += 1) {
  const result = community.reply(topicId, {body: `synthetic capacity setup ${index}`, role: 'teacher', authorId: 'fixture-setup'});
  if (!result.ok) throw new Error(`capacity setup stopped at ${index}: ${result.error}`);
}
const filledCount = community.snapshot().threads.reduce((sum, item) => sum + item.replies.length, 0);
const serviceReceiptsBefore = runtime.inspect().receipts.length;
const body = 'A valid bounded teacher reply rejected only because the fixture is at capacity.';
const updateDraftAccepted = controller.updateDraft('content', body);
const result = await controller.dispatch('forum-reply', {threadId: topicId, content: body});
const form = find(tree, node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-reply');
const textarea = find(form, node => node.tag === 'textarea' && node.attrs?.name === 'content');
const afterReplies = community.snapshot().threads.reduce((sum, item) => sum + item.replies.length, 0);
console.log(JSON.stringify({
  setup: {mode: 'fixture, volatile memory only', initialReplies: beforeReplies, setupRepliesAdded: 498,
    limit: community.snapshot().limits.replies, totalBeforeSubmit: filledCount},
  submit: {body, bodyLength: body.length, updateDraftAccepted, result, totalAfterSubmit: afterReplies,
    zeroNewReplies: afterReplies === filledCount, retainedControllerDraft: controller.state.community.replyDraft ?? null,
    emittedTextareaValue: textarea?.children?.join('') ?? textarea?.attrs?.value ?? '',
    replyComposerPresent: !!form, separateReplyFormOnThreadDetail: form?.attrs?.['data-submit'] === 'forum-reply',
    route: controller.state.route, routePage: controller.state.route.communityRoute?.page},
  authority: {communityStorageStatus: community.snapshot().storageStatus,
    serviceReceiptsBefore: serviceReceiptsBefore, serviceReceiptsAfter: runtime.inspect().receipts.length,
    noForumStorageProvided: true, network: 'none'},
}, null, 2));
