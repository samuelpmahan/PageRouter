import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFixtureProvider, createServiceRuntime} from '../services/index.mjs';
import {createCommunity, renderCommunity} from './community.mjs';
import {createPublicController, normalizePublicRoute} from './public-controller.mjs';
import {renderPublicSite} from './public-site.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function setup() {
  const storage = memoryStorage();
  const provider = createFixtureProvider({fixture: true, storage});
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage});
  const controller = createPublicController({runtime, storage, community});
  return {controller, runtime, storage, community};
}

function registrationDraftSetup() {
  const storage = memoryStorage();
  const provider = createFixtureProvider({fixture: true, storage});
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage});
  let tree = null;
  const controller = createPublicController({runtime, storage, community,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, get tree() { return tree; }};
}

function communityDraftSetup() {
  const storage = memoryStorage();
  const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const community = createCommunity({storage});
  let tree = null;
  const controller = createPublicController({runtime, storage, community,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, community, get tree() { return tree; }};
}

function topicComposerFields(tree) {
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  const form = nodes.find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-topic');
  if (!form) return null;
  const fields = [];
  const walkForm = node => {
    if (!node || typeof node !== 'object') return;
    if (node.attrs?.name) fields.push(node);
    for (const child of node.children || []) walkForm(child);
  };
  walkForm(form);
  const title = fields.find(node => node.attrs.name === 'title');
  const category = fields.find(node => node.attrs.name === 'category');
  const content = fields.find(node => node.attrs.name === 'content');
  return {
    title: title?.attrs.value ?? '',
    category: category?.children?.find(option => option?.attrs?.selected)?.attrs?.value ?? '',
    content: content?.children?.join('') ?? '',
  };
}

async function openTeacherTopicComposer(env) {
  await env.controller.initialize('#/create-post');
  await env.controller.dispatch('forum-role', {role: 'teacher'});
  assert.ok(topicComposerFields(env.tree), 'teacher sees the topic composer');
}

function replyComposerFields(tree) {
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  const form = nodes.find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-reply');
  if (!form) return null;
  const formNodes = [];
  const walkForm = node => {
    if (!node || typeof node !== 'object') return;
    formNodes.push(node);
    for (const child of node.children || []) walkForm(child);
  };
  walkForm(form);
  const textarea = formNodes.find(node => node.tag === 'textarea' && node.attrs?.name === 'content');
  return {threadId: form.attrs['data-thread-id'], content: textarea?.children?.join('') ?? textarea?.attrs?.value ?? ''};
}

function postEditFields(tree) {
  const nodes = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(tree);
  const form = nodes.find(node => node.tag === 'form' && node.attrs?.['data-submit'] === 'forum-edit-post');
  if (!form) return null;
  const formNodes = [];
  const walkForm = node => {
    if (!node || typeof node !== 'object') return;
    formNodes.push(node);
    for (const child of node.children || []) walkForm(child);
  };
  walkForm(form);
  const title = formNodes.find(node => node.tag === 'input' && node.attrs?.name === 'title');
  const content = formNodes.find(node => node.tag === 'textarea' && node.attrs?.name === 'content');
  return {postId: form.attrs['data-post-id'], title: title?.attrs?.value ?? '', content: content?.children?.join('') ?? ''};
}

async function openTeacherReplyComposer(env, threadId = 'topic-official-bug-forum') {
  await env.controller.initialize(`#/posts/${threadId}`);
  await env.controller.dispatch('forum-role', {role: 'teacher'});
  assert.equal(replyComposerFields(env.tree)?.threadId, threadId, 'teacher sees the reply composer on the selected thread');
}

function loginDraftFailureSetup() {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  const started = [];
  const pending = [];
  const releases = [];
  let loginCalls = 0;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port !== 'Session.login') return invoke(input);
    const index = loginCalls++;
    let announceStart, release;
    started[index] = new Promise(resolve => { announceStart = resolve; });
    pending[index] = new Promise(resolve => { release = resolve; });
    releases[index] = release;
    announceStart();
    await pending[index];
    return invoke(index === 0 ? {...input, failWith: 'transport_failure'} : input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  let tree = null;
  const controller = createPublicController({runtime, storage, community: createCommunity({storage}),
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, started, release(index) { releases[index](); },
    get loginCalls() { return loginCalls; }, get tree() { return tree; }};
}

function registrationFailureSetup({failCalls = {}, pauseCall = 0} = {}) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let announceStart, release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let registrationCalls = 0;
  let loginAliasIndex = null;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'Registration.registerTeacher') {
      registrationCalls += 1;
      if (pauseCall === registrationCalls) {
        announceStart();
        await pending;
      }
      const failWith = failCalls[registrationCalls];
      return invoke(failWith ? {...input, failWith} : input);
    }
    if (port === 'Session.login') {
      const match = /^public-teacher-(\d+)@fixture\.test$/.exec(input.email);
      loginAliasIndex = match ? Number(match[1]) : null;
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  let tree = null;
  const controller = createPublicController({runtime, storage, community: createCommunity({storage}),
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, started, release,
    get registrationCalls() { return registrationCalls; }, get loginAliasIndex() { return loginAliasIndex; },
    get tree() { return tree; }};
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

function selectedOptionValue(tree, id) {
  const select = nodeById(tree, id);
  return select?.children?.find(option => option?.attrs?.selected)?.attrs?.value || '';
}

async function prepareRegistrationDraft(env, {name, email, phone}) {
  const {controller} = env;
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  })) await controller.selectSchool(key, value);

  // Mirror app.mjs's delegated `input` listener for the non-secret fields.
  for (const [key, value] of Object.entries({name, email, phone})) {
    assert.equal(controller.updateDraft(key, value), true);
  }
}

function assertRegistrationDraftRendered(tree, {name, email, phone}) {
  assert.equal(nodeById(tree, 'hh-register-name')?.attrs?.value, name);
  assert.equal(nodeById(tree, 'hh-register-email')?.attrs?.value, email);
  assert.equal(nodeById(tree, 'hh-register-phone')?.attrs?.value, phone);
  assert.equal(selectedOptionValue(tree, 'hh-directory-state'), 'Demo Washington');
  assert.equal(selectedOptionValue(tree, 'hh-directory-county'), 'Demo King');
  assert.equal(selectedOptionValue(tree, 'hh-directory-district'), 'Demo District');
  assert.equal(selectedOptionValue(tree, 'hh-directory-school'), 'Demo Academy');
}

function assertCredentialsNotPersisted(env, credentials) {
  const surfaces = [
    JSON.stringify(env.controller.state),
    JSON.stringify(env.runtime.inspect()),
    JSON.stringify(env.runtime.pxc.entries().map(([address, part]) => ({address, value: part.value}))),
    [...env.storage.values.values()].join('\n'),
  ].join('\n');
  for (const credential of credentials) assert.equal(surfaces.includes(credential), false);
}

function loginFormPayload(email, password) {
  const data = new FormData();
  data.set('email', email);
  data.set('password', password);
  return Object.fromEntries(data.entries());
}

function assertLoginCredentialsNotPersisted(env, credentials) {
  const surfaces = [
    JSON.stringify(env.controller.state),
    JSON.stringify(env.runtime.snapshot()),
    JSON.stringify(env.runtime.inspect()),
    JSON.stringify(env.runtime.pxc.entries().map(([, part]) => part.value)),
    [...env.storage.values.values()].join('\n'),
    JSON.stringify(env.tree),
  ].join('\n');
  for (const credential of credentials) assert.equal(surfaces.includes(credential), false);
}

async function preparePendingLoginIdentity(env) {
  const email = `pending-${randomUUID()}@fixture.test`;
  const result = await env.runtime.invoke('Registration.registerTeacher', {
    teacher: {name: 'Demo Pending Login', email, phoneNumber: 'DEMO'},
    school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'},
    termsAccepted: true, demoAccount: true,
  });
  assert.equal(result.ok, true);
  await env.controller.initialize('#/login');
  return email;
}

test('login draft retains typed, newer, and explicit blank email through held failures', async () => {
  const env = loginDraftFailureSetup();
  const pendingEmail = await preparePendingLoginIdentity(env);
  const credentials = [randomUUID(), randomUUID()];
  const initialEmail = 'typed-initial@example.test';
  const newerEmail = 'typed-newer@example.test';

  assert.equal(env.controller.updateDraft('email', initialEmail), true);
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, initialEmail);
  const firstLogin = env.controller.dispatch('public:login', loginFormPayload(initialEmail, credentials[0]));
  await env.started[0];
  assert.equal(env.controller.state.request.status, 'busy');
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, initialEmail);
  assert.equal(env.controller.updateDraft('email', newerEmail), true);
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, newerEmail);
  env.release(0);
  const transportFailure = await firstLogin;
  assert.equal(transportFailure.error?.code, 'transport_failure');
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, newerEmail);
  assert.equal(env.controller.state.journey.session.status, 'anonymous');
  assert.equal(env.runtime.snapshot().session.status, 'anonymous');
  assert.equal(env.runtime.snapshot().registration.status, 'pending');
  assert.equal(env.controller.state.journey.registration.identity.email, '');

  assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
  assert.equal(env.loginCalls, 1, 'public retry does not repeat login');

  assert.equal(env.controller.updateDraft('email', pendingEmail), true);
  const deniedLogin = env.controller.dispatch('public:login', loginFormPayload(pendingEmail, credentials[1]));
  await env.started[1];
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, pendingEmail);
  assert.equal(env.controller.updateDraft('email', ''), true);
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, '');
  env.release(1);
  const pendingDenied = await deniedLogin;
  assert.equal(pendingDenied.error?.code, 'pending_denied');
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value, '');
  assert.equal(env.controller.state.journey.loginDraft.email, '');
  assert.equal(env.controller.state.journey.session.status, 'anonymous');
  assert.equal(env.controller.state.journey.session.email, '');
  assert.equal(env.runtime.snapshot().session.status, 'anonymous');
  assert.equal(env.runtime.snapshot().registration.status, 'pending');
  assert.equal(env.controller.state.journey.registration.identity.email, '');
  assert.equal(env.loginCalls, 2);
  assertLoginCredentialsNotPersisted(env, credentials);
});

test('login draft keeps existing fallback order and clears only after authority changes', async () => {
  const renderEmail = journey => nodeById(renderPublicSite({route: {page: 'login'}, journey}), 'hh-login-email')?.attrs?.value;
  assert.equal(renderEmail({loginDraft: {email: null}, session: {email: 'session@example.test'}, registration: {identity: {email: 'registered@example.test'}}}), 'session@example.test');
  assert.equal(renderEmail({loginDraft: {email: null}, session: {email: ''}, registration: {identity: {email: 'registered@example.test'}}}), 'registered@example.test');
  assert.equal(renderEmail({loginDraft: {email: ''}, session: {email: 'session@example.test'}, registration: {identity: {email: 'registered@example.test'}}}), '');

  const env = registrationDraftSetup();
  await env.controller.initialize('#/login');
  assert.equal(env.controller.updateDraft('email', 'avery@fixture.test'), true);
  const password = randomUUID();
  const login = await env.controller.dispatch('public:login', loginFormPayload('avery@fixture.test', password));
  assert.equal(login.ok, true);
  assert.equal(env.controller.state.journey.session.status, 'authenticated');
  assert.equal(env.controller.state.journey.loginDraft.email, null);
  assert.equal(env.controller.route.page, 'profile');
  assertLoginCredentialsNotPersisted(env, [password]);

  await env.controller.navigate('#/login');
  assert.equal(nodeById(env.tree, 'hh-login-email')?.attrs?.value,
    env.controller.state.journey.session.email || env.controller.state.journey.registration.identity.email || '');
  assert.equal(env.controller.updateDraft('email', 'stale-draft@example.test'), true);
  const logout = await env.controller.dispatch('public:logout');
  assert.equal(logout.ok, true);
  assert.equal(env.controller.state.journey.session.status, 'anonymous');
  assert.equal(env.controller.state.journey.loginDraft.email, null);
  assert.notEqual(nodeById(env.tree, 'hh-login-email')?.attrs?.value, 'stale-draft@example.test');

  assert.equal(env.controller.updateDraft('email', 'pre-reset@example.test'), true);
  assert.equal((await env.controller.dispatch('public:reset')).ok, true);
  assert.equal(env.controller.state.journey.loginDraft.email, null);
  await env.controller.navigate('#/login');
  assert.notEqual(nodeById(env.tree, 'hh-login-email')?.attrs?.value, 'pre-reset@example.test');
});

test('held successful login projects authenticated email after route reentry', async () => {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let announceStart, release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let loginCalls = 0;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port !== 'Session.login') return invoke(input);
    loginCalls += 1;
    announceStart();
    await pending;
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  let tree = null;
  const controller = createPublicController({runtime, storage, community: createCommunity({storage}),
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  const accountEmail = `e1903-${randomUUID()}@example.test`;
  const account = await runtime.invoke('Registration.registerTeacher', {
    teacher: {name: 'Demo E1903 Synthetic', email: accountEmail, phoneNumber: 'DEMO'},
    school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'},
    termsAccepted: true, demoAccount: true,
  });
  assert.equal(account.ok, true);
  const approval = await runtime.invoke('Demo.simulateApproval', {teacherId: account.data.registration.teacherId});
  assert.equal(approval.ok, true);
  await controller.initialize('#/login');

  const password = randomUUID();
  const newerEmail = `newer-${randomUUID()}@example.test`;
  controller.updateDraft('email', accountEmail);
  const login = controller.dispatch('public:login', {email: accountEmail, password});
  await started;
  assert.equal(controller.state.request.status, 'busy');
  assert.equal(controller.updateDraft('email', newerEmail), true);
  await controller.navigate('#/about');
  await controller.navigate('#/login');
  assert.equal(controller.state.journey.loginDraft.email, newerEmail);
  release();

  const result = await login;
  assert.equal(result.ok, true);
  assert.equal(loginCalls, 1);
  assert.equal(controller.state.journey.session.status, 'authenticated');
  assert.equal(controller.state.journey.session.email, accountEmail);
  assert.equal(controller.state.journey.runtime.session.teacherId, account.data.registration.teacherId);
  assert.equal(controller.state.journey.loginDraft.email, null);
  assert.equal(controller.route.page, 'login');
  assertLoginCredentialsNotPersisted({controller, runtime, storage, get tree() { return tree; }}, [password]);
  assert.equal(nodeById(tree, 'hh-login-email')?.attrs?.value, accountEmail,
    'reentered login view follows the successful authenticated identity, not the superseded draft');
});

async function registeredProfileSetup() {
  const env = setup(), {controller} = env;
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) await controller.selectSchool(key, value);
  await controller.dispatch('public:terms-consent', {accepted: true});
  assert.equal((await controller.dispatch('public:register', {name: 'Synthetic Wishlist', email: 'wishlist@example.invalid', password: 'Volatile-Only-17', confirm_password: 'Volatile-Only-17'})).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email: 'wishlist@example.invalid', password: 'Volatile-Only-17'})).ok, true);
  await controller.navigate('#/profile');
  return env;
}

