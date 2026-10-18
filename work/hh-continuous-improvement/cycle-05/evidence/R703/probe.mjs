import assert from 'node:assert/strict';
import {createFixtureProvider} from '../../../PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {values, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key)};
}

function controlledRuntime(delayedPorts = [], failedPorts = []) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  const gates = new Map(delayedPorts.map((port) => {
    let startedResolve, releaseResolve;
    const started = new Promise((resolve) => { startedResolve = resolve; });
    const pending = new Promise((resolve) => { releaseResolve = resolve; });
    return [port, {started, startedResolve, pending, releaseResolve}];
  }));
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async (input) => {
    const gate = gates.get(port);
    if (gate) { gate.startedResolve(); await gate.pending; }
    return invoke(failedPorts.includes(port) ? {...input, failWith: 'transport_failure'} : input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  const runtime = createServiceRuntime(provider);
  return {storage, runtime,
    async started(port) { await gates.get(port).started; },
    release(port) { gates.get(port).releaseResolve(); }};
}

function controllerFor({runtime, storage}) {
  return createPublicController({runtime, storage, community: createCommunity({storage})});
}

async function registerLogin(controller, suffix) {
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await controller.selectSchool(key, value);
  }
  await controller.dispatch('public:terms-consent', {accepted: true});
  const email = `r703-${suffix}@example.invalid`;
  const password = 'Volatile-Only-R703';
  assert.equal((await controller.dispatch('public:register', {name: `R703 ${suffix}`, email, password,
    confirm_password: password})).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email, password})).ok, true);
  await controller.navigate('#/profile');
  return controller.state.journey.session.teacherId;
}

function view(controller) {
  const s = controller.state;
  const tree = renderPublicSite({route: controller.route, state: s, journey: s.journey});
  const findMain = (node) => node?.tag === 'main' ? node : (node?.children || []).map(findMain).find(Boolean) || null;
  const text = (node) => node == null ? '' : typeof node === 'string' || typeof node === 'number'
    ? String(node) : (node.children || []).map(text).join(' ');
  return {routeProfileId: controller.route.profileId || null,
    status: s.journey.profile.status, source: s.journey.profile.source,
    id: s.journey.profile.value?.id || null, teacherId: s.journey.profile.value?.teacherId || null,
    name: s.journey.profile.value?.name || null, mainText: text(findMain(tree))};
}

