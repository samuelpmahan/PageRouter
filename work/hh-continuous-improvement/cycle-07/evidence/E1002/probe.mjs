import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle07/H2/E1002');
const sourceFiles = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-controller.test.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs',
  'checkpoint/vendor/hh/services/fixture-provider.mjs',
  'checkpoint/vendor/hh/services/runtime.mjs',
];
const sha256 = async file => createHash('sha256').update(await readFile(resolve(repo, file))).digest('hex');

function inspectTree(node, text = [], elements = []) {
  if (typeof node === 'string' || typeof node === 'number') text.push(String(node));
  else if (Array.isArray(node)) for (const child of node) inspectTree(child, text, elements);
  else if (node && typeof node === 'object') {
    elements.push({tag: node.tag, attrs: node.attrs || {}});
    for (const child of node.children || []) inspectTree(child, text, elements);
  }
  return {text: text.join(' '), elements};
}

function pageSnapshot(controller) {
  const tree = inspectTree(renderPublicSite({route: controller.route, state: controller.state}));
  const profile = controller.state.journey.profile;
  const wishlist = controller.state.journey.wishlist;
  return {
    route: {path: controller.route.path, page: controller.route.page, profileId: controller.route.profileId || null},
    session: {status: controller.state.journey.session.status, teacherId: controller.state.journey.session.teacherId || null,
      communityRole: controller.state.journey.communityRole},
    profile: {status: profile.status, id: profile.value?.id || null, teacherId: profile.value?.teacherId || null,
      name: profile.value?.name || null, wishlistUrl: profile.value?.wishlistUrl || null,
      source: profile.source || null, readOnly: profile.readOnly === true || profile.value?.readOnly === true},
    handoff: {intent: wishlist.intent === true, destination: wishlist.destination || null,
      choiceRequired: wishlist.choiceRequired === true, confirmed: wishlist.confirmed === true, opened: wishlist.opened === true},
    rendered: {
      confirmButtons: tree.elements.filter(el => el.attrs?.['data-event'] === 'public:confirm-wishlist').map(el => ({tag: el.tag, id: el.attrs.id || null})),
      wishlistAnchors: tree.elements.filter(el => ['hh-profile-wishlist-open', 'hh-reference-wishlist'].includes(el.attrs?.id))
        .map(el => ({id: el.attrs.id, href: el.attrs.href || null, text: (el.attrs.id === 'hh-reference-wishlist' ? 'captured reference' : 'synthetic continuation')})),
      textHasAvery: tree.text.includes('Demo Avery'),
      textHasJordan: tree.text.includes('Demo Jordan'),
      textHasSarah: tree.text.includes('Sarah Endsley'),
      textHasProfileUnavailable: tree.text.includes('Profile unavailable'),
      textHasLoadingProfile: tree.text.includes('Loading profile…'),
    },
  };
}

