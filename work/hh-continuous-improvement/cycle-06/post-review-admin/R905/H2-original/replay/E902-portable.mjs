import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider, createServiceRuntime} from '../../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle06/H2/R905/replay-output/E902');
await mkdir(out, {recursive: true});
const sources = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs',
  'checkpoint/vendor/hh/services/fixture-provider.mjs',
  'checkpoint/vendor/hh/services/runtime.mjs',
];
const sha256 = async path => createHash('sha256').update(await readFile(resolve(repo, path))).digest('hex');

function flatten(node, texts = [], nodes = []) {
  if (typeof node === 'string' || typeof node === 'number') texts.push(String(node));
  else if (Array.isArray(node)) for (const child of node) flatten(child, texts, nodes);
  else if (node && typeof node === 'object') {
    nodes.push({tag: node.tag, attrs: node.attrs || {}});
    for (const child of node.children || []) flatten(child, texts, nodes);
  }
  return {text: texts.join(' '), nodes};
}

function delayedRuntime(outcome) {
  const base = createFixtureProvider({fixture: true});
  assert.equal(base.capabilities.persistence, 'volatile-memory');
  let announceStart;
  let release;
  const started = new Promise(resolveStarted => { announceStart = resolveStarted; });
  const held = new Promise(resolveHeld => { release = resolveHeld; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port !== 'Session.logout') return invoke(input);
    announceStart();
    await held;
    return invoke(outcome === 'failure' ? {...input, failWith: 'transport_failure'} : input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  return {runtime: createServiceRuntime(provider), started, release};
}

async function signedInController(runtime) {
  const controller = createPublicController({runtime});
  await controller.initialize('#/login');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-preview-only'});
  assert.equal(login.ok, true, 'seeded synthetic fixture login succeeds');
  assert.equal(runtime.snapshot().session.status, 'authenticated');
  return controller;
}

async function caseFor(outcome, destination) {
  const controlled = delayedRuntime(outcome);
  const {runtime} = controlled;
  const controller = await signedInController(runtime);
  const pending = controller.dispatch('public:logout');
  await controlled.started;
  assert.equal(controller.state.journey.session.status, 'authenticated', 'logout remains pending before navigation');

  await controller.navigate(destination);
  const beforeProfile = structuredClone(controller.state.journey.profile);
  const beforeSession = controller.state.journey.session.status;
  const beforeTree = flatten(renderPublicSite({route: controller.route, state: controller.state}));
  const beforePublicIds = runtime.snapshot().demo.publicProfiles.map(profile => profile.id);
  assert.equal(beforeSession, 'authenticated');
  if (destination.endsWith('reference-sarah')) {
    assert.equal(beforeProfile.source, 'captured-readonly');
    assert.equal(beforeProfile.readOnly, true);
    assert.match(beforeTree.text, /Sarah Endsley/);
  } else {
    assert.equal(beforeProfile.value?.id, 'demo-jordan');
    assert.equal(beforeProfile.value?.teacherId, 'demo-seed-jordan');
    assert.match(beforeTree.text, /Demo Jordan/);
  }

  controlled.release();
  const result = await pending;
  const afterSession = controller.state.journey.session.status;
  const afterProfile = structuredClone(controller.state.journey.profile);
  const afterTree = flatten(renderPublicSite({route: controller.route, state: controller.state}));
  const afterPublicIds = runtime.snapshot().demo.publicProfiles.map(profile => profile.id);
  const edit = await controller.dispatch('public:edit-profile');
  return {
    outcome,
    destination: controller.route.path,
    logout: {ok: result.ok, code: result.error?.code || null, message: result.message},
    session: {before: beforeSession, after: afterSession, provider: runtime.snapshot().session.status},
    profileProjection: {
      before: {status: beforeProfile.status, id: beforeProfile.value?.id || beforeProfile.value?.teacherId || null,
        source: beforeProfile.source || null, readOnly: beforeProfile.readOnly === true || beforeProfile.value?.readOnly === true},
      after: {status: afterProfile.status, id: afterProfile.value?.id || afterProfile.value?.teacherId || null,
        source: afterProfile.source || null, readOnly: afterProfile.readOnly === true || afterProfile.value?.readOnly === true},
      preserved: JSON.stringify(beforeProfile) === JSON.stringify(afterProfile),
    },
    renderedTree: {
      beforeHasExpectedProfile: destination.endsWith('reference-sarah') ? beforeTree.text.includes('Sarah Endsley') : beforeTree.text.includes('Demo Jordan'),
      afterHasExpectedProfile: destination.endsWith('reference-sarah') ? afterTree.text.includes('Sarah Endsley') : afterTree.text.includes('Demo Jordan'),
      afterShowsLoginLink: afterTree.nodes.some(node => node.attrs?.['data-public-route'] === 'login'),
    },
    editAuthority: {ok: edit.ok, code: edit.error?.code || null, ownerEditGranted: edit.ok === true},
    providerData: {publicProfileIdsBefore: beforePublicIds, publicProfileIdsAfter: afterPublicIds,
      profileRecordsUnchanged: JSON.stringify(beforePublicIds) === JSON.stringify(afterPublicIds),
      persistence: runtime.capabilities.persistence, fixture: runtime.fixture, mode: runtime.mode},
  };
}

async function normalOwnLogout() {
  const provider = createFixtureProvider({fixture: true});
  const runtime = createServiceRuntime(provider);
  const controller = await signedInController(runtime);
  await controller.navigate('#/profile');
  const ownId = controller.state.journey.profile.value?.id;
  assert.ok(ownId);
  const result = await controller.dispatch('public:logout');
  const tree = flatten(renderPublicSite({route: controller.route, state: controller.state}));
  return {route: controller.route.path, ownProfileIdBeforeLogout: ownId, logoutOk: result.ok,
    session: controller.state.journey.session.status, profileStatus: controller.state.journey.profile.status,
    loginPageRendered: tree.text.includes('Log In to Your Account'),
    providerPublicIdsAfter: runtime.snapshot().demo.publicProfiles.map(profile => profile.id),
    persistence: runtime.capabilities.persistence, fixture: runtime.fixture, mode: runtime.mode};
}

const report = {
  schema: 'hh-cycle06-H2-E902/logout-navigation-probe/v1',
  job_id: 'E902',
  worker: 'H2',
  source: {repository: 'PageRouter', commit: 'a5b141816ffb871110e541ef00ecf9527674137e', tree: '5eb00395e85afeb357be11b6add395ef5fbb6b68', hashes: {}},
  commands: ['node /workspace/scratch/8528bb251845/hh-cycle06/H2/probe.mjs'],
  limits: {environment: 'actual createFixtureProvider volatile-memory + createServiceRuntime + createPublicController + renderPublicSite',
    identity: 'synthetic seeded fixture Demo Avery only; no real teacher data', networkOrProduction: false,
    browserVisualQA: false, backendExecution: false, sourceMutation: false},
};

try {
  for (const source of sources) report.source.hashes[source] = await sha256(source);
  report.cases = [];
  for (const [outcome, destination] of [
    ['success', '#/public-profile/demo-jordan'],
    ['success', '#/public-profile/reference-sarah'],
    ['failure', '#/public-profile/demo-jordan'],
    ['failure', '#/public-profile/reference-sarah'],
  ]) report.cases.push(await caseFor(outcome, destination));
  report.normalOwnLogout = await normalOwnLogout();
  const successForeign = report.cases[0], successCaptured = report.cases[1];
  const failures = report.cases.slice(2);
  report.assertions = {
    delayedRequestsWereActuallyReached: true,
    successfulLogoutAnonymizedSession: successForeign.session.after === 'anonymous' && successCaptured.session.after === 'anonymous',
    successfulForeignRouteRetainedRouteButLostProjection: successForeign.destination === '/public-profile/demo-jordan' && !successForeign.profileProjection.preserved && !successForeign.renderedTree.afterHasExpectedProfile,
    successfulCapturedRouteProjectionCleared: successCaptured.destination === '/public-profile/reference-sarah' && !successCaptured.profileProjection.preserved,
    capturedRenderedReferenceStillReadOnly: successCaptured.renderedTree.afterHasExpectedProfile && !successCaptured.editAuthority.ownerEditGranted,
    failedLogoutPreservedAuthenticatedProjection: failures.every(item => item.logout.ok === false && item.session.after === 'authenticated' && item.profileProjection.preserved),
    noLogoutGrantedOwnerEdit: report.cases.every(item => !item.editAuthority.ownerEditGranted),
    providerProfileRecordsUnchanged: report.cases.every(item => item.providerData.profileRecordsUnchanged),
    normalOwnLogoutRedirectsAndAnonymizes: report.normalOwnLogout.route === '/login' && report.normalOwnLogout.session === 'anonymous' && report.normalOwnLogout.loginPageRendered,
  };
  report.outcome = report.assertions.successfulForeignRouteRetainedRouteButLostProjection || report.assertions.successfulCapturedRouteProjectionCleared
    ? 'confirmed_reuse' : 'not_reuse';
} catch (error) {
  report.outcome = 'insufficient_evidence';
  report.error = {name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '')};
}

report.summary = report.outcome === 'confirmed_reuse'
  ? 'A successful delayed synthetic logout preserves the navigated profile URL but clears its active controller projection; foreign-profile rendered content disappears. Captured-reference rendered content remains static/read-only, though its controller projection is also cleared. Failure preserves authenticated projections; normal own-profile logout anonymizes and redirects as before.'
  : 'The selected delayed-logout hypothesis was not reproduced by this probe.';
report.next = report.outcome === 'confirmed_reuse'
  ? 'Keep this read-only reproduction as baseline evidence. Any correction requires a fresh native assignment, a focused regression that fails against this exact source, and independent review; preserve successful logout anonymity, captured-reference readonly behavior, foreign-owner rejection, and normal own-profile redirect.'
  : 'Do not change source on this hypothesis; retain the completed falsifier and only pursue a newly authorized, runtime-supported adjacent case.';
await writeFile(resolve(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.outcome === 'insufficient_evidence') process.exitCode = 1;
