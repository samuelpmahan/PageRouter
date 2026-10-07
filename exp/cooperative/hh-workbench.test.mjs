import test from 'node:test';
import assert from 'node:assert/strict';
import {Part} from '../../vendor/hh/services/pxc.mjs';
import {FIXTURE_WISHLIST_URL} from '../../vendor/hh/services/fixtures.mjs';
import {createHHWorkbench} from './hh-workbench.mjs';

const school = {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'};
const teacher = {name: 'Demo Compose Teacher', email: 'compose.teacher@fixture.test', phoneNumber: 'DEMO'};

test('exposes each HH fixture service as a real kernel Part and receipt', async () => {
  const workbench = createHHWorkbench();
  assert.equal(workbench.listCapabilities().length, 14);
  const call = await workbench.invoke('school.states');
  assert.equal(call.ok, true);
  assert.deepEqual(call.result.data.values, ['Demo California', 'Demo Washington']);
  assert.ok(call.part instanceof Part);
  assert.equal(call.receipt.status, 'produced');
  assert.equal(call.receipt.into, 'hh.result.1');
  assert.doesNotThrow(() => JSON.stringify(workbench.inspect()));
});

test('runs a multi-stage school search through the HH service ports', async () => {
  const workbench = createHHWorkbench();
  const result = await workbench.compose({workflow: 'schoolSearch', state: 'Demo Washington', chooseFirst: true});
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((step) => step.port), [
    'SchoolData.getStates', 'SchoolData.getCounties', 'SchoolData.getDistricts', 'SchoolData.getSchools',
  ]);
  assert.deepEqual(result.outcomes.at(-1).result.data.values, ['Demo Academy', 'Demo STEM School']);
  assert.ok(result.part instanceof Part);
  assert.equal(result.receipt.status, 'produced');
  assert.deepEqual(workbench.inspect().kernel.receipts.slice(-5).map((receipt) => receipt.into), [
    'hh.result.1', 'hh.result.2', 'hh.result.3', 'hh.result.4', 'hh.workbench.composition.1.result',
  ]);
});

test('composes registration, approval, demo login, profile creation and public read', async () => {
  const workbench = createHHWorkbench();
  await workbench.runtime.ready;
  const result = await workbench.compose({workflow: 'teacherOnboarding', teacher, school,
    profile: {displayName: 'Demo Compose Teacher', bio: 'A synthetic classroom.', subjects: ['Science'], wishlistUrl: FIXTURE_WISHLIST_URL},
    openPublicProfile: true});
  assert.equal(result.ok, true);
  assert.deepEqual(result.outcomes.map((stage) => stage.result.outcome), [
    'pending_saved', 'approval_simulated', 'logged_in', 'profile_created', 'loaded',
  ]);
  assert.equal(result.outcomes.at(-1).result.data.profile.displayName, 'Demo Compose Teacher');
  assert.equal(workbench.snapshot().ownProfile.status, 'present');
  const reset = await workbench.reset();
  assert.equal(reset.result.outcome, 'reset');
  assert.equal(workbench.snapshot().ownProfile.status, 'unknown');
});

test('supports separated approval/login, profile publication and directory reads', async () => {
  const workbench = createHHWorkbench();
  const approvalLogin = await workbench.compose({workflow: 'approvalLogin', teacherId: 'demo-seed-avery', email: 'avery@fixture.test'});
  assert.equal(approvalLogin.ok, true);
  assert.deepEqual(approvalLogin.outcomes.map((stage) => stage.result.outcome), ['approval_simulated', 'logged_in']);
  const publish = await workbench.compose({workflow: 'profilePublish', profile: {
    displayName: 'Demo Avery', bio: 'Synthetic update.', subjects: ['Science'], wishlistUrl: FIXTURE_WISHLIST_URL,
  }});
  assert.equal(publish.ok, false);
  assert.equal(publish.outcomes[0].result.outcome, 'profile_exists');
  assert.equal(publish.outcomes.length, 1);
  const directory = await workbench.compose({workflow: 'publicDirectory', profileIds: ['demo-avery', 'demo-jordan']});
  assert.equal(directory.ok, true);
  assert.deepEqual(directory.outcomes.map((stage) => stage.result.data.profile.id), ['demo-avery', 'demo-jordan']);
  assert.ok(workbench.listWorkflows().length >= 5);
});