async function createHeld(env, controller, name = 'R703 Owner') {
  const promise = controller.dispatch('public:profile-create', {name, bio: 'Adversarial synthetic profile.',
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-R703'});
  await env.started('TeacherProfile.createProfile');
  return promise;
}

const results = {};

// Different teacher: route projection and ownership gate must survive success.
{
  const env = controlledRuntime(['TeacherProfile.createProfile']);
  const c = controllerFor(env), teacherId = await registerLogin(c, 'foreign');
  const create = createHeld(env, c, 'R703 Foreign Owner');
  await c.navigate('#/public-profile/demo-avery');
  const before = view(c);
  env.release('TeacherProfile.createProfile');
  const createResult = await create;
  const after = view(c);
  const edit = await c.dispatch('public:edit-profile');
  assert.equal(createResult.ok, true);
  assert.equal(after.name, 'Demo Avery');
  assert.equal(after.teacherId, 'demo-seed-avery');
  assert.equal(edit.error.code, 'profile_owner_mismatch');
  results.foreignProfile = {before, after, createOk: createResult.ok, editError: edit.error.code,
    createdOwnTeacherId: env.runtime.snapshot().ownProfile.profile.teacherId, expectedOwnTeacherId: teacherId};
}

// Captured reference: preserve object, rendered reference and readonly gate.
{
  const env = controlledRuntime(['TeacherProfile.createProfile']);
  const c = controllerFor(env); await registerLogin(c, 'captured');
  const create = createHeld(env, c, 'R703 Captured Owner');
  await c.navigate('#/public-profile/reference-sarah');
  const before = structuredClone(c.state.journey.profile), beforeView = view(c);
  env.release('TeacherProfile.createProfile');
  assert.equal((await create).ok, true);
  const after = view(c), edit = await c.dispatch('public:edit-profile');
  assert.deepEqual(c.state.journey.profile, before);
  assert.equal(after.name, 'Sarah Endsley');
  assert.equal(edit.error.code, 'read_only_reference');
  results.capturedReference = {beforeView, after, editError: edit.error.code,
    profileUnchanged: JSON.stringify(c.state.journey.profile) === JSON.stringify(before)};
}

// A public read still pending with null value must not be replaced by create completion.
{
  const env = controlledRuntime(['TeacherProfile.createProfile', 'TeacherProfile.openPublicProfile']);
  const c = controllerFor(env); await registerLogin(c, 'pending-read');
  const create = createHeld(env, c, 'R703 Pending Read Owner');
  const read = c.navigate('#/public-profile/demo-jordan');
  await env.started('TeacherProfile.openPublicProfile');
  const pending = structuredClone(c.state.journey.profile);
  env.release('TeacherProfile.createProfile');
  assert.equal((await create).ok, true);
  assert.deepEqual(c.state.journey.profile, pending);
  env.release('TeacherProfile.openPublicProfile');
  await read;
  assert.equal(c.state.journey.profile.value.id, 'demo-jordan');
  assert.equal(view(c).name, 'Demo Jordan');
  results.pendingPublicRead = {pending: {status: pending.status, value: pending.value}, afterCreateProjectionPreserved: true,
    final: view(c)};
}

// Prospective own public alias: hold its read too, then ensure create completion and read completion retain overlay.
{
  const env = controlledRuntime(['TeacherProfile.createProfile', 'TeacherProfile.openPublicProfile']);
  const c = controllerFor(env), teacherId = await registerLogin(c, 'own-alias');
  const ownId = `profile-${teacherId}`;
  const create = createHeld(env, c, 'R703 Alias Name');
  const read = c.navigate(`#/public-profile/${ownId}`);
  await env.started('TeacherProfile.openPublicProfile');
  const pending = view(c);
  env.release('TeacherProfile.createProfile');
  assert.equal((await create).ok, true);
  const afterCreate = view(c);
  env.release('TeacherProfile.openPublicProfile');
  await read;
  const afterRead = view(c);
  assert.equal(pending.status, 'loading');
  assert.equal(afterCreate.routeProfileId, ownId);
  assert.equal(afterRead.id, ownId);
  assert.equal(afterRead.name, 'R703 Alias Name');
  assert.equal((await c.dispatch('public:edit-profile')).ok, true);
  results.ownAliasRace = {pending, afterCreate, afterRead, subsequentEditAllowed: true};
}

// A failed create with an existing own profile cannot replace a captured-reference route.
{
  const env = controlledRuntime();
  const c = controllerFor(env); await registerLogin(c, 'existing-fail');
  assert.equal((await c.dispatch('public:profile-create', {name: 'R703 Existing Owner'})).ok, true);
  await c.navigate('#/public-profile/reference-sarah');
  const before = structuredClone(c.state.journey.profile), beforeView = view(c);
  const failed = await c.dispatch('public:profile-create', {name: 'R703 Duplicate'});
  const after = view(c);
  assert.equal(failed.error.code, 'profile_exists');
  assert.deepEqual(c.state.journey.profile, before);
  assert.equal(after.name, 'Sarah Endsley');
  results.failedCreateWithExistingProfile = {error: failed.error.code, beforeView, after,
    profileUnchanged: JSON.stringify(c.state.journey.profile) === JSON.stringify(before)};
}

// A not-found error projection must survive a successful create on another profile route.
{
  const env = controlledRuntime(['TeacherProfile.createProfile']);
  const c = controllerFor(env); await registerLogin(c, 'not-found');
  const create = createHeld(env, c, 'R703 Not Found Owner');
  await c.navigate('#/public-profile/nonexistent-profile');
  const before = view(c);
  assert.equal(before.status, 'error');
  env.release('TeacherProfile.createProfile');
  assert.equal((await create).ok, true);
  const after = view(c);
  assert.deepEqual(after, before);
  results.notFoundProjection = {before, after, unchanged: true};
}

// A public-read transport failure must survive a successful create on another profile route.
{
  const env = controlledRuntime(['TeacherProfile.createProfile'], ['TeacherProfile.openPublicProfile']);
  const c = controllerFor(env); await registerLogin(c, 'read-failure');
  const create = createHeld(env, c, 'R703 Read Failure Owner');
  await env.started('TeacherProfile.createProfile');
  await c.navigate('#/public-profile/demo-jordan');
  const before = view(c);
  assert.equal(before.status, 'error');
  env.release('TeacherProfile.createProfile');
  assert.equal((await create).ok, true);
  const after = view(c);
  assert.deepEqual(after, before);
  results.readFailureProjection = {before, after, unchanged: true};
}

// Normal own route -> own public alias preserves local display fields.
{
  const env = controlledRuntime();
  const c = controllerFor(env); const teacherId = await registerLogin(c, 'normal-own');
  assert.equal((await c.dispatch('public:profile-create', {name: 'R703 Display Name', bio: 'Custom synthetic bio.',
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-NORMAL'})).ok, true);
  const own = view(c);
  await c.navigate(`#/public-profile/profile-${teacherId}`);
  const alias = view(c);
  assert.equal(own.name, 'R703 Display Name');
  assert.equal(alias.name, 'R703 Display Name');
  assert.match(alias.mainText, /Custom synthetic bio\./);
  assert.match(alias.mainText, /DEMO-NORMAL/);
  results.normalOwnAlias = {own, alias};
}

const core = ({routeProfileId, status, source, id, teacherId, name}) =>
  ({routeProfileId, status, source, id, teacherId, name});
console.log(JSON.stringify({schema: 'hh-cycle05-H2-R703/adversarial-probe/v1', allAssertionsPassed: true,
  providerBoundary: 'volatile in-memory synthetic fixture; synthetic provider operations executed; no production/backend provider operation',
  cases: {
    foreignProfile: {before: core(results.foreignProfile.before), after: core(results.foreignProfile.after),
      editError: results.foreignProfile.editError, ownTeacherId: results.foreignProfile.createdOwnTeacherId},
    capturedReference: {before: core(results.capturedReference.beforeView), after: core(results.capturedReference.after),
      editError: results.capturedReference.editError, profileUnchanged: results.capturedReference.profileUnchanged},
    pendingPublicRead: {pending: results.pendingPublicRead.pending, afterCreateProjectionPreserved: results.pendingPublicRead.afterCreateProjectionPreserved,
      final: core(results.pendingPublicRead.final)},
    ownAliasRace: {pending: core(results.ownAliasRace.pending), afterCreate: core(results.ownAliasRace.afterCreate),
      afterRead: core(results.ownAliasRace.afterRead), subsequentEditAllowed: results.ownAliasRace.subsequentEditAllowed},
    failedCreateWithExistingProfile: {error: results.failedCreateWithExistingProfile.error,
      before: core(results.failedCreateWithExistingProfile.beforeView), after: core(results.failedCreateWithExistingProfile.after),
      profileUnchanged: results.failedCreateWithExistingProfile.profileUnchanged},
    notFoundProjection: {before: core(results.notFoundProjection.before), after: core(results.notFoundProjection.after), unchanged: results.notFoundProjection.unchanged},
    readFailureProjection: {before: core(results.readFailureProjection.before), after: core(results.readFailureProjection.after), unchanged: results.readFailureProjection.unchanged},
    normalOwnAlias: {own: core(results.normalOwnAlias.own), alias: core(results.normalOwnAlias.alias),
      bioPreserved: true, wishlistPreserved: true},
  }}));
