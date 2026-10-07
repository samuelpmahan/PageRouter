import {createFixtureProvider} from '../../vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '../../vendor/hh/services/runtime.mjs';
import {Part} from '../../vendor/hh/services/pxc.mjs';
import {HH_PORTS} from '../../vendor/hh/services/contract.mjs';

const OPERATIONS = Object.freeze([
  ['school.states', 'SchoolData.getStates', 'List synthetic fixture states'],
  ['school.counties', 'SchoolData.getCounties', 'List counties in a selected state'],
  ['school.districts', 'SchoolData.getDistricts', 'List districts in a selected county'],
  ['school.schools', 'SchoolData.getSchools', 'List schools in a selected district'],
  ['registration.create', 'Registration.registerTeacher', 'Create a synthetic pending teacher registration'],
  ['registration.status', 'Registration.getOwnStatus', 'Read the selected synthetic registration status'],
  ['session.status', 'Session.getSession', 'Read the current synthetic demo session'],
  ['session.login', 'Session.login', 'Open an explicitly selected synthetic demo session'],
  ['session.logout', 'Session.logout', 'Close the synthetic demo session'],
  ['profile.create', 'TeacherProfile.createProfile', 'Create the current demo teacher profile'],
  ['profile.own', 'TeacherProfile.getOwnProfile', 'Read the current teacher profile'],
  ['profile.public', 'TeacherProfile.openPublicProfile', 'Read a public synthetic profile by ID'],
  ['demo.reset', 'Demo.reset', 'Reset disposable state while keeping seeded profiles'],
  ['demo.approve', 'Demo.simulateApproval', 'Simulate approval for a synthetic registration'],
]);
const OP_BY_ID = new Map(OPERATIONS.map(([id, port, description]) => [id, {id, port, description}]));
const INPUT_SPECS = Object.freeze({
  'school.states': {required: [], example: {}},
  'school.counties': {required: ['state'], example: {state: 'Demo Washington'}},
  'school.districts': {required: ['state', 'county'], example: {state: 'Demo Washington', county: 'Demo King'}},
  'school.schools': {required: ['state', 'county', 'district'], example: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District'}},
  'registration.create': {required: ['teacher', 'school', 'demoAccount', 'termsAccepted'], example: {
    teacher: {name: 'Demo Compose Teacher', email: 'compose.teacher@fixture.test', phoneNumber: 'DEMO'},
    school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'}, demoAccount: true, termsAccepted: true}},
  'registration.status': {required: [], example: {}},
  'session.status': {required: [], example: {}},
  'session.login': {required: ['email', 'demoAccount'], example: {email: 'compose.teacher@fixture.test', demoAccount: true}},
  'session.logout': {required: [], example: {}},
  'profile.create': {required: ['displayName', 'subjects', 'wishlistUrl'], example: {
    displayName: 'Demo Compose Teacher', bio: 'A synthetic classroom.', subjects: ['Science'], wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW'}},
  'profile.own': {required: [], example: {}},
  'profile.public': {required: ['profileId'], example: {profileId: 'demo-avery'}},
  'demo.reset': {required: [], example: {}},
  'demo.approve': {required: [], example: {}},
});
const INPUT_FIELDS = Object.freeze({
  'school.states': {},
  'school.counties': {state: 'string'},
  'school.districts': {state: 'string', county: 'string'},
  'school.schools': {state: 'string', county: 'string', district: 'string'},
  'registration.create': {teacher: 'object', school: 'object', demoAccount: 'boolean', termsAccepted: 'boolean', simulateMailFailure: 'boolean', failWith: 'string'},
  'registration.status': {failWith: 'string'},
  'session.status': {failWith: 'string'},
  'session.login': {email: 'string', demoAccount: 'boolean', failWith: 'string'},
  'session.logout': {failWith: 'string'},
  'profile.create': {displayName: 'string', bio: 'string', subjects: 'array', wishlistUrl: 'string', failWith: 'string'},
  'profile.own': {failWith: 'string'},
  'profile.public': {profileId: 'string', failWith: 'string'},
  'demo.reset': {failWith: 'string'},
  'demo.approve': {teacherId: 'string', failWith: 'string'},
});
const OUTPUT_PORTS = Object.freeze({
  'school.states': [{path: 'data.values', type: 'array'}, {path: 'data.values.0', type: 'string'}],
  'school.counties': [{path: 'data.values', type: 'array'}, {path: 'data.values.0', type: 'string'}],
  'school.districts': [{path: 'data.values', type: 'array'}, {path: 'data.values.0', type: 'string'}],
  'school.schools': [{path: 'data.values', type: 'array'}, {path: 'data.values.0', type: 'string'}],
  'registration.create': [{path: 'data.pending_saved', type: 'boolean'}, {path: 'data.registration', type: 'object'}, {path: 'data.mail.status', type: 'string'}],
  'registration.status': [{path: 'data.registration', type: 'object'}, {path: 'data.registration.status', type: 'string'}, {path: 'data.registration.teacherId', type: 'string', nullable: true}],
  'session.status': [{path: 'data.session', type: 'object'}, {path: 'data.session.status', type: 'string'}, {path: 'data.session.teacherId', type: 'string', nullable: true}],
  'session.login': [{path: 'data.session', type: 'object'}, {path: 'data.registration', type: 'object'}, {path: 'data.ownProfile', type: 'object'}],
  'session.logout': [{path: 'data.session', type: 'object'}, {path: 'data.session.status', type: 'string'}],
  'profile.create': [{path: 'data.profile', type: 'object'}, {path: 'data.profile.id', type: 'string'}, {path: 'data.ownProfile', type: 'object'}],
  'profile.own': [{path: 'data.ownProfile', type: 'object'}, {path: 'data.ownProfile.status', type: 'string'}, {path: 'data.ownProfile.profile', type: 'object', nullable: true}],
  'profile.public': [{path: 'data.profile', type: 'object'}, {path: 'data.profile.id', type: 'string'}, {path: 'data.profile.displayName', type: 'string'}],
  'demo.reset': [{path: 'data.journey', type: 'object'}, {path: 'data.journey.session.status', type: 'string'}],
  'demo.approve': [{path: 'data.registration', type: 'object'}, {path: 'data.registration.status', type: 'string'}, {path: 'data.session.status', type: 'string'}],
});
const WORKFLOWS = Object.freeze([
  Object.freeze({id: 'schoolSearch', description: 'Walk the fixture school hierarchy and choose the first match at each level', example: {workflow: 'schoolSearch', chooseFirst: true}}),
  Object.freeze({id: 'teacherOnboarding', description: 'Register, simulate approval, demo-login, and optionally create and read a profile', example: {workflow: 'teacherOnboarding', teacher: {name: 'Demo Compose Teacher', email: 'compose.teacher@fixture.test', phoneNumber: 'DEMO'}, school: {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'}, profile: {displayName: 'Demo Compose Teacher', bio: 'A synthetic classroom.', subjects: ['Science'], wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW'}, openPublicProfile: true}}),
  Object.freeze({id: 'approvalLogin', description: 'Simulate approval, then start a selected fixture teacher’s demo session', inputSchema: {required: ['email', 'teacherId'], properties: {email: 'string', teacherId: 'string'}}, example: {workflow: 'approvalLogin', teacherId: 'demo-seed-avery', email: 'avery@fixture.test'}}),
  Object.freeze({id: 'profilePublish', description: 'Create a profile for the current demo session and read its public projection', inputSchema: {required: ['profile'], properties: {profile: 'object'}}, example: {workflow: 'profilePublish', profile: {displayName: 'Demo Compose Teacher', bio: 'A synthetic classroom.', subjects: ['Science'], wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW'}}}),
  Object.freeze({id: 'publicDirectory', description: 'Read several known seeded or current-tab public profiles in order', inputSchema: {required: ['profileIds'], properties: {profileIds: 'array'}}, example: {workflow: 'publicDirectory', profileIds: ['demo-avery', 'demo-jordan']}}),
]);
const SECRET_KEY = /password|credential|token|secret|authorization|cookie/i;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTree(child);
  return value;
}

function safePayload(value, seen = new Set()) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => SECRET_KEY.test(key))) return false;
    } catch { /* ordinary text */ }
    return true;
  }
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value !== 'number' || Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (![Object.prototype, Array.prototype, null].includes(prototype)) return false;
  seen.add(value);
  let okay = true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || SECRET_KEY.test(key)) { okay = false; break; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !safePayload(descriptor.value, seen)) { okay = false; break; }
  }
  seen.delete(value);
  return okay;
}

function getPath(value, path) {
  if (!path) return value;
  return path.split('.').reduce((current, key) => current && own(Object(current), key) ? current[key] : undefined, value);
}

function resolveBindings(value, completed, runtimeInputs) {
  if (Array.isArray(value)) return value.map((item) => resolveBindings(item, completed, runtimeInputs));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 1 && typeof value.$ref === 'string') {
      const dot = value.$ref.indexOf('.');
      const stageId = dot < 0 ? value.$ref : value.$ref.slice(0, dot);
      const path = dot < 0 ? '' : value.$ref.slice(dot + 1);
      if (!completed.has(stageId)) throw new Error(`Composition reference is not available: ${stageId}`);
      const found = getPath(completed.get(stageId), path);
      if (found === undefined) throw new Error(`Composition reference has no value: ${value.$ref}`);
      return found;
    }
    if (keys.length === 1 && typeof value.$input === 'string') {
      const found = getPath(runtimeInputs, value.$input);
      if (found === undefined) throw new Error(`Calculation input binding has no value: ${value.$input}`);
      return found;
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveBindings(child, completed, runtimeInputs)]));
  }
  return value;
}