test('rejects credential-shaped inputs before creating a request Part', async () => {
  const workbench = createHHWorkbench();
  await workbench.runtime.ready;
  const before = workbench.inspect().kernel.receipts.length;
  const call = await workbench.invoke('session.login', {email: teacher.email, password: 'not allowed'});
  assert.equal(call.result.error.code, 'unsafe_input');
  assert.equal(workbench.inspect().kernel.receipts.length, before);
});

test('serializes concurrent calls and keeps receipts paired with their actual results', async () => {
  const workbench = createHHWorkbench();
  const [states, session] = await Promise.all([
    workbench.invoke('school.states'), workbench.invoke('session.status'),
  ]);
  assert.equal(states.receipt.into, states.part.composition && 'hh.result.1');
  assert.equal(session.receipt.into, 'hh.result.2');
  assert.equal(states.result.port, 'SchoolData.getStates');
  assert.equal(session.result.port, 'Session.getSession');
});

test('reports missing composition references with a real failed kernel receipt', async () => {
  const workbench = createHHWorkbench();
  const run = await workbench.compose({stages: [
    {id: 'lookup', operation: 'school.states', inputs: {}},
    {id: 'badReference', operation: 'school.counties', inputs: {state: {$ref: 'lookup.data.notThere'}}},
  ]});
  assert.equal(run.ok, false);
  assert.equal(run.outcome, 'composition_failed');
  assert.equal(run.receipt.status, 'failed');
  assert.match(run.error.message, /no value/);
});

const directoryPlan = () => ({name: 'Schools for a state', stages: [
  {id: 'states', operation: 'school.states', inputs: {}},
  {id: 'counties', operation: 'school.counties', inputs: {state: {$input: 'state'}}},
  {id: 'districts', operation: 'school.districts', inputs: {state: {$input: 'state'}, county: {$ref: 'counties.data.values.0'}}},
  {id: 'schools', operation: 'school.schools', inputs: {state: {$input: 'state'}, county: {$ref: 'counties.data.values.0'}, district: {$ref: 'districts.data.values.0'}}},
]});
const directorySchema = {type: 'object', required: ['state'], properties: {state: {type: 'string', description: 'Fixture state to search'}}, example: {state: 'Demo Washington'}};

test('defines and invokes a reusable Calculation Part using editable parameter bindings', async () => {
  const workbench = createHHWorkbench();
  const defined = await workbench.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema});
  assert.equal(defined.ok, true);
  assert.equal(defined.definition.operation, 'calculation.schoolDirectory');
  assert.equal(defined.definition.operationVersion, 'calculation.schoolDirectory@1');
  assert.deepEqual(defined.definition.outputs.map(({path, type}) => [path, type]), [
    ['outcomes.3.result.data.values', 'array'], ['outcomes.3.result.data.values.0', 'string'],
  ]);
  const actualPart = workbench.runtime.pxc.get(defined.definition.address);
  assert.ok(actualPart instanceof Part);
  assert.equal(typeof actualPart.value, 'function');
  const invocation = await workbench.invoke(defined.definition.operation, {state: 'Demo Washington'});
  assert.equal(invocation.ok, true);
  assert.deepEqual(invocation.result.outcomes.at(-1).result.data.values, ['Demo Academy', 'Demo STEM School']);
  assert.ok(invocation.part instanceof Part);
  assert.equal(invocation.receipt.into, 'hh.workbench.calculation-call.1.result');
  const inspected = await workbench.inspectPart(invocation.receipt.into);
  assert.equal(inspected.receipt.status, 'produced');
  assert.equal(inspected.composition.calculation, defined.definition.address);
  assert.deepEqual(workbench.listOperations().filter((operation) => operation.kind === 'calculation').map((operation) => operation.operation), [
    'calculation.schoolDirectory', 'calculation.schoolDirectory@1',
  ]);
});