function profileCreateFailureSetup({failWith = null} = {}) {
  const storage = memoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let announceStart, release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let createCalls = 0;
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.createProfile') {
      createCalls += 1;
      if (createCalls === 1) {
        announceStart();
        await pending;
      }
      return invoke(failWith && createCalls === 1 ? {...input, failWith} : input);
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services: Object.freeze(services)});
  const community = createCommunity({storage});
  let tree = null;
  const controller = createPublicController({runtime, storage, community,
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  return {controller, runtime, storage, started, release,
    get createCalls() { return createCalls; }, get tree() { return tree; }};
}

async function prepareSyntheticProfileOwner(env) {
  const email = `e1703-${randomUUID()}@example.invalid`, password = randomUUID();
  await env.controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await env.controller.selectSchool(key, value);
  }
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  assert.equal((await env.controller.dispatch('public:register', {name: 'Synthetic E1703 Teacher', email, password, confirmPassword: password})).ok, true);
  assert.equal((await env.controller.dispatch('public:approve')).ok, true);
  assert.equal((await env.controller.dispatch('public:login', {email, password})).ok, true);
  await env.controller.navigate('#/profile');
  assert.equal(env.controller.state.journey.profile.status, 'absent');
  assertCredentialsNotPersisted(env, [password]);
  return password;
}

function controlledFixtureRuntime(delayedPorts = [], {failPorts = []} = {}) {
  const base = createFixtureProvider({fixture: true});
  const gates = new Map(delayedPorts.map(port => {
    let announceStart, release;
    const started = new Promise(resolve => { announceStart = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    return [port, {started, announceStart, pending, release}];
  }));
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    const gate = gates.get(port);
    if (gate) {
      gate.announceStart();
      await gate.pending;
    }
    return invoke(failPorts.includes(port) ? {...input, failWith: 'denied'} : input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  return {
    runtime: createServiceRuntime(provider),
    waitFor(port) { return gates.get(port)?.started || Promise.reject(new Error(`No gate for ${port}`)); },
    release(port) { gates.get(port)?.release(); },
  };
}

async function createControlledSyntheticTeacher(controller, suffix = 'controlled') {
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) {
    await controller.selectSchool(key, value);
  }
  await controller.dispatch('public:terms-consent', {accepted: true});
  const email = `${suffix}@example.invalid`;
  assert.equal((await controller.dispatch('public:register', {
    name: 'Synthetic Controlled', email, password: 'Volatile-Only-31', confirm_password: 'Volatile-Only-31',
  })).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email, password: 'Volatile-Only-31'})).ok, true);
  await controller.navigate('#/profile');
  return controller.state.journey.session.teacherId;
}

function controlledController(runtime) {
  return createPublicController({runtime, community: createCommunity()});
}

test('prepared share handoff is invalidated before foreign profile read resolves', async () => {
  const base = createFixtureProvider({fixture: true});
  let announceJordan, releaseJordan;
  const jordanStarted = new Promise(resolve => { announceJordan = resolve; });
  const jordanGate = new Promise(resolve => { releaseJordan = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') {
      announceJordan();
      await jordanGate;
    }
    return invoke(input);
  }]));
  const controller = controlledController(createServiceRuntime({...base, services}));
  await controller.initialize('#/');
  await controller.navigate('#/public-profile/demo-avery');
  const prepared = await controller.dispatch('public:share');
  assert.equal(prepared.share.url, '#/public-profile/demo-avery');

  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.share.intent, true, 'same-profile alias retains the prepared handoff');

  const loadingJordan = controller.navigate('#/public-profile/demo-jordan');
  await jordanStarted;
  assert.equal(controller.state.journey.profile.status, 'loading');
  assert.equal(controller.state.journey.share.intent, false, 'foreign route retires Avery handoff before provider completion');
  assert.equal(controller.state.journey.share.profileId, null);
  releaseJordan();
  await loadingJordan;
  assert.equal(controller.state.journey.profile.value.id, 'demo-jordan');
  assert.equal(controller.state.journey.share.intent, false);

  const rendered = renderPublicSite({route: controller.route, state: controller.state, journey: controller.state.journey});
  const stack = [rendered], fields = [];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.attrs?.id === 'hh-share-route') fields.push(node);
    stack.push(...(node.children || []));
  }
  assert.equal(fields.length, 0, 'Jordan does not display the prepared Avery route');
});

test('route-derived share dispatch remains available to anonymous, pending, missing, and captured viewers', async () => {
  const rendered = (controller) => {
    const root = renderPublicSite({route: controller.route, state: controller.state, journey: controller.state.journey});
    const stack = [root], nodes = [];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== 'object') continue;
      nodes.push(node); stack.push(...(node.children || []));
    }
    return {fields: nodes.filter(node => node.attrs?.id === 'hh-share-route'),
      capturedNote: nodes.some(node => node.attrs?.['data-testid'] === 'hh-reference-share-note')};
  };
  const base = createFixtureProvider({fixture: true});
  let announceJordan, releaseJordan;
  const jordanStarted = new Promise(resolve => { announceJordan = resolve; });
  const jordanGate = new Promise(resolve => { releaseJordan = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') {
      announceJordan(); await jordanGate;
    }
    return invoke(input);
  }]));
  const controller = controlledController(createServiceRuntime({...base, services}));
  await controller.initialize('#/');
  assert.equal(controller.state.journey.session.status, 'anonymous');
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal((await controller.dispatch('public:share')).share.url, '#/public-profile/demo-avery');

  const pendingJordan = controller.navigate('#/public-profile/demo-jordan');
  await jordanStarted;
  assert.equal(controller.state.journey.profile.status, 'loading');
  assert.equal((await controller.dispatch('public:share')).share.url, '#/public-profile/demo-jordan');
  releaseJordan(); await pendingJordan;

  await controller.navigate('#/public-profile/demo-missing');
  assert.equal(controller.state.journey.profile.status, 'error');
  assert.equal((await controller.dispatch('public:share')).share.url, '#/public-profile/demo-missing');
  assert.equal(rendered(controller).fields.length, 0, 'unavailable route does not project a share field');

  await controller.navigate('#/public-profile/reference-sarah');
  assert.equal(controller.state.journey.profile.source, 'captured-readonly');
  assert.equal((await controller.dispatch('public:share')).share.url, '#/public-profile/reference-sarah');
  assert.equal(rendered(controller).fields.length, 0, 'captured profile does not render a synthetic share field');
  assert.equal(rendered(controller).capturedNote, true, 'captured Share Page affordance retains its local note');
});

test('delayed profile creation preserves the current other-teacher route and edit authority', async () => {
  const controlled = controlledFixtureRuntime(['TeacherProfile.createProfile']);
  const {runtime} = controlled, controller = controlledController(runtime);
  const teacherId = await createControlledSyntheticTeacher(controller, 'other-profile-route');
  const creating = controller.dispatch('public:profile-create', {name: 'Synthetic Owner Profile'});
  await controlled.waitFor('TeacherProfile.createProfile');
  await controller.navigate('#/public-profile/demo-avery');
  const displayedOtherTeacher = structuredClone(controller.state.journey.profile);
  assert.equal(displayedOtherTeacher.value.id, 'demo-avery');
  assert.equal(displayedOtherTeacher.value.teacherId, 'demo-seed-avery');
  assert.equal(displayedOtherTeacher.value.name, 'Demo Avery');

  controlled.release('TeacherProfile.createProfile');
  assert.equal((await creating).ok, true);
  assert.equal(runtime.snapshot().ownProfile.profile.id, `profile-${teacherId}`);
  assert.equal(controller.route.profileId, 'demo-avery');
  assert.deepEqual(controller.state.journey.profile, displayedOtherTeacher);
  const edit = await controller.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'profile_owner_mismatch');

  await controller.navigate(`#/public-profile/profile-${teacherId}`);
  assert.equal(controller.state.journey.profile.value.id, `profile-${teacherId}`);
  assert.equal(controller.state.journey.profile.value.name, 'Synthetic Owner Profile');
  assert.equal((await controller.dispatch('public:edit-profile')).ok, true, 'the own-profile public alias remains editable');
});

test('delayed profile creation preserves a captured read-only reference projection', async () => {
  const controlled = controlledFixtureRuntime(['TeacherProfile.createProfile']);
  const controller = controlledController(controlled.runtime);
  await createControlledSyntheticTeacher(controller, 'captured-reference-route');
  const creating = controller.dispatch('public:profile-create', {name: 'Synthetic Reference Control'});
  await controlled.waitFor('TeacherProfile.createProfile');
  await controller.navigate('#/public-profile/reference-sarah');
  const capturedReference = structuredClone(controller.state.journey.profile);
  assert.equal(capturedReference.source, 'captured-readonly');
  assert.equal(capturedReference.readOnly, true);

  controlled.release('TeacherProfile.createProfile');
  assert.equal((await creating).ok, true);
  assert.equal(controller.route.profileId, 'reference-sarah');
  assert.deepEqual(controller.state.journey.profile, capturedReference);
  const edit = await controller.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'read_only_reference');
});

test('delayed profile creation leaves an in-flight public-profile read projection intact', async () => {
  const controlled = controlledFixtureRuntime(['TeacherProfile.createProfile', 'TeacherProfile.openPublicProfile']);
  const controller = controlledController(controlled.runtime);
  await createControlledSyntheticTeacher(controller, 'pending-public-read');
  const creating = controller.dispatch('public:profile-create', {name: 'Synthetic Pending Read Control'});
  await controlled.waitFor('TeacherProfile.createProfile');
  const reading = controller.navigate('#/public-profile/demo-jordan');
  await controlled.waitFor('TeacherProfile.openPublicProfile');
  const pendingRead = structuredClone(controller.state.journey.profile);
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.equal(pendingRead.status, 'loading');
  assert.equal(pendingRead.value, null);

  controlled.release('TeacherProfile.createProfile');
  assert.equal((await creating).ok, true);
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.deepEqual(controller.state.journey.profile, pendingRead);

  controlled.release('TeacherProfile.openPublicProfile');
  await reading;
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.equal(controller.state.journey.profile.value.id, 'demo-jordan');
  assert.equal(controller.state.journey.profile.value.teacherId, 'demo-seed-jordan');
});

test('failed profile creation service sync preserves a captured reference when an own profile exists', async () => {
  const {controller, runtime} = await registeredProfileSetup();
  const profileCreated = await controller.dispatch('public:profile-create', {name: 'Existing Synthetic Owner'});
  assert.equal(profileCreated.ok, true);
  await controller.navigate('#/public-profile/reference-sarah');
  const capturedReference = structuredClone(controller.state.journey.profile);

  const failedCreate = await controller.dispatch('public:profile-create', {name: 'Duplicate Synthetic Owner'});
  assert.equal(failedCreate.ok, false);
  assert.equal(failedCreate.error.code, 'profile_exists');
  assert.equal(runtime.snapshot().ownProfile.status, 'present');
  assert.equal(controller.route.profileId, 'reference-sarah');
  assert.deepEqual(controller.state.journey.profile, capturedReference);
});