const SIMPLE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const ALLOWED_INPUT_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'null', 'any']);
const operationForCalculation = (id) => `calculation.${id}`;
const pinnedOperationForCalculation = (id, version) => `calculation.${id}@${version}`;
const addressForCalculation = (id, version) => `hh.workbench.defined.${id}.v${version}.calculation`;

function calcOperationParts(operation) {
  if (typeof operation !== 'string' || !operation.startsWith('calculation.')) return null;
  const token = operation.slice('calculation.'.length);
  const match = /^([A-Za-z][A-Za-z0-9_-]{0,47})(?:@(\d+))?$/.exec(token);
  return match ? {id: match[1], version: match[2] ? Number(match[2]) : null} : null;
}

function collectBindings(value, visit, location = []) {
  if (Array.isArray(value)) { value.forEach((item, index) => collectBindings(item, visit, [...location, String(index)])); return; }
  if (!value || typeof value !== 'object') { visit({location, kind: 'literal', value}); return; }
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.$input === 'string') { visit({location, kind: 'parameter', path: value.$input}); return; }
  if (keys.length === 1 && typeof value.$ref === 'string') { visit({location, kind: 'connection', path: value.$ref}); return; }
  for (const [key, child] of Object.entries(value)) collectBindings(child, visit, [...location, key]);
}

