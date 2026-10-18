import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createFixtureProvider, createServiceRuntime} from '../../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const repo = resolve('/workspace/scratch/8528bb251845/PageRouter');
const out = resolve('/workspace/scratch/8528bb251845/hh-cycle06/H2/R905/replay-output/R903');
await mkdir(out, {recursive: true});
const files = [
  'checkpoint/vendor/hh/src/public-controller.mjs',
  'checkpoint/vendor/hh/src/public-controller.test.mjs',
  'checkpoint/vendor/hh/src/public-site.mjs',
  'checkpoint/vendor/hh/services/fixture-provider.mjs',
  'checkpoint/vendor/hh/services/runtime.mjs',
];
const sha256 = async path => createHash('sha256').update(await readFile(resolve(repo, path))).digest('hex');

function treeInfo(node, text = [], elements = []) {
  if (typeof node === 'string' || typeof node === 'number') text.push(String(node));
  else if (Array.isArray(node)) for (const child of node) treeInfo(child, text, elements);
  else if (node && typeof node === 'object') {
    elements.push({tag: node.tag, attrs: node.attrs || {}});
    for (const child of node.children || []) treeInfo(child, text, elements);
  }
  return {text: text.join(' '), elements};
}

function controlledRuntime({delay = [], fail = []} = {}) {
  const base = createFixtureProvider({fixture: true});
  const gates = new Map(delay.map(port => {
    let startedResolve, releaseResolve;
    const started = new Promise(resolveStarted => { startedResolve = resolveStarted; });
    const held = new Promise(resolveHeld => { releaseResolve = resolveHeld; });
    return [port, {started, startedResolve, held, releaseResolve}];
  }));
  const observed = {};
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    const gate = gates.get(port);
    if (gate) { gate.startedResolve(); await gate.held; }
    const result = await invoke(fail.includes(port) ? {...input, failWith: port === 'Session.logout' ? 'denied' : 'transport_failure'} : input);
    observed[port] = result;
    return result;
  }]));
  const provider = {...base, services: Object.freeze(services)};
  return {
    runtime: createServiceRuntime(provider),
    observed,
    wait(port) { const gate = gates.get(port); assert.ok(gate, `gate for ${port}`); return gate.started; },
    release(port) { const gate = gates.get(port); assert.ok(gate, `gate for ${port}`); gate.releaseResolve(); },
  };
}

function controllerFor(runtime) { return createPublicController({runtime}); }

async function loginAvery(controller) {
  await controller.initialize('#/login');
  const result = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'synthetic-only'});
  assert.equal(result.ok, true);
  assert.equal(controller.state.journey.session.status, 'authenticated');
  return controller;
}

async function caseForeignSuccess() {
  const delayed = controlledRuntime({delay: ['Session.logout']});
  const c = await loginAvery(controllerFor(delayed.runtime));
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  await c.navigate('#/public-profile/demo-jordan');
  const projection = structuredClone(c.state.journey.profile);
  const before = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.equal(projection.value.teacherId, 'demo-seed-jordan');
  assert.match(before.text, /Demo Jordan/);
  delayed.release('Session.logout');
  const result = await logout;
  const after = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.equal(result.ok, true);
  assert.equal(c.route.path, '/public-profile/demo-jordan');
  assert.equal(c.state.journey.session.status, 'anonymous');
  assert.equal(c.state.journey.communityRole, 'anonymous');
  assert.deepEqual(c.state.journey.profile, projection);
  assert.match(after.text, /Demo Jordan/);
  const edit = await c.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'authentication_required');
  assert.deepEqual(c.state.journey.profile, projection);
  return {case: 'success_foreign_jordan', route: c.route.path, session: c.state.journey.session.status,
    communityRole: c.state.journey.communityRole, profileId: c.state.journey.profile.value.id,
    renderedJordanBefore: before.text.includes('Demo Jordan'), renderedJordanAfter: after.text.includes('Demo Jordan'),
    ownerEdit: edit.error.code, assertion: 'route, foreign profile projection and tree retained; session/community anonymous; edit denied'};
}

