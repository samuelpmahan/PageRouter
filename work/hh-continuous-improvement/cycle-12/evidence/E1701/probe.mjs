import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {FIXTURE_STORAGE_KEY} from '../../../PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const expectedDraft = {
  name: 'Synthetic E1701 Profile',
  bio: 'Typed preview-only classroom introduction.',
  wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-E1701',
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function nodeById(tree, id) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.attrs?.id === id) return tree;
  for (const child of tree.children || []) {
    const match = nodeById(child, id);
    if (match) return match;
  }
  return null;
}

function profileForm(tree) {
  return {
    form: !!nodeById(tree, 'hh-profile-create-form'),
    name: nodeById(tree, 'hh-profile-name')?.attrs?.value ?? null,
    bio: nodeById(tree, 'hh-profile-bio')?.attrs?.value ?? null,
    wishlistUrl: nodeById(tree, 'hh-profile-wishlist-url')?.attrs?.value ?? null,
  };
}

function assertNoCredentialLeak({secret, runtime, controller, storage, outputs}) {
  const inspected = [JSON.stringify(runtime.inspect()), JSON.stringify(controller.state), storage.getItem(FIXTURE_STORAGE_KEY), JSON.stringify(outputs)].join('\n');
  assert.equal(inspected.includes(secret), false, 'ephemeral credential must not appear in Parts, state, storage, or evidence');
}

function createEnvironment({failure = null, holdFirstCreate = true, emailTag}) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  const calls = Object.create(null);
  let announceStart;
  let release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    calls[port] = (calls[port] || 0) + 1;
    if (port === 'TeacherProfile.createProfile' && calls[port] === 1 && holdFirstCreate) {
      announceStart();
      await held;
    }
    if (port === 'TeacherProfile.createProfile' && calls[port] === 1 && failure) {
      return invoke({...input, failWith: failure});
    }
    return invoke(input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  const runtime = createServiceRuntime(provider);
  let tree = null;
  const community = createCommunity({storage});
  const controller = createPublicController({runtime, storage, community,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {base, calls, controller, runtime, storage, started, release, get tree() { return tree; }, emailTag};
}

async function prepareAuthenticatedTeacher(env) {
  const email = `e1701-${env.emailTag}@example.invalid`;
  const password = randomUUID();
  await env.controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await env.controller.selectSchool(key, value);
  }
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  const registered = await env.controller.dispatch('public:register', {
    name: 'Synthetic E1701 Teacher', email, password, confirm_password: password,
  });
  assert.equal(registered.ok, true, 'volatile synthetic fixture registration succeeds');
  await env.controller.dispatch('public:approve');
  const loggedIn = await env.controller.dispatch('public:login', {email, password});
  assert.equal(loggedIn.ok, true, 'volatile synthetic fixture login succeeds');
  await env.controller.navigate('#/profile');
  assert.equal(env.controller.state.journey.profile.status, 'absent');
  assert.deepEqual(env.controller.state.journey.profile.createDraft, {name: '', bio: '', wishlistUrl: ''});
  return password;
}

function typeDraft(controller) {
  for (const [key, value] of Object.entries(expectedDraft)) assert.equal(controller.updateDraft(key, value), true);
  assert.deepEqual(controller.state.journey.profile.createDraft, expectedDraft);
}

function providerProfile(env) {
  return env.base.snapshot().ownProfile;
}

function persistedProfile(env) {
  const raw = env.storage.getItem(FIXTURE_STORAGE_KEY);
  assert.ok(raw, 'volatile fixture writes its synthetic state to the supplied in-memory storage');
  return JSON.parse(raw).teachers.find(record => record.id === env.controller.state.journey.session.teacherId)?.profile ?? null;
}

async function runFailureCase(failure, emailTag) {
  const env = createEnvironment({failure, emailTag});
  const secret = await prepareAuthenticatedTeacher(env);
  typeDraft(env.controller);
  const outputs = [];
  const inFlight = env.controller.dispatch('public:profile-create', {});
  await env.started;
  assert.equal(env.calls['TeacherProfile.createProfile'], 1, 'one write is held at the volatile fixture boundary');
  assert.equal(env.controller.state.request.status, 'busy');
  assert.deepEqual(env.controller.state.journey.profile.createDraft, expectedDraft);
  const heldProjection = profileForm(env.tree);
  assert.deepEqual(heldProjection, {...expectedDraft, form: true});
  assert.equal(providerProfile(env).status, 'absent');
  assert.equal(persistedProfile(env), null);
  env.release();
  const result = await inFlight;
  const completionRequestStatus = env.controller.state.request.status;
  outputs.push({case: failure, outcome: result.error?.code, outcomeKnown: result.error?.outcomeKnown ?? true});
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, failure);
  assert.equal(env.calls['TeacherProfile.createProfile'], 1, 'failure completion does not automatically repeat the write');
  assert.deepEqual(env.controller.state.journey.profile.createDraft, expectedDraft);
  assert.deepEqual(profileForm(env.tree), {...expectedDraft, form: true});
  assert.equal(providerProfile(env).status, 'absent');
  assert.equal(persistedProfile(env), null);

  const retry = await env.controller.dispatch('public:retry');
  outputs.push({publicRetry: retry.error?.code, count: env.calls['TeacherProfile.createProfile']});
  assert.equal(retry.error?.code, 'nothing_to_retry');
  assert.equal(env.calls['TeacherProfile.createProfile'], 1, 'public:retry issues no unsafe write retry');

  const explicit = await env.controller.dispatch('public:profile-create', {});
  outputs.push({explicitResubmit: explicit.ok, count: env.calls['TeacherProfile.createProfile']});
  assert.equal(explicit.ok, true, 'deliberate user resubmission succeeds from the retained draft');
  assert.equal(env.calls['TeacherProfile.createProfile'], 2, 'only explicit resubmission issues the second write');
  assert.equal(providerProfile(env).status, 'present');
  assert.equal(persistedProfile(env).displayName, 'Demo Synthetic E1701 Profile');
  assert.deepEqual(env.controller.state.journey.profile.createDraft, {name: '', bio: '', wishlistUrl: ''});
  assert.equal(nodeById(env.tree, 'hh-profile-create-form'), null, 'success control replaces the create form with the profile projection');
  assertNoCredentialLeak({secret, runtime: env.runtime, controller: env.controller, storage: env.storage, outputs});
  return {
    case: failure,
    held: {calls: 1, requestStatus: 'busy', providerProfile: 'absent', rendered: heldProjection},
    completion: {ok: result.ok, error: result.error.code, requestStatus: completionRequestStatus,
      draftPreserved: true, formPreserved: true, providerProfile: 'absent', persistedProfile: false,
      publicRetry: retry.error.code, callsAfterRetry: 1, explicitResubmit: explicit.ok, totalCalls: 2,
      finalProfile: providerProfile(env).status, draftClearedAfterSuccess: true},
  };
}