test('held profile creation keeps the live create draft through failure and explicit resubmission', async () => {
  const scenarios = [
    {name: 'known transport failure', failWith: 'transport_failure', requestStatus: 'failed', outcomeKnown: true},
    {name: 'unknown outcome', failWith: 'outcome_unknown', requestStatus: 'outcome_unknown', outcomeKnown: false},
    {name: 'ordinary success control', failWith: null, requestStatus: 'completed'},
  ];
  for (const [index, scenario] of scenarios.entries()) {
    const env = profileCreateFailureSetup({failWith: scenario.failWith});
    const password = await prepareSyntheticProfileOwner(env);
    const submittedDraft = {
      name: `Synthetic E1703 Submitted ${index}`,
      bio: 'Typed classroom introduction before the held request.',
      wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-E1703',
    };
    const liveDraft = {
      name: `Synthetic E1703 Edited ${index}`,
      bio: 'Typed classroom introduction while the request is held.',
      wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-E1703-LIVE',
    };
    for (const [key, value] of Object.entries(submittedDraft)) assert.equal(env.controller.updateDraft(key, value), true);

    const attempt = env.controller.dispatch('public:profile-create', {});
    await env.started;
    assert.equal(env.createCalls, 1);
    assert.equal(env.controller.state.request.status, 'busy');
    assert.equal(env.runtime.snapshot().ownProfile.status, 'absent');
    for (const [key, value] of Object.entries(liveDraft)) assert.equal(env.controller.updateDraft(key, value), true);
    assert.deepEqual(env.controller.state.journey.profile.createDraft, liveDraft);
    assert.ok(nodeById(env.tree, 'hh-profile-create-form'), 'the create form remains rendered while the write is held');
    assert.equal(nodeById(env.tree, 'hh-profile-name')?.attrs?.value, liveDraft.name);
    assert.equal(nodeById(env.tree, 'hh-profile-bio')?.attrs?.value, liveDraft.bio);
    assert.equal(nodeById(env.tree, 'hh-profile-wishlist-url')?.attrs?.value, liveDraft.wishlistUrl);

    env.release();
    const result = await attempt;
    if (scenario.failWith) {
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, scenario.failWith);
      assert.equal(result.error?.outcomeKnown, scenario.outcomeKnown);
      assert.equal(env.controller.state.request.status, scenario.requestStatus);
      assert.equal(env.runtime.snapshot().ownProfile.status, 'absent');
      assert.equal(env.controller.state.journey.profile.status, 'absent');
      assert.deepEqual(env.controller.state.journey.profile.createDraft, liveDraft);
      assert.ok(nodeById(env.tree, 'hh-profile-create-form'), 'the failed write preserves the create form');
      assert.equal(nodeById(env.tree, 'hh-profile-name')?.attrs?.value, liveDraft.name);
      assert.equal(nodeById(env.tree, 'hh-profile-bio')?.attrs?.value, liveDraft.bio);
      assert.equal(nodeById(env.tree, 'hh-profile-wishlist-url')?.attrs?.value, liveDraft.wishlistUrl);
      assert.equal(env.controller.canRetry, false);
      assert.equal(env.createCalls, 1, 'completion does not automatically repeat the profile write');
      assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
      assert.equal(env.createCalls, 1, 'public:retry does not repeat an unsafe profile write');
    } else {
      assert.equal(result.ok, true);
      assert.equal(env.controller.state.request.status, scenario.requestStatus);
    }

    // Failure leaves the latest edits available; deliberate resubmission must use them.
    const resubmitted = scenario.failWith ? await env.controller.dispatch('public:profile-create', {}) : result;
    const expectedProfile = scenario.failWith ? liveDraft : submittedDraft;
    assert.equal(resubmitted.ok, true);
    assert.equal(env.createCalls, scenario.failWith ? 2 : 1);
    assert.equal(env.runtime.snapshot().ownProfile.status, 'present');
    assert.equal(env.controller.state.journey.profile.value.name, expectedProfile.name);
    assert.equal(env.controller.state.journey.profile.value.bio, expectedProfile.bio);
    assert.equal(env.controller.state.journey.profile.value.wishlistUrl, expectedProfile.wishlistUrl);
    assert.deepEqual(env.controller.state.journey.profile.createDraft, {name: '', bio: '', wishlistUrl: ''});
    assert.equal(nodeById(env.tree, 'hh-profile-create-form'), null, 'successful creation replaces the form');
    assertCredentialsNotPersisted(env, [password]);
  }
});

