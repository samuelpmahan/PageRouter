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
const editPostForm = () => walk(tree).find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-edit-post');
const postFields = () => {
  const form = editPostForm();
  const nodes = walk(form);
  const title = nodes.find(node => node.tag === 'input' && node.attrs?.name === 'title');
  const content = nodes.find(node => node.tag === 'textarea' && node.attrs?.name === 'content');
  return form ? {title: title?.attrs?.value ?? '', content: content?.children?.join('') ?? content?.attrs?.value ?? ''} : null;
};

await controller.initialize('#/create-post');
await controller.dispatch('forum-role', {role: 'teacher'});
const created = community.createThread({title: 'E2901 baseline post', body: 'Original persisted body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
if (!created.ok) throw new Error(`synthetic fixture setup failed: ${created.error}`);
const postId = created.value.id;
await controller.initialize(`#/posts/${postId}`);
await controller.dispatch('forum-role', {role: 'teacher'});
const before = {
  route: controller.state.route,
  role: controller.state.journey.communityRole,
  postId,
  authorId: community.getThread(postId, {role: 'teacher'}).authorId,
  persistedTitle: community.getThread(postId, {role: 'teacher'}).title,
  persistedBody: community.getThread(postId, {role: 'teacher'}).body,
  storageStatus: community.snapshot().storageStatus,
  storage: storage.getItem('hh-forum-v1'),
  receipts: runtime.inspect().receipts.length,
};

await controller.dispatch('forum-edit-post', {threadId: postId, postId});
const editing = {form: !!editPostForm(), fields: postFields(), editingPostId: controller.state.community.editingPostId};
const changedBody = 'Meaningful replacement body submitted with a rejected title.';
const rejected = await controller.dispatch('forum-edit-post', {threadId: postId, postId, title: '   ', content: changedBody});
const afterRejectedSave = {
  ok: rejected.ok,
  error: rejected.error,
  form: !!editPostForm(),
  fields: postFields(),
  editingPostId: controller.state.community.editingPostId,
  persisted: {title: community.getThread(postId, {role: 'teacher'}).title, body: community.getThread(postId, {role: 'teacher'}).body},
  storageUnchanged: storage.getItem('hh-forum-v1') === before.storage,
  receiptsUnchanged: runtime.inspect().receipts.length === before.receipts,
};

const correctedTitle = 'E2901 corrected post';
const corrected = await controller.dispatch('forum-edit-post', {threadId: postId, postId, title: correctedTitle, content: changedBody});
const afterCorrection = {
  ok: corrected.ok,
  error: corrected.error ?? null,
  form: !!editPostForm(),
  persisted: {title: community.getThread(postId, {role: 'teacher'}).title, body: community.getThread(postId, {role: 'teacher'}).body},
  storageChanged: storage.getItem('hh-forum-v1') !== before.storage,
  receiptsUnchanged: runtime.inspect().receipts.length === before.receipts,
};

await controller.dispatch('forum-edit-post', {threadId: postId, postId});
const beforeCancel = {form: !!editPostForm(), fields: postFields(), persistedBody: community.getThread(postId, {role: 'teacher'}).body};
await controller.dispatch('forum-cancel-edit', {threadId: postId, postId});
const afterCancel = {
  form: !!editPostForm(),
  editingPostId: controller.state.community.editingPostId,
  persisted: {title: community.getThread(postId, {role: 'teacher'}).title, body: community.getThread(postId, {role: 'teacher'}).body},
};

console.log(JSON.stringify({job_id: 'E2901', baseline: before, editing, rejectedSave: afterRejectedSave, correction: afterCorrection, beforeCancel, afterCancel}, null, 2));