async function caseCapturedSuccess() {
  const delayed = controlledRuntime({delay: ['Session.logout']});
  const c = await loginAvery(controllerFor(delayed.runtime));
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  await c.navigate('#/pages/teacher.html');
  const projection = structuredClone(c.state.journey.profile);
  assert.equal(c.route.profileId, 'reference-sarah');
  assert.equal(projection.source, 'captured-readonly');
  assert.equal(projection.readOnly, true);
  delayed.release('Session.logout');
  assert.equal((await logout).ok, true);
  const tree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.deepEqual(c.state.journey.profile, projection);
  assert.match(tree.text, /Sarah Endsley/);
  assert.equal(c.state.journey.session.status, 'anonymous');
  assert.equal(c.state.journey.communityRole, 'anonymous');
  const edit = await c.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'read_only_reference');
  return {case: 'success_captured_readonly', route: c.route.path, session: c.state.journey.session.status,
    projectionSource: c.state.journey.profile.source, readOnly: c.state.journey.profile.readOnly,
    renderedSarah: tree.text.includes('Sarah Endsley'), edit: edit.error.code,
    assertion: 'captured projection/tree retained; readonly guard retains precedence after anonymous logout'};
}

async function pendingReadCase({profileId, finish}) {
  const failing = finish === 'failure';
  const delayed = controlledRuntime({delay: ['Session.logout', 'TeacherProfile.openPublicProfile'],
    fail: failing ? ['TeacherProfile.openPublicProfile'] : []});
  const c = await loginAvery(controllerFor(delayed.runtime));
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  const routeRead = c.navigate(`#/public-profile/${profileId}`);
  await delayed.wait('TeacherProfile.openPublicProfile');
  const pendingProjection = structuredClone(c.state.journey.profile);
  assert.equal(pendingProjection.status, 'loading');
  delayed.release('Session.logout');
  assert.equal((await logout).ok, true);
  assert.deepEqual(c.state.journey.profile, pendingProjection, 'logout must preserve the actual in-flight route projection');
  assert.equal(c.state.journey.session.status, 'anonymous');
  assert.equal(c.state.journey.communityRole, 'anonymous');
  delayed.release('TeacherProfile.openPublicProfile');
  const routeResult = await routeRead;
  const serviceRead = delayed.observed['TeacherProfile.openPublicProfile'];
  const final = structuredClone(c.state.journey.profile);
  const tree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  if (finish === 'success') {
    assert.equal(routeResult.ok, true);
    assert.equal(serviceRead.ok, true);
    assert.equal(final.status, 'present');
    assert.equal(final.value.id, profileId);
    assert.match(tree.text, /Demo Jordan/);
  } else {
    assert.equal(routeResult.ok, true, 'navigate reports route installation; service read reports its own outcome');
    assert.equal(serviceRead.ok, false);
    assert.equal(final.status, 'error');
    assert.equal(final.value, null);
    assert.doesNotMatch(tree.text, /Demo Jordan/);
    if (finish === 'failure') assert.equal(serviceRead.error.code, 'transport_failure');
    if (finish === 'not_found') assert.equal(serviceRead.error.code, 'not_found');
  }
  return {case: `pending_read_${finish}`, route: c.route.path, logoutSession: c.state.journey.session.status,
    projectionWhileReadHeldAfterLogout: pendingProjection.status, read: {routeOk: routeResult.ok, serviceOk: serviceRead.ok, code: serviceRead.error?.code || null},
    finalProjection: {status: final.status, id: final.value?.id || null}, renderedJordan: tree.text.includes('Demo Jordan'),
    assertion: 'pending projection preserved across logout; read completes with its own success/failure/not-found result'};
}