for (const action of ['create', 'edit']) {
  for (const [label, invalidUrl] of [['unsupported', 'https://example.invalid/wishlist'], ['overlength', 'https://www.amazon.com/hz/wishlist/ls/DEMO-' + 'A'.repeat(513)]]) test(`profile ${action} rejects ${label} wishlist before mutation and retains draft`, async () => {
    const {controller, runtime} = await registeredProfileSetup();
    if (action === 'edit') {
      assert.equal((await controller.dispatch('public:profile-create', {name: 'Saved name', wishlistUrl: ''})).ok, true);
      await controller.dispatch('public:edit-profile');
    }
    const draftKey = action === 'create' ? 'createDraft' : 'editDraft';
    controller.updateDraft('name', 'Typed name');
    controller.updateDraft('bio', 'Typed introduction');
    controller.updateDraft('wishlistUrl', invalidUrl);
    const retainedWishlistDraft = controller.state.journey.profile[draftKey].wishlistUrl;
    const beforeProfile = structuredClone(controller.state.journey.profile);
    const beforeRuntime = runtime.snapshot(), beforeParts = runtime.pxc.entries().length;
    const result = await controller.dispatch(`public:profile-${action}`, {wishlistUrl: invalidUrl});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'validation_failed');
    assert.match(result.error.message, /synthetic.*DEMO/i);
    assert.deepEqual(runtime.snapshot(), beforeRuntime);
    assert.equal(runtime.pxc.entries().length, beforeParts, 'invalid URL must not invoke a provider operation');
    assert.deepEqual(controller.state.journey.profile, beforeProfile, 'profile, open form and draft remain intact');
    assert.equal(controller.state.journey.profile[draftKey].wishlistUrl, retainedWishlistDraft);
    assert.equal(controller.state.journey.outcome.kind, 'validation-error');
  });
  for (const wishlistUrl of ['', 'https://www.amazon.com/hz/wishlist/ls/DEMO-CLASSROOM']) {
    test(`profile ${action} preserves ${wishlistUrl ? 'valid synthetic' : 'blank'} wishlist compatibility`, async () => {
      const {controller, runtime} = await registeredProfileSetup();
      if (action === 'edit') assert.equal((await controller.dispatch('public:profile-create', {name: 'Saved name', wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-SAVED'})).ok, true);
      const existing = controller.state.journey.profile.value?.wishlistUrl;
      assert.equal((await controller.dispatch(`public:profile-${action}`, {name: 'Typed name', wishlistUrl})).ok, true);
      assert.equal(controller.state.journey.profile.value.wishlistUrl, wishlistUrl || existing || 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW');
      assert.equal(runtime.snapshot().ownProfile.profile.wishlistUrl, 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW', 'provider retains synthetic fixture data');
    });
  }
}

function deferredRuntime(portToDelay) {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  let pending = null;
  const runtime = {
    ready: base.ready,
    pxc: base.pxc,
    snapshot: () => base.snapshot(),
    inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; },
    get fixture() { return base.fixture; },
    invoke(port, input, boundary) {
      if (port === portToDelay && !pending) return new Promise(resolve => {
        pending = () => base.invoke(port, input, boundary).then(resolve);
      });
      return base.invoke(port, input, boundary);
    },
  };
  return {runtime, release: async () => { const resolve = pending; pending = null; assert.ok(resolve, 'expected deferred service call'); await resolve(); }};
}

test('normalizes captured public route aliases and forum paths', () => {
  assert.equal(normalizePublicRoute('#/').page, 'home');
  assert.equal(normalizePublicRoute('#/forgot-password').page, 'forgot');
  assert.equal(normalizePublicRoute('#/find-teachers').page, 'directory');
  assert.equal(normalizePublicRoute('#/public-profile/demo-avery').profileId, 'demo-avery');
  assert.equal(normalizePublicRoute('#/pages/homepage.html').page, 'home');
  assert.equal(normalizePublicRoute('#/pages/index.html').page, 'directory');
  assert.equal(normalizePublicRoute('#/pages/find_teachers.html').page, 'directory');
  assert.equal(normalizePublicRoute('#/pages/teacher.html').profileId, 'reference-sarah');
  assert.equal(normalizePublicRoute('#/pages/teacher.html?id=demo-avery').profileId, 'demo-avery');
  assert.deepEqual(normalizePublicRoute('#/pages/create_post.html').communityRoute, {page: 'create-post'});
  assert.deepEqual(normalizePublicRoute('#/pages/post.html?publicid=abc').communityRoute, {page: 'post', threadId: 'abc'});
  assert.equal(normalizePublicRoute('#/pages/unknown.html').page, 'not-found');
  assert.deepEqual(normalizePublicRoute('#/forum').communityRoute, {page: 'forum'});
  assert.deepEqual(normalizePublicRoute('#/create-post').communityRoute, {page: 'create-post'});
  assert.deepEqual(normalizePublicRoute('#/posts/topic-local-1').communityRoute,
    {page: 'post', threadId: 'topic-local-1'});
});

test('captured Teacher of the Day opens as a read-only snapshot without invoking teacher services', async () => {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const calls = [];
  const runtime = {
    ready: base.ready,
    snapshot: () => base.snapshot(),
    inspect: () => base.inspect(),
    pxc: base.pxc,
    invoke(port, input, boundary) { calls.push(port); return base.invoke(port, input, boundary); },
  };
  const controller = createPublicController({runtime, storage});
  await controller.initialize('#/');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  calls.length = 0;
  const before = runtime.snapshot();
  const opened = await controller.navigate('#/pages/teacher.html');
  assert.equal(opened.ok, true);
  assert.equal(controller.route.profileId, 'reference-sarah');
  assert.equal(controller.state.journey.profile.source, 'captured-readonly');
  assert.equal(controller.state.journey.profile.value.name, 'Sarah Endsley');
  assert.equal(controller.state.journey.profile.value.school.school, 'Rochester Primary School');
  assert.equal(controller.state.journey.profile.value.school.county, 'Thurston County');
  assert.equal(controller.state.journey.profile.value.school.state, 'Washington');
  assert.ok(controller.state.journey.profile.value.provenance.profilePage.endsWith('/pages/teacher.html'));
  assert.deepEqual(calls, [], 'the captured reference route does not call the fixture provider');
  assert.deepEqual(runtime.snapshot(), before, 'captured display does not change provider state');
  assert.equal((await controller.dispatch('public:edit-profile')).error.code, 'read_only_reference');
  const edit = await controller.dispatch('public:profile-edit', {name: 'An unauthorized replacement', bio: 'forged', wishlistUrl: ''});
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'read_only_reference');
  assert.equal(controller.state.journey.profile.value.name, 'Sarah Endsley');
  assert.deepEqual(runtime.snapshot(), before, 'a logged-in demo account still cannot mutate captured reference data');
});

test('profile edit toggle rejects another authenticated teacher profile', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/public-profile/demo-jordan');

  const runtimeBefore = runtime.snapshot();
  const profileBefore = structuredClone(controller.state.journey.profile.value);
  assert.equal(runtimeBefore.session.teacherId, 'demo-seed-avery');
  assert.equal(profileBefore.teacherId, 'demo-seed-jordan');

  const result = await controller.dispatch('public:edit-profile');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'profile_owner_mismatch');
  assert.equal(controller.state.journey.profile.editOpen, false);
  assert.deepEqual(controller.state.journey.profile.value, profileBefore);
  await controller.navigate('#/public-profile/demo-jordan');
  assert.equal(controller.state.journey.profile.value.name, profileBefore.displayName);
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('profile edit submit rejects another authenticated teacher profile without creating an overlay', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/public-profile/demo-jordan');

  const runtimeBefore = runtime.snapshot();
  const profileBefore = structuredClone(controller.state.journey.profile.value);
  assert.equal(runtimeBefore.session.teacherId, 'demo-seed-avery');
  assert.equal(profileBefore.teacherId, 'demo-seed-jordan');

  const result = await controller.dispatch('public:profile-edit', {name: 'Demo Jordan changed by Avery', bio: 'Unauthorized local overlay'});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'profile_owner_mismatch');
  assert.deepEqual(controller.state.journey.profile.value, profileBefore);
  await controller.navigate('#/public-profile/demo-jordan');
  assert.equal(controller.state.journey.profile.value.name, profileBefore.displayName);
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('profile edit toggle fails closed for anonymous and missing teacher identities', async () => {
  const anonymous = setup();
  await anonymous.controller.initialize('#/public-profile/demo-jordan');
  const anonymousResult = await anonymous.controller.dispatch('public:edit-profile');
  assert.equal(anonymousResult.ok, false);
  assert.equal(anonymousResult.error.code, 'authentication_required');
  assert.equal(anonymous.controller.state.journey.profile.editOpen, false);

  const missingIdentity = setup();
  await missingIdentity.controller.initialize('#/login');
  assert.equal((await missingIdentity.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await missingIdentity.controller.navigate('#/public-profile/demo-avery');
  missingIdentity.controller.state.journey.session.teacherId = '';
  const missingIdentityResult = await missingIdentity.controller.dispatch('public:edit-profile');
  assert.equal(missingIdentityResult.ok, false);
  assert.equal(missingIdentityResult.error.code, 'profile_owner_mismatch');
  assert.equal(missingIdentity.controller.state.journey.profile.editOpen, false);
});

test('profile edit remains available to its owner through a public profile alias', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.session.teacherId, 'demo-seed-avery');
  assert.equal(controller.state.journey.profile.value.teacherId, 'demo-seed-avery');
  const runtimeBefore = runtime.snapshot();

  const result = await controller.dispatch('public:profile-edit', {name: 'Demo Avery public alias edit'});

  assert.equal(result.ok, true);
  assert.equal(result.localOnly, true);
  assert.equal(controller.state.journey.profile.value.name, 'Demo Avery public alias edit');
  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.profile.value.name, 'Demo Avery public alias edit');
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('cascades school filters, loads local directory matches and restores remembered filters', async () => {
  const {controller} = setup();
  await controller.initialize('#/');
  assert.equal(controller.state.route.page, 'home');
  await controller.navigate('#/find-teachers');
  assert.equal(controller.state.journey.searchPerformed, false, 'route loading is not a submitted search');
  await controller.selectSchool('state', 'Demo Washington');
  await controller.selectSchool('county', 'Demo King');
  await controller.selectSchool('district', 'Demo District');
  await controller.selectSchool('school', 'Demo Academy');
  assert.equal(controller.state.journey.searchPerformed, false, 'filter selection alone is not a submitted search');
  assert.deepEqual(controller.state.journey.lookups.schools, ['Demo Academy', 'Demo STEM School']);
  const result = await controller.dispatch('public:directory-search', {query: 'avery'});
  assert.equal(result.ok, true);
  assert.equal(controller.state.journey.searchPerformed, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
  assert.ok(controller.state.journey.matches.items.some(item => item.id === 'demo-avery'));
  await controller.dispatch('public:directory-search', {query: 'no match'});
  assert.equal(controller.state.journey.searchPerformed, true, 'an explicit empty-result search still counts as a search');
  assert.equal(controller.state.journey.matches.items.length, 0);
  await controller.dispatch('public:directory-restore');
  assert.equal(controller.state.journey.filters.query, 'no match');
  assert.equal(controller.state.journey.matches.items.length, 0);
  await controller.selectSchool('state', '');
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  assert.deepEqual(controller.state.journey.lookups.districts, []);
  assert.deepEqual(controller.state.journey.lookups.schools, []);
});

test('school lookup retry stays bound to the failed current selection', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  assert.equal(controller.canRetry, true);
  assert.match(controller.state.journey.lookupError, /school-data failure/);

  const cleared = await controller.selectSchool('state', '');
  assert.equal(cleared.ok, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, false, 'a retry for an invalidated selection must be unavailable');
  assert.equal(controller.state.journey.school.state, '');
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  assert.equal(controller.canRetry, false);
});

test('school lookup retry recovers the same current selection', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('navigating away invalidates a failed registration school lookup retry', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  await controller.selectSchool('state', 'Demo Washington');
  assert.equal(controller.canRetry, true);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.equal(controller.canRetry, false);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.state.journey.outcome, null);
});

test('initial school choices remain retryable when the states read fails', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/register');
  assert.equal(controller.state.journey.lookupError, 'Simulated local school-data failure; no state changed.');
  assert.equal(controller.canRetry, true);
  assert.equal(controller.state.journey.lookupRetryable, true);
  const retry = await controller.dispatch('public:retry');
  assert.equal(retry.ok, true);
  assert.deepEqual(controller.state.journey.lookups.states, ['Demo California', 'Demo Washington']);
});

test('returning to registration reloads states after an invalidated initial lookup failure', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/register');
  assert.deepEqual(controller.state.journey.lookups.states, []);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.deepEqual(controller.state.journey.lookups.states, ['Demo California', 'Demo Washington']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('successful initial school-data read does not erase a directory retry', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/directory');
  assert.equal(controller.state.journey.matches.status, 'error');
  assert.equal(controller.canRetry, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
});

test('returning to registration reloads a failed county cascade', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  await controller.selectSchool('state', 'Demo Washington');
  assert.equal(controller.state.journey.lookupRetryable, true);
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('school lookup retry remains available from directory when no directory retry owns it', async () => {
  const {controller} = setup();
  await controller.initialize('#/directory');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  assert.equal(controller.canRetry, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
});

test('distinguishes an explicit empty-filter search from the initial background directory load', async () => {
  const {controller} = setup();
  await controller.initialize('#/find-teachers');
  assert.equal(controller.state.journey.matches.status, 'loaded', 'the background read remains intact');
  assert.equal(controller.state.journey.searchPerformed, false);
  assert.deepEqual(controller.state.journey.school, {state: '', county: '', district: '', school: '', grade: ''});

  const submitted = await controller.dispatch('public:directory-search', {query: ''});
  assert.equal(submitted.ok, true);
  assert.equal(controller.state.journey.searchPerformed, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
});

test('leaving a pending directory read for login or registration retires shared loading', async () => {
  for (const target of ['login', 'register']) {
    const {controller} = setup();
    await controller.initialize('#/');
    const directory = controller.navigate('#/directory');
    assert.equal(controller.state.journey.loading, true);
    const destination = controller.navigate(`#/${target}`);
    await Promise.all([directory, destination]);
    assert.equal(controller.route.page, target);
    assert.equal(controller.state.journey.loading, false, `${target} must not inherit the abandoned directory loading flag`);
  }
});

test('an abandoned directory completion cannot clear a newer pending school lookup', async () => {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  let holdStates = false;
  let finishStates = null;
  const runtime = {
    ready: base.ready,
    pxc: base.pxc,
    snapshot: () => base.snapshot(),
    inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; },
    get fixture() { return base.fixture; },
    invoke(port, input, boundary) {
      if (holdStates && port === 'SchoolData.getStates' && !finishStates) {
        return new Promise(resolve => {
          finishStates = () => base.invoke(port, input, boundary).then(resolve);
        });
      }
      return base.invoke(port, input, boundary);
    },
  };
  const controller = createPublicController({runtime, storage});
  await controller.initialize('#/');
  controller.state.journey.lookups.states = [];
  holdStates = true;
  const directory = controller.navigate('#/directory');
  assert.equal(controller.state.journey.loading, true);
  const registration = controller.navigate('#/register');
  await directory;
  assert.equal(controller.route.page, 'register');
  assert.equal(typeof finishStates, 'function', 'registration started its own delayed school-state read');
  assert.equal(controller.state.journey.loading, true, 'the current lookup still owns the loading state');
  finishStates();
  await registration;
  assert.equal(controller.state.journey.loading, false, 'the lookup completion clears its own loading state');
  assert.deepEqual(controller.state.journey.lookups.states, ['Demo California', 'Demo Washington']);
});

test('bounded text drafts keep spaces while typing and normalize only on submit', async () => {
  const {controller} = setup();
  const typeIntoDraft = (name, value, read) => {
    let typed = '';
    for (const character of value) {
      typed += character;
      assert.equal(controller.updateDraft(name, typed), true);
      assert.equal(read(), typed, `draft ${name} should preserve ${JSON.stringify(typed)}`);
    }
  };

  await controller.initialize('#/find-teachers');
  typeIntoDraft('query', 'A certainly nonexistent classroom ', () => controller.state.journey.filters.query);
  await controller.dispatch('public:directory-search', {query: controller.state.journey.filters.query});
  assert.equal(controller.state.journey.filters.query, 'A certainly nonexistent classroom');

  await controller.navigate('#/contact');
  typeIntoDraft('subject', 'A local question ', () => controller.state.journey.contact.subject);
  typeIntoDraft('message', 'A note with spaces ', () => controller.state.journey.contact.message);
  await controller.dispatch('public:contact', {
    name: 'Guest', email: 'guest@example.org', subject: controller.state.journey.contact.subject,
    message: controller.state.journey.contact.message,
  });
  assert.equal(controller.state.journey.contact.subject, 'A local question');
  assert.equal(controller.state.journey.contact.message, 'A note with spaces');

  await controller.navigate('#/register');
  typeIntoDraft('name', 'Jamie Example ', () => controller.state.journey.registration.identity.name);
});

test('rejects stored school selections whose individual values do not form one fixture row', async () => {
  const contradictory = {version: 1, school: {
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Bay School', grade: '',
  }, query: 'avery', sort: 'date-newest'};
  const storage = memoryStorage({'hh-public-directory-filters.v1': JSON.stringify(contradictory)});
  const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const controller = createPublicController({runtime, storage});
  await controller.initialize('#/');
  assert.equal(storage.getItem('hh-public-directory-filters.v1'), null);
  assert.equal(controller.state.journey.rememberedFilters, null);
  assert.equal(controller.state.journey.outcome.kind, 'local-warning');
});

test('registration mismatch validation retains delegated non-secret drafts and selected school', async () => {
  const env = registrationDraftSetup();
  const identity = {name: 'Jamie Example', email: 'jamie.mismatch@example.test', phone: '312-555-0198'};
  await prepareRegistrationDraft(env, identity);
  await env.controller.dispatch('public:terms-consent', {accepted: true});

  const password = randomUUID();
  let confirmation = randomUUID();
  while (confirmation === password) confirmation = randomUUID();
  const receiptsBefore = env.runtime.inspect().receipts.length;
  const result = await env.controller.dispatch('public:register', {
    ...identity, password, confirmPassword: confirmation, termsAccepted: true,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  });

  assert.equal(result.error?.code, 'validation_failed');
  assertRegistrationDraftRendered(env.tree, identity);
  assert.equal(env.runtime.inspect().receipts.length, receiptsBefore);
  assert.equal(env.runtime.snapshot().registration.status, 'none');
  assertCredentialsNotPersisted(env, [password, confirmation]);
});

test('registration missing-terms validation retains delegated non-secret drafts and selected school', async () => {
  const env = registrationDraftSetup();
  const identity = {name: 'Jamie Example', email: 'jamie.terms@example.test', phone: '312-555-0198'};
  await prepareRegistrationDraft(env, identity);

  const password = randomUUID();
  const receiptsBefore = env.runtime.inspect().receipts.length;
  const result = await env.controller.dispatch('public:register', {
    ...identity, password, confirmPassword: password,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  });

  assert.equal(result.error?.code, 'validation_failed');
  assertRegistrationDraftRendered(env.tree, identity);
  assert.equal(env.runtime.inspect().receipts.length, receiptsBefore);
  assert.equal(env.runtime.snapshot().registration.status, 'none');
  assertCredentialsNotPersisted(env, [password]);
});

test('registration transport failure retains the live draft and only permits explicit resubmission', async () => {
  const env = registrationFailureSetup({failCalls: {1: 'transport_failure'}, pauseCall: 1});
  const submitted = {name: 'E1403 Submitted', email: 'e1403.submitted@example.test', phone: '312-555-0140'};
  await prepareRegistrationDraft(env, submitted);
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  const password = randomUUID();
  const attempt = env.controller.dispatch('public:register', {...submitted, password, confirmPassword: password,
    termsAccepted: true, state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});
  await env.started;
  const liveDraft = {name: 'E1403 Edited While Pending', email: 'e1403.edited@example.test', phone: '312-555-0141'};
  for (const [key, value] of Object.entries(liveDraft)) assert.equal(env.controller.updateDraft(key, value), true);
  env.release();
  const failed = await attempt;

  assert.equal(failed.error?.code, 'transport_failure');
  assert.equal(failed.error?.outcomeKnown, true);
  assert.equal(env.controller.route.page, 'register');
  assert.equal(env.controller.state.request.status, 'failed');
  assertRegistrationDraftRendered(env.tree, liveDraft);
  assert.equal(env.controller.state.journey.registration.identity.email, liveDraft.email);
  assert.equal(env.controller.state.journey.terms.accepted, true);
  assert.equal(env.runtime.snapshot().registration.status, 'none');
  assert.equal(env.runtime.snapshot().session.status, 'anonymous');
  assert.equal(env.controller.canRetry, false);
  assert.equal(env.registrationCalls, 1);
  assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
  assert.equal(env.registrationCalls, 1, 'safe retry must not issue another registration write');
  assertCredentialsNotPersisted(env, [password]);

  const freshPassword = randomUUID();
  const resubmitted = await env.controller.dispatch('public:register', {...liveDraft, password: freshPassword,
    confirmPassword: freshPassword, termsAccepted: true,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});
  assert.equal(resubmitted.ok, true);
  assert.equal(env.registrationCalls, 2);
  assert.equal(env.runtime.snapshot().registration.status, 'pending');
  assert.equal(env.controller.state.journey.registration.identity.email, liveDraft.email);
  assertCredentialsNotPersisted(env, [password, freshPassword]);
});

test('registration unknown outcome retains the live draft and has no safe automatic retry', async () => {
  const env = registrationFailureSetup({failCalls: {1: 'outcome_unknown'}});
  const identity = {name: 'E1403 Unknown', email: 'e1403.unknown@example.test', phone: '312-555-0142'};
  await prepareRegistrationDraft(env, identity);
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  const password = randomUUID();
  const failed = await env.controller.dispatch('public:register', {...identity, password, confirmPassword: password,
    termsAccepted: true, state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});

  assert.equal(failed.error?.code, 'outcome_unknown');
  assert.equal(failed.error?.outcomeKnown, false);
  assert.equal(env.controller.state.request.status, 'outcome_unknown');
  assertRegistrationDraftRendered(env.tree, identity);
  assert.equal(env.controller.state.journey.registration.identity.email, identity.email);
  assert.equal(env.runtime.snapshot().registration.status, 'none');
  assert.equal(env.controller.canRetry, false);
  assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
  assert.equal(env.registrationCalls, 1, 'unknown outcome must not be automatically retried');
  assertCredentialsNotPersisted(env, [password]);
});

test('registration retains the current draft after navigation away and back on failed writes', async () => {
  for (const failure of ['transport_failure', 'outcome_unknown']) {
    const env = registrationFailureSetup({failCalls: {1: failure}, pauseCall: 1});
    const submitted = {name: `E1405 Submitted ${failure}`, email: `e1405.submitted-${failure}@example.test`, phone: '312-555-0145'};
    const liveDraft = {name: `E1405 Current ${failure}`, email: `e1405.current-${failure}@example.test`, phone: '312-555-0146'};
    await prepareRegistrationDraft(env, submitted);
    await env.controller.dispatch('public:terms-consent', {accepted: true});
    const password = randomUUID();
    const attempt = env.controller.dispatch('public:register', {...submitted, password, confirmPassword: password,
      termsAccepted: true, state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});
    await env.started;
    await env.controller.navigate('#/about');
    await env.controller.navigate('#/register');
    for (const [key, value] of Object.entries(liveDraft)) assert.equal(env.controller.updateDraft(key, value), true);
    env.release();
    const failed = await attempt;

    assert.equal(failed.error?.code, failure);
    assert.equal(env.controller.route.page, 'register');
    assertRegistrationDraftRendered(env.tree, liveDraft);
    assert.equal(env.controller.state.journey.registration.identity.email, liveDraft.email);
    assert.equal(env.runtime.snapshot().registration.status, 'none');
    assert.equal(env.controller.canRetry, false);
    assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
    assert.equal(env.registrationCalls, 1, 'failure must not issue an automatic registration retry');
    assertCredentialsNotPersisted(env, [password]);
  }
});

test('held registration completion on login preserves transaction classification without replay', async () => {
  const cases = [
    {name: 'known transport failure', failWith: 'transport_failure', requestStatus: 'failed'},
    {name: 'unknown outcome', failWith: 'outcome_unknown', requestStatus: 'outcome_unknown'},
    {name: 'successful pending registration', failWith: null, requestStatus: 'completed'},
  ];

  for (const scenario of cases) {
    const env = registrationFailureSetup({
      failCalls: scenario.failWith ? {1: scenario.failWith} : {},
      pauseCall: 1,
    });
    const identity = {
      name: 'HH11 Volatile Teacher',
      email: `hh11-${randomUUID()}@example.test`,
      phone: '555-0101',
    };
    const password = randomUUID();
    await prepareRegistrationDraft(env, identity);
    await env.controller.dispatch('public:terms-consent', {accepted: true});

    const attempt = env.controller.dispatch('public:register', {
      ...identity,
      password,
      confirmPassword: password,
      termsAccepted: true,
      state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
    });
    await env.started;
    assert.equal(env.registrationCalls, 1, `${scenario.name}: one registration call is held`);
    assert.equal(env.controller.route.page, 'register');

    await env.controller.navigate('#/login');
    const loginFormWhileHeld = nodeById(env.tree, 'hh-login-form');
    const loginSubmitWhileHeld = nodeById(env.tree, 'hh-login-submit');
    assert.equal(env.tree.attrs['data-public-page'], 'login');
    assert.ok(loginFormWhileHeld, `${scenario.name}: login form is rendered before release`);
    assert.ok(loginSubmitWhileHeld, `${scenario.name}: login submit is rendered before release`);
    assert.notEqual(loginSubmitWhileHeld.attrs.disabled, true, `${scenario.name}: login submit is enabled before release`);

    env.release();
    const result = await attempt;
    const loginFormAfterCompletion = nodeById(env.tree, 'hh-login-form');
    const loginSubmitAfterCompletion = nodeById(env.tree, 'hh-login-submit');
    const completion = {
      route: env.controller.route.page,
      renderedPage: env.tree.attrs['data-public-page'],
      loginFormPresent: !!loginFormAfterCompletion,
      loginSubmitEnabled: !!loginSubmitAfterCompletion && loginSubmitAfterCompletion.attrs.disabled !== true,
      requestStatus: env.controller.state.request.status,
      resultOk: result.ok,
      resultCode: result.error?.code || null,
      outcomeKnown: result.error?.outcomeKnown ?? null,
      providerRegistrationStatus: env.runtime.snapshot().registration.status,
      registrationCalls: env.registrationCalls,
      retryAvailable: env.controller.canRetry,
    };

    assert.equal(completion.route, 'login', `${scenario.name}: route remains on login`);
    assert.equal(completion.renderedPage, 'login', `${scenario.name}: rendered page remains login`);
    assert.equal(completion.loginFormPresent, true, `${scenario.name}: login form remains rendered`);
    assert.equal(completion.loginSubmitEnabled, true, `${scenario.name}: login submit remains enabled`);
    assert.equal(completion.requestStatus, scenario.requestStatus);
    assert.equal(completion.registrationCalls, 1, `${scenario.name}: completion caused no second registration call`);

    if (scenario.failWith === 'transport_failure') {
      assert.equal(completion.resultOk, false);
      assert.equal(completion.resultCode, 'transport_failure');
      assert.equal(completion.outcomeKnown, true);
      assert.equal(completion.providerRegistrationStatus, 'none');
      assert.equal(completion.retryAvailable, false);
      assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
      assert.equal(env.registrationCalls, 1, 'known registration failure is not safely retried');
    } else if (scenario.failWith === 'outcome_unknown') {
      assert.equal(completion.resultOk, false);
      assert.equal(completion.resultCode, 'outcome_unknown');
      assert.equal(completion.outcomeKnown, false);
      assert.equal(completion.providerRegistrationStatus, 'none');
      assert.equal(completion.retryAvailable, false);
      assert.equal((await env.controller.dispatch('public:retry')).error?.code, 'nothing_to_retry');
      assert.equal(env.registrationCalls, 1, 'unknown registration outcome is not retried');
    } else {
      assert.equal(completion.resultOk, true);
      assert.equal(result.outcome, 'pending_saved');
      assert.equal(completion.providerRegistrationStatus, 'pending');
      assert.equal(completion.retryAvailable, false);
    }

    const retained = [
      JSON.stringify(env.controller.state),
      JSON.stringify(env.runtime.snapshot()),
      JSON.stringify(env.runtime.inspect()),
      JSON.stringify(env.runtime.pxc.entries().map(([address, part]) => ({address, value: part.value}))),
      [...env.storage.values.values()].join('\n'),
      JSON.stringify(env.tree),
    ].join('\n');
    assert.equal(retained.includes(password), false, `${scenario.name}: password is absent from retained surfaces`);

    // Preserve the completion-phase snapshot above before exercising the independent login validation path.
    const registrationCallsBeforeLoginValidation = env.registrationCalls;
    const invalidLogin = await env.controller.dispatch('public:login', {email: 'invalid', password: ''});
    assert.equal(invalidLogin.error?.code, 'validation_failed');
    assert.equal(env.controller.route.page, 'login');
    assert.ok(nodeById(env.tree, 'hh-login-form'), 'login form remains available after local validation');
    assert.notEqual(nodeById(env.tree, 'hh-login-submit')?.attrs.disabled, true);
    assert.equal(env.registrationCalls, registrationCallsBeforeLoginValidation, 'login validation caused no registration write');
    assert.equal(env.registrationCalls, 1);

    const retainedAfterLoginValidation = [
      JSON.stringify(env.controller.state),
      JSON.stringify(env.runtime.snapshot()),
      JSON.stringify(env.runtime.inspect()),
      JSON.stringify(env.runtime.pxc.entries().map(([address, part]) => ({address, value: part.value}))),
      [...env.storage.values.values()].join('\n'),
      JSON.stringify(env.tree),
    ].join('\n');
    assert.equal(retainedAfterLoginValidation.includes(password), false, `${scenario.name}: password remains absent after login validation`);
  }
});

test('failed re-registration preserves the approved synthetic alias for login', async () => {
  const env = registrationFailureSetup({failCalls: {2: 'transport_failure'}});
  const identity = {name: 'E1403 Approved Alias', email: 'e1403.alias@example.test', phone: '312-555-0143'};
  await prepareRegistrationDraft(env, identity);
  await env.controller.dispatch('public:terms-consent', {accepted: true});
  const firstPassword = randomUUID();
  const registered = await env.controller.dispatch('public:register', {...identity, password: firstPassword,
    confirmPassword: firstPassword, termsAccepted: true,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});
  assert.equal(registered.ok, true);
  assert.equal(env.registrationCalls, 1);
  assert.equal((await env.controller.dispatch('public:approve')).ok, true);
  assert.equal(env.runtime.snapshot().registration.status, 'approved');

  const secondPassword = randomUUID();
  const failedReregistration = await env.controller.dispatch('public:register', {...identity,
    password: secondPassword, confirmPassword: secondPassword, termsAccepted: true,
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'});
  assert.equal(failedReregistration.error?.code, 'transport_failure');
  assert.equal(env.runtime.snapshot().registration.status, 'approved');
  assert.equal(env.registrationCalls, 2);

  const login = await env.controller.dispatch('public:login', {email: identity.email, password: secondPassword});
  assert.equal(login.ok, true);
  assert.equal(env.loginAliasIndex, 1, 'failed re-registration must not replace the previously approved alias');
  assert.equal(env.controller.state.journey.session.email, identity.email);
  assertCredentialsNotPersisted(env, [firstPassword, secondPassword]);
});

test('registration keeps passwords ephemeral, approval and login stay separate, and edits remain local', async () => {
  const {controller, runtime, storage} = setup();
  await controller.initialize('#/register');
  await controller.selectSchool('state', 'Demo Washington');
  await controller.selectSchool('county', 'Demo King');
  await controller.selectSchool('district', 'Demo District');
  await controller.selectSchool('school', 'Demo Academy');
  await controller.dispatch('public:accept-terms');
  const password = 'Transient-Only-Secret-71';
  const registered = await controller.dispatch('public:register', {
    name: 'Avery Sample', email: 'avery.sample@example.org', phone_number: '312-555-0117',
    password, confirm_password: password,
  });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(controller.state.journey.runtime.registration.status, 'pending');
  assert.equal(controller.state.journey.registration.identity.name, 'Avery Sample');
  assert.equal(controller.state.journey.registration.identity.email, 'avery.sample@example.org');
  assert.equal(controller.state.journey.registration.identity.phone, '312-555-0117');
  assert.equal(JSON.stringify(controller.state).includes(password), false);
  assert.equal([...storage.values.values()].join('\n').includes(password), false);
  assert.equal(JSON.stringify(runtime.inspect()).includes(password), false);
  assert.equal(JSON.stringify(runtime.pxc.entries().map(([, part]) => part.value)).includes(password), false);

  const denied = await controller.dispatch('public:login', {email: 'avery.sample@example.org', password});
  assert.equal(denied.ok, false);
  assert.equal(controller.state.journey.runtime.registration.status, 'pending');
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous');
  assert.equal((await controller.dispatch('approve')).ok, true);
  assert.equal(controller.state.journey.runtime.registration.status, 'approved');
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous');
  const loggedIn = await controller.dispatch('public:login', {email: 'avery.sample@example.org', password});
  assert.equal(loggedIn.ok, true);
  assert.equal(controller.state.journey.runtime.session.status, 'authenticated');

  const made = await controller.dispatch('public:profile-create', {
    name: 'Avery Sample', bio: 'A local classroom profile.', wishlistUrl: '',
  });
  assert.equal(made.ok, true, JSON.stringify(made));
  const savedRuntimeName = runtime.snapshot().ownProfile.profile.displayName;
  assert.match(savedRuntimeName, /^Demo /);
  await controller.dispatch('public:profile-edit', {name: 'Avery Newname', bio: 'Edited only in this view.', wishlistUrl: ''});
  assert.equal(controller.state.journey.profile.value.name, 'Avery Newname');
  assert.equal(runtime.snapshot().ownProfile.profile.displayName, savedRuntimeName);
  assert.equal(controller.state.journey.profile.source, 'local-overlay');
  await controller.dispatch('public:edit-profile');
  controller.updateDraft('name', 'Avery Draftname ');
  controller.updateDraft('bio', ' Retained through render replacement. ');
  controller.updateDraft('wishlistUrl', 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.deepEqual(controller.state.journey.profile.editDraft, {
    name: 'Avery Draftname ', bio: ' Retained through render replacement. ',
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',
  });
  await controller.dispatch('public:profile-edit', {});
  assert.equal(controller.state.journey.profile.value.name, 'Avery Draftname');
  assert.equal(controller.state.journey.profile.value.wishlistUrl, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  const profileId = controller.state.journey.profile.value.id;
  await controller.navigate(`#/teachers/${profileId}`);
  assert.equal(controller.state.journey.profile.value.name, 'Avery Draftname');
  assert.equal(controller.state.journey.profile.source, 'local-overlay');
});

test('profile edit overlay remains local to this controller and reset clears it', async () => {
  const storage = memoryStorage();
  const baseProvider = createFixtureProvider({fixture: true, storage});
  const ports = Object.keys(baseProvider.services);
  const calls = Object.fromEntries(ports.map(port => [port, 0]));
  const provider = {...baseProvider, services: Object.freeze(Object.fromEntries(ports.map(port => [port, async input => {
    calls[port] += 1;
    return baseProvider.services[port](input);
  }]))) };
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage});
  let tree = null;
  const controller = createPublicController({runtime, storage, community, onChange(state, route) {
    tree = renderPublicSite({route, state, journey: state.journey});
  }});
  const textOf = node => node == null ? '' : typeof node === 'string' ? node :
    (node.children || []).map(textOf).join(' ');
  const captureParts = selectedRuntime => selectedRuntime.pxc.entries().map(([address, part]) => ({
    address, part, value: part.value,
    serialized: address === 'hh.provider' || typeof part.value === 'function' ? null : JSON.stringify(part.value),
  }));

  await controller.initialize('#/login');
  const ephemeralPassword = randomUUID();
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: ephemeralPassword});
  assert.equal(login.ok, true);
  await controller.navigate('#/profile');
  assert.equal(controller.state.journey.profile.value.id, 'demo-avery');

  const disclosure = 'This is a locally rendered profile. Changes and sharing are not sent to the public service.';
  assert.ok(textOf(tree).includes(disclosure), 'the rendered page discloses its local-only boundary before save');
  assert.equal(runtime.capabilities.profileEdit, false);
  assert.equal(Object.keys(baseProvider.services).some(port => port === 'TeacherProfile.updateProfile'), false);

  assert.equal((await controller.dispatch('public:edit-profile')).ok, true);
  assert.equal(controller.updateDraft('name', 'E2203 Synthetic Avery'), true);
  assert.equal(controller.updateDraft('bio', 'E2203 local overlay test'), true);
  const countsBeforeSave = {...calls};
  const providerStateBeforeSave = structuredClone(baseProvider.snapshot());
  const runtimeStateBeforeSave = structuredClone(runtime.snapshot());
  const partsBeforeSave = captureParts(runtime);
  const receiptsBeforeSave = runtime.pxc.receipts();
  const storageBeforeSave = [...storage.values.entries()].sort(([a], [b]) => a.localeCompare(b));

  const saved = await controller.dispatch('public:profile-edit', {});

  assert.equal(saved.ok, true);
  assert.equal(saved.localOnly, true);
  assert.equal(controller.state.journey.outcome.kind, 'local-only');
  assert.equal(controller.state.journey.profile.value.name, 'E2203 Synthetic Avery');
  assert.match(textOf(tree), /shown in this tab only/i);
  assert.deepEqual(calls, countsBeforeSave, 'profile save must call no provider port');
  assert.deepEqual(baseProvider.snapshot(), providerStateBeforeSave, 'fixture provider state must remain unchanged');
  assert.deepEqual(runtime.snapshot(), runtimeStateBeforeSave, 'runtime snapshot must remain unchanged');
  assert.deepEqual(runtime.pxc.receipts(), receiptsBeforeSave, 'profile save must create no runtime receipt');
  assert.deepEqual([...storage.values.entries()].sort(([a], [b]) => a.localeCompare(b)), storageBeforeSave,
    'profile save must write no fixture storage');
  const partsAfterSave = captureParts(runtime);
  assert.equal(partsAfterSave.length, partsBeforeSave.length, 'profile save must add no Parts');
  for (let index = 0; index < partsBeforeSave.length; index += 1) {
    assert.equal(partsAfterSave[index].address, partsBeforeSave[index].address);
    assert.strictEqual(partsAfterSave[index].part, partsBeforeSave[index].part, 'existing Part identity must be unchanged');
    assert.strictEqual(partsAfterSave[index].value, partsBeforeSave[index].value, 'existing Part value identity must be unchanged');
    assert.equal(partsAfterSave[index].serialized, partsBeforeSave[index].serialized,
      'serializable Part value must be unchanged');
  }
  assert.equal(JSON.stringify(controller.state).includes(ephemeralPassword), false);
  assert.equal(JSON.stringify(runtime.pxc.entries().map(([, part]) => part.value)).includes(ephemeralPassword), false);
  assert.equal([...storage.values.values()].join('\n').includes(ephemeralPassword), false);

  const readsBeforeAlias = calls['TeacherProfile.openPublicProfile'];
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal(controller.state.journey.profile.value.name, 'E2203 Synthetic Avery',
    'same-controller alias read should merge its local overlay');
  assert.equal(controller.state.journey.profile.source, 'local-overlay');
  assert.equal(calls['TeacherProfile.openPublicProfile'], readsBeforeAlias + 1,
    'alias reentry should use the real fixture public-profile read');

  const freshProvider = createFixtureProvider({fixture: true, storage});
  const freshRuntime = createServiceRuntime(freshProvider);
  const freshCommunity = createCommunity({storage});
  const freshController = createPublicController({runtime: freshRuntime, storage, community: freshCommunity});
  await freshController.initialize('#/profile');
  assert.equal(freshController.state.journey.session.status, 'authenticated', 'synthetic fixture session survives in shared storage');
  assert.equal(freshController.state.journey.profile.value.name, 'Demo Avery',
    'new provider/runtime/controller must load the original fixture profile, not the old controller overlay');
  assert.equal(freshController.state.journey.profile.source, 'runtime');

  assert.equal((await controller.dispatch('public:reset')).ok, true);
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal(controller.state.journey.profile.value.name, 'Demo Avery', 'explicit fixture reset clears the overlay');
  assert.equal(controller.state.journey.profile.source, 'runtime');
});

test('Terms checkbox consent tracks both checking and unchecking without opening the modal', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:terms-consent', {accepted: true});
  assert.deepEqual(controller.state.journey.terms, {open: false, accepted: true});
  await controller.dispatch('public:terms-consent', {accepted: false});
  assert.deepEqual(controller.state.journey.terms, {open: false, accepted: false});
  await controller.navigate('#/pages/terms_conditions.html');
  assert.equal(controller.state.journey.terms.open, true);
  await controller.navigate('#/about');
  assert.equal(controller.state.journey.terms.open, false);
});

test('seeded UI login, local contact and reset never claim remote effects', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'entered-but-not-verified'});
  assert.equal(login.ok, true);
  assert.equal(runtime.snapshot().session.status, 'authenticated');
  assert.equal(controller.state.journey.outcome.kind, 'local-simulation');
  const contact = await controller.dispatch('public:contact', {name: 'Guest', email: 'guest@example.org', subject: 'A local question', message: 'A'.repeat(250)});
  assert.equal(contact.ok, true);
  assert.equal(controller.state.journey.outcome.kind, 'local-simulation');
  const tooLong = await controller.dispatch('public:contact', {name: 'Guest', email: 'guest@example.org', subject: 'A local question', message: 'A'.repeat(251)});
  assert.equal(tooLong.ok, false);
  assert.equal((await controller.dispatch('public:forgot', {email: 'avery@fixture.test'})).ok, true);
  assert.equal(controller.state.journey.outcome.remote, false);
  await controller.navigate('#/find-teachers');
  await controller.dispatch('public:directory-search', {query: 'avery'});
  assert.equal(controller.state.journey.searchPerformed, true);
  await controller.dispatch('reset');
  assert.equal(runtime.snapshot().session.status, 'anonymous');
  assert.equal(controller.state.journey.registration.status, 'none');
  assert.equal(controller.state.journey.searchPerformed, false);
});

test('wishlist and community actions are explicit local preview handoffs', async () => {
  const {controller, community} = setup();
  await controller.initialize('#/');
  await controller.dispatch('public:wishlist');
  assert.equal(controller.state.journey.wishlist.intent, true);
  assert.equal(controller.state.journey.wishlist.remote, false);
  await controller.dispatch('community:role', {role: 'teacher'});
  const created = await controller.dispatch('forum-topic', {title: 'Local topic', content: 'Only in preview.', category: 'Questions'});
  assert.equal(created.ok, true);
  assert.ok(community.snapshot().threads.some(thread => thread.id === created.value.id));
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous', 'forum role does not create an HH login');
  await controller.navigate(`#/posts/${created.value.id}`);
  assert.deepEqual(controller.state.route.communityRoute, {page: 'post', threadId: created.value.id});
});

test('rejected author post edit retains rendered fields and corrected explicit save commits once', async () => {
  const env = communityDraftSetup();
  let forumWrites = 0;
  const setItem = env.storage.setItem.bind(env.storage);
  env.storage.setItem = (key, value) => { if (key === 'hh-forum-v1') forumWrites += 1; setItem(key, value); };
  await env.controller.initialize('#/create-post');
  await env.controller.dispatch('forum-role', {role: 'teacher'});
  const created = env.community.createThread({title: 'E2903 original', body: 'Original persisted body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  assert.equal(created.ok, true);
  const postId = created.value.id;
  await env.controller.navigate(`#/posts/${postId}`);
  const beforeStorage = env.storage.getItem('hh-forum-v1');
  const beforeReceipts = env.runtime.inspect().receipts.length;
  const beforeThreadCount = env.community.snapshot().threads.length;
  const changedBody = 'Meaningful changed body survives the rejected title.';

  await env.controller.dispatch('forum-edit-post', {postId, threadId: postId});
  assert.ok(postEditFields(env.tree), 'the author has an edit form');
  const rejected = await env.controller.dispatch('forum-edit-post', {postId, threadId: postId, title: '   ', content: changedBody});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'title_and_body_required');
  assert.deepEqual(postEditFields(env.tree), {postId, title: '   ', content: changedBody});
  assert.deepEqual(env.controller.state.community.postEditDraft, {postId, title: '   ', content: changedBody});
  assert.equal(env.storage.getItem('hh-forum-v1'), beforeStorage, 'rejected edit leaves forum storage unchanged');
  assert.equal(env.runtime.inspect().receipts.length, beforeReceipts, 'post editing does not invoke HH account services');
  assert.equal(env.community.snapshot().threads.length, beforeThreadCount);
  assert.equal(env.community.getThread(postId, {role: 'teacher'}).body, 'Original persisted body.');

  const writesBeforeCorrection = forumWrites;
  const corrected = await env.controller.dispatch('forum-edit-post', {postId, threadId: postId, title: 'E2903 corrected', content: changedBody});
  assert.equal(corrected.ok, true);
  assert.equal(env.controller.state.community.postEditDraft, null);
  assert.equal(postEditFields(env.tree), null);
  const saved = env.community.snapshot().threads.filter(thread => thread.id === postId);
  assert.equal(saved.length, 1, 'the explicit corrected save updates the original post without creating another topic');
  assert.equal(saved[0].title, 'E2903 corrected');
  assert.equal(saved[0].body, changedBody);
  assert.equal(forumWrites, writesBeforeCorrection + 1, 'one corrected submit persists exactly once');
  assert.equal(env.runtime.inspect().receipts.length, beforeReceipts);
});

test('cancelled author post edit discards its draft and restores persisted fields on reopen', async () => {
  const env = communityDraftSetup();
  await env.controller.initialize('#/create-post');
  await env.controller.dispatch('forum-role', {role: 'teacher'});
  const created = env.community.createThread({title: 'E2903 cancel', body: 'Saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  const postId = created.value.id;
  await env.controller.navigate(`#/posts/${postId}`);
  const beforeStorage = env.storage.getItem('hh-forum-v1');
  await env.controller.dispatch('forum-edit-post', {postId, threadId: postId});
  const rejected = await env.controller.dispatch('forum-edit-post', {postId, threadId: postId, title: '   ', content: 'Uncommitted replacement body.'});
  assert.equal(rejected.error, 'title_and_body_required');
  assert.deepEqual(postEditFields(env.tree), {postId, title: '   ', content: 'Uncommitted replacement body.'});

  await env.controller.dispatch('forum-cancel-edit', {postId, threadId: postId});
  assert.equal(env.controller.state.community.postEditDraft, null);
  assert.equal(env.controller.state.community.editingPostId, null);
  assert.equal(postEditFields(env.tree), null);
  assert.equal(env.community.getThread(postId, {role: 'teacher'}).body, 'Saved body.');
  assert.equal(env.storage.getItem('hh-forum-v1'), beforeStorage, 'cancel does not persist draft text');
  await env.controller.dispatch('forum-edit-post', {postId, threadId: postId});
  assert.deepEqual(postEditFields(env.tree), {postId, title: 'E2903 cancel', content: 'Saved body.'});
});

test('post edit draft is thread-bound and cleared on role exit, forum reset, logout, and app reset', async () => {
  const env = communityDraftSetup();
  assert.equal((await env.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);
  await env.controller.dispatch('forum-role', {role: 'teacher'});
  const first = env.community.createThread({title: 'E2903 first', body: 'First saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  const second = env.community.createThread({title: 'E2903 second', body: 'Second saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  await env.controller.navigate(`#/posts/${first.value.id}`);
  await env.controller.dispatch('forum-edit-post', {postId: first.value.id, threadId: first.value.id});
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: first.value.id, threadId: first.value.id, title: '   ', content: 'First edit draft.'})).ok, false);
  assert.deepEqual(env.controller.state.community.postEditDraft, {postId: first.value.id, title: '   ', content: 'First edit draft.'});

  await env.controller.navigate(`#/posts/${second.value.id}`);
  assert.equal(env.controller.state.community.postEditDraft, null, 'leaving the source thread discards its edit draft');
  assert.equal(env.controller.state.community.editingPostId, null);
  await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id});
  assert.deepEqual(postEditFields(env.tree), {postId: second.value.id, title: 'E2903 second', content: 'Second saved body.'}, 'another post never inherits the first draft');

  const oversizedTitle = 'x'.repeat(300);
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: oversizedTitle, content: 'Second saved body.'})).error, 'input_too_long');
  assert.equal(postEditFields(env.tree).title.length, 256, 'overlength retry keeps one character beyond the acceptance cap');
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: postEditFields(env.tree).title, content: 'Second saved body.'})).error, 'input_too_long', 'the retained sentinel remains invalid');
  const paddedTitle = `${' '.repeat(2_000)}${'p'.repeat(1_000)}`;
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: paddedTitle, content: 'Second saved body.'})).error, 'input_too_long');
  assert.equal(postEditFields(env.tree).title, 'p'.repeat(256), 'trimmed overlength title retains an invalid sentinel');
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: postEditFields(env.tree).title, content: 'Second saved body.'})).error, 'input_too_long');
  const paddedBody = `${' '.repeat(10_000)}${'b'.repeat(10_001)}`;
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: 'E2903 second', content: paddedBody})).error, 'input_too_long');
  assert.equal(postEditFields(env.tree).content, 'b'.repeat(10_001), 'trimmed overlength body retains an invalid sentinel');
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: 'E2903 second', content: postEditFields(env.tree).content})).error, 'input_too_long');

  await env.controller.dispatch('forum-role', {role: 'moderator'});
  assert.equal(env.controller.state.community.postEditDraft, null, 'leaving teacher role clears retained text');
  assert.equal(env.controller.state.community.editingPostId, null);
  const foreignTree = renderCommunity({route: {page: 'post', threadId: 'topic-official-bug-forum'}, state: env.community.snapshot(), session: {role: 'teacher', personaId: 'demo-teacher'}});
  assert.equal(postEditFields(foreignTree), null);
  assert.ok(JSON.stringify(foreignTree).includes('Edit post') === false, 'a teacher still has no edit control for a foreign post');
  const moderatorTree = renderCommunity({route: {page: 'post', threadId: 'topic-official-bug-forum'}, state: env.community.snapshot(), session: {role: 'moderator'}});
  assert.ok(JSON.stringify(moderatorTree).includes('Edit post'), 'moderator edit control remains available');

  await env.controller.dispatch('forum-role', {role: 'teacher'});
  await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id});
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: second.value.id, threadId: second.value.id, title: '   ', content: 'Draft before forum reset.'})).ok, false);
  await env.controller.dispatch('forum-reset');
  assert.equal(env.controller.state.community.postEditDraft, null, 'forum reset clears retained edit text');
  assert.equal(env.controller.state.community.editingPostId, null);

  const afterForumReset = env.community.createThread({title: 'E2903 after forum reset', body: 'Saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  await env.controller.navigate(`#/posts/${afterForumReset.value.id}`);
  await env.controller.dispatch('forum-edit-post', {postId: afterForumReset.value.id, threadId: afterForumReset.value.id});
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: afterForumReset.value.id, threadId: afterForumReset.value.id, title: '   ', content: 'Draft before logout.'})).ok, false);
  assert.equal((await env.controller.dispatch('public:logout')).ok, true);
  assert.equal(env.controller.state.community.postEditDraft, null, 'successful logout clears retained edit text');
  assert.equal(env.controller.state.community.editingPostId, null);

  await env.controller.dispatch('forum-role', {role: 'teacher'});
  const afterLogout = env.community.createThread({title: 'E2903 after logout', body: 'Saved body.', category: 'Questions', author: 'Synthetic teacher', authorId: 'demo-teacher', role: 'teacher'});
  await env.controller.navigate(`#/posts/${afterLogout.value.id}`);
  await env.controller.dispatch('forum-edit-post', {postId: afterLogout.value.id, threadId: afterLogout.value.id});
  assert.equal((await env.controller.dispatch('forum-edit-post', {postId: afterLogout.value.id, threadId: afterLogout.value.id, title: '   ', content: 'Draft before app reset.'})).ok, false);
  assert.equal((await env.controller.dispatch('public:reset')).ok, true);
  assert.equal(env.controller.state.community.postEditDraft, null, 'app reset clears retained edit text');
  assert.equal(env.controller.state.community.editingPostId, null);
});

