import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle08/H2/E1202');
const sourceFiles = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-controller.test.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs',
  'checkpoint/vendor/hh/services/fixture-provider.mjs',
  'checkpoint/vendor/hh/services/runtime.mjs',
];

function inspectTree(node, text = [], elements = []) {
  if (typeof node === 'string' || typeof node === 'number') text.push(String(node));
  else if (Array.isArray(node)) for (const child of node) inspectTree(child, text, elements);
  else if (node && typeof node === 'object') {
    elements.push({tag: node.tag, attrs: node.attrs || {}, value: node.value});
    for (const child of node.children || []) inspectTree(child, text, elements);
  }
  return {text: text.join(' '), elements};
}

function snapshot(controller) {
  const tree = inspectTree(renderPublicSite({route: controller.route, state: controller.state}));
  const profile = controller.state.journey.profile;
  const share = controller.state.journey.share;
  const shareFields = tree.elements.filter(el => el.attrs?.['data-testid'] === 'share-route' || el.attrs?.name === 'share-route' || el.attrs?.id === 'share-route');
  const fieldByLabel = tree.elements.filter(el => el.tag === 'label' && String(el.children || '').includes('Share route'));
  const fieldInputs = tree.elements.filter(el => el.tag === 'input' && (el.attrs?.id === 'share-route' || el.attrs?.name === 'share-route'));
  return {
    route: {path: controller.route.path, page: controller.route.page, profileId: controller.route.profileId || null},
    session: {status: controller.state.journey.session.status, teacherId: controller.state.journey.session.teacherId || null},
    profile: {status: profile.status, id: profile.value?.id || null, teacherId: profile.value?.teacherId || null,
      name: profile.value?.name || null, source: profile.source || null, readOnly: profile.readOnly === true || profile.value?.readOnly === true},
    share: {intent: share.intent === true, url: share.url || null, remote: share.remote ?? null, copied: share.copied ?? null},
    rendered: {
      buttons: tree.elements.filter(el => el.attrs?.['data-event'] === 'public:share').map(el => ({id: el.attrs.id || null, tag: el.tag})),
      shareHandoff: tree.elements.filter(el => el.attrs?.['data-testid'] === 'hh-share-handoff').map(el => el.attrs),
      shareRouteFields: fieldInputs.map(el => ({id: el.attrs.id || null, name: el.attrs.name || null, value: el.value ?? el.attrs.value ?? null, readonly: el.attrs.readonly ?? null})),
      sarahNote: tree.elements.some(el => el.attrs?.['data-testid'] === 'hh-reference-share-note'),
      staticSarahWishlist: tree.elements.filter(el => el.attrs?.id === 'hh-reference-wishlist').map(el => el.attrs.href),
      textHasAvery: tree.text.includes('Demo Avery'), textHasJordan: tree.text.includes('Demo Jordan'),
      textHasSarah: tree.text.includes('Sarah Endsley'), textHasUnavailable: tree.text.includes('Profile unavailable'),
    },
    debug: {matchedShareElements: shareFields.length, labels: fieldByLabel.length},
  };
}

