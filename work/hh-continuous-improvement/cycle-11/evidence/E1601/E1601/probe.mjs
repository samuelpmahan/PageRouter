import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function inspectTree(tree) {
  const nodes = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(tree);
  return {
    page: tree?.attrs?.['data-public-page'] || null,
    loginForm: nodes.some(node => node.attrs?.id === 'hh-login-form'),
    registerForm: nodes.some(node => node.attrs?.id === 'hh-register-form'),
    loginSubmitEnabled: nodes.some(node => node.attrs?.id === 'hh-login-submit' && node.attrs?.disabled !== true),
    feedback: nodes.filter(node => node.attrs?.role === 'status').map(node => ({
      className: node.attrs?.class || '',
      text: (node.children || []).filter(child => typeof child === 'string').join(''),
    })),
  };
}

function secretAbsentCheck({controller, runtime, storage, password}) {
  const serialized = [
    JSON.stringify(controller.state),
    JSON.stringify(runtime.inspect()),
    JSON.stringify(runtime.pxc.entries().map(([address, part]) => ({address, value: part.value}))),
    [...storage.values.values()].join('\n'),
  ].join('\n');
  return !serialized.includes(password);
}

function assertRouteForm(tree, page, formKey, label) {
  const rendered = inspectTree(tree);
  assert.equal(rendered.page, page, `${label}: rendered route identity`);
  assert.equal(rendered[formKey], true, `${label}: expected form is rendered`);
  if (page === 'login') assert.equal(rendered.loginSubmitEnabled, true, `${label}: login submit remains enabled`);
  return rendered;
}

function setup({failWith = null, hold = true} = {}) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let startedResolve;
  let releaseResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const pending = new Promise(resolve => { releaseResolve = resolve; });
  let registrationCalls = 0;
  let tree = null;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'Registration.registerTeacher') {
      registrationCalls += 1;
      if (hold) {
        startedResolve();
        await pending;
      }
      return invoke(failWith ? {...input, failWith} : input);
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  const controller = createPublicController({runtime, storage, community: createCommunity({storage}),
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, started, release() { releaseResolve(); },
    get tree() { return tree; }, get registrationCalls() { return registrationCalls; }};
}

async function prepare(env, suffix) {
  const credentials = {
    email: `hh11-${suffix}-${randomBytes(8).toString('hex')}@example.test`,
    password: `volatile-${randomBytes(20).toString('hex')}`,
  };
  await env.controller.initialize('#/register');
  for (const [key, value] of Object.entries({
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  })) await env.controller.selectSchool(key, value);
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  return {credentials, payload: {
    name: 'Synthetic Teacher', email: credentials.email, phone: '555-0101',
    password: credentials.password, confirm_password: credentials.password,
  }};
}

async function runHeldCase({name, failWith, navigateBeforeRelease, navigateAfterCompletion = false}) {
  const env = setup({failWith, hold: true});
  const {credentials, payload} = await prepare(env, name);
  const write = env.controller.dispatch('public:register', payload);
  await env.started;
  assert.equal(env.registrationCalls, 1, 'exactly one registration write started');
  const during = assertRouteForm(env.tree, 'register', 'registerForm', `${name} while request is held`);
  if (navigateBeforeRelease) {
    await env.controller.navigate('#/login');
  }
  const currentBeforeRelease = navigateBeforeRelease
    ? assertRouteForm(env.tree, 'login', 'loginForm', `${name} before release`)
    : assertRouteForm(env.tree, 'register', 'registerForm', `${name} before release`);
  env.release();
  const result = await write;
  if (failWith) {
    assert.equal(result.error?.code, failWith, `${name}: actual fixture outcome classification`);
    assert.equal(result.error?.outcomeKnown, failWith !== 'outcome_unknown', `${name}: outcome-known projection`);
  } else {
    assert.equal(result.ok, true, `${name}: fixture success control`);
  }
  await Promise.resolve();
  const completedRoute = navigateBeforeRelease
    ? assertRouteForm(env.tree, 'login', 'loginForm', `${name} on completion`)
    : assertRouteForm(env.tree, 'register', 'registerForm', `${name} on completion`);
  if (navigateAfterCompletion) await env.controller.navigate('#/login');
  const after = assertRouteForm(env.tree, 'login', 'loginForm', `${name} after control navigation`);
  const loginLocalValidation = await env.controller.dispatch('public:login', {email: 'invalid', password: ''});
  assert.equal(loginLocalValidation.error?.code, 'validation_failed', 'login form dispatch reaches existing local validation');
  const afterLoginValidation = assertRouteForm(env.tree, 'login', 'loginForm', `${name} after login local-validation control`);
  assert.equal(env.registrationCalls, 1, 'login validation control causes no additional registration write');
  const observation = {
    name,
    failWith: failWith || 'none',
    navigatedBeforeRelease: navigateBeforeRelease,
    result: {ok: result.ok, code: result.error?.code || null, outcomeKnown: result.error?.outcomeKnown ?? null},
    beforeRelease: currentBeforeRelease,
    wasPendingOnRegister: during.page === 'register' && during.registerForm,
    completedRoute,
    after,
    loginLocalValidation: {
      code: loginLocalValidation.error?.code || null,
      requestStatus: env.controller.state.request.status,
      afterFeedback: afterLoginValidation.feedback,
      registrationCalls: env.registrationCalls,
    },
    requestStatus: env.controller.state.request.status,
    outcomeKind: env.controller.state.journey.outcome?.kind || null,
    registrationCalls: env.registrationCalls,
    credentialAbsentFromRetainedSurfaces: secretAbsentCheck({
      controller: env.controller, runtime: env.runtime, storage: env.storage,
      password: credentials.password,
    }),
  };
  assert.equal(observation.credentialAbsentFromRetainedSurfaces, true, 'password is absent from retained state/runtime/Parts/storage');
  assert.equal(env.registrationCalls, 1, 'completion caused no automatic second registration write');
  return observation;
}

const observations = [];
observations.push(await runHeldCase({name: 'same-route-existing-error-control', failWith: 'transport_failure', navigateBeforeRelease: false, navigateAfterCompletion: true}));
observations.push(await runHeldCase({name: 'navigate-login-then-known-failure', failWith: 'transport_failure', navigateBeforeRelease: true}));
observations.push(await runHeldCase({name: 'navigate-login-then-unknown-outcome', failWith: 'outcome_unknown', navigateBeforeRelease: true}));
observations.push(await runHeldCase({name: 'navigate-login-then-success-control', failWith: null, navigateBeforeRelease: true}));

console.log(JSON.stringify({schema: 'hh11-h1-e1601-probe/v1', source: 'local fixture provider + public controller/render tree', observations}, null, 2));