test('rejected topic with a whitespace-only title retains category and meaningful body in compose', async () => {
  const env = communityDraftSetup();
  await openTeacherTopicComposer(env);
  const beforeTree = env.tree;
  assert.equal(env.controller.updateDraft('title', 'typed but not submitted'), false);
  assert.strictEqual(env.tree, beforeTree, 'topic typing stays DOM-local and does not trigger a controller rerender');
  const beforeCount = env.community.snapshot().threads.length;
  const beforeStorage = env.storage.getItem('hh-forum-v1');
  const payload = {title: '   ', category: 'Questions', content: 'A meaningful teacher question.'};
  const result = await env.controller.dispatch('forum-topic', payload);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'title_and_body_required');
  assert.deepEqual(env.controller.state.community.topicDraft, payload);
  assert.deepEqual(topicComposerFields(env.tree), payload);
  assert.equal(env.community.snapshot().threads.length, beforeCount);
  assert.equal(env.storage.getItem('hh-forum-v1'), beforeStorage, 'a failed topic draft is not written to forum storage');
  assert.equal(env.controller.state.journey.session.status, 'anonymous', 'a forum role does not create an HH account');
  const inlineTree = renderCommunity({route: {page: 'forum'}, state: {...env.controller.state.community, composer: 'topic'}, session: {role: 'teacher'}});
  assert.deepEqual(topicComposerFields(inlineTree), payload, 'the inline composer projects the same rejected submit draft');
});

