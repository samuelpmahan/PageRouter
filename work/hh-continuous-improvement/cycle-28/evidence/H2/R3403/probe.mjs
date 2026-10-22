import assert from 'node:assert/strict';
import {createFixtureProvider} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createCommunity} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/86659bbafcce/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

function walk(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  found.push(node);
  for (const child of node.children || []) walk(child, found);
  return found;
}
function buttonById(tree, id) {
  return walk(tree).find(node => node.tag === 'button' && node.attrs?.id === id) || null;
}
function accountReceipt(snapshot) {
  return {
    session: snapshot.session,
    registration: snapshot.registration,
    ownProfile: snapshot.ownProfile,
    selectedTeacher: snapshot.demo.selectedTeacher,
    selectedSchool: snapshot.demo.selectedSchool,
    publicProfileIds: snapshot.demo.publicProfiles.map(profile => profile.id).sort(),
  };
}
function portTotals(calls) {
  return Object.fromEntries([...new Set(calls.map(call => call.port))].sort()
    .map(port => [port, calls.filter(call => call.port === port).length]));
}
function delta(before, after) {
  const ports = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...ports].sort().map(port => [port, (after[port] || 0) - (before[port] || 0)]).filter(([, count]) => count !== 0));
}
function clickEvent(button) {
  assert.ok(button, 'rendered button exists');
  const dataset = {event: button.attrs['data-event']};
  assert.equal(typeof dataset.event, 'string');
  return dataset.event;
}

const fixture = createFixtureProvider({fixture: true, storage: null});
const calls = [];
const provider = Object.freeze({...fixture, services: Object.freeze(Object.fromEntries(
  Object.entries(fixture.services).map(([port, invoke]) => [port, async input => {
    calls.push({port});
    return invoke(input);
  }]),
))});
const runtime = createServiceRuntime(provider);
const community = createCommunity({storage: null});
let tree = null;
const controller = createPublicController({runtime, storage: null, community,
  onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
});
await controller.initialize('#/directory');
const before = {
  actualPortCalls: portTotals(calls),
  runtimeReceiptCount: runtime.inspect().receipts.length,
  account: accountReceipt(fixture.snapshot()),
};

await controller.dispatch('public:fail-next');
const lookupFailure = await controller.selectSchool('state', 'Demo Washington');
assert.equal(lookupFailure.ok, false);
assert.equal(controller.state.journey.lookupRetryable, true);
const hiddenUnderResult = buttonById(tree, 'hh-directory-lookup-retry');
assert.ok(hiddenUnderResult, 'a retryable lookup failure renders its own action');
assert.equal(hiddenUnderResult.attrs['data-event'], 'public:retry-school-lookup');

const portsBeforeDirFailure = portTotals(calls);
await controller.dispatch('public:fail-next');
const directoryFailure = await controller.dispatch('public:directory-search', {query: ''});
assert.equal(directoryFailure.ok, false);
assert.equal(controller.state.journey.matches.status, 'error');
assert.equal(controller.state.journey.lookupRetryable, true);
const resultRetry = buttonById(tree, 'hh-directory-retry');
const schoolRetry = buttonById(tree, 'hh-directory-lookup-retry');
assert.equal(clickEvent(resultRetry), 'public:retry');
assert.equal(clickEvent(schoolRetry), 'public:retry-school-lookup');
const portsBeforeSchoolClick = portTotals(calls);
const schoolClickResult = await controller.dispatch(clickEvent(schoolRetry));
const portsAfterSchoolClick = portTotals(calls);
assert.equal(schoolClickResult.ok, true);
assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
assert.equal(controller.state.journey.matches.status, 'error', 'school-choice action leaves directory failure intact');
assert.equal(controller.state.journey.error, 'Directory results could not be loaded.');
assert.equal(buttonById(tree, 'hh-directory-retry')?.attrs['data-event'], 'public:retry', 'result recovery action remains available');
assert.equal(buttonById(tree, 'hh-directory-lookup-retry'), null, 'recovered school error no longer offers retry');
assert.deepEqual(delta(portsBeforeSchoolClick, portsAfterSchoolClick), {'SchoolData.getCounties': 1}, 'rendered school action executes the actual current cascade read only');

const resultButtonAfterSchool = buttonById(tree, 'hh-directory-retry');
const resultClick = await controller.dispatch(clickEvent(resultButtonAfterSchool));
assert.equal(resultClick.ok, true);
assert.equal(controller.state.journey.matches.status, 'loaded', 'directory retry recovers only the directory results');

await controller.dispatch('public:fail-next');
const invalidatedLookup = await controller.selectSchool('state', 'Demo California');
assert.equal(invalidatedLookup.ok, false);
const portsBeforeSelectionChange = portTotals(calls);
const newSelection = await controller.selectSchool('state', 'Demo Washington');
assert.equal(newSelection.ok, true);
assert.equal((await controller.dispatch('public:retry-school-lookup')).error?.code, 'nothing_to_retry');
assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
const portsAfterSelectionChange = portTotals(calls);
assert.deepEqual(delta(portsBeforeSelectionChange, portsAfterSelectionChange), {'SchoolData.getCounties': 1}, 'stale retry adds no read after the replacement selection loads');

await controller.dispatch('public:fail-next');
const routeInvalidatedLookup = await controller.selectSchool('state', 'Demo California');
assert.equal(routeInvalidatedLookup.ok, false);
await controller.navigate('#/login');
const portsBeforeStaleEvent = portTotals(calls);
const staleEvent = await controller.dispatch('public:retry-school-lookup');
assert.equal(staleEvent.error?.code, 'nothing_to_retry');
assert.deepEqual(delta(portsBeforeStaleEvent, portTotals(calls)), {}, 'route-invalidated retry adds no service read');

const after = {
  actualPortCalls: portTotals(calls),
  runtimeReceiptCount: runtime.inspect().receipts.length,
  account: accountReceipt(fixture.snapshot()),
};
assert.deepEqual(after.account, before.account, 'lookup and directory recovery do not mutate account/profile receipt');
assert.equal(after.actualPortCalls['Registration.registerTeacher'] || 0, 0);
assert.equal(after.actualPortCalls['TeacherProfile.createProfile'] || 0, 0);
assert.equal(after.actualPortCalls['Session.login'] || 0, 0);
assert.equal(after.actualPortCalls['Session.logout'] || 0, 0);

console.log(JSON.stringify({
  fixture: {mode: runtime.mode, fixture: runtime.fixture, persistence: runtime.capabilities.persistence, productionAuthority: runtime.capabilities.productionAuthority},
  renderedSchoolEvent: 'public:retry-school-lookup',
  renderedResultEvent: 'public:retry',
  schoolClickPortDelta: delta(portsBeforeSchoolClick, portsAfterSchoolClick),
  afterSelectionInvalidationPortDelta: delta(portsBeforeSelectionChange, portsAfterSelectionChange),
  afterRouteInvalidationPortDelta: delta(portsBeforeStaleEvent, portTotals(calls)),
  before,
  after,
  directoryRecovered: controller.state.journey.matches.status === 'loaded',
  accountReceiptUnchanged: JSON.stringify(before.account) === JSON.stringify(after.account),
}, null, 2));
