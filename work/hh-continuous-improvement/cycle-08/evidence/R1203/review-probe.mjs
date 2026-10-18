import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle08/H2/R1203');
const sourceFiles = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-controller.test.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs',
  'checkpoint/vendor/hh/services/fixture-provider.mjs',
  'checkpoint/vendor/hh/services/runtime.mjs',
];

function inspect(node, text = [], elements = []) {
  if (typeof node === 'string' || typeof node === 'number') text.push(String(node));
  else if (Array.isArray(node)) for (const child of node) inspect(child, text, elements);
  else if (node && typeof node === 'object') {
    elements.push({tag: node.tag, attrs: node.attrs || {}, value: node.value ?? null});
    for (const child of node.children || []) inspect(child, text, elements);
  }
  return {text: text.join(' '), elements};
}

function view(controller) {
  const state = controller.state.journey;
  const tree = inspect(renderPublicSite({route: controller.route, state: controller.state, journey: state}));
  const shareFields = tree.elements.filter(element => element.attrs?.id === 'hh-share-route');
  return {
    route: {page: controller.route.page, path: controller.route.path, profileId: controller.route.profileId || null},
    profile: {status: state.profile.status, id: state.profile.value?.id || null,
      teacherId: state.profile.value?.teacherId || null, source: state.profile.source || null,
      readOnly: state.profile.readOnly === true || state.profile.value?.readOnly === true},
    session: {status: state.session.status, teacherId: state.session.teacherId || null},
    share: structuredClone(state.share),
    wishlist: structuredClone(state.wishlist),
    rendered: {
      shareFields: shareFields.map(element => ({id: element.attrs.id, value: element.value ?? element.attrs.value ?? null,
        readonly: element.attrs.readonly ?? null})),
      shareButtons: tree.elements.filter(element => element.attrs?.['data-event'] === 'public:share').map(element => element.attrs.id || null),
      capturedShareNote: tree.elements.some(element => element.attrs?.['data-testid'] === 'hh-reference-share-note'),
      capturedWishlist: tree.elements.filter(element => element.attrs?.id === 'hh-reference-wishlist').map(element => element.attrs.href),
      editButton: tree.elements.some(element => element.attrs?.id === 'hh-profile-edit'),
      unavailable: tree.text.includes('Profile unavailable'),
      loading: tree.text.includes('Loading profile…'),
    },
  };
}