test('nests a named Calculation inside a larger output-to-input composition with real inner receipts', async () => {
  const workbench = createHHWorkbench();
  const base = await workbench.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema});
  const outer = await workbench.defineCalculation({id: 'confirmFirstSchool', inputSchema: directorySchema, plan: {name: 'Verify first school', stages: [
    {id: 'directory', operation: base.definition.operation, inputs: {state: {$input: 'state'}}},
    {id: 'schoolsAgain', operation: 'school.schools', inputs: {state: {$input: 'state'},
      county: {$ref: 'directory.outcomes.1.result.data.values.0'}, district: {$ref: 'directory.outcomes.2.result.data.values.0'}}},
  ]}});
  assert.equal(outer.ok, true);
  assert.equal(outer.definition.plan.stages[0].operation, 'calculation.schoolDirectory@1');
  const result = await workbench.invoke(outer.definition.operation, {state: 'Demo Washington'});
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.outcomes.at(-1).result.data.values, ['Demo Academy', 'Demo STEM School']);
  const addresses = workbench.runtime.pxc.receipts().map((receipt) => receipt.into);
  assert.ok(addresses.some((address) => address.startsWith('hh.workbench.calculation-call.')));
  assert.ok(addresses.some((address) => address.startsWith('hh.result.')));
  assert.equal(result.receipt.status, 'produced');
  const wired = await workbench.compose({name: 'Call the reusable calculation then consume its output',
    inputSchema: directorySchema, inputs: {state: 'Demo Washington'}, stages: [
      {id: 'directory', operation: 'calculation.schoolDirectory', inputs: {state: {$input: 'state'}}},
      {id: 'again', operation: 'school.schools', inputs: {state: {$input: 'state'},
        county: {$ref: 'directory.outcomes.1.result.data.values.0'}, district: {$ref: 'directory.outcomes.2.result.data.values.0'}}},
    ]});
  assert.equal(wired.ok, true);
  assert.equal(wired.outcomes[0].operation, 'calculation.schoolDirectory@1');
  assert.deepEqual(wired.outcomes[1].result.data.values, ['Demo Academy', 'Demo STEM School']);
});

test('requires explicit replace and pins existing dependents to the prior Calculation version', async () => {
  const workbench = createHHWorkbench();
  const first = await workbench.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema});
  const dependent = await workbench.defineCalculation({id: 'dependent', inputSchema: directorySchema, plan: {stages: [
    {id: 'directory', operation: first.definition.operation, inputs: {state: {$input: 'state'}}},
  ]}});
  const blocked = await workbench.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema});
  assert.equal(blocked.ok, false);
  const replaced = await workbench.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema, replace: true});
  assert.equal(replaced.ok, true);
  assert.equal(replaced.definition.version, 2);
  assert.equal(dependent.definition.plan.stages[0].operation, 'calculation.schoolDirectory@1');
  assert.equal(workbench.listCalculationVersions('schoolDirectory').length, 2);
  const result = await workbench.invoke('calculation.dependent', {state: 'Demo Washington'});
  assert.equal(result.ok, true);
  assert.equal(result.receipt.composition.calculation, workbench.runtime.pxc.get(dependent.definition.address));
  const loaded = createHHWorkbench();
  const importResult = await loaded.importSession(workbench.exportSession());
  assert.equal(importResult.ok, true);
  assert.equal(loaded.listCalculationVersions('schoolDirectory').length, 2);
  const replay = await loaded.invoke('calculation.dependent', {state: 'Demo Washington'});
  assert.equal(replay.ok, true);
  const pinnedDirectory = loaded.listParts().then((parts) => parts.find((part) => part.address === first.definition.address));
  assert.equal((await pinnedDirectory).calculation.active, false);
});