test('rejected topic with a whitespace-only body retains title and category in compose', async () => {
  const env = communityDraftSetup();
  await openTeacherTopicComposer(env);
  const beforeCount = env.community.snapshot().threads.length;
  const payload = {title: 'A valid teacher title', category: 'Resources', content: '   '};
  const result = await env.controller.dispatch('forum-topic', payload);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'title_and_body_required');
  assert.deepEqual(env.controller.state.community.topicDraft, payload);
  assert.deepEqual(topicComposerFields(env.tree), payload);
  assert.equal(env.community.snapshot().threads.length, beforeCount);
});

test('corrected explicit topic retry clears draft and creates exactly one local topic', async () => {
  const env = communityDraftSetup();
  await openTeacherTopicComposer(env);
  const receiptsBefore = env.runtime.inspect().receipts.length;
  const invalid = {title: '  ', category: 'Questions', content: 'Keep this meaningful body.'};
  assert.equal((await env.controller.dispatch('forum-topic', invalid)).ok, false);
  assert.deepEqual(topicComposerFields(env.tree), invalid);
  const corrected = {...invalid, title: 'A corrected local topic'};
  const created = await env.controller.dispatch('forum-topic', corrected);
  assert.equal(created.ok, true);
  assert.equal(created.value.title, corrected.title);
  assert.equal(created.value.body, corrected.content);
  assert.equal(env.controller.state.community.topicDraft, null);
  assert.equal(env.community.snapshot().threads.length, 4);
  assert.equal(env.runtime.inspect().receipts.length, receiptsBefore, 'forum submissions do not invoke teacher account services');
  assert.equal(env.controller.state.journey.session.status, 'anonymous');
  assert.equal(env.controller.canRetry, false, 'a rejected topic does not arm automatic retry');
  assert.equal(JSON.parse(env.storage.getItem('hh-forum-v1')).threads.length, 4);
});

