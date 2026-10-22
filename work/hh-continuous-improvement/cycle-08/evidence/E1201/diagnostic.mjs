import assert from 'node:assert/strict';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function nodes(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  found.push(node); for (const child of node.children || []) nodes(child, found); return found;
}
function rendered(c) {
  const s = c.state;
  const root = renderPublicSite({route: s.route, state: s, journey: s.journey, community: s.community});
  const all = nodes(root);
  return {route: structuredClone(c.route), profileStatus: s.journey.profile.status,
    share: structuredClone(s.journey.share), page: root.attrs?.['data-public-page'],
    h1: all.filter(n => n.tag === 'h1').map(n => (n.children || []).filter(x => typeof x === 'string').join('')),
    routeField: all.find(n => n.attrs?.id === 'hh-share-route')?.attrs?.value || null,
    shareNote: all.some(n => n.attrs?.['data-testid'] === 'hh-reference-share-note')};
}
function runtime({holdJordan = false} = {}) {
  const base = createFixtureProvider({fixture: true}); let announce, release;
  const started = new Promise(resolve => { announce = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (holdJordan && port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') { announce(); await gate; }
    return invoke(input);
  }]));
  return {runtime: createServiceRuntime({...base, services}), started, release};
}

const results = {job_id: 'E1201', worker: 'H1', scope: 'Additional route-derived dispatch compatibility diagnostics; synthetic only', cases: {}};
// Direct share dispatch while Jordan is loading uses the current route ID, although the loading renderer exposes no Share button.
{
  const env = runtime({holdJordan: true}); const c = createPublicController({runtime: env.runtime});
  await c.initialize('#/'); await c.navigate('#/public-profile/demo-avery'); await c.dispatch('public:share');
  const pending = c.navigate('#/public-profile/demo-jordan'); await env.started;
  assert.equal(rendered(c).profileStatus, 'loading');
  const dispatch = await c.dispatch('public:share');
  assert.equal(dispatch.share.url, '#/public-profile/demo-jordan');
  results.cases.direct_share_during_pending_read = {before: {route: {page:'profile', profileId:'demo-jordan'}, profileStatus:'loading', visibleShareButton:false}, dispatch, after:rendered(c)};
  env.release(); await pending;
  assert.equal(rendered(c).routeField, '#/public-profile/demo-jordan');
  results.cases.direct_share_during_pending_read.resolved = rendered(c);
}
// The route is available for local projection even when the service says that profile does not exist.
{
  const env = runtime(); const c = createPublicController({runtime: env.runtime});
  await c.initialize('#/'); await c.navigate('#/public-profile/demo-missing');
  assert.equal(rendered(c).profileStatus, 'error');
  const dispatch = await c.dispatch('public:share');
  assert.equal(dispatch.share.url, '#/public-profile/demo-missing');
  assert.equal(rendered(c).routeField, null);
  results.cases.direct_share_missing_profile = {dispatch, after:rendered(c)};
}
// The reference route keeps its captured share page action, but never renders the synthetic share-route field.
{
  const env = runtime(); const c = createPublicController({runtime: env.runtime});
  await c.initialize('#/'); await c.navigate('#/public-profile/reference-sarah');
  assert.equal(c.state.journey.profile.source, 'captured-readonly');
  const dispatch = await c.dispatch('public:share');
  assert.equal(dispatch.share.url, '#/public-profile/reference-sarah');
  assert.equal(rendered(c).routeField, null);
  assert.equal(rendered(c).shareNote, true);
  results.cases.captured_sarah_share_page_compatibility = {dispatch, after:rendered(c)};
}
console.log(JSON.stringify(results, null, 2));