function makeRuntime({holdPublicRead = false} = {}) {
  const base = createFixtureProvider({fixture: true});
  assert.equal(base.capabilities.persistence, 'volatile-memory');
  let startRead;
  let releaseRead;
  const readStarted = new Promise(resolveStarted => { startRead = resolveStarted; });
  const readHeld = new Promise(resolveHeld => { releaseRead = resolveHeld; });
  const calls = [];
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls.push({port, profileId: port === 'TeacherProfile.openPublicProfile' ? input.profileId : undefined});
    if (holdPublicRead && port === 'TeacherProfile.openPublicProfile') {
      startRead();
      await readHeld;
    }
    return invoke(input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  return {
    runtime: createServiceRuntime(provider),
    calls,
    readStarted,
    releaseRead() { releaseRead(); },
  };
}

async function freshAvery({holdPublicRead = false} = {}) {
  const env = makeRuntime({holdPublicRead});
  const controller = createPublicController({runtime: env.runtime});
  await controller.initialize('#/login');
  assert.equal(env.runtime.mode, 'fixture');
  assert.equal(env.runtime.fixture, true);
  assert.equal(env.runtime.capabilities.productionAuthority, false);
  assert.equal(env.runtime.capabilities.persistence, 'volatile-memory');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(login.ok, true, 'seeded Demo Avery is a synthetic approved fixture identity');
  assert.equal(controller.route.path, '/profile');
  assert.equal(controller.state.journey.session.teacherId, 'demo-seed-avery');
  const baselineProfiles = structuredClone(env.runtime.snapshot().demo.publicProfiles);
  return {controller, ...env, baselineProfiles};
}

async function prepareAveryHandoff(controller) {
  const before = pageSnapshot(controller);
  assert.equal(before.route.path, '/profile');
  assert.equal(before.profile.id, 'demo-avery');
  assert.equal(before.profile.teacherId, 'demo-seed-avery');
  assert.equal(before.profile.wishlistUrl, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  const callsBefore = controller.state.journey.runtime;
  const prepared = await controller.dispatch('public:wishlist');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.handoff.remote, false);
  assert.equal(prepared.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(prepared.handoff.choiceRequired, true);
  return {before, prepared: pageSnapshot(controller), handoff: prepared.handoff,
    syntheticOnly: true, controllerRuntimeSnapshotBefore: callsBefore.kind};
}

async function confirmWithoutOpening(env, controller) {
  const providerCallCountBefore = env.calls.length;
  const result = await controller.dispatch('public:confirm-wishlist');
  assert.equal(result.ok, true);
  assert.equal(result.handoff.confirmed, true);
  assert.equal(result.handoff.opened, false);
  assert.equal(result.handoff.remote, false);
  assert.equal(env.calls.length, providerCallCountBefore, 'confirmation is controller-local and invokes no provider service');
  return result;
}

async function crossProfileCase() {
  const env = await freshAvery();
  const {controller} = env;
  const prepared = await prepareAveryHandoff(controller);
  const providerCallsBeforeNavigation = env.calls.length;
  await controller.navigate('#/public-profile/demo-jordan');
  const beforeConfirm = pageSnapshot(controller);
  assert.equal(beforeConfirm.route.profileId, 'demo-jordan');
  assert.equal(beforeConfirm.profile.id, 'demo-jordan');
  assert.equal(beforeConfirm.profile.teacherId, 'demo-seed-jordan');
  assert.equal(beforeConfirm.profile.name, 'Demo Jordan');
  assert.equal(beforeConfirm.session.status, 'authenticated');
  assert.equal(beforeConfirm.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(beforeConfirm.handoff.choiceRequired, true);
  assert.equal(beforeConfirm.rendered.confirmButtons.length, 1, 'confirmation remains visibly available on Jordan profile');
  const confirmation = await confirmWithoutOpening(env, controller);
  const afterConfirm = pageSnapshot(controller);
  const continuation = afterConfirm.rendered.wishlistAnchors.find(anchor => anchor.id === 'hh-profile-wishlist-open');
  assert.equal(confirmation.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(afterConfirm.route.profileId, 'demo-jordan');
  assert.equal(afterConfirm.profile.teacherId, 'demo-seed-jordan');
  assert.equal(continuation?.href, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.deepEqual(env.runtime.snapshot().demo.publicProfiles, env.baselineProfiles, 'handoff/confirm do not mutate fixture teacher profiles');
  assert.equal(env.runtime.snapshot().session.status, 'authenticated');
  return {case: 'prepared_avery_then_confirmed_on_jordan', prepared: prepared.prepared,
    beforeConfirm, confirmation: {ok: confirmation.ok, destination: confirmation.handoff.destination,
      confirmed: confirmation.handoff.confirmed, opened: confirmation.handoff.opened, remote: confirmation.handoff.remote},
    afterConfirm, providerCalls: {beforeNavigation: providerCallsBeforeNavigation, afterNavigation: env.calls.length - 1,
      confirmAddedCall: false}, profileRecordsUnchanged: true,
    outcome: continuation?.href !== 'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN' ? 'confirmed_stale_identity' : 'current_identity'};
}

async function sameProfileControl() {
  const env = await freshAvery();
  const {controller} = env;
  const prepared = await prepareAveryHandoff(controller);
  await controller.navigate('#/public-profile/demo-avery');
  const beforeConfirm = pageSnapshot(controller);
  assert.equal(beforeConfirm.profile.id, 'demo-avery');
  assert.equal(beforeConfirm.profile.teacherId, 'demo-seed-avery');
  const confirmation = await confirmWithoutOpening(env, controller);
  const after = pageSnapshot(controller);
  const continuation = after.rendered.wishlistAnchors.find(anchor => anchor.id === 'hh-profile-wishlist-open');
  assert.equal(confirmation.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(continuation?.href, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  return {case: 'prepared_and_confirmed_same_avery_identity', prepared: prepared.prepared,
    beforeConfirm, confirmation: {ok: confirmation.ok, destination: confirmation.handoff.destination},
    after, continuationHref: continuation?.href, outcome: 'current_identity_control'};
}

async function capturedReferenceControl() {
  const env = await freshAvery();
  const {controller} = env;
  const prepared = await prepareAveryHandoff(controller);
  await controller.navigate('#/public-profile/reference-sarah');
  const beforeDirectConfirm = pageSnapshot(controller);
  assert.equal(beforeDirectConfirm.profile.source, 'captured-readonly');
  assert.equal(beforeDirectConfirm.profile.readOnly, true);
  const staticLink = beforeDirectConfirm.rendered.wishlistAnchors.find(anchor => anchor.id === 'hh-reference-wishlist');
  assert.equal(staticLink?.href, 'https://www.amazon.com/hz/wishlist/ls/3F27WJHJEBAXN?ref_=wl_share&tag=h0mer00mher0-20');
  assert.equal(beforeDirectConfirm.rendered.confirmButtons.length, 0, 'captured route renders its own static link, not the dynamic confirmation button');
  const confirmation = await confirmWithoutOpening(env, controller);
  const after = pageSnapshot(controller);
  assert.equal(confirmation.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(after.rendered.wishlistAnchors.find(anchor => anchor.id === 'hh-reference-wishlist')?.href, staticLink.href);
  assert.equal(after.rendered.wishlistAnchors.some(anchor => anchor.id === 'hh-profile-wishlist-open'), false);
  return {case: 'captured_readonly_priority', prepared: prepared.prepared, beforeDirectConfirm,
    staticReferenceHref: staticLink.href, directConfirm: {ok: confirmation.ok, destination: confirmation.handoff.destination},
    after, outcome: 'captured_static_link_remains_distinct'};
}

async function pendingReadControl() {
  const env = await freshAvery({holdPublicRead: true});
  const {controller} = env;
  const prepared = await prepareAveryHandoff(controller);
  const pendingNavigation = controller.navigate('#/public-profile/demo-jordan');
  await env.readStarted;
  const loading = pageSnapshot(controller);
  assert.equal(loading.profile.status, 'loading');
  assert.equal(loading.route.profileId, 'demo-jordan');
  assert.equal(loading.rendered.textHasLoadingProfile, true);
  assert.equal(loading.rendered.confirmButtons.length, 0);
  env.releaseRead();
  await pendingNavigation;
  const loaded = pageSnapshot(controller);
  assert.equal(loaded.profile.teacherId, 'demo-seed-jordan');
  assert.equal(loaded.rendered.confirmButtons.length, 1);
  const confirmation = await confirmWithoutOpening(env, controller);
  const after = pageSnapshot(controller);
  assert.equal(confirmation.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  return {case: 'pending_jordan_read_after_avery_handoff', prepared: prepared.prepared, loading,
    loaded, confirmation: {ok: confirmation.ok, destination: confirmation.handoff.destination}, after,
    outcome: confirmation.handoff.destination === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY'
      ? 'stale_identity_after_pending_read' : 'current_identity'};
}

async function notFoundControl() {
  const env = await freshAvery();
  const {controller} = env;
  const prepared = await prepareAveryHandoff(controller);
  const read = await controller.navigate('#/public-profile/not-a-fixture-profile');
  const beforeDirectConfirm = pageSnapshot(controller);
  assert.equal(read.ok, true, 'navigate reports route installation; profile result lives in the controller projection');
  assert.equal(beforeDirectConfirm.profile.status, 'error');
  assert.equal(beforeDirectConfirm.profile.id, null);
  assert.equal(beforeDirectConfirm.rendered.textHasProfileUnavailable, true);
  assert.equal(beforeDirectConfirm.rendered.confirmButtons.length, 0);
  const confirmation = await confirmWithoutOpening(env, controller);
  const after = pageSnapshot(controller);
  assert.equal(confirmation.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.equal(after.rendered.confirmButtons.length, 0, 'error route does not render dynamic confirmation control');
  return {case: 'not_found_profile_control', prepared: prepared.prepared, beforeDirectConfirm,
    directDispatchResult: {ok: confirmation.ok, destination: confirmation.handoff.destination}, after,
    outcome: 'handoff_handler_accepts_direct_confirm_but_no_confirmation_control_is_rendered'};
}

async function main() {
  const result = {
    schema: 'hh-cycle07-H2-E1002/wishlist-identity-probe/v1',
    job_id: 'E1002',
    worker: 'H2',
    repository: 'PageRouter',
    head: '7feded8819db87026a8f35f6aa515bda513ab541',
    tree: '1cdcf9bfb34b680ed198eb7e750486ecfd1887cc',
    sourceHashes: {},
    commands: ['node /workspace/scratch/8528bb251845/hh-cycle07/H2/E1002/probe.mjs'],
    environment: {runtime: 'actual createFixtureProvider volatile-memory + createServiceRuntime + createPublicController + renderPublicSite tree',
      identity: 'synthetic seeded Demo Avery and Demo Jordan only', fixture: true, productionAuthority: false,
      networkOrProduction: false, backendExecution: false, externalOpenOrPayment: false, browserVisualQA: false},
    hypothesis: 'A handoff prepared for the active profile may survive route navigation without binding destination to the newly displayed teacher; confirmation may continue to expose the stale destination.',
    cases: [],
  };
  for (const file of sourceFiles) result.sourceHashes[file] = await sha256(file);
  result.cases.push(await crossProfileCase());
  result.cases.push(await sameProfileControl());
  result.cases.push(await capturedReferenceControl());
  result.cases.push(await pendingReadControl());
  result.cases.push(await notFoundControl());
  const jordan = result.cases.find(item => item.case === 'prepared_avery_then_confirmed_on_jordan');
  result.assertions = {
    actualVolatileFixtureUsed: result.environment.fixture && !result.environment.productionAuthority,
    AveryHandoffWasUserPrepared: jordan.prepared.handoff.destination === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',
    JordanIdentityWasActuallyLoaded: jordan.beforeConfirm.profile.teacherId === 'demo-seed-jordan' && jordan.beforeConfirm.profile.name === 'Demo Jordan',
    oldDestinationSurvivesNavigation: jordan.beforeConfirm.handoff.destination === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',
    JordanShowsConfirmationForOldHandoff: jordan.beforeConfirm.rendered.confirmButtons.length === 1,
    directConfirmReturnsAveryDestinationUnderJordan: jordan.confirmation.destination === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY' && jordan.afterConfirm.profile.teacherId === 'demo-seed-jordan',
    renderedContinuationHrefIsStale: jordan.afterConfirm.rendered.wishlistAnchors.some(anchor => anchor.id === 'hh-profile-wishlist-open' && anchor.href === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY'),
    noExternalOpenOrProviderWriteOnConfirm: jordan.confirmation.opened === false && jordan.confirmation.remote === false && jordan.providerCalls.confirmAddedCall === false,
    sameProfileControlMatchesIdentity: result.cases[1].continuationHref === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',
    capturedReferenceKeepsStaticSarahLink: result.cases[2].staticReferenceHref.includes('/3F27WJHJEBAXN') && result.cases[2].after.rendered.wishlistAnchors.every(a => a.id !== 'hh-profile-wishlist-open'),
    pendingReadDoesNotResetOldHandoff: result.cases[3].loading.handoff.destination === 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY' && result.cases[3].after.profile.teacherId === 'demo-seed-jordan',
    notFoundRendersNoConfirmControl: result.cases[4].beforeDirectConfirm.rendered.confirmButtons.length === 0,
  };
  result.allAssertionsPassed = Object.values(result.assertions).every(Boolean);
  result.outcome = result.assertions.renderedContinuationHrefIsStale && result.assertions.directConfirmReturnsAveryDestinationUnderJordan
    ? 'confirmed_reuse' : result.allAssertionsPassed ? 'not_reuse' : 'insufficient_evidence';
  result.summary = result.outcome === 'confirmed_reuse'
    ? 'The real volatile fixture/controller/renderPublicSite path confirms a prepared Avery handoff remains active after Jordan loads. The visible confirmation button remains on Jordan; direct confirmation succeeds without a provider call and the rendered continuation href still targets Avery. Same-identity control uses Avery, captured reference keeps its separate static Sarah URL, pending navigation preserves the stale handoff until Jordan loads, and not-found renders no confirmation button. No external link was opened.'
    : 'The selected wishlist handoff identity hypothesis was not demonstrated by this run.';
  result.limits = {syntheticOnly: true, noProductionOrBackendOrNetwork: true, noRealTeacherData: true,
    noExternalOpenSharePayment: true, renderedTreeNotBrowserQA: true, noProductSourceOrGitMutation: true,
    profileRecordWrites: 'None from wishlist preparation/confirmation; only fixture login and public-profile reads were performed.'};
  result.next = result.outcome === 'confirmed_reuse'
    ? 'Preserve this reproduction as baseline evidence. No source correction is authorized by E1002; a separate fresh native assignment is required before implementation and independent review.'
    : 'Retain this falsifier; do not make source changes without a demonstrated regression and fresh native assignment.';
  return result;
}

try {
  const result = await main();
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const failure = {schema: 'hh-cycle07-H2-E1002/wishlist-identity-probe/v1', job_id: 'E1002', worker: 'H2', outcome: 'insufficient_evidence',
    error: {name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '')}};
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(failure, null, 2)}\n`);
  console.log(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}
