import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    values,
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

function statusNode(tree) {
  if (!tree || typeof tree !== 'object') return null;
  if (String(tree.attrs?.class || '').split(/\s+/).includes('hh-status')) return tree;
  for (const child of tree.children || []) {
    const match = statusNode(child);
    if (match) return match;
  }
  return null;
}

function nodeText(node) {
  if (typeof node === 'string') return node;
  if (!node || typeof node !== 'object') return '';
  return (node.children || []).map(nodeText).join('');
}

function createEnv({failWith, hold}) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let announceStart;
  let release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let registrationCalls = 0;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'Registration.registerTeacher') {
      registrationCalls += 1;
      if (hold && registrationCalls === 1) {
        announceStart();
        await gate;
      }
      return invoke(failWith ? {...input, failWith} : input);
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  let tree = null;
  const controller = createPublicController({runtime, storage,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, started, release,
    get registrationCalls() { return registrationCalls; }, get tree() { return tree; }};
}

async function prepareRegistration(env, tag) {
  const identity = {
    name: `E1602 ${tag}`,
    email: `e1602.${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@example.test`,
    phone: '206-555-1602',
  };
  await env.controller.initialize('#/register');
  for (const [key, value] of Object.entries({
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  })) await env.controller.selectSchool(key, value);
  for (const [key, value] of Object.entries(identity)) assert.equal(env.controller.updateDraft(key, value), true);
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  return identity;
}

function observe(env, passwords) {
  const currentTree = env.tree;
  const feedback = statusNode(currentTree);
  const runtimeState = env.runtime.snapshot();
  const runtimeInspection = env.runtime.inspect();
  const runtimePartValues = env.runtime.pxc.entries().map(([address, part]) => ({address, value: part.value}));
  const retained = JSON.stringify({
    controller: env.controller.state,
    runtimeState,
    runtimeInspection,
    runtimePartValues,
    storage: [...env.storage.values.entries()],
    tree: currentTree,
  });
  return {
    currentRoute: env.controller.route.path,
    page: env.controller.route.page,
    loginFormPresent: !!nodeById(currentTree, 'hh-login-form'),
    registerFormPresent: !!nodeById(currentTree, 'hh-register-form'),
    visibleFeedback: feedback ? {class: feedback.attrs?.class || '', text: nodeText(feedback)} : null,
    request: {...env.controller.state.request},
    outcome: env.controller.state.journey.outcome ? {...env.controller.state.journey.outcome} : null,
    fixtureAuthority: {
      mode: env.runtime.mode,
      fixture: env.runtime.fixture,
      productionAuthority: env.runtime.capabilities?.productionAuthority,
      authorityBeyondSupportedFixtureCapability: 'UNKNOWN (not exercised)',
      snapshotMode: runtimeState.mode,
      snapshotFixture: runtimeState.fixture,
      registrationStatus: runtimeState.registration.status,
      sessionStatus: runtimeState.session.status,
    },
    registrationCalls: env.registrationCalls,
    canRetry: env.controller.canRetry,
    credentialsAbsentFromRetainedSurfaces: passwords.every(password => !retained.includes(password)),
  };
}

async function failureCase({tag, failWith, navigateToLogin}) {
  const env = createEnv({failWith, hold: true});
  const identity = await prepareRegistration(env, tag);
  const password = randomUUID();
  const submitted = env.controller.dispatch('public:register', {
    ...identity, password, confirmPassword: password, termsAccepted: true,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  });
  let startTimer;
  try {
    await Promise.race([env.started, new Promise((_, reject) => {
      startTimer = setTimeout(() => reject(new Error('registration provider did not start')), 3000);
    })]);
  } finally {
    clearTimeout(startTimer);
  }
  if (navigateToLogin) await env.controller.navigate('#/login');
  env.release();
  const result = await submitted;
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, failWith);
  assert.equal(env.registrationCalls, 1);
  assert.equal(env.controller.route.page, navigateToLogin ? 'login' : 'register');
  const observation = observe(env, [password]);
  assert.equal(observation.loginFormPresent, navigateToLogin);
  assert.equal(observation.registerFormPresent, !navigateToLogin);
  assert.equal(observation.registrationCalls, 1, 'no second registration write occurred before user action');
  assert.equal(observation.credentialsAbsentFromRetainedSurfaces, true);
  return {tag, providerFailure: failWith, observation};
}

async function loginLocalErrorControl() {
  const env = createEnv({hold: false});
  await env.controller.initialize('#/login');
  const result = await env.controller.dispatch('public:login', {});
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'validation_failed');
  const observation = observe(env, []);
  assert.equal(observation.page, 'login');
  assert.equal(observation.loginFormPresent, true);
  assert.equal(observation.registrationCalls, 0);
  assert.match(observation.visibleFeedback?.text || '', /Enter the demo email/);
  return {tag: 'login-local-validation-control', observation};
}

const results = [];
results.push(await failureCase({tag: 'known-same-register-route-control', failWith: 'transport_failure', navigateToLogin: false}));
results.push(await failureCase({tag: 'known-late-on-login', failWith: 'transport_failure', navigateToLogin: true}));
results.push(await failureCase({tag: 'unknown-late-on-login', failWith: 'outcome_unknown', navigateToLogin: true}));
results.push(await loginLocalErrorControl());

process.stdout.write(`${JSON.stringify({probe: 'HH11 E1602 H2 late-registration-feedback', scope: 'volatile fixture/controller/render-tree only', results}, null, 2)}\n`);
