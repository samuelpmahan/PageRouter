import assert from 'node:assert/strict';
import {createCommunity} from '../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';
import {createFixtureProvider, createServiceRuntime} from '../../PageRouter/checkpoint/vendor/hh/services/index.mjs';

function makeEnv() {
  const storage = null;
  const provider = createFixtureProvider({fixture: true, storage});
  const calls = [];
  const services = Object.fromEntries(Object.entries(provider.services).map(([port, invoke]) => [port, async input => {
    calls.push(port);
    return invoke(input);
  }]));
  const runtime = createServiceRuntime({...provider, services: Object.freeze(services)});
  let tree = null;
  const controller = createPublicController({runtime, storage, community: createCommunity({storage}),
    onChange(state, route) { tree = renderPublicSite({route, state, journey: state.journey}); },
  });
  const nodes = root => {
    const found = [];
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      found.push(node);
      for (const child of node.children || []) visit(child);
    };
    visit(root);
    return found;
  };
  return {storage, runtime, controller, calls, get tree() { return tree; }, nodes};
}

function accountProfileProjection(snapshot) {
  return JSON.stringify({session: snapshot.session, registration: snapshot.registration,
    ownProfile: snapshot.ownProfile, selectedTeacher: snapshot.demo?.selectedTeacher,
    selectedSchool: snapshot.demo?.selectedSchool, publicProfiles: snapshot.demo?.publicProfiles});
}

const env = makeEnv();
const {controller, runtime, calls, nodes} = env;
assert.equal(env.storage, null);
await controller.initialize('#/');
assert.equal(runtime.snapshot().diagnostics.persistence, 'volatile-memory');
const before = accountProfileProjection(runtime.snapshot());
const homeFind = () => nodes(env.tree).find(node => node.attrs?.id === 'hh-home-find-teachers');
const homeRandom = () => nodes(env.tree).find(node => node.attrs?.id === 'hh-home-random-teacher');
const homeRoute = () => nodes(env.tree).find(node => node.tag === 'a' && node.attrs?.['data-public-route'] === 'home');

await controller.navigate(homeFind().attrs.href);
const caLookup = await controller.selectSchool('state', 'Demo California');
assert.equal(caLookup.ok, true);
const searchForm = () => nodes(env.tree).find(node => node.tag === 'form' && node.attrs?.id === 'hh-directory-form');
controller.updateDraft('query', 'Jordan');
const queryInput = () => nodes(searchForm()).find(node => node.tag === 'input' && node.attrs?.name === 'query');
assert.equal(queryInput().attrs.value, 'Jordan');
const search = await controller.dispatch(searchForm().attrs['data-submit'], {query: queryInput().attrs.value});
assert.equal(search.ok, true);
assert.deepEqual(controller.state.journey.matches.items.map(profile => profile.id), ['demo-jordan']);
const retained = {query: controller.state.journey.filters.query, school: structuredClone(controller.state.journey.school),
  matches: controller.state.journey.matches.items.map(profile => profile.id)};

const selections = [];
for (let click = 0; click < 2; click += 1) {
  await controller.navigate(homeRoute().attrs.href);
  await controller.dispatch(homeRandom().attrs['data-event']);
  selections.push(controller.route.profileId);
}
assert.deepEqual(selections, ['demo-avery', 'demo-jordan']);
assert.ok(selections.some(id => !retained.matches.includes(id)), 'global Home pool includes a profile outside the prior directory subset');
assert.equal(controller.state.journey.filters.query, retained.query);
assert.deepEqual(controller.state.journey.school, retained.school);
assert.deepEqual(controller.state.journey.matches.items.map(profile => profile.id), retained.matches);
assert.equal(accountProfileProjection(runtime.snapshot()), before, 'Home random reads do not change runtime account/profile data');
assert.equal(calls.filter(port => !['SchoolData.getStates', 'SchoolData.getCounties', 'TeacherProfile.openPublicProfile'].includes(port)).length, 0,
  'only school-choice and public-profile reads are invoked');
assert.deepEqual(calls, ['SchoolData.getStates', 'SchoolData.getCounties', 'TeacherProfile.openPublicProfile', 'TeacherProfile.openPublicProfile']);
assert.equal(runtime.inspect().receipts.length, 5, 'four service reads plus the runtime service-binding composition receipt');

const fresh = makeEnv();
await fresh.controller.initialize('#/');
const freshBefore = accountProfileProjection(fresh.runtime.snapshot());
const freshRandom = fresh.nodes(fresh.tree).find(node => node.attrs?.id === 'hh-home-random-teacher');
await fresh.controller.dispatch(freshRandom.attrs['data-event']);
assert.equal(fresh.controller.route.profileId, 'demo-avery', 'fresh Home starts the deterministic two-profile cycle at its first global profile');
assert.equal(accountProfileProjection(fresh.runtime.snapshot()), freshBefore);
assert.deepEqual(fresh.calls, ['SchoolData.getStates', 'TeacherProfile.openPublicProfile']);
assert.equal(fresh.runtime.inspect().receipts.length, 3, 'two service reads plus the runtime service-binding composition receipt');

console.log(JSON.stringify({ok: true, priorDirectory: retained, homeCycle: selections,
  freshHomeProfile: fresh.controller.route.profileId, ports: calls, freshPorts: fresh.calls,
  runtimeAccountProfileUnchanged: true, runtimeReceiptCounts: [runtime.inspect().receipts.length, fresh.runtime.inspect().receipts.length],
  storage: 'null/volatile-memory'}, null, 2));
