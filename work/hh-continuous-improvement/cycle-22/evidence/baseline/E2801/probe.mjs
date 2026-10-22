import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const values = new Map();
const storage = {
  getItem(key) { return values.get(key) ?? null; },
  setItem(key, value) { values.set(key, String(value)); },
  removeItem(key) { values.delete(key); },
};
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
const community = createCommunity({storage});
let tree;
const controller = createPublicController({runtime, storage, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
const walk = (node, out = []) => {
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  for (const child of node.children || []) walk(child, out);
  return out;
};
const replyForm = () => walk(tree).find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-reply');
const replyInput = () => {
  const form = replyForm();
  return walk(form).find(node => node.tag === 'textarea' && node.attrs?.name === 'content');
};
const storageValue = () => storage.getItem('hh-forum-v1');

await controller.initialize('#/posts/topic-official-bug-forum');
await controller.dispatch('forum-role', {role: 'teacher'});
const initial = community.getThread('topic-official-bug-forum', {role: 'teacher'});
const before = {
  route: controller.state.route,
  role: controller.state.journey.communityRole,
  replies: initial.replies.length,
  storage: storageValue(),
  receipts: runtime.inspect().receipts.length,
  form: !!replyForm(),
  inputValue: replyInput()?.attrs?.value ?? replyInput()?.children?.join('') ?? '',
};
const invalid = await controller.dispatch('forum-reply', {threadId: 'topic-official-bug-forum', content: '   '});
const invalidState = {
  ok: invalid.ok,
  error: invalid.error,
  message: controller.state.community.message,
  replyDraft: controller.state.community.replyDraft ?? null,
  replyCount: community.getThread('topic-official-bug-forum', {role: 'teacher'}).replies.length,
  storageUnchanged: storageValue() === before.storage,
  form: !!replyForm(),
  inputValue: replyInput()?.attrs?.value ?? replyInput()?.children?.join('') ?? '',
  receiptsUnchanged: runtime.inspect().receipts.length === before.receipts,
};
const correctedText = 'A corrected synthetic teacher reply.';
const corrected = await controller.dispatch('forum-reply', {threadId: 'topic-official-bug-forum', content: correctedText});
const correctedState = {
  ok: corrected.ok,
  error: corrected.error ?? null,
  createdBody: corrected.value?.body ?? null,
  replyCount: community.getThread('topic-official-bug-forum', {role: 'teacher'}).replies.length,
  storageChanged: storageValue() !== before.storage,
  inputValue: replyInput()?.attrs?.value ?? replyInput()?.children?.join('') ?? '',
  receiptsUnchanged: runtime.inspect().receipts.length === before.receipts,
};
await controller.dispatch('forum-reply', {threadId: 'topic-official-bug-forum', content: '   '});
const draftBeforeRoleExit = controller.state.community.replyDraft ?? null;
await controller.dispatch('forum-role', {role: 'anonymous'});
const afterRoleExit = {
  role: controller.state.journey.communityRole,
  replyDraft: controller.state.community.replyDraft ?? null,
  replies: community.getThread('topic-official-bug-forum', {role: 'anonymous'}).replies.length,
};
await controller.dispatch('forum-role', {role: 'teacher'});
const afterRoleReentry = {
  role: controller.state.journey.communityRole,
  replyDraft: controller.state.community.replyDraft ?? null,
  inputValue: replyInput()?.attrs?.value ?? replyInput()?.children?.join('') ?? '',
  replies: community.getThread('topic-official-bug-forum', {role: 'teacher'}).replies.length,
};

console.log(JSON.stringify({job_id: 'E2801', baseline: before, invalid: invalidState,
  corrected: correctedState, draftBeforeRoleExit, afterRoleExit, afterRoleReentry}, null, 2));