test('rejected overlength topic draft stays invalid and cannot be silently truncated into a post', async () => {
  const env = communityDraftSetup();
  await openTeacherTopicComposer(env);
  const beforeCount = env.community.snapshot().threads.length;
  const oversized = {title: 'x'.repeat(300), category: 'Community', content: 'Bounded retained body.'};
  const rejected = await env.controller.dispatch('forum-topic', oversized);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'input_too_long');
  const retained = topicComposerFields(env.tree);
  assert.equal(retained.title.length, 256, 'retain one over the acceptance limit so retry remains invalid until edited');
  assert.equal(retained.category, oversized.category);
  assert.equal(retained.content, oversized.content);
  const repeated = await env.controller.dispatch('forum-topic', retained);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error, 'input_too_long');
  assert.equal(env.community.snapshot().threads.length, beforeCount);
  assert.equal(env.storage.getItem('hh-forum-v1'), null);

  const oversizedBody = {title: 'Valid body-bound title', category: 'Questions', content: 'b'.repeat(10_500)};
  const rejectedBody = await env.controller.dispatch('forum-topic', oversizedBody);
  assert.equal(rejectedBody.ok, false);
  assert.equal(rejectedBody.error, 'input_too_long');
  const retainedBody = topicComposerFields(env.tree);
  assert.equal(retainedBody.content.length, 10_001, 'retain one over the acceptance limit so retry remains invalid until edited');
  const repeatedBody = await env.controller.dispatch('forum-topic', retainedBody);
  assert.equal(repeatedBody.ok, false);
  assert.equal(repeatedBody.error, 'input_too_long');
  assert.equal(env.community.snapshot().threads.length, beforeCount);
  assert.equal(env.storage.getItem('hh-forum-v1'), null);
});

test('topic draft clears when teacher role leaves, on forum reset, logout, and app reset', async () => {
  const env = communityDraftSetup();
  await openTeacherTopicComposer(env);
  const invalid = {title: '  ', category: 'Questions', content: 'A local body.'};
  assert.equal((await env.controller.dispatch('forum-topic', invalid)).ok, false);
  assert.deepEqual(env.controller.state.community.topicDraft, invalid);
  await env.controller.dispatch('forum-role', {role: 'anonymous'});
  assert.equal(env.controller.state.community.topicDraft, null);

  await env.controller.dispatch('forum-role', {role: 'teacher'});
  assert.equal((await env.controller.dispatch('forum-topic', invalid)).ok, false);
  assert.deepEqual(env.controller.state.community.topicDraft, invalid);
  await env.controller.dispatch('forum-reset');
  assert.equal(env.controller.state.community.topicDraft, null);

  assert.equal((await env.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);
  assert.equal((await env.controller.dispatch('forum-topic', invalid)).ok, false);
  assert.deepEqual(env.controller.state.community.topicDraft, invalid);
  assert.equal((await env.controller.dispatch('public:logout')).ok, true);
  assert.equal(env.controller.state.community.topicDraft, null);
  assert.equal(env.controller.state.journey.communityRole, 'anonymous');

  await env.controller.dispatch('forum-role', {role: 'teacher'});
  assert.equal((await env.controller.dispatch('forum-topic', invalid)).ok, false);
  assert.deepEqual(env.controller.state.community.topicDraft, invalid);
  assert.equal((await env.controller.dispatch('public:reset')).ok, true);
  assert.equal(env.controller.state.community.topicDraft, null);
  assert.equal(env.controller.state.journey.communityRole, 'anonymous');
});

test('rejected teacher reply at aggregate capacity stays in its thread composer and explicit retry clears it', async () => {
  const env = communityDraftSetup();
  const threadId = 'topic-official-bug-forum';
  await openTeacherReplyComposer(env, threadId);
  for (let index = 0; index < 498; index += 1) {
    const added = env.community.reply(threadId, {body: `Synthetic capacity setup ${index}`, role: 'teacher', authorId: 'demo-teacher'});
    assert.equal(added.ok, true);
  }
  const body = 'A meaningful teacher reply to preserve while the fixture reply limit is reached.';
  const beforeCount = env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0);
  const beforeStorage = env.storage.getItem('hh-forum-v1');
  const beforeReceipts = env.runtime.inspect().receipts.length;
  assert.equal(beforeCount, 500);
  assert.equal(env.controller.updateDraft('content', body), false, 'reply typing remains DOM-local');

  const rejected = await env.controller.dispatch('forum-reply', {threadId, content: body});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'reply_limit_reached');
  assert.deepEqual(env.controller.state.community.replyDraft, {threadId, content: body});
  assert.deepEqual(replyComposerFields(env.tree), {threadId, content: body});
  assert.equal(env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0), beforeCount);
  assert.equal(env.storage.getItem('hh-forum-v1'), beforeStorage, 'a rejected reply does not write forum storage');
  assert.equal(env.runtime.inspect().receipts.length, beforeReceipts, 'forum submit does not call an HH account service');

  const setupReply = env.community.getThread(threadId, {role: 'teacher'}).replies.at(-1);
  assert.equal(env.community.deleteReply(threadId, setupReply.id, {role: 'teacher', personaId: 'demo-teacher'}).ok, true,
    'make one local fixture slot available without resetting the reply draft');
  const created = await env.controller.dispatch('forum-reply', {threadId, content: body});
  assert.equal(created.ok, true);
  assert.equal(created.value.body, body);
  const thread = env.community.getThread(threadId, {role: 'teacher'});
  assert.equal(thread.replies.filter(reply => reply.body === body).length, 1);
  assert.equal(env.controller.state.community.replyDraft, null);
  assert.deepEqual(replyComposerFields(env.tree), {threadId, content: ''});
  assert.equal(env.runtime.inspect().receipts.length, beforeReceipts);
});

test('overlength rejected teacher reply retains one over the cap and cannot become valid through truncation', async () => {
  const env = communityDraftSetup();
  const threadId = 'topic-official-bug-forum';
  await openTeacherReplyComposer(env, threadId);
  const content = 'x'.repeat(10_001);
  const beforeCount = env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0);
  const rejected = await env.controller.dispatch('forum-reply', {threadId, content});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'input_too_long');
  assert.deepEqual(env.controller.state.community.replyDraft, {threadId, content});
  assert.equal(replyComposerFields(env.tree).content.length, 10_001);
  assert.equal(env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0), beforeCount);
  const repeated = await env.controller.dispatch('forum-reply', {threadId, content: replyComposerFields(env.tree).content});
  assert.equal(repeated.ok, false);
  assert.equal(repeated.error, 'input_too_long');
  assert.equal(env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0), beforeCount);

  const paddedOverlength = `${' '.repeat(10_000)}${'x'.repeat(10_001)}`;
  const paddedRejected = await env.controller.dispatch('forum-reply', {threadId, content: paddedOverlength});
  assert.equal(paddedRejected.ok, false);
  assert.equal(paddedRejected.error, 'input_too_long');
  assert.equal(env.controller.state.community.replyDraft?.content, 'x'.repeat(10_001),
    'normalizing surrounding whitespace must not truncate a meaningful oversized body into an accepted retry');
  const paddedRetry = await env.controller.dispatch('forum-reply', {threadId, content: env.controller.state.community.replyDraft.content});
  assert.equal(paddedRetry.ok, false);
  assert.equal(paddedRetry.error, 'input_too_long');
  assert.equal(env.community.snapshot().threads.reduce((total, thread) => total + thread.replies.length, 0), beforeCount);
});

test('reply draft is thread-bound, teacher-only, and cleared on role exit or forum/app reset', async () => {
  const env = communityDraftSetup();
  const firstThread = 'topic-official-bug-forum';
  const otherThread = 'topic-teachers-lounge-open';
  await openTeacherReplyComposer(env, firstThread);
  const firstBody = `Private teacher reply draft ${'x'.repeat(10_001)}`;
  assert.equal((await env.controller.dispatch('forum-reply', {threadId: firstThread, content: '   '})).ok, false);
  assert.deepEqual(replyComposerFields(env.tree), {threadId: firstThread, content: '   '});
  await env.controller.navigate(`#/community/thread/${firstThread}`);
  assert.deepEqual(replyComposerFields(env.tree), {threadId: firstThread, content: '   '}, 'same-thread alias navigation preserves its draft');
  await env.controller.navigate(`#/posts/${otherThread}`);
  assert.equal(env.controller.state.community.replyDraft, null, 'changing thread clears the old draft');
  assert.deepEqual(replyComposerFields(env.tree), {threadId: otherThread, content: ''}, 'another thread never inherits the body');

  const rejectedLongBody = await env.controller.dispatch('forum-reply', {threadId: otherThread, content: firstBody});
  assert.equal(rejectedLongBody.ok, false);
  assert.equal(rejectedLongBody.error, 'input_too_long');
  assert.equal(env.controller.state.community.replyDraft?.threadId, otherThread);
  assert.equal(env.controller.state.community.replyDraft?.content.length, 10_001);
  await env.controller.dispatch('forum-role', {role: 'moderator'});
  assert.equal(env.controller.state.community.replyDraft, null, 'leaving teacher role clears retained content');
  assert.deepEqual(replyComposerFields(env.tree), {threadId: otherThread, content: ''}, 'moderator does not see the teacher draft');
  const moderatorReply = await env.controller.dispatch('forum-reply', {threadId: otherThread, content: 'Moderator must not retain this.'});
  assert.equal(moderatorReply.ok, false);
  assert.equal(env.controller.state.community.replyDraft, null);
  await env.controller.dispatch('forum-role', {role: 'anonymous'});
  const anonymousReply = await env.controller.dispatch('forum-reply', {threadId: otherThread, content: 'Anonymous must not retain this.'});
  assert.equal(anonymousReply.ok, false);
  assert.equal(env.controller.state.community.replyDraft, null);

  await env.controller.dispatch('forum-role', {role: 'teacher'});
  assert.equal((await env.controller.dispatch('forum-reply', {threadId: otherThread, content: '   '})).ok, false);
  assert.ok(env.controller.state.community.replyDraft);
  await env.controller.dispatch('forum-reset');
  assert.equal(env.controller.state.community.replyDraft, null, 'forum reset clears the retained body');

  assert.equal((await env.controller.dispatch('forum-reply', {threadId: otherThread, content: '   '})).ok, false);
  assert.ok(env.controller.state.community.replyDraft);
  assert.equal((await env.controller.dispatch('public:reset')).ok, true);
  assert.equal(env.controller.state.community.replyDraft, null, 'app reset clears the retained body');
});

