import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const evidence = {
  job_id: 'E1001', worker: 'H1',
  environment: {provider: 'fixture', fixture: true, productionAuthority: false, persistence: 'volatile-memory', httpCalls: 0, browserOpened: false, externalActions: 0},
  assertions: [], cases: {},
};

function elements(node, predicate = () => true, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  for (const child of node.children || []) elements(child, predicate, found);
  return found;
}
function tree(controller) {
  const s = controller.state, j = s.journey;
  return renderPublicSite({route: s.route, state: s, journey: j, community: s.community});
}
function rendered(controller) {
  const root = tree(controller);
  const nodes = elements(root);
  return {
    page: root.attrs?.['data-public-page'],
    h1: nodes.filter(n => n.tag === 'h1').map(n => (n.children || []).filter(x => typeof x === 'string').join('')),
    anchors: nodes.filter(n => n.tag === 'a').map(n => ({id: n.attrs?.id || null, href: n.attrs?.href || null, text: (n.children || []).filter(x => typeof x === 'string').join('')})),
    buttons: nodes.filter(n => n.tag === 'button').map(n => ({id: n.attrs?.id || null, event: n.attrs?.['data-event'] || null, text: (n.children || []).filter(x => typeof x === 'string').join('')})),
  };
}
function freshRuntime({holdJordan = false} = {}) {
  const base = createFixtureProvider({fixture: true});
  const calls = [];
  let releaseJordan;
  let startedJordan;
  const jordanStarted = new Promise(resolve => { startedJordan = resolve; });
  const jordanGate = new Promise(resolve => { releaseJordan = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls.push({port, profileId: input?.profileId || null});
    if (holdJordan && port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') {
      startedJordan();
      await jordanGate;
    }
    return invoke(input);
  }]));
  const provider = {...base, services};
  const runtime = createServiceRuntime(provider);
  return {runtime, calls, jordanStarted, releaseJordan};
}
async function signedInAvery(opts) {
  const controller = createPublicController({runtime: opts.runtime});
  await controller.initialize('#/');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(login.ok, true, 'synthetic fixture login succeeds');
  assert.equal(controller.state.journey.session.status, 'authenticated');
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal(controller.state.journey.profile.value?.id, 'demo-avery');
  return controller;
}
function capture(name, controller, extra = {}) {
  evidence.cases[name] = {
    route: {...controller.route}, profileStatus: controller.state.journey.profile.status,
    profile: controller.state.journey.profile.value ? {id: controller.state.journey.profile.value.id, name: controller.state.journey.profile.value.name, readOnly: !!controller.state.journey.profile.readOnly} : null,
    session: {status: controller.state.journey.session.status, teacherId: controller.state.journey.session.teacherId},
    wishlist: structuredClone(controller.state.journey.wishlist), render: rendered(controller), ...extra,
  };
}

