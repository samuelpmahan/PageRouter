import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const productRoot = process.env.PAGEROUTER_ROOT;
if (!productRoot) throw new Error('Set PAGEROUTER_ROOT to the PageRouter checkout root.');
const productImport = relativePath => import(pathToFileURL(resolve(productRoot, relativePath)).href);
import assert from 'node:assert/strict';
const {createFixtureProvider, createServiceRuntime} = await productImport('checkpoint/vendor/hh/services/index.mjs');
const {createPublicController} = await productImport('checkpoint/vendor/hh/src/public-controller.mjs');
const {renderPublicSite} = await productImport('checkpoint/vendor/hh/src/public-site.mjs');
const {createCommunity} = await productImport('checkpoint/vendor/hh/src/community.mjs');

function memoryStorage() {
  const values = new Map();
  return {getItem(k) { return values.get(k) ?? null; }, setItem(k, v) { values.set(k, String(v)); }, removeItem(k) { values.delete(k); }};
}

function find(tree, id) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.attrs?.id === id) return tree;
  for (const child of tree.children || []) { const found = find(child, id); if (found) return found; }
  return null;
}

async function scenario(target, outcome) {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  let entered;
  const enteredWait = new Promise(resolve => { entered = resolve; });
  let release;
  const runtime = {
    ready: base.ready, pxc: base.pxc, snapshot: () => base.snapshot(), inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; }, get fixture() { return base.fixture; },
    invoke(port, input, boundary) {
      if (port !== 'TeacherProfile.openPublicProfile') return base.invoke(port, input, boundary);
      entered({port, input});
      return new Promise(resolve => { release = async () => resolve(outcome === 'success'
        ? await base.invoke(port, input, boundary)
        : {ok: false, mode: 'fixture', message: 'Controlled synthetic fixture read failure.', error: {code: 'controlled_read_failure', retryable: false}}); });
    },
  };
  const community = createCommunity({storage});
  const controller = createPublicController({runtime, storage, community});
  await controller.initialize('#/home');
  assert.equal(controller.state.journey.loading, false, 'home initialization completes its fixture lookup');

  const profileNavigation = controller.navigate('#/public-profile/demo-avery');
  const invocation = await enteredWait;
  assert.equal(invocation.port, 'TeacherProfile.openPublicProfile');
  const whilePending = {
    route: controller.route.path,
    journeyLoading: controller.state.journey.loading,
    profileStatus: controller.state.journey.profile.status,
  };
  assert.equal(whilePending.journeyLoading, false, 'public profile reads do not use the shared lookup loading flag');
  assert.equal(whilePending.profileStatus, 'loading');

  await controller.navigate(target);
  const formId = target === '#/register' ? 'hh-register-form' : 'hh-login-form';
  const submitId = target === '#/register' ? 'hh-register-submit' : 'hh-login-submit';
  const routeTree = renderPublicSite({route: controller.route, state: controller.state});
  const form = find(routeTree, formId);
  const submit = find(routeTree, submitId);
  assert.ok(form, `${target} form is rendered`);
  assert.ok(submit, `${target} submit control is rendered`);
  const afterNavigateBeforeResolve = {
    route: controller.route.path,
    journeyLoading: controller.state.journey.loading,
    profileStatus: controller.state.journey.profile.status,
    formRendered: !!form,
    submitRendered: !!submit,
    submitDisabled: submit.attrs.disabled === true,
    profileProjectionRendered: !!find(routeTree, 'hh-profile-retry'),
  };
  assert.equal(afterNavigateBeforeResolve.route, target.slice(1));
  assert.equal(afterNavigateBeforeResolve.journeyLoading, false, 'public profile read leaves shared loading false across auth navigation');
  assert.equal(afterNavigateBeforeResolve.submitDisabled, false);
  assert.equal(afterNavigateBeforeResolve.profileProjectionRendered, false);

  await release();
  const profileResult = await profileNavigation;
  const afterResolveTree = renderPublicSite({route: controller.route, state: controller.state});
  const result = {
    target, outcome,
    pendingInvocation: invocation,
    whilePending,
    afterNavigateBeforeResolve,
    outerNavigationResult: {ok: profileResult.ok, route: profileResult.route?.path || null},
    staleProfileUpdateObserved: false,
    afterResolve: {
      route: controller.route.path,
      journeyLoading: controller.state.journey.loading,
      profileStatus: controller.state.journey.profile.status,
      formRendered: !!find(afterResolveTree, formId),
      submitRendered: !!find(afterResolveTree, submitId),
      submitDisabled: find(afterResolveTree, submitId)?.attrs.disabled === true,
      profileProjectionRendered: !!find(afterResolveTree, 'hh-profile-retry'),
    },
  };
  assert.equal(result.staleProfileUpdateObserved, false, 'route guard prevents success or failure from replacing the current projection');
  assert.equal(result.afterResolve.route, target.slice(1));
  assert.equal(result.afterResolve.profileStatus, 'loading', 'guard preserves the superseded profile projection in controller state');
  assert.equal(result.afterResolve.journeyLoading, false, 'public profile read never used shared loading');
  assert.equal(result.afterResolve.submitDisabled, false);
  assert.equal(result.afterResolve.profileProjectionRendered, false);
  return result;
}