test('successful logout clears a retained reply draft and leaving the thread clears it', async () => {
  const env = communityDraftSetup();
  assert.equal((await env.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);
  const threadId = 'topic-official-bug-forum';
  await env.controller.navigate(`#/posts/${threadId}`);
  assert.equal(env.controller.state.journey.communityRole, 'teacher');
  assert.equal((await env.controller.dispatch('forum-reply', {threadId, content: '   '})).ok, false);
  assert.ok(env.controller.state.community.replyDraft);
  await env.controller.navigate('#/forum');
  assert.equal(env.controller.state.community.replyDraft, null, 'leaving the reply thread clears its draft');
  await env.controller.navigate(`#/posts/${threadId}`);
  assert.equal((await env.controller.dispatch('forum-reply', {threadId, content: '   '})).ok, false);
  assert.ok(env.controller.state.community.replyDraft);
  assert.equal((await env.controller.dispatch('public:logout')).ok, true);
  assert.equal(env.controller.state.community.replyDraft, null, 'successful logout clears the retained body');
});

test('wishlist handoff is invalidated before a foreign profile read and must be freshly prepared for that profile', async () => {
  const base = createFixtureProvider({fixture: true});
  let announceJordan, releaseJordan;
  const jordanStarted = new Promise(resolve => { announceJordan = resolve; });
  const jordanGate = new Promise(resolve => { releaseJordan = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-jordan') {
      announceJordan();
      await jordanGate;
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services});
  const controller = createPublicController({runtime});
  await controller.initialize('#/');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal((await controller.dispatch('public:wishlist')).handoff.destination,
    'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');

  const readingJordan = controller.navigate('#/public-profile/demo-jordan');
  await jordanStarted;
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.equal(controller.state.journey.profile.status, 'loading');
  assert.equal(controller.state.journey.wishlist.intent, false, 'foreign route invalidates old prepared destination before provider completion');
  assert.equal((await controller.dispatch('public:confirm-wishlist')).error.code, 'no_wishlist_handoff');
  releaseJordan();
  await readingJordan;
  assert.equal(controller.state.journey.profile.value?.id, 'demo-jordan');
  const preparedJordan = await controller.dispatch('public:wishlist');
  assert.equal(preparedJordan.ok, true);
  assert.equal(preparedJordan.handoff.profileId, 'demo-jordan');
  assert.equal(preparedJordan.handoff.destination, 'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN');
  assert.equal((await controller.dispatch('public:confirm-wishlist')).ok, true);
  const currentTree = renderPublicSite({route: controller.route, state: controller.state});
  const currentAnchors = [];
  const visitCurrent = node => { if (!node || typeof node !== 'object') return; if (node.tag === 'a') currentAnchors.push(node); for (const child of node.children || []) visitCurrent(child); };
  visitCurrent(currentTree);
  assert.equal(currentAnchors.find(node => node.attrs?.id === 'hh-profile-wishlist-open')?.attrs?.href,
    'https://www.amazon.com/hz/wishlist/ls/DEMO-JORDAN');
});

test('wishlist handoff remains on same-profile aliases and captured reference keeps its static link', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/');
  await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  await controller.navigate('#/public-profile/demo-avery');
  await controller.dispatch('public:wishlist');
  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.wishlist.intent, true);
  assert.equal((await controller.dispatch('public:confirm-wishlist')).ok, true);
  await controller.navigate('#/public-profile/reference-sarah');
  assert.equal(controller.state.journey.profile.source, 'captured-readonly');
  assert.equal(controller.state.journey.wishlist.intent, false);
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const anchors = [];
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.tag === 'a') anchors.push(node); for (const child of node.children || []) visit(child); };
  visit(tree);
  const capturedLink = anchors.find(node => node.attrs?.id === 'hh-reference-wishlist');
  assert.ok(capturedLink?.attrs?.href);
  assert.equal(anchors.some(node => node.attrs?.id === 'hh-profile-wishlist-open'), false);
  assert.equal((await controller.dispatch('public:wishlist')).error.code, 'read_only_reference');
  assert.equal(runtime.snapshot().session.status, 'authenticated');
});

test('failed profile navigation clears prior wishlist handoff and stale confirmation is rejected', async () => {
  const {controller} = setup();
  await controller.initialize('#/');
  await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  await controller.navigate('#/public-profile/demo-avery');
  await controller.dispatch('public:wishlist');
  await controller.navigate('#/public-profile/demo-profile-missing');
  assert.equal(controller.state.journey.profile.status, 'error');
  assert.equal(controller.state.journey.wishlist.intent, false);
  assert.equal((await controller.dispatch('public:confirm-wishlist')).error.code, 'no_wishlist_handoff');
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const anchors = [];
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.tag === 'a') anchors.push(node); for (const child of node.children || []) visit(child); };
  visit(tree);
  assert.equal(anchors.some(node => node.attrs?.id === 'hh-profile-wishlist-open'), false);
});

test('confirmed wishlist destination is not rendered on a foreign profile', async () => {
  const {controller} = setup();
  await controller.initialize('#/');
  await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  await controller.navigate('#/public-profile/demo-avery');
  await controller.dispatch('public:wishlist');
  assert.equal((await controller.dispatch('public:confirm-wishlist')).ok, true);
  await controller.navigate('#/public-profile/demo-jordan');
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const anchors = [];
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.tag === 'a') anchors.push(node); for (const child of node.children || []) visit(child); };
  visit(tree);
  assert.equal(anchors.some(node => node.attrs?.id === 'hh-profile-wishlist-open'), false,
    'an already confirmed handoff must not project an old profile URL onto a foreign teacher');
});

test('same-profile wishlist handoff cannot be confirmed while its profile reload is pending or failed', async () => {
  const base = createFixtureProvider({fixture: true});
  let holdAvery = false, failAvery = false, announceAvery, releaseAvery;
  const averyStarted = new Promise(resolve => { announceAvery = resolve; });
  const averyGate = new Promise(resolve => { releaseAvery = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port === 'TeacherProfile.openPublicProfile' && input?.profileId === 'demo-avery') {
      if (holdAvery) { announceAvery(); await averyGate; }
      if (failAvery) return {ok: false, message: 'Synthetic profile read failed.', error: {code: 'transport_failure', retryable: false}};
    }
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...base, services});
  const controller = createPublicController({runtime});
  await controller.initialize('#/');
  await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  await controller.navigate('#/public-profile/demo-avery');
  await controller.dispatch('public:wishlist');

  holdAvery = true;
  const reading = controller.navigate('#/public-profile/demo-avery');
  await averyStarted;
  assert.equal(controller.state.journey.profile.status, 'loading');
  assert.equal(controller.state.journey.wishlist.intent, true, 'same-profile identity may retain the explicit choice while loading');
  assert.equal((await controller.dispatch('public:confirm-wishlist')).error.code, 'wishlist_profile_changed');
  releaseAvery();
  await reading;
  holdAvery = false;
  failAvery = true;
  await controller.navigate('#/public-profile/demo-avery');
  assert.equal(controller.state.journey.profile.status, 'error');
  assert.equal((await controller.dispatch('public:confirm-wishlist')).error.code, 'wishlist_profile_changed');
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const anchors = [];
  const visit = node => { if (!node || typeof node !== 'object') return; if (node.tag === 'a') anchors.push(node); for (const child of node.children || []) visit(child); };
  visit(tree);
  assert.equal(anchors.some(node => node.attrs?.id === 'hh-profile-wishlist-open'), false);
});

test('late login, approval and logout results never redirect away from the current route', async () => {
  {
    const {runtime, release} = deferredRuntime('Session.login');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/login');
    const pending = controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'temporary'});
    await controller.navigate('#/about');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'about');
  }
  {
    const {runtime, release} = deferredRuntime('Demo.simulateApproval');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/register');
    for (const [level, value] of [['state', 'Demo Washington'], ['county', 'Demo King'], ['district', 'Demo District'], ['school', 'Demo Academy']]) {
      await controller.selectSchool(level, value);
    }
    await controller.dispatch('public:accept-terms');
    await controller.dispatch('public:register', {name: 'Taylor Rivera', email: 'taylor@example.org', password: 'one', confirmPassword: 'one'});
    const pending = controller.dispatch('approve');
    await controller.navigate('#/partners');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'partners');
  }
  {
    const {runtime, release} = deferredRuntime('Session.logout');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/login');
    await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'temporary'});
    const pending = controller.dispatch('public:logout');
    await controller.navigate('#/contact');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'contact');
  }
});

test('successful logout clears the own projection and anonymizes the community on its original route', async () => {
  const controlled = controlledFixtureRuntime(['Session.logout']);
  const controller = controlledController(controlled.runtime);
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);
  assert.equal(controller.route.page, 'profile');
  assert.equal(controller.state.journey.session.status, 'authenticated');

  const logout = controller.dispatch('public:logout');
  await controlled.waitFor('Session.logout');
  assert.equal(controller.state.journey.profile.value.id, 'demo-avery');
  controlled.release('Session.logout');

  assert.equal((await logout).ok, true);
  assert.equal(controlled.runtime.snapshot().session.status, 'anonymous');
  assert.equal(controller.state.journey.session.status, 'anonymous');
  assert.equal(controller.state.journey.communityRole, 'anonymous');
  assert.equal(controller.route.page, 'login');
  assert.equal(controller.state.journey.profile.status, 'unknown');
  assert.equal(controller.state.journey.profile.value, null);
});

test('successful logout preserves a foreign public-profile projection after navigation', async () => {
  const controlled = controlledFixtureRuntime(['Session.logout']);
  const controller = controlledController(controlled.runtime);
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);

  const logout = controller.dispatch('public:logout');
  await controlled.waitFor('Session.logout');
  await controller.navigate('#/public-profile/demo-jordan');
  const foreignProjection = structuredClone(controller.state.journey.profile);
  assert.equal(foreignProjection.value.id, 'demo-jordan');
  assert.equal(foreignProjection.value.teacherId, 'demo-seed-jordan');
  assert.equal(controlled.runtime.snapshot().session.status, 'authenticated', 'the held service has not logged out yet');

  controlled.release('Session.logout');
  assert.equal((await logout).ok, true);
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.equal(controlled.runtime.snapshot().session.status, 'anonymous');
  assert.equal(controller.state.journey.session.status, 'anonymous');
  assert.equal(controller.state.journey.communityRole, 'anonymous');
  assert.deepEqual(controller.state.journey.profile, foreignProjection);
  const edit = await controller.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'authentication_required');
  assert.deepEqual(controller.state.journey.profile, foreignProjection);
});

test('successful logout preserves a captured readonly projection and its readonly guard', async () => {
  const controlled = controlledFixtureRuntime(['Session.logout']);
  const controller = controlledController(controlled.runtime);
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);

  const logout = controller.dispatch('public:logout');
  await controlled.waitFor('Session.logout');
  await controller.navigate('#/pages/teacher.html');
  const capturedProjection = structuredClone(controller.state.journey.profile);
  assert.equal(capturedProjection.source, 'captured-readonly');
  assert.equal(capturedProjection.readOnly, true);

  controlled.release('Session.logout');
  assert.equal((await logout).ok, true);
  assert.equal(controller.route.profileId, 'reference-sarah');
  assert.equal(controlled.runtime.snapshot().session.status, 'anonymous');
  assert.equal(controller.state.journey.communityRole, 'anonymous');
  assert.deepEqual(controller.state.journey.profile, capturedProjection);
  const edit = await controller.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'read_only_reference');
  assert.deepEqual(controller.state.journey.profile, capturedProjection);
});

test('successful logout does not clear a public-profile projection while its read is pending', async () => {
  const controlled = controlledFixtureRuntime(['Session.logout', 'TeacherProfile.openPublicProfile']);
  const controller = controlledController(controlled.runtime);
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);

  const logout = controller.dispatch('public:logout');
  await controlled.waitFor('Session.logout');
  const publicRead = controller.navigate('#/public-profile/demo-jordan');
  await controlled.waitFor('TeacherProfile.openPublicProfile');
  const pendingProjection = structuredClone(controller.state.journey.profile);
  assert.equal(pendingProjection.status, 'loading');
  assert.equal(controller.route.profileId, 'demo-jordan');

  controlled.release('Session.logout');
  assert.equal((await logout).ok, true);
  assert.equal(controller.state.journey.session.status, 'anonymous');
  assert.equal(controller.state.journey.communityRole, 'anonymous');
  assert.deepEqual(controller.state.journey.profile, pendingProjection);

  controlled.release('TeacherProfile.openPublicProfile');
  await publicRead;
  assert.equal(controller.state.journey.profile.status, 'present');
  assert.equal(controller.state.journey.profile.value.id, 'demo-jordan');
  assert.equal(controller.state.journey.profile.value.teacherId, 'demo-seed-jordan');
});

test('failed logout after navigation leaves foreign projection and authenticated authority unchanged', async () => {
  const controlled = controlledFixtureRuntime(['Session.logout'], {failPorts: ['Session.logout']});
  const controller = controlledController(controlled.runtime);
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'})).ok, true);

  const logout = controller.dispatch('public:logout');
  await controlled.waitFor('Session.logout');
  await controller.navigate('#/public-profile/demo-jordan');
  const foreignProjection = structuredClone(controller.state.journey.profile);
  controlled.release('Session.logout');

  const result = await logout;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'denied');
  assert.equal(controlled.runtime.snapshot().session.status, 'authenticated');
  assert.equal(controller.state.journey.session.status, 'authenticated');
  assert.equal(controller.state.journey.communityRole, 'teacher');
  assert.equal(controller.route.profileId, 'demo-jordan');
  assert.deepEqual(controller.state.journey.profile, foreignProjection);
  const edit = await controller.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'profile_owner_mismatch');
  assert.deepEqual(controller.state.journey.profile, foreignProjection);
});
