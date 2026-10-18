import assert from 'node:assert/strict';
import {createFixtureProvider} from '../../../PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {values, getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); }};
}

function collectText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(collectText).join(' ');
}

function renderedProfile(controller) {
  const state = controller.state;
  const tree = renderPublicSite({route: controller.route, state, journey: state.journey});
  const findMain = (node) => node?.tag === 'main' ? node : (node?.children || []).map(findMain).find(Boolean) || null;
  return {page: tree.attrs['data-public-page'], visibleMainText: collectText(findMain(tree)), profileSource: state.journey.profile.source,
    profileStatus: state.journey.profile.status, profileId: state.journey.profile.value?.id || null,
    profileTeacherId: state.journey.profile.value?.teacherId || null, profileName: state.journey.profile.value?.name || null};
}

function deferredRuntime(fail = false) {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const pending = [];
  const runtime = {
    ready: base.ready, pxc: base.pxc, snapshot: () => base.snapshot(), inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; }, get fixture() { return base.fixture; },
    invoke(port, input, boundary) {
      if (port === 'TeacherProfile.createProfile') {
        return new Promise((resolve) => pending.push(async () => {
          const request = fail ? {...input, failWith: 'denied'} : input;
          resolve(await base.invoke(port, request, boundary));
        }));
      }
      return base.invoke(port, input, boundary);
    },
  };
  return {storage, runtime, pending, async release() {
    assert.equal(pending.length, 1, 'one synthetic profile-create call is held');
    await pending.shift()();
  }};
}

async function registerApprovedLoggedIn() {
  const storage = memoryStorage();
  const provider = createFixtureProvider({fixture: true, storage});
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage});
  const controller = createPublicController({runtime, storage, community});
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await controller.selectSchool(key, value);
  }
  await controller.dispatch('public:terms-consent', {accepted: true});
  const email = 'hh5-e702@example.invalid';
  const password = 'Volatile-Only-17';
  assert.equal((await controller.dispatch('public:register', {name: 'E702 Synthetic', email, password,
    confirm_password: password})).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email, password})).ok, true);
  await controller.navigate('#/profile');
  return {controller, runtime};
}

async function runHeldCompletion({fail = false, routeHref = '#/public-profile/demo-jordan'} = {}) {
  const env = deferredRuntime(fail);
  const storage = env.storage;
  const community = createCommunity({storage});
  const controller = createPublicController({runtime: env.runtime, storage, community});
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await controller.selectSchool(key, value);
  }
  await controller.dispatch('public:terms-consent', {accepted: true});
  const email = fail ? 'hh5-e702-failure@example.invalid' : 'hh5-e702-success@example.invalid';
  const password = 'Volatile-Only-18';
  assert.equal((await controller.dispatch('public:register', {name: 'E702 Synthetic', email, password,
    confirm_password: password})).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email, password})).ok, true);
  await controller.navigate('#/profile');
  const preCreate = renderedProfile(controller);
  assert.equal(preCreate.profileStatus, 'absent');
  const createPromise = controller.dispatch('public:profile-create', {name: fail ? 'Failure Creator' : 'Success Creator',
    bio: 'Synthetic local probe.'});
  assert.equal(env.pending.length, 1, 'provider create call reached and is held');
  const duringCreate = renderedProfile(controller);
  assert.equal(duringCreate.profileStatus, 'absent');
  await controller.navigate(routeHref);
  const beforeRelease = renderedProfile(controller);
  const expectedRouteProfileId = routeHref.includes('teacher.html') ? 'reference-sarah' : 'demo-jordan';
  const expectedBeforeName = expectedRouteProfileId === 'reference-sarah' ? 'Sarah Endsley' : 'Demo Jordan';
  assert.equal(controller.route.profileId, expectedRouteProfileId);
  assert.equal(beforeRelease.profileName, expectedBeforeName);
  if (expectedRouteProfileId === 'demo-jordan') assert.equal(beforeRelease.profileTeacherId, 'demo-seed-jordan');
  await env.release();
  const result = await createPromise;
  const afterRelease = renderedProfile(controller);
  const stateProfileAfterRelease = {source: controller.state.journey.profile.source,
    status: controller.state.journey.profile.status, name: controller.state.journey.profile.value?.name || null,
    teacherId: controller.state.journey.profile.value?.teacherId || null};
  const referenceEdit = expectedRouteProfileId === 'reference-sarah'
    ? await controller.dispatch('public:profile-edit', {name: 'Unauthorized during completion'}) : null;
  const stateProfileAfterEdit = expectedRouteProfileId === 'reference-sarah' ? {source: controller.state.journey.profile.source,
    status: controller.state.journey.profile.status, name: controller.state.journey.profile.value?.name || null,
    teacherId: controller.state.journey.profile.value?.teacherId || null} : null;
  return {fail, result: {ok: result.ok, errorCode: result.error?.code || null}, preCreate, duringCreate,
    beforeRelease, afterRelease, routeProfileId: controller.route.profileId,
    stateProfileAfterRelease, stateProfileAfterEdit, referenceEditOk: referenceEdit?.ok ?? null,
    referenceEditError: referenceEdit?.error?.code || null,
    sessionTeacherId: controller.state.journey.session.teacherId,
    runtimeOwnProfileStatus: env.runtime.snapshot().ownProfile.status,
    runtimeOwnProfileTeacherId: env.runtime.snapshot().ownProfile.profile?.teacherId || null};
}