function makeGraphSource(definition, resolveOutputs) {
  const nodes = definition.plan.stages.map((stage) => ({id: stage.id, operation: stage.operation,
    inputs: stage.inputs, outputs: resolveOutputs(stage.operation)}));
  const bindings = [];
  for (const stage of definition.plan.stages) collectBindings(stage.inputs, (binding) => bindings.push({stageId: stage.id, ...binding}));
  return freezeTree({format: 'pxcube-composition-graph/1', id: definition.id, version: definition.version,
    name: definition.plan.name, nodes, bindings, parameters: definition.inputSchema,
    interface: {inputs: definition.inputSchema, outputs: definition.outputs}});
}

function normalizeInputSchema(schema, plan) {
  if (schema === undefined || schema === null) {
    const properties = Object.create(null);
    for (const stage of plan.stages) collectInputPaths(stage.inputs, (path) => {
      const root = path.split('.')[0];
      if (SIMPLE_ID.test(root)) properties[root] = {description: 'Runtime parameter consumed by this Calculation'};
    });
    return freezeTree({type: 'object', required: [], properties, example: {}});
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || !jsonSafe(schema) || !safePayload(schema) || !schema.properties ||
      typeof schema.properties !== 'object' || Array.isArray(schema.properties)) throw new TypeError('inputSchema must declare a properties object.');
  const properties = Object.create(null);
  for (const [key, field] of Object.entries(schema.properties)) {
    const type = typeof field === 'string' ? field : field?.type;
    if (!SIMPLE_ID.test(key) || SECRET_KEY.test(key) || (type !== undefined && !ALLOWED_INPUT_TYPES.has(type))) throw new TypeError(`Unsupported input schema field: ${key}`);
    properties[key] = {...(type && type !== 'any' ? {type} : {}), ...(typeof field === 'object' && typeof field.description === 'string' ? {description: field.description.slice(0, 180)} : {})};
  }
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some((key) => typeof key !== 'string' || !own(properties, key)) || new Set(required).size !== required.length) {
    throw new TypeError('inputSchema.required must name declared fields.');
  }
  const example = schema.example ?? {};
  if (!example || typeof example !== 'object' || Array.isArray(example) || !safePayload(example) || !jsonSafe(example)) throw new TypeError('inputSchema.example must be a safe object.');
  return freezeTree({type: 'object', required: [...required], properties, example: structuredClone(example)});
}

function collectInputPaths(value, visit) {
  if (Array.isArray(value)) { for (const item of value) collectInputPaths(item, visit); return; }
  if (!value || typeof value !== 'object') return;
  if (Object.keys(value).length === 1 && typeof value.$input === 'string') { visit(value.$input); return; }
  for (const child of Object.values(value)) collectInputPaths(child, visit);
}

function validateCalculationInputs(schema, inputs) {
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !safePayload(inputs)) throw new TypeError('Calculation inputs must be a safe object.');
  for (const key of Object.keys(inputs)) if (!own(schema.properties, key)) throw new TypeError(`Unexpected calculation input: ${key}`);
  for (const key of schema.required) if (!own(inputs, key)) throw new TypeError(`Missing calculation input: ${key}`);
  for (const [key, value] of Object.entries(inputs)) {
    const type = schema.properties[key].type || 'any';
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (type !== 'any' && !(type === 'object' && actual === 'object') && type !== actual) throw new TypeError(`Calculation input ${key} must be ${type}.`);
  }
  return freezeTree(structuredClone(inputs));
}

function operationDependencies(plan) {
  return plan.stages.map((stage) => stage.operation).filter((operation) => operation.startsWith('calculation.'));
}

function validateStageReferences(plan, schema) {
  const previous = new Set();
  for (const stage of plan.stages) {
    collectInputPaths(stage.inputs, (path) => {
      const [root, ...rest] = path.split('.');
      if (!SIMPLE_ID.test(root) || !own(schema.properties, root) || (rest.some((item) => !SIMPLE_ID.test(item) && !/^\d+$/.test(item)))) {
        throw new TypeError(`Undeclared calculation input binding: ${path}`);
      }
    });
    const refs = [];
    collectRefs(stage.inputs, (ref) => refs.push(ref));
    for (const ref of refs) {
      const dot = ref.indexOf('.');
      const stageId = dot < 0 ? ref : ref.slice(0, dot);
      if (!previous.has(stageId)) throw new TypeError(`Composition reference must point to an earlier stage: ${ref}`);
    }
    previous.add(stage.id);
  }
}

function normalizeOutputs(outputs) {
  if (outputs === undefined || outputs === null) return freezeTree([{path: 'result', type: 'unknown', source: 'unknown'}]);
  if (!Array.isArray(outputs) || outputs.length > 32) throw new TypeError('outputs must be an array of declared output ports.');
  const seen = new Set();
  return freezeTree(outputs.map((output) => {
    if (!output || typeof output !== 'object' || typeof output.path !== 'string' || SECRET_KEY.test(output.path) ||
        !/^[A-Za-z][A-Za-z0-9_.]*$/.test(output.path) || !['string', 'number', 'boolean', 'object', 'array', 'unknown'].includes(output.type) || seen.has(output.path)) {
      throw new TypeError('Each output port needs a unique safe path and supported type.');
    }
    seen.add(output.path);
    return {path: output.path, type: output.type, ...(output.nullable === true ? {nullable: true} : {}), source: 'declared-interface'};
  }));
}

