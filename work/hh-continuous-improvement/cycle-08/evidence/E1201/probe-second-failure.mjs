import assert from 'node:assert/strict';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const evidence = {
  job_id: 'E1201', worker: 'H1',
  environment: {provider: 'fixture', fixture: true, productionAuthority: false, persistence: 'volatile-memory', httpCalls: 0, browserOpened: false, externalActions: 0},
  assertions: [], cases: {},
};
function elements(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  found.push(node);
  for (const child of node.children || []) elements(child, found);
  return found;
}
function view(controller) {
  const s = controller.state, root = renderPublicSite({route: s.route, state: s, journey: s.journey, community: s.community});
  const nodes = elements(root);
  const routeField = nodes.find(n => n.attrs?.id === 'hh-share-route');
  return {
    page: root.attrs?.['data-public-page'], route: structuredClone(controller.route),
    profile: s.journey.profile.value ? {id: s.journey.profile.value.id, name: s.journey.profile.value.name, readOnly: !!s.journey.profile.value.readOnly} : null,
    profileStatus: s.journey.profile.status, share: structuredClone(s.journey.share),
    shareRouteField: routeField ? {tag: routeField.tag, value: routeField.attrs?.value, readonly: routeField.attrs?.readonly} : null,
    h1: nodes.filter(n => n.tag === 'h1').map(n => (n.children || []).filter(x => typeof x === 'string').join('')),
    anchors: nodes.filter(n => n.tag === 'a').map(n => ({id: n.attrs?.id || null, href: n.attrs?.href || null})),
    buttons: nodes.filter(n => n.tag === 'button').map(n => ({id: n.attrs?.id || null, event: n.attrs?.['data-event'] || null})),
  };
}
function fixtureRuntime({holdJordan = false} = {}) {
  const base = createFixtureProvider({fixture: true});
  const calls = [];
  let releaseJordan, startedJordan;
  const jordanStarted = new Promise(resolve => { startedJordan = resolve; });
  const jordanGate = new Promise(resolve => { releaseJordan = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls.push({port, profileId: input?.profileId || null});
    if (holdJordan && port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') {
      startedJordan(); await jordanGate;
    }
    return invoke(input);
  }]));
  return {runtime: createServiceRuntime({...base, services}), calls, jordanStarted, releaseJordan};
}
async function preparedAvery({holdJordan = false} = {}) {
  const env = fixtureRuntime({holdJordan});
  const controller = createPublicController({runtime: env.runtime});
  await controller.initialize('#/');
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal(controller.state.journey.profile.value?.id, 'demo-avery');
  const share = await controller.dispatch('public:share');
  assert.equal(share.ok, true);
  assert.equal(share.share.url, '#/public-profile/demo-avery');
  return {...env, controller};
}
function capture(name, controller, extra = {}) { evidence.cases[name] = {...view(controller), ...extra}; }

// Main finding: the actual provider read is held while route and UI tree are observable.
{
  const env = await preparedAvery({holdJordan: true});
  const c = env.controller;
  capture('prepared_avery', c);
  const pending = c.navigate('#/public-profile/demo-jordan');
  await env.jordanStarted;
  assert.equal(c.route.profileId, 'demo-jordan');
  assert.equal(c.state.journey.profile.status, 'loading');
  capture('jordan_provider_read_held', c, {providerReadHeld: true});
  env.releaseJordan();
  await pending;
  assert.equal(c.state.journey.profile.value?.id, 'demo-jordan');
  const loaded = view(c);
  assert.equal(loaded.shareRouteField?.value, '#/public-profile/demo-avery');
  assert.equal(c.state.journey.share.url, '#/public-profile/demo-avery');
  capture('jordan_loaded_stale_share_route', c);
  const forged = await c.dispatch('public:share', {profileId: 'demo-avery', id: 'demo-avery', url: '#/public-profile/demo-avery'});
  assert.equal(forged.ok, true);
  assert.equal(forged.share.url, '#/public-profile/demo-jordan');
  assert.equal(view(c).shareRouteField?.value, '#/public-profile/demo-jordan');
  evidence.cases.fresh_jordan_dispatch_ignores_forged_payload = {dispatchedPayload: {profileId: 'demo-avery', id: 'demo-avery', url: '#/public-profile/demo-avery'}, dispatchResult: forged, rendered: view(c)};
  evidence.assertions.push('Actual synthetic route change leaves the prior Avery share route in both journey state and the rendered read-only share-route field while Jordan is loaded; explicit dispatch on Jordan refreshes to Jordan and ignores forged payload identity fields.');
  evidence.cases.provider_calls = env.calls;
}

// Same profile alias is identity-preserving: a prepared share remains correct on Avery's alias.
{
  const {controller: c} = await preparedAvery();
  await c.navigate('#/teachers/demo-avery');
  assert.equal(c.state.journey.profile.value?.id, 'demo-avery');
  assert.equal(view(c).shareRouteField?.value, '#/public-profile/demo-avery');
  capture('same_profile_alias_positive_control', c);
  evidence.assertions.push('Same-profile alias retains the matching Avery route.');
}

// Captured Sarah is served by the static read-only renderer, not the synthetic provider.
{
  const env = await preparedAvery(); const c = env.controller; const before = env.calls.length;
  await c.navigate('#/public-profile/reference-sarah');
  assert.equal(c.state.journey.profile.source, 'captured-readonly');
  assert.equal(env.calls.length, before);
  assert.equal(view(c).page, 'profile');
  assert.equal(view(c).shareRouteField, null);
  capture('captured_sarah_readonly_priority', c, {providerCallsDuringNavigation: env.calls.length - before});
  evidence.assertions.push('Captured Sarah route uses the separate read-only renderer and does not inherit the synthetic share-route field or invoke the provider.');
}

// Missing profile has no stale public-profile page, but the controller retains share state.
{
  const {controller: c} = await preparedAvery();
  await c.navigate('#/public-profile/demo-missing');
  assert.equal(c.state.journey.profile.status, 'error');
  assert.equal(view(c).shareRouteField, null);
  capture('missing_profile', c);
  evidence.assertions.push('Missing-profile result is unavailable and renders no share-route field on the error state.');
}

// Pending provider read preserves the stale field until route resolution, then still displays it on Jordan.
{
  const env = await preparedAvery({holdJordan: true}); const c = env.controller;
  const pending = c.navigate('#/public-profile/demo-jordan'); await env.jordanStarted;
  assert.equal(view(c).profileStatus, 'loading');
  assert.equal(view(c).shareRouteField?.value, '#/public-profile/demo-avery');
  capture('pending_read_while_stale_field_visible', c, {providerReadHeld: true});
  env.releaseJordan(); await pending;
  assert.equal(view(c).shareRouteField?.value, '#/public-profile/demo-avery');
  capture('pending_read_resolved_jordan_still_stale', c);
  evidence.assertions.push('The stale share field is visible during the held route read and remains Avery after Jordan resolves.');
}

// Anonymous supporter compatibility: no session is needed to prepare a local share of a viewed profile.
{
  const env = fixtureRuntime(); const c = createPublicController({runtime: env.runtime});
  await c.initialize('#/'); await c.navigate('#/public-profile/demo-avery');
  assert.equal(c.state.journey.session.status, 'anonymous');
  const share = await c.dispatch('public:share');
  assert.equal(share.ok, true);
  assert.equal(share.share.url, '#/public-profile/demo-avery');
  capture('anonymous_supporter_share', c);
  evidence.assertions.push('Anonymous supporter can prepare the local route for the viewed synthetic profile.');
}

console.log(JSON.stringify(evidence, null, 2));