const successRace = await runHeldCompletion();
const failureRace = await runHeldCompletion({fail: true});
const capturedRace = await runHeldCompletion({routeHref: '#/pages/teacher.html'});
assert.equal(successRace.result.ok, true);
assert.equal(successRace.routeProfileId, 'demo-jordan');
assert.equal(successRace.afterRelease.profileTeacherId, successRace.runtimeOwnProfileTeacherId);
assert.notEqual(successRace.afterRelease.profileTeacherId, 'demo-seed-jordan');
assert.equal(failureRace.result.ok, false);
assert.equal(failureRace.result.errorCode, 'denied');
assert.equal(failureRace.afterRelease.profileTeacherId, 'demo-seed-jordan');
assert.equal(capturedRace.routeProfileId, 'reference-sarah');
assert.equal(capturedRace.beforeRelease.profileName, 'Sarah Endsley');
assert.equal(capturedRace.routeProfileId, 'reference-sarah');
assert.equal(capturedRace.stateProfileAfterRelease.source, 'local-overlay');
assert.equal(capturedRace.stateProfileAfterRelease.teacherId, 'demo-teacher-1');
assert.equal(capturedRace.afterRelease.profileName, 'Success Creator');
assert.equal(capturedRace.referenceEditOk, true);
assert.equal(capturedRace.stateProfileAfterEdit.name, 'Unauthorized during completion');

const own = await registerApprovedLoggedIn();
assert.equal((await own.controller.dispatch('public:profile-create', {name: 'Positive Control Owner', bio: 'Synthetic positive control.'})).ok, true);
const ownView = renderedProfile(own.controller);
assert.equal(ownView.page, 'profile');
assert.equal(ownView.profileName, 'Positive Control Owner');
assert.equal(ownView.profileTeacherId, own.runtime.snapshot().session.teacherId);
const ownProfileRoute = own.controller.state.journey.profile.value.id;
await own.controller.navigate(`#/public-profile/${ownProfileRoute}`);
const ownPublicView = renderedProfile(own.controller);
assert.equal(ownPublicView.profileName, 'Positive Control Owner');
await own.controller.navigate('#/pages/teacher.html');
const referenceBefore = renderedProfile(own.controller);
assert.equal(referenceBefore.profileName, 'Sarah Endsley');
const referenceMutation = await own.controller.dispatch('public:profile-edit', {name: 'Not Allowed'});
assert.equal(referenceMutation.ok, false);
assert.equal(referenceMutation.error.code, 'read_only_reference');
assert.equal(renderedProfile(own.controller).profileName, 'Sarah Endsley');

console.log(JSON.stringify({schema: 'hh-cycle05-H2-E702/profile-create-route-probe/v1', allAssertionsPassed: true,
  successRace: {result: successRace.result, routeProfileId: successRace.routeProfileId,
    before: {profileName: successRace.beforeRelease.profileName, profileTeacherId: successRace.beforeRelease.profileTeacherId},
    after: {profileName: successRace.afterRelease.profileName, profileTeacherId: successRace.afterRelease.profileTeacherId,
      visibleMainText: successRace.afterRelease.visibleMainText}, runtimeOwnProfileTeacherId: successRace.runtimeOwnProfileTeacherId},
  failureRace: {result: failureRace.result, routeProfileId: failureRace.routeProfileId,
    before: {profileName: failureRace.beforeRelease.profileName, profileTeacherId: failureRace.beforeRelease.profileTeacherId},
    after: {profileName: failureRace.afterRelease.profileName, profileTeacherId: failureRace.afterRelease.profileTeacherId,
      visibleMainText: failureRace.afterRelease.visibleMainText}},
  capturedRace: {result: capturedRace.result, routeProfileId: capturedRace.routeProfileId,
    beforeRenderedName: capturedRace.beforeRelease.profileName, afterRenderedName: capturedRace.afterRelease.profileName,
    journeyProjectionAfterRelease: capturedRace.stateProfileAfterRelease,
    referenceEditOk: capturedRace.referenceEditOk, referenceEditError: capturedRace.referenceEditError,
    journeyProjectionAfterEdit: capturedRace.stateProfileAfterEdit},
  controls: {ownProfileName: ownView.profileName, ownPublicProfileName: ownPublicView.profileName,
    capturedReferenceName: referenceBefore.profileName, capturedReferenceMutation: referenceMutation.error.code}}, null, 2));