function normalizePlan(source, schema, resolveOperation) {
  if (!source || typeof source !== 'object' || Array.isArray(source) || !jsonSafe(source) || !safePayload(source)) throw new TypeError('Calculation plan must be safe plain data.');
  const plan = structuredClone(source);
  if (!Array.isArray(plan.stages) || !plan.stages.length || plan.stages.length > 32) throw new TypeError('Calculation plan needs one to 32 ordered stages.');
  const seen = new Set();
  for (const stage of plan.stages) {
    if (!stage || !SIMPLE_ID.test(stage.id) || seen.has(stage.id) || typeof stage.operation !== 'string' ||
        (!OP_BY_ID.has(stage.operation) && !resolveOperation(stage.operation)) || !stage.inputs || typeof stage.inputs !== 'object' || Array.isArray(stage.inputs) || !jsonSafe(stage.inputs)) {
      throw new TypeError('Each calculation stage needs a unique ID, known service/calculation, and plain input object.');
    }
    const resolved = resolveOperation(stage.operation);
    if (resolved) stage.operation = resolved.operationVersion;
    seen.add(stage.id);
  }
  validateStageReferences(plan, schema);
  plan.name = typeof plan.name === 'string' ? plan.name.slice(0, 100) : 'Composed HH Calculation';
  plan.stopOnFailure = plan.stopOnFailure !== false;
  return freezeTree(plan);
}

function assertAcyclicDefinitions(definitions) {
  const visiting = new Set();
  const visited = new Set();
  function visit(key) {
    if (visiting.has(key)) throw new TypeError(`Calculation dependency cycle detected at ${key}.`);
    if (visited.has(key)) return;
    visiting.add(key);
    const entry = definitions.get(key);
    if (entry) for (const dependency of operationDependencies(entry.plan)) {
      const parsed = calcOperationParts(dependency);
      if (!parsed?.version) throw new TypeError(`Nested Calculation must be pinned to a version: ${dependency}`);
      const depKey = `${parsed.id}@${parsed.version}`;
      if (definitions.has(depKey)) visit(depKey);
      else throw new TypeError(`Missing nested Calculation version: ${dependency}`);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of definitions.keys()) visit(key);
}

function collectRefs(value, visit) {
  if (Array.isArray(value)) { for (const item of value) collectRefs(item, visit); return; }
  if (!value || typeof value !== 'object') return;
  if (Object.keys(value).length === 1 && typeof value.$ref === 'string') { visit(value.$ref); return; }
  for (const child of Object.values(value)) collectRefs(child, visit);
}

function jsonSafe(value, seen = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Array.prototype && ![Object.prototype, null].includes(proto)) return false;
  seen.add(value);
  let valid = true;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || SECRET_KEY.test(key)) { valid = false; break; }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor) || !jsonSafe(descriptor.value, seen)) { valid = false; break; }
  }
  seen.delete(value);
  return valid;
}

function makeSchoolSearchPlan(input = {}) {
  const state = input.state;
  const county = input.county;
  const district = input.district;
  const firstChoice = input.chooseFirst === true;
  const stages = [{id: 'states', operation: 'school.states', inputs: {}}];
  const selectedState = state ?? (firstChoice ? {$ref: 'states.data.values.0'} : undefined);
  if (selectedState !== undefined) stages.push({id: 'counties', operation: 'school.counties', inputs: {state: selectedState}});
  const selectedCounty = county ?? (firstChoice && stages.some((stage) => stage.id === 'counties') ? {$ref: 'counties.data.values.0'} : undefined);
  if (selectedCounty !== undefined && selectedState !== undefined) stages.push({id: 'districts', operation: 'school.districts', inputs: {state: selectedState, county: selectedCounty}});
  const selectedDistrict = district ?? (firstChoice && stages.some((stage) => stage.id === 'districts') ? {$ref: 'districts.data.values.0'} : undefined);
  if (selectedDistrict !== undefined && selectedCounty !== undefined && selectedState !== undefined) {
    stages.push({id: 'schools', operation: 'school.schools', inputs: {state: selectedState, county: selectedCounty, district: selectedDistrict}});
  }
  return {name: 'Fixture school search', stages};
}

function makeTeacherJourneyPlan(input = {}) {
  const stages = [
    {id: 'registration', operation: 'registration.create', inputs: {
      teacher: input.teacher, school: input.school, demoAccount: true, termsAccepted: true,
      ...(input.simulateMailFailure === true ? {simulateMailFailure: true} : {}),
    }},
    {id: 'approval', operation: 'demo.approve', inputs: {}},
    {id: 'login', operation: 'session.login', inputs: {email: input.teacher?.email, demoAccount: true}},
  ];
  if (input.profile) stages.push({id: 'profile', operation: 'profile.create', inputs: input.profile});
  if (input.openPublicProfile === true && input.profile) stages.push({id: 'publicProfile', operation: 'profile.public', inputs: {profileId: {$ref: 'profile.data.profile.id'}}});
  return {name: 'Register, approve, log in, and create profile', stages, stopOnFailure: true};
}