async function invalidatedDirectoryScenario() {
  const storage = memoryStorage();
  const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const controller = createPublicController({runtime, storage, community: createCommunity({storage})});
  await controller.initialize('#/home');
  await controller.initialize('#/directory');
  const pendingSearch = controller.dispatch('public:directory-search', {query: 'avery'});
  const pendingState = {route: controller.route.path, journeyLoading: controller.state.journey.loading,
    matchesStatus: controller.state.journey.matches.status};
  const loginNavigation = controller.navigate('#/login');
  const [searchResult] = await Promise.all([pendingSearch, loginNavigation]);
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const submit = find(tree, 'hh-login-submit');
  const loginDispatch = await controller.dispatch('public:login', {});
  const result = {
    pendingState,
    searchResult,
    blankLoginDispatch: {ok: loginDispatch.ok, errorCode: loginDispatch.error?.code || null},
    loadingAfterBlankLoginDispatch: controller.state.journey.loading,
    afterInvalidation: {
      route: controller.route.path,
      journeyLoading: controller.state.journey.loading,
      matchesStatus: controller.state.journey.matches.status,
      loginFormRendered: !!find(tree, 'hh-login-form'),
      loginSubmitRendered: !!submit,
      loginSubmitDisabled: submit?.attrs.disabled === true,
      staleDirectoryProjectionRendered: !!find(tree, 'hh-directory-results'),
    },
  };
  assert.equal(pendingState.journeyLoading, true);
  assert.equal(pendingState.matchesStatus, 'loading');
  assert.equal(result.afterInvalidation.route, '/login');
  assert.equal(result.afterInvalidation.journeyLoading, false, 'navigation clears the retired directory loading flag');
  assert.equal(result.afterInvalidation.matchesStatus, 'loading', 'directory projection remains stale while another route is active');
  assert.ok(result.afterInvalidation.loginFormRendered);
  assert.equal(result.afterInvalidation.loginSubmitDisabled, false);
  assert.equal(result.afterInvalidation.staleDirectoryProjectionRendered, false);
  assert.equal(searchResult.ignored, true);
  assert.equal(result.blankLoginDispatch.errorCode, 'validation_failed', 'active login dispatch reaches local validation without invoking account service');
  assert.equal(result.loadingAfterBlankLoginDispatch, false);
  return result;
}

const results = [];
for (const target of ['#/register', '#/login']) {
  for (const outcome of ['success', 'failure']) results.push(await scenario(target, outcome));
}
const adjacentDirectoryCase = await invalidatedDirectoryScenario();
process.stdout.write(JSON.stringify({schema: 'hh-e602-probe/v1', evidence: 'synthetic volatile fixture runtime; controller and renderer execution; no browser or backend', results, adjacentDirectoryCase}, null, 2) + '\n');