test('rejects undeclared inputs and cyclic imports before adding any Parts', async () => {
  const workbench = createHHWorkbench();
  await workbench.runtime.ready;
  const before = workbench.runtime.pxc.entries().length;
  const invalidBinding = await workbench.defineCalculation({id: 'badBinding', plan: {stages: [
    {id: 'states', operation: 'school.states', inputs: {}},
    {id: 'counties', operation: 'school.counties', inputs: {state: {$input: 'missing'}}},
  ]}, inputSchema: {
    type: 'object', required: ['state'], properties: {state: {type: 'string'}},
  }});
  assert.equal(invalidBinding.ok, false);
  assert.equal(workbench.runtime.pxc.entries().length, before);
  const cycle = await workbench.importSession({format: 'hh-workbench-session', version: 1, definitions: [
    {id: 'alpha', version: 1, active: true, inputSchema: {type: 'object', properties: {}}, plan: {stages: [
      {id: 'beta', operation: 'calculation.beta@1', inputs: {}},
    ]}},
    {id: 'beta', version: 1, active: true, inputSchema: {type: 'object', properties: {}}, plan: {stages: [
      {id: 'alpha', operation: 'calculation.alpha@1', inputs: {}},
    ]}},
  ]});
  assert.equal(cycle.ok, false);
  assert.match(cycle.error.message, /cycle/i);
  assert.equal(workbench.runtime.pxc.entries().length, before);
  assert.deepEqual(workbench.listDefinedCalculations(), []);
});

test('exports and atomically imports data-only graph source, then replays it', async () => {
  const source = createHHWorkbench();
  await source.defineCalculation({id: 'schoolDirectory', plan: directoryPlan(), inputSchema: directorySchema});
  const data = source.exportSession();
  assert.equal(data.format, 'hh-workbench-session');
  assert.equal(data.definitions[0].sourceGraph.format, 'pxcube-composition-graph/1');
  assert.equal(data.definitions[0].sourceGraph.nodes.length, 4);
  assert.ok(data.definitions[0].sourceGraph.bindings.some((binding) => binding.kind === 'connection'));
  assert.doesNotThrow(() => JSON.stringify(data));
  const loaded = createHHWorkbench();
  const imported = await loaded.importSession(data);
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.imported, ['calculation.schoolDirectory@1']);
  const replay = await loaded.invoke('calculation.schoolDirectory', {state: 'Demo California'});
  assert.equal(replay.ok, true);
  assert.deepEqual(replay.result.outcomes.at(-1).result.data.values, ['Demo Bay School']);
  assert.equal((await loaded.inspectPart(imported.definitions[0].address)).kind, 'definedCalculationPart');
  const beforeInvalid = loaded.runtime.pxc.entries().length;
  const untrusted = await loaded.importSession({format: 'hh-workbench-session', version: 1, definitions: [
    {id: 'unsafe', version: 1, active: true, inputSchema: {type: 'object', properties: {}}, plan: {stages: [
      {id: 'run', operation: 'eval', inputs: {source: '1+1'}},
    ]}},
  ]});
  assert.equal(untrusted.ok, false);
  assert.equal(loaded.runtime.pxc.entries().length, beforeInvalid);
  let getterRan = false;
  const getterBackedDefinition = {};
  Object.defineProperty(getterBackedDefinition, 'operation', {enumerable: true, get() { getterRan = true; throw new Error('must not run'); }});
  const accessorImport = await loaded.importSession({format: 'hh-workbench-session', version: 1, definitions: [getterBackedDefinition]});
  assert.equal(accessorImport.ok, false);
  assert.equal(getterRan, false);
  assert.equal(loaded.runtime.pxc.entries().length, beforeInvalid);
});