function makeWorkflowPlan(input = {}) {
  if (input.workflow === 'schoolSearch') return makeSchoolSearchPlan(input);
  if (input.workflow === 'teacherOnboarding') return makeTeacherJourneyPlan(input);
  if (input.workflow === 'approvalLogin') return {name: 'Approve and demo-login', stages: [
    {id: 'approval', operation: 'demo.approve', inputs: input.teacherId ? {teacherId: input.teacherId} : {}},
    {id: 'login', operation: 'session.login', inputs: {email: input.email, demoAccount: true}},
  ]};
  if (input.workflow === 'profilePublish') {
    const stages = [{id: 'profile', operation: 'profile.create', inputs: input.profile || {}}];
    stages.push({id: 'publicProfile', operation: 'profile.public', inputs: {profileId: {$ref: 'profile.data.profile.id'}}});
    return {name: 'Create and read public profile', stages};
  }
  if (input.workflow === 'publicDirectory') {
    const ids = Array.isArray(input.profileIds) ? input.profileIds : [];
    return {name: 'Read public teacher directory profiles', stages: ids.map((profileId, index) => ({
      id: `profile${index + 1}`, operation: 'profile.public', inputs: {profileId},
    }))};
  }
  return input;
}

/**
 * Browser-local HH fixture adapter. All domain operations are real HH service
 * invocations through the recovered PxC runtime; composite ticks are themselves
 * recorded in that same kernel and retain the real service outcomes they invoke.
 */