async function caseOwnAliasPrivacy() {
  const delayed = controlledRuntime({delay: ['Session.logout']});
  const c = controllerFor(delayed.runtime);
  await c.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) await c.selectSchool(key, value);
  await c.dispatch('public:terms-consent', {accepted: true});
  const email = 'r903-owner@example.invalid';
  assert.equal((await c.dispatch('public:register', {name: 'H2 Owner', email, password: 'synthetic-only', confirm_password: 'synthetic-only'})).ok, true);
  assert.equal((await c.dispatch('public:approve')).ok, true);
  assert.equal((await c.dispatch('public:login', {email, password: 'synthetic-only'})).ok, true);
  await c.navigate('#/profile');
  assert.equal((await c.dispatch('public:profile-create', {name: 'Owner Alias Display', bio: 'Synthetic local overlay'})).ok, true);
  const ownId = delayed.runtime.snapshot().ownProfile.profile.id;
  await c.navigate(`#/public-profile/${ownId}`);
  const ownerProjection = structuredClone(c.state.journey.profile);
  assert.equal(ownerProjection.value.id, ownId);
  assert.equal(ownerProjection.source, 'local-overlay');
  assert.match(treeInfo(renderPublicSite({route: c.route, state: c.state})).text, /Owner Alias Display/);
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  // Navigate to the public own alias while the operation is outstanding.
  await c.navigate(`#/public-profile/${ownId}`);
  assert.equal(c.state.journey.profile.value.id, ownId);
  const preLogoutTree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  delayed.release('Session.logout');
  assert.equal((await logout).ok, true);
  const postLogoutTree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.equal(c.state.journey.session.status, 'anonymous');
  assert.equal(c.state.journey.profile.status, 'unknown', 'logout clears owner-alias projection');
  assert.doesNotMatch(postLogoutTree.text, /Owner Alias Display/);
  const edit = await c.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'profile_unavailable');
  const dataBefore = ownerProjection.value.id;
  const dataAfter = delayed.runtime.snapshot().demo.publicProfiles.find(profile => profile.id === ownId)?.id;
  assert.equal(dataAfter, dataBefore, 'provider profile record still exists; only ephemeral route projection was cleared');
  return {case: 'success_own_public_alias_privacy', ownProfileId: ownId, route: c.route.path,
    beforeRenderedOverlay: preLogoutTree.text.includes('Owner Alias Display'), afterRenderedOverlay: postLogoutTree.text.includes('Owner Alias Display'),
    profileStatus: c.state.journey.profile.status, session: c.state.journey.session.status,
    providerRecordStillPresent: dataAfter === dataBefore, edit: edit.error.code,
    assertion: 'same-id own public alias clears transient projection on logout; renderer no longer exposes the local overlay; provider record is not deleted'};
}

async function caseSameRouteLogout() {
  const delayed = controlledRuntime({delay: ['Session.logout']});
  const c = await loginAvery(controllerFor(delayed.runtime));
  assert.equal(c.route.page, 'profile');
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  delayed.release('Session.logout');
  assert.equal((await logout).ok, true);
  const tree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.equal(c.route.page, 'login');
  assert.equal(c.state.journey.session.status, 'anonymous');
  assert.equal(c.state.journey.communityRole, 'anonymous');
  assert.equal(c.state.journey.profile.status, 'unknown');
  assert.match(tree.text, /Log In to Your Account/);
  return {case: 'same_route_normal_logout', route: c.route.path, session: c.state.journey.session.status,
    communityRole: c.state.journey.communityRole, profileStatus: c.state.journey.profile.status,
    loginPageRendered: tree.text.includes('Log In to Your Account'), assertion: 'original route redirect and privacy clear preserved'};
}

async function caseFailedLogout() {
  const delayed = controlledRuntime({delay: ['Session.logout'], fail: ['Session.logout']});
  const c = await loginAvery(controllerFor(delayed.runtime));
  const logout = c.dispatch('public:logout');
  await delayed.wait('Session.logout');
  await c.navigate('#/public-profile/demo-jordan');
  const projection = structuredClone(c.state.journey.profile);
  const preTree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  delayed.release('Session.logout');
  const result = await logout;
  const postTree = treeInfo(renderPublicSite({route: c.route, state: c.state}));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'denied');
  assert.equal(delayed.runtime.snapshot().session.status, 'authenticated');
  assert.equal(c.state.journey.session.status, 'authenticated');
  assert.equal(c.state.journey.communityRole, 'teacher');
  assert.deepEqual(c.state.journey.profile, projection);
  assert.match(postTree.text, /Demo Jordan/);
  assert.deepEqual(delayed.runtime.snapshot().demo.publicProfiles.map(p => p.id), ['demo-avery', 'demo-jordan']);
  const edit = await c.dispatch('public:edit-profile');
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'profile_owner_mismatch');
  return {case: 'failed_logout_control', result: result.error.code, route: c.route.path,
    session: c.state.journey.session.status, communityRole: c.state.journey.communityRole,
    projectionPreserved: JSON.stringify(c.state.journey.profile) === JSON.stringify(projection),
    jordanRenderedBefore: preTree.text.includes('Demo Jordan'), jordanRenderedAfter: postTree.text.includes('Demo Jordan'),
    edit: edit.error.code, providerProfiles: delayed.runtime.snapshot().demo.publicProfiles.map(p => p.id),
    assertion: 'failed logout preserves auth/community/projection/render and foreign-owner edit rejection'};
}

