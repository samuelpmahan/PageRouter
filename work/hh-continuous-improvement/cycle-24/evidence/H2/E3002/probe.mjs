import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); }};
}
function nodes(tree) {
  const result = [];
  const visit = node => { if (!node || typeof node !== 'object') return; result.push(node); for (const child of node.children || []) visit(child); };
  visit(tree);
  return result;
}
function cardIds(tree) { return nodes(tree).filter(node => node.attrs?.class?.includes('community-topic ')).map(node => node.attrs['data-thread-id']); }
function hasText(tree, text) { return JSON.stringify(tree).includes(text); }

const accountStorage = memoryStorage();
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage: accountStorage}));
const community = createCommunity({storage: null});
const visibleRecovery = community.createThread({title: 'Visible recovery-key discussion', body: 'Teacher-visible recovery-key fixture body.', category: 'Questions', author: 'Demo Fixture Teacher', authorId: 'demo-teacher', role: 'teacher'});
const hiddenRecovery = community.createThread({title: 'Hidden recovery-key discussion', body: 'Moderator-only recovery-key fixture body.', category: 'Questions', author: 'Demo Fixture Teacher', authorId: 'demo-teacher', role: 'teacher'});
assert.equal(visibleRecovery.ok, true);
assert.equal(hiddenRecovery.ok, true);
assert.equal(community.moderate(hiddenRecovery.value.id, {hidden: true, role: 'moderator'}).ok, true);
for (let i = 0; i < 40; i += 1) {
  const added = community.createThread({title: `Pagination fixture ${String(i + 1).padStart(2, '0')}`, body: `Synthetic page-window entry ${i + 1}.`, category: i % 2 ? 'Community' : 'Questions', author: 'Demo Fixture Teacher', authorId: 'demo-teacher', role: 'teacher'});
  assert.equal(added.ok, true);
  if (i === 2) {
    for (const voter of ['voter-a', 'voter-b', 'voter-c']) assert.equal(community.vote(added.value.id, {role: 'teacher', personaId: voter}).ok, true);
  }
}

let tree = null;
const controller = createPublicController({runtime, storage: accountStorage, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); }});
await controller.initialize('#/forum');
const accountReceiptsAtStart = runtime.inspect().receipts.length;
await controller.dispatch('forum-role', {role: 'teacher'});
const initial = {role: controller.state.journey.communityRole, pageSize: controller.state.community.pageSize,
  cards: cardIds(tree).length, hiddenInCards: cardIds(tree).includes(hiddenRecovery.value.id),
  sortControls: nodes(tree).filter(node => ['sort-date-newest', 'sort-date-oldest', 'sort-upvotes'].includes(node.attrs?.id)).map(node => [node.attrs.id, node.attrs['aria-pressed']]),
  loadMorePresent: nodes(tree).some(node => node.attrs?.['data-event'] === 'forum-load-more'),
  visibilityControls: nodes(tree).some(node => node.attrs?.id === 'community-role-select')};
assert.equal(initial.cards, 10);
assert.equal(initial.hiddenInCards, false);
assert.equal(initial.loadMorePresent, true);
assert.equal(initial.visibilityControls, true);

await controller.dispatch('forum-sort', {sort: 'upvotes'});
const topUpvoted = cardIds(tree)[0];
assert.equal(topUpvoted, 'topic-local-5');
assert.equal(nodes(tree).find(node => node.attrs?.id === 'sort-upvotes')?.attrs?.['aria-pressed'], 'true');
await controller.dispatch('forum-load-more');
const afterLoadMore = {pageSize: controller.state.community.pageSize, cards: cardIds(tree).length,
  loadMorePresent: nodes(tree).some(node => node.attrs?.['data-event'] === 'forum-load-more')};
assert.equal(afterLoadMore.pageSize, 20);
assert.equal(afterLoadMore.cards, 20);
assert.equal(afterLoadMore.loadMorePresent, true);

await controller.dispatch('forum-category', {category: 'Questions'});
await controller.dispatch('forum-search', {query: 'recovery-key'});
const teacherSearch = {category: controller.state.community.category, query: controller.state.community.query,
  ids: cardIds(tree), visibleDiscussionPresent: hasText(tree, visibleRecovery.value.title), hiddenDiscussionPresent: hasText(tree, hiddenRecovery.value.title),
  resultCount: cardIds(tree).length};
assert.equal(teacherSearch.resultCount, 1);
assert.ok(teacherSearch.ids.includes(visibleRecovery.value.id));
assert.equal(teacherSearch.hiddenDiscussionPresent, false);

await controller.dispatch('forum-open-thread', {threadId: visibleRecovery.value.id});
const detail = {route: controller.state.route.path, titlePresent: hasText(tree, visibleRecovery.value.title),
  backLinkPresent: nodes(tree).some(node => node.attrs?.href === '#/forum' && (node.children || []).join('').includes('Back to Forum')),
  teacherRole: controller.state.journey.communityRole};
