import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '../../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '../../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)};
}

function deferredLogoutRuntime({fail = false} = {}) {
  const base = createFixtureProvider({fixture: true, storage: memoryStorage()});
  let announceStart;
  let releaseGate;
  const started = new Promise(resolve => { announceStart = resolve; });
  const gate = new Promise(resolve => { releaseGate = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'Session.logout') {
      announceStart();
      await gate;
      if (fail) input = {...input, failWith: 'denied'};
    }
    return invoke(input);
  }]));
  return {runtime: createServiceRuntime({...base, services: Object.freeze(services)}), started,
    release: () => releaseGate()};
}

function collectText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return (node.children || []).map(collectText).join(' ');
}

function projected(controller) {
  const profile = controller.state.journey.profile;
  return {profileStatus: profile.status, profileId: profile.value?.id || null,
    profileName: profile.value?.name || null, profileTeacherId: profile.value?.teacherId || null,
    source: profile.source, readOnly: profile.readOnly === true,
    sessionStatus: controller.state.journey.session.status, sessionTeacherId: controller.state.journey.session.teacherId || null,
    route: {...controller.route}};
}

async function runCase({name, fail = false, navigateTo = null}) {
  const delayed = deferredLogoutRuntime({fail});
  const controller = createPublicController({runtime: delayed.runtime, community: createCommunity()});
  await controller.initialize('#/login');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(login.ok, true, `${name}: synthetic seed login`);
  await controller.navigate('#/profile');
  const before = projected(controller);
  const logout = controller.dispatch('public:logout');
  await delayed.started;
  const during = projected(controller);
  if (navigateTo) await controller.navigate(navigateTo);
  const afterNavigation = projected(controller);
  delayed.release();
  const result = await logout;
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const publicContent = tree.children.find(node => node.attrs?.class === 'hh-public-content');
  const main = publicContent?.children?.find(node => node.tag === 'main') || null;
  const edit = await controller.dispatch('public:edit-profile');
  const outcome = {name, failureInjected: fail, before, during, afterNavigation,
    completion: {ok: result.ok, error: result.error?.code || null, ...projected(controller),
      renderedMainText: collectText(main).replace(/\s+/g, ' ').trim().slice(0, 220),
      editOk: edit.ok, editError: edit.error?.code || null, editOpen: controller.state.journey.profile.editOpen === true},
    runtime: {mode: delayed.runtime.mode, fixture: delayed.runtime.fixture,
      productionAuthority: delayed.runtime.capabilities.productionAuthority,
      persistence: delayed.runtime.capabilities.persistence}};
  assert.equal(outcome.runtime.mode, 'fixture');
  assert.equal(outcome.runtime.fixture, true);
  assert.equal(outcome.runtime.productionAuthority, false);
  return outcome;
}

const normalLogout = await runCase({name: 'normal-positive-control'});
const foreignSuccess = await runCase({name: 'foreign-profile-success-race', navigateTo: '#/public-profile/demo-jordan'});
const foreignFailure = await runCase({name: 'foreign-profile-failure-control', fail: true, navigateTo: '#/public-profile/demo-jordan'});
const capturedSuccess = await runCase({name: 'captured-readonly-success-race', navigateTo: '#/public-profile/reference-sarah'});

assert.equal(normalLogout.completion.ok, true);
assert.equal(normalLogout.completion.route.path, '/login');
assert.equal(normalLogout.completion.sessionStatus, 'anonymous');
assert.equal(normalLogout.completion.profileStatus, 'unknown');
assert.equal(foreignSuccess.afterNavigation.profileName, 'Demo Jordan');
assert.equal(foreignSuccess.completion.ok, true);
assert.equal(foreignSuccess.completion.route.profileId, 'demo-jordan');
assert.equal(foreignSuccess.completion.sessionStatus, 'anonymous');
assert.equal(foreignSuccess.completion.profileStatus, 'unknown');
assert.match(foreignSuccess.completion.renderedMainText, /Teacher profile.*This public profile is part of the local preview/);
assert.equal(foreignSuccess.completion.editError, 'profile_unavailable');
assert.equal(foreignFailure.completion.ok, false);
assert.equal(foreignFailure.completion.error, 'denied');
assert.equal(foreignFailure.completion.profileName, 'Demo Jordan');
assert.equal(foreignFailure.completion.editError, 'profile_owner_mismatch');
assert.equal(capturedSuccess.afterNavigation.profileName, 'Sarah Endsley');
assert.equal(capturedSuccess.afterNavigation.source, 'captured-readonly');
assert.equal(capturedSuccess.afterNavigation.readOnly, true);
assert.equal(capturedSuccess.completion.sessionStatus, 'anonymous');
assert.equal(capturedSuccess.completion.profileStatus, 'unknown');
assert.match(capturedSuccess.completion.renderedMainText, /Sarah Endsley/);
assert.equal(capturedSuccess.completion.editError, 'profile_unavailable');

function compact(result) {
  const state = view => ({route: view.route.path, profileId: view.profileId,
    profileName: view.profileName, profileStatus: view.profileStatus,
    session: view.sessionStatus, source: view.source, readOnly: view.readOnly});
  return {case: result.name, fixture: result.runtime,
    before: state(result.before), held: state(result.during), afterNavigation: state(result.afterNavigation),
    completion: {ok: result.completion.ok, error: result.completion.error, ...state(result.completion),
      renderedMainText: result.completion.renderedMainText,
      editError: result.completion.editError}};
}

console.log(JSON.stringify({schema: 'hh-cycle06-E901-held-logout/v1', observedAt: new Date().toISOString(),
  cases: [normalLogout, foreignSuccess, foreignFailure, capturedSuccess].map(compact), assertionsPassed: true}));