function makeEnv({holdProfileId = null} = {}) {
  const base = createFixtureProvider({fixture: true});
  assert.equal(base.capabilities.persistence, 'volatile-memory');
  let signalStarted;
  let release;
  const started = new Promise(resolveStarted => { signalStarted = resolveStarted; });
  const gate = new Promise(resolveGate => { release = resolveGate; });
  const calls = [];
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls.push({port, profileId: port === 'TeacherProfile.openPublicProfile' ? input.profileId : undefined});
    if (holdProfileId && port === 'TeacherProfile.openPublicProfile' && input?.profileId === holdProfileId) {
      signalStarted();
      await gate;
    }
    return invoke(input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  const runtime = createServiceRuntime(provider);
  const controller = createPublicController({runtime});
  return {base, runtime, controller, calls, started, release: () => release()};
}

async function start(env, hash = '#/') {
  await env.controller.initialize(hash);
  assert.equal(env.runtime.mode, 'fixture');
  assert.equal(env.runtime.fixture, true);
  assert.equal(env.runtime.capabilities.productionAuthority, false);
  assert.equal(env.runtime.capabilities.persistence, 'volatile-memory');
}

async function loginAvery(env) {
  await start(env, '#/login');
  const result = await env.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(result.ok, true);
  assert.equal(env.controller.state.journey.session.teacherId, 'demo-seed-avery');
  assert.equal(env.controller.state.journey.profile.value.id, 'demo-avery');
}

async function prepareShare(controller, payload = {}) {
  const result = await controller.dispatch('public:share', payload);
  assert.equal(result.ok, true);
  assert.equal(result.share.remote, false);
  assert.equal(result.share.copied, false);
  return result.share;
}

async function heldForeignReadAndAliasControls() {
  const env = makeEnv({holdProfileId: 'demo-jordan'});
  await loginAvery(env);
  const wishlist = await env.controller.dispatch('public:wishlist');
  assert.equal(wishlist.ok, true);
  const wishlistBeforeShare = structuredClone(env.controller.state.journey.wishlist);
  const prepared = await prepareShare(env.controller, {profileId: 'demo-jordan', id: 'demo-jordan',
    url: 'https://attacker.invalid/', copied: true, remote: true});
  assert.equal(prepared.url, '#/public-profile/demo-avery', 'share ignores forged identity and transport fields');
  assert.deepEqual(env.controller.state.journey.wishlist, wishlistBeforeShare, 'share dispatch leaves prepared wishlist handoff untouched');

  await env.controller.navigate('#/teachers/demo-avery');
  const alias = view(env.controller);
  assert.equal(alias.share.intent, true);
  assert.equal(alias.share.profileId, 'demo-avery');
  assert.equal(alias.rendered.shareFields[0]?.value, '#/public-profile/demo-avery');
  assert.equal(alias.session.teacherId, 'demo-seed-avery');
  assert.equal(alias.profile.id, 'demo-avery');
  assert.deepEqual(alias.wishlist, wishlistBeforeShare);

  const callsBeforeForeignNavigation = env.calls.length;
  const navigation = env.controller.navigate('#/public-profile/demo-jordan');
  await env.started;
  const pending = view(env.controller);
  assert.equal(pending.route.profileId, 'demo-jordan');
  assert.equal(pending.profile.status, 'loading');
  assert.equal(pending.share.intent, false, 'old share is cleared synchronously before held service read resolves');
  assert.equal(pending.share.profileId, null);
  assert.equal(pending.rendered.shareFields.length, 0);
  assert.equal(pending.session.teacherId, 'demo-seed-avery', 'navigation does not change owner session');
  env.release();
  await navigation;
  const jordan = view(env.controller);
  assert.equal(jordan.profile.id, 'demo-jordan');
  assert.equal(jordan.session.teacherId, 'demo-seed-avery');
  assert.equal(jordan.share.intent, false);
  assert.equal(jordan.rendered.shareFields.length, 0);
  assert.equal(env.calls.length, callsBeforeForeignNavigation + 1, 'navigation performs one public-profile read');
  assert.equal(env.calls.filter(call => call.port === 'TeacherProfile.openPublicProfile').at(-1)?.profileId, 'demo-jordan');
  return {case: 'held_foreign_profile_read_clears_stale_share_before_completion', prepared, wishlistBeforeShare,
    alias, pending, jordan, providerReadCount: env.calls.filter(call => call.port === 'TeacherProfile.openPublicProfile').length,
    outcome: 'accepted'};
}

async function pendingMissingCapturedAndForgedControls() {
  const env = makeEnv({holdProfileId: 'demo-jordan'});
  await start(env);
  const navigation = env.controller.navigate('#/public-profile/demo-jordan');
  await env.started;
  assert.equal(env.controller.state.journey.profile.status, 'loading');
  const during = await prepareShare(env.controller, {profileId: 'demo-avery', url: 'not-a-route', copied: true, remote: true});
  assert.equal(during.url, '#/public-profile/demo-jordan', 'direct pending dispatch is route-derived, not payload-derived');
  assert.equal(during.profileId, 'demo-jordan');
  assert.equal(during.remote, false);
  assert.equal(during.copied, false);
  env.release();
  await navigation;
  const loadedJordan = view(env.controller);
  assert.equal(loadedJordan.profile.id, 'demo-jordan');
  assert.equal(loadedJordan.rendered.shareFields[0]?.value, '#/public-profile/demo-jordan');

  await env.controller.navigate('#/public-profile/demo-missing');
  const missingRead = view(env.controller);
  assert.equal(missingRead.profile.status, 'error');
  assert.equal(missingRead.share.intent, false, 'foreign navigation retires Jordan share even when target is absent');
  const missingDispatch = await prepareShare(env.controller, {profileId: 'demo-jordan', url: 'forged'});
  assert.equal(missingDispatch.url, '#/public-profile/demo-missing');
  assert.equal(missingDispatch.profileId, 'demo-missing');
  const missingAfterDispatch = view(env.controller);
  assert.equal(missingAfterDispatch.rendered.shareFields.length, 0, 'missing profile has no editable share field');
  assert.equal(missingAfterDispatch.rendered.unavailable, true);

  await env.controller.navigate('#/public-profile/reference-sarah');
  const capturedBefore = view(env.controller);
  assert.equal(capturedBefore.profile.source, 'captured-readonly');
  assert.equal(capturedBefore.profile.readOnly, true);
  assert.equal(capturedBefore.rendered.shareFields.length, 0);
  assert.equal(capturedBefore.rendered.capturedWishlist.length, 1);
  const capturedDispatch = await prepareShare(env.controller, {profileId: 'demo-jordan', url: 'forged'});
  assert.equal(capturedDispatch.url, '#/public-profile/reference-sarah');
  const capturedAfter = view(env.controller);
  assert.equal(capturedAfter.rendered.shareFields.length, 0);
  assert.equal(capturedAfter.rendered.capturedShareNote, true);
  assert.deepEqual(capturedAfter.rendered.capturedWishlist, capturedBefore.rendered.capturedWishlist,
    'captured static Sarah wishlist remains separate from generic share route state');
  assert.equal(env.calls.some(call => ['Share.copy', 'Share.send', 'Share.open'].includes(call.port)), false);
  return {case: 'direct_route_derived_dispatch_for_pending_missing_and_captured', pendingDuring: {route: '#/public-profile/demo-jordan', share: during},
    loadedJordan, missingRead, missingDispatch, missingAfterDispatch, capturedBefore,
    capturedDispatch, capturedAfter, outcome: 'accepted'};
}

async function navigationAwayAndOwnerLogoutControls() {
  const env = makeEnv();
  await loginAvery(env);
  const prepared = await prepareShare(env.controller);
  const beforeAway = view(env.controller);
  assert.equal(beforeAway.rendered.editButton, true);
  await env.controller.navigate('#/home');
  const away = view(env.controller);
  assert.equal(away.share.intent, false);
  assert.equal(away.session.teacherId, 'demo-seed-avery');
  assert.equal(away.profile.id, 'demo-avery');

  await env.controller.navigate('#/profile');
  const ownAlias = await prepareShare(env.controller);
  assert.equal(ownAlias.url, '#/public-profile/demo-avery');
  assert.equal(env.controller.state.journey.session.teacherId, 'demo-seed-avery');
  const logout = await env.controller.dispatch('public:logout');
  assert.equal(logout.ok, true);
  const afterLogout = view(env.controller);
  assert.equal(afterLogout.session.status, 'anonymous');
  assert.equal(afterLogout.route.page, 'login');
  assert.equal(afterLogout.share.intent, false, 'logout navigation clears the now-unbound own-profile share route');
  assert.equal(afterLogout.wishlist.intent, false);
  return {case: 'navigation_away_owner_and_logout_controls', prepared, beforeAway, away, ownAlias,
    logout: {ok: logout.ok}, afterLogout, outcome: 'accepted'};
}

const cases = [await heldForeignReadAndAliasControls(), await pendingMissingCapturedAndForgedControls(), await navigationAwayAndOwnerLogoutControls()];
const sourceHashes = {};
for (const file of sourceFiles) sourceHashes[file] = createHash('sha256').update(await readFile(resolve(repo, file))).digest('hex');
const report = {
  schema: 'hh-cycle08-H2-R1203/public-share-review/v1', job_id: 'R1203', worker: 'H2', decision: 'accepted',
  repository: 'PageRouter', head: '65ea21f5a2ef3f3a7adb285b2285d2c6f8274fcd', tree: '0901b1816314ef3aa5d580867ac0cd3fc49d3637',
  reviewedSourceHashes: sourceHashes,
  exactFixHashes: {controller: '8faad923a2e4721f1cc1059f902c54f97759ef32b57d36fe4fa8523205011a0b',
    test: '1150f43987bf79a5eb82936e0ee6100852f8f29388b239d14849ac08a0fbad62'},
  reviewedPriorEvidence: {
    e1201: '/workspace/scratch/8528bb251845/hh-cycle08/H1/E1201/result.json + stdout-final.log: synthetic runtime/tree stale-share reproduction and held-read/alias/captured/missing controls',
    e1202: '/workspace/scratch/8528bb251845/hh-cycle08/H2/E1202/result.json: independent prior reproduction with same-identity and captured-Sarah controls',
    e1203: '/workspace/scratch/8528bb251845/hh-cycle08/H1/E1203/result.json + actual red.stdout.log, compatibility-baseline.stdout.log, green-share.stdout.log, full-controller.stdout.log: expected pre-code failure, route-derived compatibility pass, targeted green and 49-test controller green',
  },
  commands: [
    "node --test --test-name-pattern='share' checkpoint/vendor/hh/src/public-controller.test.mjs",
    'node --test checkpoint/vendor/hh/src/public-controller.test.mjs',
    'node /workspace/scratch/8528bb251845/hh-cycle08/H2/R1203/review-probe.mjs',
  ],
  tests: {focusedShare: {passed: 3, failed: 0}, fullController: {passed: 49, failed: 0},
    reviewProbeCases: cases.length, allAssertionsPassed: true},
  cases,
  assessment: {
    synchronousInvalidation: true, aliasesRetainMatchingIdentity: true, pendingAndFailedDirectDispatchRemainRouteDerived: true,
    capturedSarahStaticReadonlyPriorityRetained: true, payloadIdentityAndTransportFieldsIgnored: true,
    wishlistStateNotModifiedBySharePreparation: true, ownerSessionAndLogoutFlowRetained: true,
    noExternalCopyShareOpenOrProviderWrite: true, noProductSourceOrGitMutation: true,
  },
  scope: {fixture: true, productionAuthority: false, persistence: 'volatile-memory', httpCalls: 0,
    backendExecution: false, realTeacherData: false, externalCopyShareOpen: false, browserVisualQA: false,
    canonicalBuild: false, humanAcceptance: false},
  summary: 'Accepted the exact two-file fix. The identity key is set from the current public route/profile and a foreign route synchronously clears the old share state before its read resolves. Independent held-read/runtime/tree cases confirmed the old Avery route and input are gone on Jordan; matching aliases retain it; pending/missing/captured direct dispatches derive the URL from the current route despite forged payloads; captured Sarah keeps the static read-only note and wishlist; wishlist state, owner session, and logout behavior remain intact.',
  limitations: ['Runtime and rendered-tree fixture evidence only; not browser visual QA.',
    'No backend, production account, network, real teacher data, external copy/share/open, canonical build, or human acceptance.'],
};
await writeFile(resolve(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({decision: report.decision, tests: report.tests, cases: cases.map(item => ({case: item.case, outcome: item.outcome})), sourceHashes}, null, 2));