// Main reproduction: hold the actual provider read so route/profile loading state is observed before resolution.
{
  const opts = freshRuntime({holdJordan: true});
  const c = await signedInAvery(opts);
  const prepared = await c.dispatch('public:wishlist');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  capture('foreign_prepared_before_navigation', c);
  const pendingNavigation = c.navigate('#/public-profile/demo-jordan');
  await opts.jordanStarted;
  assert.equal(c.route.profileId, 'demo-jordan');
  assert.equal(c.state.journey.profile.status, 'loading');
  capture('foreign_while_provider_read_held', c, {providerReadHeld: true});
  opts.releaseJordan();
  await pendingNavigation;
  assert.equal(c.state.journey.profile.value?.id, 'demo-jordan');
  assert.equal(c.state.journey.profile.value?.name, 'Demo Jordan');
  const awaitingChoice = rendered(c);
  assert.ok(awaitingChoice.buttons.some(n => n.id === 'hh-profile-wishlist-confirm'));
  capture('foreign_before_confirmation', c);
  const confirmed = await c.dispatch('public:confirm-wishlist');
  assert.equal(confirmed.ok, true);
  const after = rendered(c);
  const continueLink = after.anchors.find(n => n.id === 'hh-profile-wishlist-open');
  assert.ok(continueLink, 'rendered regular profile exposes the confirm-to-continue anchor');
  assert.equal(continueLink.href, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(c.state.journey.profile.value?.id, 'demo-jordan');
  evidence.cases.foreign_after_direct_confirmation = {
    route: {...c.route}, profile: {id: c.state.journey.profile.value.id, name: c.state.journey.profile.value.name},
    session: {status: c.state.journey.session.status, teacherId: c.state.journey.session.teacherId},
    dispatchedEvent: 'public:confirm-wishlist', dispatchResult: confirmed, renderedContinueAnchor: continueLink,
    wishlist: structuredClone(c.state.journey.wishlist),
  };
  evidence.assertions.push('Foreign-profile stale wishlist mismatch reproduced through the actual fixture provider, controller state, direct event dispatch, and rendered continue anchor.');
  evidence.cases.foreign_provider_calls = opts.calls;
}

// Same-profile control: the user's prepared Avery destination matches the profile, including its alternate public route.
{
  const opts = freshRuntime();
  const c = await signedInAvery(opts);
  await c.dispatch('public:wishlist');
  await c.navigate('#/teachers/demo-avery');
  assert.equal(c.state.journey.profile.value?.id, 'demo-avery');
  assert.equal(c.state.journey.wishlist.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  await c.dispatch('public:confirm-wishlist');
  const link = rendered(c).anchors.find(n => n.id === 'hh-profile-wishlist-open');
  assert.equal(link?.href, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  capture('same_profile_alias_positive_control', c, {renderedContinueAnchor: link});
  evidence.assertions.push('Same-profile alias control renders the selected profile’s own synthetic destination.');
}

// Already-confirmed control: confirmation stays attached to the prior handoff across subsequent navigation.
{
  const opts = freshRuntime();
  const c = await signedInAvery(opts);
  await c.dispatch('public:wishlist');
  await c.dispatch('public:confirm-wishlist');
  await c.navigate('#/public-profile/demo-jordan');
  assert.equal(c.state.journey.profile.value?.id, 'demo-jordan');
  const link = rendered(c).anchors.find(n => n.id === 'hh-profile-wishlist-open');
  assert.equal(link?.href, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  capture('confirmed_then_foreign_control', c, {renderedContinueAnchor: link});
  evidence.assertions.push('Already-confirmed handoff control also persists and renders its Avery URL on Jordan.');
}

// Captured reference priority control: its static captured URL remains distinct from the synthetic journey handoff.
{
  const opts = freshRuntime();
  const c = await signedInAvery(opts);
  await c.dispatch('public:wishlist');
  const callsBefore = opts.calls.length;
  await c.navigate('#/public-profile/reference-sarah');
  assert.equal(c.state.journey.profile.readOnly, true);
  assert.equal(c.state.journey.profile.source, 'captured-readonly');
  assert.equal(opts.calls.length, callsBefore, 'captured reference route bypasses provider');
  const staticLink = rendered(c).anchors.find(n => n.id === 'hh-reference-wishlist');
  assert.ok(staticLink?.href);
  assert.notEqual(staticLink.href, c.state.journey.wishlist.destination);
  await c.dispatch('public:confirm-wishlist');
  const after = rendered(c).anchors.find(n => n.id === 'hh-reference-wishlist');
  assert.equal(after.href, staticLink.href);
  assert.equal(rendered(c).anchors.some(n => n.id === 'hh-profile-wishlist-open'), false);
  capture('captured_reference_priority_control', c, {providerCallsDuringCapturedNavigation: opts.calls.length - callsBefore, staticCapturedAnchor: after});
  evidence.assertions.push('Captured read-only Sarah route keeps its static reference link and never substitutes the stale synthetic Avery handoff.');
}

// Missing-profile control: failed lookup renders unavailable state without a continue link.
{
  const opts = freshRuntime();
  const c = await signedInAvery(opts);
  await c.dispatch('public:wishlist');
  const result = await c.navigate('#/public-profile/demo-profile-missing');
  assert.equal(c.route.profileId, 'demo-profile-missing');
  assert.equal(c.state.journey.profile.status, 'error');
  const view = rendered(c);
  assert.ok(view.h1.includes('Profile unavailable'));
  assert.equal(view.anchors.some(n => n.id === 'hh-profile-wishlist-open'), false);
  capture('missing_profile_control', c, {navigationResult: result});
  evidence.assertions.push('Missing profile read yields unavailable rendering and no external continue anchor.');
}

console.log(JSON.stringify(evidence, null, 2));
await writeFile('/workspace/scratch/8528bb251845/hh-cycle07/H1/E1001/runtime-evidence.json', `${JSON.stringify(evidence, null, 2)}\n`);