export function createHHWorkbench({storage, storageKey} = {}) {
  const provider = createFixtureProvider({fixture: true, storage, ...(storageKey ? {storageKey} : {})});
  const runtime = createServiceRuntime(provider);
  let serial = Promise.resolve();
  let sequence = 0;
  const definedById = new Map();
  const calculationVersions = new Map();
  const capabilityList = Object.freeze(OPERATIONS.map(([id, port, description]) => {
    const spec = INPUT_SPECS[id];
    return Object.freeze({id, port, description, mode: 'fixture', fixtureOnly: true,
      inputs: Object.freeze({type: 'object', required: Object.freeze(spec.required), properties: freezeTree(Object.fromEntries(Object.entries(INPUT_FIELDS[id]).map(([key, type]) => [key, {type}]))), example: freezeTree(structuredClone(spec.example)),
        failureInjection: Object.freeze(['transport_failure', 'store_failure', 'outcome_unknown', 'denied'])}),
      outputs: Object.freeze(OUTPUT_PORTS[id].map((output) => Object.freeze({...output, source: 'declared-contract'})))});
  }));

  function serialize(action) {
    const next = serial.then(action, action);
    serial = next.then(() => undefined, () => undefined);
    return next;
  }

  function resolveCalculation(operation) {
    const parsed = calcOperationParts(operation);
    if (!parsed) return null;
    const definition = parsed.version ? calculationVersions.get(`${parsed.id}@${parsed.version}`) : definedById.get(parsed.id);
    return definition ? {...definition, operation: operationForCalculation(definition.id), operationVersion: pinnedOperationForCalculation(definition.id, definition.version)} : null;
  }

  function outputsForOperation(operation) {
    const base = OP_BY_ID.get(operation);
    if (base) return (OUTPUT_PORTS[operation] || []).map((port) => ({...port, source: 'declared-contract'}));
    const definition = resolveCalculation(operation);
    return definition ? definition.outputs : [{path: 'result', type: 'unknown', source: 'unknown'}];
  }

  function definitionDescriptor(definition) {
    const sourceGraph = makeGraphSource(definition, outputsForOperation);
    return Object.freeze({id: definition.id, operation: operationForCalculation(definition.id),
      operationVersion: pinnedOperationForCalculation(definition.id, definition.version),
      version: definition.version, address: definition.address, name: definition.plan.name,
      plan: definition.plan, inputSchema: definition.inputSchema, outputs: definition.outputs, sourceGraph});
  }

  function makeCalculationPart(definition) {
    return new Part(async ({request}) => {
      const inputs = validateCalculationInputs(definition.inputSchema, request?.inputs || {});
      return runPlanUnlocked(definition.plan, inputs);
    });
  }

  function canonicalizePlan(source, inputSchema, resolver) {
    const plan = normalizePlan(source, inputSchema, resolver);
    return plan;
  }

  function validateDependencyGraph(candidateVersions = []) {
    const graph = new Map([...calculationVersions].map(([key, definition]) => [key, definition]));
    for (const definition of candidateVersions) graph.set(`${definition.id}@${definition.version}`, definition);
    assertAcyclicDefinitions(graph);
  }

  async function runPlanUnlocked(plan, runtimeInputs = {}) {
    const completed = new Map();
    const outcomes = [];
    for (const stage of plan.stages) {
      const resolvedInputs = resolveBindings(stage.inputs, completed, runtimeInputs);
      const call = await executeOperationUnlocked(stage.operation, resolvedInputs);
      const record = Object.freeze({id: stage.id, operation: stage.operation, port: call.port || stage.operation,
        ok: call.ok, result: call.result, value: call.value ?? null, part: call.part, receipt: call.receipt});
      outcomes.push(record);
      completed.set(stage.id, call.result);
      if (!call.ok && plan.stopOnFailure !== false) break;
    }
    return Object.freeze({name: plan.name || 'HH composed operation', outcomes: Object.freeze(outcomes),
      ok: outcomes.length === plan.stages.length && outcomes.every((stage) => stage.ok)});
  }

  async function executeCalculationUnlocked(definition, inputs = {}) {
    let frozenInputs;
    try { frozenInputs = validateCalculationInputs(definition.inputSchema, inputs); }
    catch (error) { return Object.freeze({ok: false, capabilityId: operationForCalculation(definition.id), result: {ok: false, outcome: 'invalid_calculation_inputs', error: {code: 'invalid_calculation_inputs', message: error.message}}, value: null, part: null, receipt: null}); }
    await runtime.ready;
    const callId = ++sequence;
    const requestAddress = `hh.workbench.calculation-call.${callId}.request`;
    const outputAddress = `hh.workbench.calculation-call.${callId}.result`;
    const before = runtime.pxc.receipts().length;
    runtime.pxc.set(requestAddress, new Part(Object.freeze({inputs: frozenInputs})));
    try {
      const part = await runtime.pxc.compose({into: outputAddress, calculation: definition.address, inputs: {request: requestAddress}});
      const receipt = runtime.pxc.receipts().slice(before).find((item) => item.into === outputAddress) || null;
      return Object.freeze({ok: part.value?.ok === true, capabilityId: operationForCalculation(definition.id), port: operationForCalculation(definition.id),
        result: part.value, value: part.value, part, receipt});
    } catch (error) {
      const receipt = runtime.pxc.receipts().slice(before).find((item) => item.into === outputAddress) || null;
      return Object.freeze({ok: false, capabilityId: operationForCalculation(definition.id), port: operationForCalculation(definition.id),
        result: {ok: false, outcome: 'calculation_failed', error: {code: 'calculation_failed', message: error instanceof Error ? error.message : 'Calculation failed.'}},
        value: null, part: null, receipt});
    }
  }

  async function executeOperationUnlocked(operation, inputs = {}) {
    const capability = OP_BY_ID.get(operation);
    if (capability) return invokeCapabilityUnlocked(capability.id, inputs);
    const definition = resolveCalculation(operation);
    if (definition) return executeCalculationUnlocked(definition, inputs);
    return Object.freeze({ok: false, capabilityId: operation, result: Object.freeze({ok: false, outcome: 'unknown_operation', error: {code: 'unknown_operation', message: 'Unknown service or Calculation operation.'}}), value: null, part: null, receipt: null});
  }

  async function invokeCapabilityUnlocked(id, inputs = {}) {
    const capability = OP_BY_ID.get(id);
    if (!capability) return Object.freeze({ok: false, capabilityId: id, result: Object.freeze({ok: false, outcome: 'unknown_capability', error: {code: 'unknown_capability', message: 'Unknown HH workbench capability.'}}), part: null, receipt: null});
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs) || !safePayload(inputs)) {
      const result = Object.freeze({ok: false, port: capability.port, mode: 'fixture', fixture: true, outcome: 'unsafe_input', data: {}, error: {code: 'unsafe_input', message: 'Credentials must stay outside fixture Parts and storage.'}});
      return Object.freeze({ok: false, capabilityId: id, result, part: null, receipt: null});
    }
    await runtime.ready;
    const before = runtime.pxc.receipts().length;
    const result = await runtime.invoke(capability.port, inputs);
    const receipt = runtime.pxc.receipts().slice(before).at(-1) || null;
    const part = receipt ? runtime.pxc.get(receipt.into) : null;
    return Object.freeze({ok: result?.ok === true, capabilityId: id, port: capability.port, result, value: result?.data ?? null, part, receipt});
  }

  function invoke(id, inputs = {}) { return serialize(() => executeOperationUnlocked(id, inputs)); }

  async function compose(input = {}) {
    const source = makeWorkflowPlan(input);
    return serialize(async () => {
      await runtime.ready;
      let plan;
      let schema;
      let frozenInputs;
      try {
        schema = normalizeInputSchema(source.inputSchema, source);
        frozenInputs = validateCalculationInputs(schema, source.inputs || {});
        plan = canonicalizePlan(source, schema, resolveCalculation);
      } catch (error) {
        return Object.freeze({ok: false, outcome: 'invalid_composition', error: {code: 'invalid_composition', message: error.message}, outcomes: Object.freeze([]), part: null, receipt: null});
      }
      const n = ++sequence;
      const calcAddress = `hh.workbench.composition.${n}.calculation`;
      const requestAddress = `hh.workbench.composition.${n}.request`;
      const outputAddress = `hh.workbench.composition.${n}.result`;
      const before = runtime.pxc.receipts().length;
      runtime.pxc.set(calcAddress, new Part(async ({request}) => runPlanUnlocked(request.plan, request.inputs)));
      runtime.pxc.set(requestAddress, new Part(Object.freeze({plan, inputs: frozenInputs})));
      let compositePart;
      try {
        compositePart = await runtime.pxc.compose({into: outputAddress, calculation: calcAddress, inputs: {request: requestAddress}});
      } catch (error) {
        const failedReceipt = runtime.pxc.receipts().slice(before).find((entry) => entry.into === outputAddress) || null;
        return Object.freeze({ok: false, outcome: 'composition_failed', error: {code: 'composition_failed',
          message: error instanceof Error ? error.message : 'The composition failed.'}, outcomes: Object.freeze([]), part: null, receipt: failedReceipt});
      }
      const receipt = runtime.pxc.receipts().slice(before).find((entry) => entry.into === outputAddress) || null;
      return Object.freeze({...compositePart.value, part: compositePart, receipt});
    });
  }

  function availableAddress(address) { return !runtime.pxc.entries().some(([current]) => current === address); }

  function inferDefinitionOutputs(plan) {
    const last = plan.stages.at(-1);
    const ports = outputsForOperation(last.operation);
    return freezeTree((ports.length ? ports : [{path: 'result', type: 'unknown', source: 'unknown'}]).map((port) => ({
      path: `outcomes.${plan.stages.length - 1}.result.${port.path}`,
      type: port.type,
      source: port.type === 'unknown' ? 'unknown' : 'inferred-from-last-stage',
    })));
  }

  async function defineCalculation({id, plan: sourcePlan, inputSchema, outputs, replace = false} = {}) {
    return serialize(async () => {
      await runtime.ready;
      try {
        if (!SIMPLE_ID.test(id) || OP_BY_ID.has(id)) throw new TypeError('Calculation id must be a unique simple name, not a built-in capability id.');
        const previous = definedById.get(id);
        if (previous && replace !== true) throw new TypeError(`Calculation ${id} already exists; pass replace:true to create a new version.`);
        const version = previous ? previous.version + 1 : 1;
        const inputDescriptor = normalizeInputSchema(inputSchema, sourcePlan);
        const plan = canonicalizePlan(sourcePlan, inputDescriptor, resolveCalculation);
        const normalizedOutputs = outputs === undefined ? inferDefinitionOutputs(plan) : normalizeOutputs(outputs);
        const address = addressForCalculation(id, version);
        if (!availableAddress(address)) throw new TypeError(`Calculation Part address already exists: ${address}`);
        const candidate = {id, version, address, plan, inputSchema: inputDescriptor, outputs: normalizedOutputs, operationVersion: pinnedOperationForCalculation(id, version)};
        validateDependencyGraph([candidate]);
        const part = makeCalculationPart(candidate);
        runtime.pxc.set(address, part);
        const definition = Object.freeze({...candidate, part});
        calculationVersions.set(`${id}@${version}`, definition);
        definedById.set(id, definition);
        return Object.freeze({ok: true, definition: definitionDescriptor(definition)});
      } catch (error) {
        return Object.freeze({ok: false, error: {code: 'definition_rejected', message: error instanceof Error ? error.message : 'Calculation definition rejected.'}});
      }
    });
  }

  function listDefinedCalculations() {
    return Object.freeze([...definedById.values()].sort((a, b) => a.id.localeCompare(b.id)).map(definitionDescriptor));
  }

  function listCalculationVersions(id) {
    const versions = [...calculationVersions.values()].filter((definition) => id === undefined || definition.id === id);
    return Object.freeze(versions.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version).map(definitionDescriptor));
  }

  function exportSession() {
    return freezeTree({format: 'hh-workbench-session', version: 1,
      definitions: [...calculationVersions.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version).map((definition) => ({
        id: definition.id, version: definition.version, active: definedById.get(definition.id)?.version === definition.version,
        plan: definition.plan, inputSchema: definition.inputSchema, outputs: definition.outputs,
        sourceGraph: makeGraphSource(definition, outputsForOperation),
      }))});
  }

  async function importSession(data) {
    return serialize(async () => {
      await runtime.ready;
      try {
        if (!jsonSafe(data) || !data || data.format !== 'hh-workbench-session' || data.version !== 1 || !Array.isArray(data.definitions) || data.definitions.length > 128) {
          throw new TypeError('Session file must be a safe hh-workbench-session version 1 object.');
        }
        const sources = structuredClone(data.definitions);
        const seen = new Set();
        for (const item of sources) {
          if (!item || !SIMPLE_ID.test(item.id) || OP_BY_ID.has(item.id) || !Number.isSafeInteger(item.version) || item.version < 1) throw new TypeError('Session definition needs a simple id and positive version.');
          const key = `${item.id}@${item.version}`;
          if (seen.has(key) || calculationVersions.has(key)) throw new TypeError(`Session Calculation already exists: ${key}`);
          if (definedById.has(item.id)) throw new TypeError(`Session would replace active Calculation ${item.id}; define replacements explicitly instead.`);
          seen.add(key);
        }
        const candidateKeys = new Set(sources.map((item) => `${item.id}@${item.version}`));
        const candidateLatest = new Map();
        for (const item of sources) candidateLatest.set(item.id, Math.max(candidateLatest.get(item.id) || 0, item.version));
        const knownResolver = (operation) => {
          const parsed = calcOperationParts(operation);
          if (!parsed) return null;
          if (parsed.version) {
            const key = `${parsed.id}@${parsed.version}`;
            if (candidateKeys.has(key)) return {id: parsed.id, version: parsed.version, operationVersion: pinnedOperationForCalculation(parsed.id, parsed.version)};
            return resolveCalculation(operation);
          }
          const version = candidateLatest.get(parsed.id) || definedById.get(parsed.id)?.version;
          if (!version) return null;
          return {id: parsed.id, version, operationVersion: pinnedOperationForCalculation(parsed.id, version)};
        };
        const candidates = [];
        for (const source of sources) {
          const schema = normalizeInputSchema(source.inputSchema, source.plan);
          const plan = canonicalizePlan(source.plan, schema, knownResolver);
          const outputs = source.outputs === undefined ? inferDefinitionOutputs(plan) : normalizeOutputs(source.outputs);
          const address = addressForCalculation(source.id, source.version);
          if (!availableAddress(address)) throw new TypeError(`Session Part address already exists: ${address}`);
          candidates.push({id: source.id, version: source.version, address, plan, inputSchema: schema, outputs,
            operationVersion: pinnedOperationForCalculation(source.id, source.version), active: source.active === true});
        }
        for (const [id, latest] of candidateLatest) {
          const versions = candidates.filter((item) => item.id === id).map((item) => item.version).sort((a, b) => a - b);
          if (versions.length !== latest || versions.some((version, index) => version !== index + 1)) throw new TypeError(`Imported versions for ${id} must be contiguous from 1.`);
          const active = candidates.filter((item) => item.id === id && item.active);
          if (active.length !== 1 || active[0].version !== latest) throw new TypeError(`Imported active version marker is inconsistent for ${id}.`);
        }
        validateDependencyGraph(candidates);
        // All schema, ID, address, binding, cycle and dependency checks finish before any Part is added.
        const definitions = candidates.map((candidate) => Object.freeze({...candidate, part: makeCalculationPart(candidate)}));
        for (const definition of definitions) runtime.pxc.set(definition.address, definition.part);
        for (const definition of definitions) calculationVersions.set(`${definition.id}@${definition.version}`, definition);
        for (const [id] of candidateLatest) {
          const latest = definitions.filter((definition) => definition.id === id).sort((a, b) => b.version - a.version)[0];
          definedById.set(id, latest);
        }
        return Object.freeze({ok: true, imported: Object.freeze(definitions.map((definition) => pinnedOperationForCalculation(definition.id, definition.version))),
          definitions: listDefinedCalculations()});
      } catch (error) {
        return Object.freeze({ok: false, error: {code: 'session_import_rejected', message: error instanceof Error ? error.message : 'Session import rejected.'}, imported: Object.freeze([])});
      }
    });
  }

  function safeValue(value, addresses, seen = new Set(), depth = 0) {
    if (depth > 6) return {kind: 'depth-limit'};
    if (value instanceof Part) return {kind: 'PartReference', address: addresses.get(value) || null};
    if (typeof value === 'function') return {kind: 'functionPartValue', executable: true};
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'undefined') return {kind: 'undefined'};
    if (typeof value !== 'object') return {kind: 'unsupported-value', type: typeof value};
    if (seen.has(value)) return {kind: 'circular-reference'};
    const prototype = Object.getPrototypeOf(value);
    if (![Object.prototype, Array.prototype, null].includes(prototype)) return {kind: 'non-plain-object', type: prototype?.constructor?.name || 'unknown'};
    seen.add(value);
    const output = Array.isArray(value) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || SECRET_KEY.test(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) { if (!Array.isArray(value)) output[key] = {kind: 'accessor-hidden'}; continue; }
      output[key] = safeValue(descriptor.value, addresses, seen, depth + 1);
    }
    seen.delete(value);
    return output;
  }

  async function listParts() {
    await runtime.ready;
    const entries = runtime.pxc.entries();
    const addresses = new Map(entries.map(([address, part]) => [part, address]));
    const receipts = runtime.pxc.receipts();
    return Object.freeze(entries.map(([address, part]) => {
      const value = part.value;
      const definition = [...calculationVersions.values()].find((candidate) => candidate.address === address);
      const receipt = receipts.find((item) => item.into === address);
      const composition = part.composition;
      return Object.freeze({address, kind: typeof value === 'function' ? (definition ? 'definedCalculationPart' : 'functionPart') : 'valuePart',
        value: safeValue(value, addresses),
        composition: composition ? {calculation: addresses.get(composition.calculation) || null,
          inputs: Object.fromEntries(Object.entries(composition.inputs).map(([name, input]) => [name, addresses.get(input) || null]))} : null,
        receipt: receipt ? {status: receipt.status, into: receipt.into, inputNames: Object.keys(receipt.composition?.inputs || {})} : null,
        ...(definition ? {calculation: {id: definition.id, version: definition.version, operation: operationForCalculation(definition.id), active: definedById.get(definition.id)?.version === definition.version}} : {})});
    }));
  }

  async function inspectPart(address) {
    const parts = await listParts();
    const found = parts.find((part) => part.address === address);
    if (!found) throw new Error(`Unknown PxC Part address: ${String(address)}`);
    return found;
  }

  async function reset() { return invoke('demo.reset', {}); }

  function inspect() {
    const snapshot = typeof runtime.snapshot === 'function' ? runtime.snapshot() : null;
    const kernel = runtime.inspect();
    return Object.freeze({mode: runtime.mode, fixture: runtime.fixture === true, capabilities: capabilityList,
      definedCalculations: listDefinedCalculations(), snapshot, kernel, latestReceipt: kernel.receipts.at(-1) || null});
  }

  function listOperations() {
    const activeAliases = listDefinedCalculations().map((definition) => Object.freeze({id: definition.operation,
      operation: definition.operation, kind: 'calculation', description: definition.name, mode: 'fixture', fixtureOnly: true,
      inputs: definition.inputSchema, outputs: definition.outputs, version: definition.version, address: definition.address, active: true}));
    const pinnedVersions = listCalculationVersions().map((definition) => Object.freeze({id: definition.operationVersion,
      operation: definition.operationVersion, kind: 'calculation', description: `${definition.name} v${definition.version}`, mode: 'fixture', fixtureOnly: true,
      inputs: definition.inputSchema, outputs: definition.outputs, version: definition.version, address: definition.address,
      active: definedById.get(definition.id)?.version === definition.version, pinned: true}));
    return Object.freeze([...capabilityList, ...activeAliases, ...pinnedVersions]);
  }

  return Object.freeze({
    listCapabilities: () => capabilityList,
    listWorkflows: () => WORKFLOWS,
    listOperations,
    invoke,
    compose,
    defineCalculation,
    listDefinedCalculations,
    listCalculationVersions,
    exportSession,
    importSession,
    listParts,
    inspectPart,
    inspect,
    reset,
    snapshot: () => runtime.snapshot(),
    runtime,
    capabilities: runtime.capabilities,
  });
}

export {HH_PORTS};
