import {createFixtureProvider, createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const storage = null;
const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
const community = createCommunity({storage});
const results = [];

for (let index = 0; index < 12; index += 1) {
  const category = index % 2 ? 'Resources' : 'Questions';
  const created = community.createThread({
    title: `HH24 synthetic ${category} discussion ${String(index + 1).padStart(2, '0')}`,
    body: `Volatile-only teacher discussion needle-${index + 1}.`,
    category,
    author: 'HH24 Synthetic Teacher',
    authorId: 'hh24-teacher',
    role: 'teacher',
  });
  if (!created.ok) throw new Error(`synthetic setup failed: ${created.error}`);
  results.push(created.value);
}
const hiddenId = results[1].id;
if (!community.moderate(hiddenId, {hidden: true, role: 'moderator'}).ok) throw new Error('could not hide synthetic moderator control');

let tree = null;
const controller = createPublicController({runtime, storage, community, onChange(state, route) {
  tree = renderPublicSite({route, state, journey: state.journey});
}});

const walk = node => {
  const nodes = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    nodes.push(value);
    for (const child of value.children || []) visit(child);
  };
  visit(node);
  return nodes;
};
const textOf = node => node == null ? '' : typeof node === 'string' ? node : (node.children || []).map(textOf).join(' ');
const inspect = label => {
  const nodes = walk(tree);
  const cards = nodes.filter(node => node.attrs?.class?.includes('community-topic '));
  const cardIds = cards.map(node => node.attrs?.['data-thread-id']);
  return {
    label,
    route: controller.state.route.path,
    role: controller.state.journey.communityRole,
    query: controller.state.community.query,
    category: controller.state.community.category,
    sort: controller.state.community.sort,
    pageSize: controller.state.community.pageSize,
    cardCount: cards.length,
    cardIds,
    hiddenSyntheticVisible: cardIds.includes(hiddenId),
    emptyMessage: nodes.find(node => node.attrs?.class === 'community-empty-state') ? textOf(nodes.find(node => node.attrs?.class === 'community-empty-state')) : null,
    loadMore: nodes.some(node => node.attrs?.['data-event'] === 'forum-load-more'),
    searchValue: nodes.find(node => node.attrs?.id === 'post-search-input')?.attrs?.value ?? null,
    activeSort: nodes.filter(node => node.attrs?.['data-sort']).find(node => node.attrs['aria-pressed'] === 'true')?.attrs?.['data-sort'] ?? null,
    discussionTitle: nodes.find(node => node.attrs?.class === 'community-detail-title') ? textOf(nodes.find(node => node.attrs?.class === 'community-detail-title')) : null,
  };
};

await controller.initialize('#/forum');
results.length && await controller.dispatch('forum-role', {role: 'anonymous'});
const initial = inspect('initial-anonymous');

await controller.dispatch('forum-role', {role: 'moderator'});
const moderator = inspect('moderator-sees-hidden');
await controller.dispatch('forum-role', {role: 'anonymous'});

await controller.dispatch('forum-category', {category: 'Resources'});
await controller.dispatch('forum-search', {query: 'needle-1'});
const filtered = inspect('resources-plus-search');
const filteredId = filtered.cardIds[0];
await controller.dispatch('forum-open-thread', {threadId: filteredId});
const detail = inspect('open-filtered-discussion');
await controller.navigate('#/forum');
const back = inspect('back-to-filtered-index');

await controller.dispatch('forum-clear-search');
const afterClearQuery = inspect('clear-query-keeps-category');
await controller.dispatch('forum-category', {category: 'All'});
await controller.dispatch('forum-search', {query: 'HH24-no-such-discussion-3001'});
const empty = inspect('no-match-filter');
await controller.dispatch('forum-clear-search');
const recovered = inspect('clear-empty-filter-recovery');
await controller.dispatch('forum-sort', {sort: 'date-oldest'});
const oldest = inspect('oldest-sort');
await controller.dispatch('forum-load-more');
const loadedMore = inspect('load-more');

console.log(JSON.stringify({
  fixtureBoundary: 'Synthetic service fixture + volatile community storage:null; no backend or account.',
  seed: {threadCount: community.snapshot().threads.length, hiddenId, storageStatus: community.snapshot().storageStatus},
  observations: {initial, moderator, filtered, detail, back, afterClearQuery, empty, recovered, oldest, loadedMore},
}, null, 2));