async function runSuccessControl() {
  const env = createEnvironment({emailTag: 'success'});
  const secret = await prepareAuthenticatedTeacher(env);
  typeDraft(env.controller);
  const inFlight = env.controller.dispatch('public:profile-create', {});
  await env.started;
  assert.equal(env.calls['TeacherProfile.createProfile'], 1);
  assert.deepEqual(profileForm(env.tree), {...expectedDraft, form: true});
  assert.equal(providerProfile(env).status, 'absent');
  env.release();
  const result = await inFlight;
  assert.equal(result.ok, true);
  assert.equal(env.calls['TeacherProfile.createProfile'], 1);
  assert.equal(providerProfile(env).status, 'present');
  assert.equal(persistedProfile(env).displayName, 'Demo Synthetic E1701 Profile');
  assert.deepEqual(env.controller.state.journey.profile.createDraft, {name: '', bio: '', wishlistUrl: ''});
  assert.equal(nodeById(env.tree, 'hh-profile-create-form'), null);
  const outputs = [{success: result.ok, calls: 1, profile: providerProfile(env).status}];
  assertNoCredentialLeak({secret, runtime: env.runtime, controller: env.controller, storage: env.storage, outputs});
  return {case: 'success_control', calls: 1, providerProfile: 'present', draftCleared: true, formRemoved: true};
}

const results = [];
results.push(await runFailureCase('transport_failure', 'known'));
results.push(await runFailureCase('outcome_unknown', 'unknown'));
results.push(await runSuccessControl());
process.stdout.write(`${JSON.stringify({probe: 'HH12 E1701 TeacherProfile.createProfile', scope: 'actual synthetic volatile fixture/controller/render-tree only', results}, null, 2)}\n`);
