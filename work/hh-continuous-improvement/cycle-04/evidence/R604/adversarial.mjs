import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const productRoot = process.env.PAGEROUTER_ROOT;
if (!productRoot) throw new Error('Set PAGEROUTER_ROOT to the PageRouter checkout root.');
const productImport = relativePath => import(pathToFileURL(resolve(productRoot, relativePath)).href);
import assert from 'node:assert/strict';
const {createFixtureProvider, createServiceRuntime} = await productImport('checkpoint/vendor/hh/services/index.mjs');
const {createPublicController} = await productImport('checkpoint/vendor/hh/src/public-controller.mjs');
const {createCommunity} = await productImport('checkpoint/vendor/hh/src/community.mjs');

function memoryStorage() {
  const values = new Map();
  return {getItem(k) { return values.get(k) ?? null; }, setItem(k, v) { values.set(k, String(v)); }, removeItem(k) { values.delete(k); }};
}

function controlledRuntime(port, {holdAll = false, fail = false} = {}) {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const pending = [];
  let armed = false;
  let notifyPending;
  const firstPending = new Promise(resolve => { notifyPending = resolve; });
  let heldCount = 0;
  const runtime = {
    ready: base.ready, pxc: base.pxc, snapshot: () => base.snapshot(), inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; }, get fixture() { return base.fixture; },
    invoke(name, input, boundary) {
      if (!armed || name !== port || (!holdAll && heldCount > 0)) return base.invoke(name, input, boundary);
      heldCount += 1;
      return new Promise(resolve => {
        const item = {input, release: async () => resolve(fail
          ? {ok: false, mode: 'fixture', message: 'Controlled synthetic lookup failure.', error: {code: 'controlled_lookup_failure', retryable: false}}
          : await base.invoke(name, input, boundary))};
        pending.push(item);
        notifyPending?.(item);
        notifyPending = null;
      });
    },
  };
  const controller = createPublicController({runtime, storage, community: createCommunity({storage})});
  return {controller, pending, firstPending, arm() { armed = true; }};
}

async function lookupToLogin(fail) {
  const {controller, pending, firstPending, arm} = controlledRuntime('SchoolData.getCounties', {fail});
  await controller.initialize('#/home');
  await controller.navigate('#/directory');
  arm();
  const lookup = controller.selectSchool('state', 'Demo Washington');
  await firstPending;
  const pendingState = {route: controller.route.path, loading: controller.state.journey.loading};
  const nav = controller.navigate('#/login');
  const immediatelyAfterNavigation = {route: controller.route.path, loading: controller.state.journey.loading};
  await nav;
  await pending[0].release();
  const lookupResult = await lookup;
  const afterStaleSettlement = {route: controller.route.path, loading: controller.state.journey.loading,
    counties: controller.state.journey.lookups.counties, lookupError: controller.state.journey.lookupError};
  assert.equal(pendingState.loading, true);
  assert.equal(immediatelyAfterNavigation.loading, false);
  assert.equal(afterStaleSettlement.loading, false);
  assert.deepEqual(afterStaleSettlement.counties, []);
  assert.equal(afterStaleSettlement.lookupError, '');
  assert.equal(lookupResult.ignored, true);
  return {fail, pendingState, immediatelyAfterNavigation, lookupResult, afterStaleSettlement};
}

async function directoryToNewPendingLookup() {
  const {controller, pending, firstPending, arm} = controlledRuntime('SchoolData.getStates');
  await controller.initialize('#/home');
  // Registration choices were previously loaded; clear the local cache to exercise
  // the same pending registration lookup setup covered by the source regression test.
  controller.state.journey.lookups.states = [];
  arm();
  const directory = controller.navigate('#/directory');
  const newPendingRegister = controller.navigate('#/register');
  await firstPending;
  await directory;
  const afterOldDirectoryReturn = {route: controller.route.path, loading: controller.state.journey.loading,
    matchesStatus: controller.state.journey.matches.status, pendingLookupCount: pending.length};
  assert.equal(afterOldDirectoryReturn.route, '/register');
  assert.equal(afterOldDirectoryReturn.loading, true);
  assert.equal(afterOldDirectoryReturn.matchesStatus, 'loading');
  await pending[0].release();
  await newPendingRegister;
  const afterCurrentLookupSettles = {loading: controller.state.journey.loading,
    states: controller.state.journey.lookups.states};
  assert.equal(afterCurrentLookupSettles.loading, false);
  assert.deepEqual(afterCurrentLookupSettles.states, ['Demo California', 'Demo Washington']);
  return {afterOldDirectoryReturn, afterCurrentLookupSettles};
}

async function newerLookupSettlesBeforeOlder() {
  const {controller, pending, firstPending, arm} = controlledRuntime('SchoolData.getCounties', {holdAll: true});
  await controller.initialize('#/home');
  await controller.navigate('#/register');
  arm();
  const older = controller.selectSchool('state', 'Demo Washington');
  await firstPending;
  const newer = controller.selectSchool('state', 'Demo California');
  assert.equal(pending.length, 2);
  await pending[1].release();
  const newerResult = await newer;
  const afterNewer = {loading: controller.state.journey.loading,
    selectedState: controller.state.journey.school.state,
    counties: controller.state.journey.lookups.counties};
  assert.equal(newerResult.ok, true);
  assert.equal(afterNewer.loading, false);
  assert.deepEqual(afterNewer.counties, ['Demo Alameda']);
  await pending[0].release();
  const olderResult = await older;
  const afterOlder = {loading: controller.state.journey.loading,
    selectedState: controller.state.journey.school.state,
    counties: controller.state.journey.lookups.counties};
  assert.equal(olderResult.ignored, true);
  assert.equal(afterOlder.loading, false);
  assert.equal(afterOlder.selectedState, 'Demo California');
  assert.deepEqual(afterOlder.counties, ['Demo Alameda']);
  return {afterNewer, olderResult, afterOlder};
}

const results = {
  lookupToLoginSuccess: await lookupToLogin(false),
  lookupToLoginFailure: await lookupToLogin(true),
  directoryWithOlderAndNewerLookup: await directoryToNewPendingLookup(),
  newerLookupSettlesBeforeOlder: await newerLookupSettlesBeforeOlder(),
};
process.stdout.write(JSON.stringify({schema: 'hh-r604-adversarial/v1', evidence: 'volatile synthetic fixture runtime only', results}, null, 2) + '\n');