async function main() {
  const result = {schema: 'hh-cycle06-H2-R903/independent-review/v1', job_id: 'R903', worker: 'H2',
    repository: 'PageRouter', head: 'a5b141816ffb871110e541ef00ecf9527674137e', tree: '5eb00395e85afeb357be11b6add395ef5fbb6b68',
    sourceHashes: {}, commands: [
      'node /workspace/scratch/8528bb251845/hh-cycle06/H2/R903/probe.mjs',
      "node --test --test-name-pattern='successful logout|failed logout after navigation' checkpoint/vendor/hh/src/public-controller.test.mjs",
      'node --test checkpoint/vendor/hh/src/public-controller.test.mjs',
      'node --test --test-concurrency=2 exp/cooperative/hh-geography-review.test.mjs exp/cooperative/hh-parity-community.test.mjs exp/cooperative/hh-parity-public.test.mjs exp/cooperative/hh-workbench.test.mjs vendor/hh/src/*.test.mjs (cwd: PageRouter/checkpoint)',
    ], validation: {
      focusedController: {passed: 5, failed: 0, log: 'focused.stdout.log'},
      fullController: {passed: 42, failed: 0, log: 'controller.stdout.log'},
      relevantHHWithoutStyle: {passed: 109, failed: 0, log: 'hh-relevant.stdout.log'},
      styleDependency: 'Not run directly; no success claim for dependency-dependent style suite.',
    }, environment: {runtime: 'actual createFixtureProvider volatile-memory + createServiceRuntime + createPublicController + renderPublicSite tree',
      identities: 'synthetic seeded Demo Avery / synthetic H2-only demo identity', productionAuthority: false, network: false,
      backendExecution: false, browserVisualQA: false, humanAcceptance: false}, cases: []};
  for (const file of files) result.sourceHashes[file] = await sha256(file);
  result.cases.push(await caseForeignSuccess());
  result.cases.push(await caseCapturedSuccess());
  result.cases.push(await pendingReadCase({profileId: 'demo-jordan', finish: 'success'}));
  result.cases.push(await pendingReadCase({profileId: 'demo-jordan', finish: 'failure'}));
  result.cases.push(await pendingReadCase({profileId: 'does-not-exist', finish: 'not_found'}));
  result.cases.push(await caseOwnAliasPrivacy());
  result.cases.push(await caseSameRouteLogout());
  result.cases.push(await caseFailedLogout());
  result.assertionsPassed = result.cases.length === 8;
  result.outcome = result.assertionsPassed ? 'accepted' : 'amend';
  result.summary = 'The frozen correction preserves foreign, captured-readonly, and pending public-profile projections across successful delayed logout while runtime session and community authority become anonymous. Pending reads independently complete success, transport failure, and not-found outcomes after logout. Same-id own public alias and normal own-page logout clear the transient owner projection; same-route logout still redirects. Failure leaves auth, community role, foreign projection/tree, and owner mismatch guard intact. No profile record deletion or edit authority expansion occurred.';
  result.next = 'Accept the exact two-file source freeze subject to H1 canonical build/evidence binding; no browser visual QA, backend execution, or human acceptance is established by this review.';
  return result;
}

try {
  const result = await main();
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const failure = {schema: 'hh-cycle06-H2-R903/independent-review/v1', job_id: 'R903', worker: 'H2', outcome: 'amend',
    error: {name: error?.name || 'Error', message: String(error?.message || error), stack: String(error?.stack || '')}};
  await writeFile(resolve(out, 'result.json'), `${JSON.stringify(failure, null, 2)}\n`);
  console.log(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
}