assert.equal(detail.route, `/posts/${visibleRecovery.value.id}`);
assert.equal(detail.titlePresent, true);
assert.equal(detail.backLinkPresent, true);

await controller.navigate('#/forum');
const afterBack = {route: controller.state.route.path, query: controller.state.community.query,
  category: controller.state.community.category, ids: cardIds(tree), hiddenInCards: cardIds(tree).includes(hiddenRecovery.value.id)};
assert.equal(afterBack.route, '/forum');
assert.equal(afterBack.query, 'recovery-key');
assert.equal(afterBack.category, 'Questions');
assert.deepEqual(afterBack.ids, [visibleRecovery.value.id]);
assert.equal(afterBack.hiddenInCards, false);

await controller.dispatch('forum-search', {query: 'term-with-no-match-xyz'});
const empty = {query: controller.state.community.query, message: nodes(tree).find(node => node.attrs?.class === 'community-empty-state')?.children?.[0]?.children?.[0] ?? null,
  clearPresent: nodes(tree).some(node => node.attrs?.id === 'forum-clear-search'), category: controller.state.community.category};
assert.equal(empty.message, 'No discussions found');
assert.equal(empty.clearPresent, true);
assert.equal(empty.category, 'Questions');

await controller.dispatch('forum-clear-search');
const cleared = {query: controller.state.community.query, category: controller.state.community.category,
  questionCards: cardIds(tree).length, categoryPickerValue: nodes(tree).find(node => node.attrs?.id === 'community-category-select')?.children?.find(option => option.attrs?.selected)?.attrs?.value,
  upvotesPressed: nodes(tree).find(node => node.attrs?.id === 'sort-upvotes')?.attrs?.['aria-pressed'],
  loadMorePresent: nodes(tree).some(node => node.attrs?.['data-event'] === 'forum-load-more')};
assert.equal(cleared.query, '');
assert.equal(cleared.category, 'Questions');
assert.equal(cleared.categoryPickerValue, 'Questions');
assert.equal(cleared.upvotesPressed, 'true');
assert.ok(cleared.questionCards >= 10);
assert.equal(cleared.loadMorePresent, true);

await controller.dispatch('forum-role', {role: 'moderator'});
await controller.dispatch('forum-search', {query: 'recovery-key'});
const moderatorSearch = {role: controller.state.journey.communityRole, ids: cardIds(tree), hiddenPresent: hasText(tree, hiddenRecovery.value.title),
  rolePicker: nodes(tree).find(node => node.attrs?.id === 'community-role-select')?.children?.find(option => option.attrs?.selected)?.attrs?.value};
assert.equal(moderatorSearch.ids.length, 2);
assert.equal(moderatorSearch.hiddenPresent, true);
assert.equal(moderatorSearch.rolePicker, 'moderator');
await controller.dispatch('forum-open-thread', {threadId: hiddenRecovery.value.id});
const moderatorDetail = {route: controller.state.route.path, titlePresent: hasText(tree, hiddenRecovery.value.title),
  restoreControl: nodes(tree).some(node => node.attrs?.['data-event'] === 'forum-unhide-thread')};
assert.equal(moderatorDetail.titlePresent, true);
assert.equal(moderatorDetail.restoreControl, true);
await controller.navigate('#/forum');
await controller.dispatch('forum-role', {role: 'teacher'});
await controller.navigate(`#/posts/${hiddenRecovery.value.id}`);
const teacherHiddenDetail = {route: controller.state.route.path, unavailable: hasText(tree, 'This conversation is unavailable in this local preview.'),
  hiddenTitleVisible: hasText(tree, hiddenRecovery.value.title)};
assert.equal(teacherHiddenDetail.unavailable, true);
assert.equal(teacherHiddenDetail.hiddenTitleVisible, false);
const accountReceiptsAtEnd = runtime.inspect().receipts.length;
assert.equal(accountReceiptsAtEnd, accountReceiptsAtStart, 'community navigation and filtering add no HH account-service receipts');

const output = {
  job_id: 'E3002', worker: 'H2', outcome: 'not_reuse',
  summary: 'No reusable search/filter→discussion→back/clear/empty-filter recovery defect reproduced in the volatile synthetic teacher-community fixture. Search and category state persisted on return; clear restored the active category, sort, page size, and pagination, while role-based hidden-thread visibility remained enforced.',
  evidence: {
    storage: community.snapshot().storageStatus,
    initial,
    sort: {sort: controller.state.community.sort, topUpvoted},
    afterLoadMore,
    teacherSearch,
    detail,
    afterBack,
    empty,
    cleared,
    moderatorSearch,
    moderatorDetail,
    teacherHiddenDetail,
    accountServiceReceipts: {atStart: accountReceiptsAtStart, atEnd: accountReceiptsAtEnd, unchanged: accountReceiptsAtStart === accountReceiptsAtEnd},
  },
  scope: 'Source-backed controller/community runtime probe with seeded forum data plus volatile synthetic pagination/recovery-key topics. No browser, DOM, backend, real account, or production claim.'
};
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