function makeEnv() {
  const base = createFixtureProvider({fixture: true});
  assert.equal(base.capabilities.persistence, 'volatile-memory');
  const calls = [];
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls.push({port, profileId: port === 'TeacherProfile.openPublicProfile' ? input.profileId : undefined});
    return invoke(input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  return {runtime: createServiceRuntime(provider), calls};
}

async function freshAvery() {
  const env = makeEnv();
  const controller = createPublicController({runtime: env.runtime});
  await controller.initialize('#/login');
  assert.equal(env.runtime.mode, 'fixture');
  assert.equal(env.runtime.fixture, true);
  assert.equal(env.runtime.capabilities.productionAuthority, false);
  assert.equal(env.runtime.capabilities.persistence, 'volatile-memory');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(login.ok, true);
  assert.equal(controller.route.path, '/profile');
  assert.equal(controller.state.journey.session.teacherId, 'demo-seed-avery');
  assert.equal(controller.state.journey.profile.value.id, 'demo-avery');
  return {controller, ...env};
}

async function prepareShare(controller) {
  const before = snapshot(controller);
  const result = await controller.dispatch('public:share');
  assert.equal(result.ok, true);
  assert.equal(result.share.remote, false);
  assert.equal(result.share.copied, false);
  return {before, dispatch: result.share, after: snapshot(controller)};
}

async function shareOnJordan() {
  const env = await freshAvery();
  const prepared = await prepareShare(env.controller);
  const callsBeforeNavigation = env.calls.length;
  await env.controller.navigate('#/public-profile/demo-jordan');
  const beforeReprepare = snapshot(env.controller);
  assert.equal(beforeReprepare.route.profileId, 'demo-jordan');
  assert.equal(beforeReprepare.profile.id, 'demo-jordan');
  assert.equal(beforeReprepare.profile.teacherId, 'demo-seed-jordan');
  assert.equal(beforeReprepare.share.url, '#/public-profile/demo-avery');
  assert.equal(beforeReprepare.rendered.shareRouteFields[0]?.value, '#/public-profile/demo-avery');
  const dispatch = await env.controller.dispatch('public:share');
  const afterReprepare = snapshot(env.controller);
  assert.equal(dispatch.share.url, '#/public-profile/demo-jordan');
  assert.equal(afterReprepare.rendered.shareRouteFields[0]?.value, '#/public-profile/demo-jordan');
  assert.equal(dispatch.share.remote, false);
  assert.equal(dispatch.share.copied, false);
  assert.equal(env.calls.length, callsBeforeNavigation + 1, 'only the Jordan public-profile read adds a service call');
  return {case: 'prepared_demo_avery_then_navigated_demo_jordan', prepared,
    beforeReprepare, directDispatch: {ok: dispatch.ok, share: dispatch.share}, afterReprepare,
    providerCalls: {beforeNavigation: callsBeforeNavigation, afterJordanNavigation: env.calls.length,
      directShareDispatchAddedProviderCall: false}, outcome: beforeReprepare.share.url === '#/public-profile/demo-avery'
      ? 'stale_prepared_identity_visible_until_reprepared' : 'current_identity'};
}

async function sameIdentityAliasControl() {
  const env = await freshAvery();
  const prepared = await prepareShare(env.controller);
  await env.controller.navigate('#/public-profile/demo-avery');
  const afterNavigation = snapshot(env.controller);
  assert.equal(afterNavigation.route.profileId, 'demo-avery');
  assert.equal(afterNavigation.profile.id, 'demo-avery');
  assert.equal(afterNavigation.share.url, '#/public-profile/demo-avery');
  assert.equal(afterNavigation.rendered.shareRouteFields[0]?.value, '#/public-profile/demo-avery');
  return {case: 'prepared_and_navigated_to_same_avery_alias', prepared, afterNavigation,
    outcome: 'same_identity_control_matches_current_profile'};
}

async function capturedSarahPriorityControl() {
  const env = await freshAvery();
  const prepared = await prepareShare(env.controller);
  await env.controller.navigate('#/public-profile/reference-sarah');
  const beforeDirectDispatch = snapshot(env.controller);
  assert.equal(beforeDirectDispatch.profile.source, 'captured-readonly');
  assert.equal(beforeDirectDispatch.profile.readOnly, true);
  assert.equal(beforeDirectDispatch.rendered.staticSarahWishlist.length, 1);
  assert.equal(beforeDirectDispatch.rendered.shareRouteFields.length, 0,
    'captured reference uses its static Share Page note path, not editable-profile share-route field');
  assert.equal(beforeDirectDispatch.share.url, '#/public-profile/demo-avery');
  assert.equal(beforeDirectDispatch.rendered.sarahNote, true);
  const direct = await env.controller.dispatch('public:share');
  const afterDirectDispatch = snapshot(env.controller);
  assert.equal(direct.share.url, '#/public-profile/reference-sarah');
  assert.equal(afterDirectDispatch.rendered.shareRouteFields.length, 0);
  assert.equal(afterDirectDispatch.rendered.staticSarahWishlist[0], beforeDirectDispatch.rendered.staticSarahWishlist[0]);
  return {case: 'captured_sarah_static_reference_priority', prepared, beforeDirectDispatch,
    directDispatch: {ok: direct.ok, share: direct.share}, afterDirectDispatch,
    outcome: 'captured_static_wishlist_stays_separate_from_generic_share_route'};
}

const cases = [await shareOnJordan(), await sameIdentityAliasControl(), await capturedSarahPriorityControl()];
const sourceHashes = {};
for (const file of sourceFiles) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(repo, file))).digest('hex');
const report = {
  schema: 'hh-cycle08-H2-E1202/public-share-identity-probe/v1',
  job_id: 'E1202', worker: 'H2', repository: 'PageRouter',
  head: '65ea21f5a2ef3f3a7adb285b2285d2c6f8274fcd', tree: '0901b1816314ef3aa5d580867ac0cd3fc49d3637',
  sourceHashes,
  commands: ['node /workspace/scratch/8528bb251845/hh-cycle08/H2/E1202/probe.mjs'],
  environment: {runtime: 'actual createFixtureProvider volatile-memory + createServiceRuntime + createPublicController + renderPublicSite tree',
    identity: 'synthetic seeded Demo Avery, Demo Jordan, and captured read-only Sarah reference only',
    fixture: true, productionAuthority: false, persistence: 'volatile-memory', networkOrProduction: false,
    backendExecution: false, externalCopyOrShareOrOpen: false, browserVisualQA: false},
  hypothesis: 'A public:share route prepared for Demo Avery may remain visible after navigation to Demo Jordan instead of following the current profile; direct dispatch behavior and captured-reference rendering may differ.',
  cases,
  assertions: {actualVolatileFixtureUsed: true, AveryShareWasPreparedByControllerDispatch: true,
    JordanIdentityWasActuallyLoaded: true, AveryShareRouteRemainedVisibleOnJordanBeforeNewDispatch: cases[0].beforeReprepare.share.url === '#/public-profile/demo-avery',
    shareRouteFieldRenderedAveryRouteOnJordan: cases[0].beforeReprepare.rendered.shareRouteFields[0]?.value === '#/public-profile/demo-avery',
    directDispatchRepreparedRouteForCurrentJordan: cases[0].directDispatch.share.url === '#/public-profile/demo-jordan',
    sameIdentityAliasControlMatches: cases[1].outcome === 'same_identity_control_matches_current_profile',
    capturedSarahStaticShareNoteDistinct: cases[2].outcome === 'captured_static_wishlist_stays_separate_from_generic_share_route',
    noExternalCopyShareOrOpen: true},
  allAssertionsPassed: true,
  outcome: cases[0].beforeReprepare.share.url === '#/public-profile/demo-avery' ? 'confirmed_reuse' : 'not_reuse',
  summary: 'Actual synthetic volatile-fixture controller/runtime/tree evidence shows the prepared share route remains #/public-profile/demo-avery when Demo Jordan is loaded, and the rendered editable-profile Share route field still presents Avery. Direct public:share dispatch while on Jordan replaces it with Jordan. The same-Avery alias remains a matching control. Captured Sarah remains a separate static read-only renderer with its own share note and static wishlist link; it does not render the generic share-route field. No external copy/share/open was performed.',
  limits: {syntheticOnly: true, noProductionBackendOrNetwork: true, noRealTeacherData: true,
    noExternalCopyShareOrOpen: true, renderedTreeNotBrowserQA: true, noProductSourceOrGitMutation: true,
    profileRecordWrites: 'None; only fixture login and public-profile reads were performed.'},
  next: 'Preserve as runtime/tree reproduction baseline. H1 may add a focused failing regression and smallest identity-binding correction under the existing native task gates; H2 must independently review any later source change. This probe does not approve code or claim browser visual QA.',
};
await writeFile(resolve(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({outcome: report.outcome, cases: cases.map(item => ({case: item.case, outcome: item.outcome})), sourceHashes}, null, 2));
