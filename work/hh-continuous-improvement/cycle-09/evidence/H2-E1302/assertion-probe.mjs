import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
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

function containsEither(value, needles, seen = new Set()) {
  if (typeof value === 'string') return needles.some(secret => secret.length > 0 && value.includes(secret));
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => needles.some(secret => secret.length > 0 && key.includes(secret)) || containsEither(child, needles, seen));
}

function renderedForm(controller) {
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const stack = [tree], identity = {}, school = {};
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const field = node.attrs?.name;
    if (['name', 'email', 'phone'].includes(field)) identity[field] = node.attrs?.value || '';
    if (node.tag === 'select' && ['state', 'county', 'district', 'school'].includes(field)) {
      school[field] = (node.children || []).find(child => child.attrs?.selected === true)?.attrs?.value || '';
    }
    stack.push(...(node.children || []));
  }
  return {identity, school};
}

async function setup(scenario, accepted, index, recordDraft = true) {
  const storage = memoryStorage();
  const provider = createFixtureProvider({fixture: true, storage});
  const runtime = createServiceRuntime(provider);
  const controller = createPublicController({runtime, storage, community: createCommunity({storage})});
  await controller.initialize('#/register');
  const school = {state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'};
  for (const [key, value] of Object.entries(school)) await controller.selectSchool(key, value);
  const identity = {
    name: `Synthetic E1302 ${scenario}`,
    email: `e1302-${index}@example.test`,
    phone: '555-0102',
  };
  if (recordDraft) for (const [key, value] of Object.entries(identity)) assert.equal(controller.updateDraft(key, value), true);
  if (accepted) await controller.dispatch('public:terms-consent', {accepted: true});
  return {controller, runtime, storage, identity, school};
}

const scenarios = [];
for (const [index, [name, accepted, match]] of [
  ['mismatch', true, false],
  ['missing-terms', false, true],
  ['valid', true, true],
  ['direct-no-draft', true, false],
].entries()) {
  const {controller, runtime, storage, identity, school} = await setup(name, accepted, index, name !== 'direct-no-draft');
  const password = randomBytes(24).toString('base64url');
  const confirmation = match ? password : `${password}x`;
  const credentials = [password, confirmation];
  const result = await controller.dispatch('public:register', {...identity, password, confirmPassword: confirmation});
  const rendered = renderedForm(controller);
  const secretAbsence = {
    controller_state: !containsEither(controller.state, credentials),
    runtime_inspect: !containsEither(runtime.inspect(), credentials),
    runtime_parts: !containsEither(runtime.pxc.entries(), credentials),
    storage: !containsEither([...storage.values.entries()], credentials),
  };
  assert.ok(Object.values(secretAbsence).every(Boolean), `${name}: credentials escaped a prohibited boundary`);
  if (name === 'direct-no-draft') {
    const emptyIdentity = {name: '', email: '', phone: ''};
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'validation_failed');
    assert.deepEqual(controller.state.journey.registration.identity, emptyIdentity);
    assert.deepEqual(rendered.identity, emptyIdentity);
    assert.deepEqual(rendered.school, school);
  } else if (name !== 'valid') {
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, 'validation_failed');
    assert.deepEqual(controller.state.journey.registration.identity, identity);
    assert.deepEqual(rendered.identity, identity);
    assert.deepEqual(controller.state.journey.school, {...school, grade: controller.state.journey.school.grade});
    assert.deepEqual(rendered.school, school);
    assert.equal(controller.state.journey.registration.status, 'none');
  } else {
    assert.equal(result.ok, true);
    assert.equal(controller.state.journey.registration.status, 'pending');
    assert.equal(runtime.snapshot().registration.status, 'pending');
    assert.equal(controller.state.journey.registration.identity.name, identity.name);
  }
  scenarios.push({
    name,
    accepted,
    result_ok: result.ok,
    error_code: result.error?.code || null,
    identity_preserved: name !== 'valid' && name !== 'direct-no-draft' ? Object.keys(identity).every(key => rendered.identity[key] === identity[key]) : null,
    school_preserved: name !== 'valid' ? Object.keys(school).every(key => rendered.school[key] === school[key]) : null,
    registration_status: controller.state.journey.registration.status,
    valid_runtime_pending: name === 'valid' ? runtime.snapshot().registration.status === 'pending' : null,
    credentials_absent: secretAbsence,
  });
  // The ephemeral credential strings are not included in output or retained outside this iteration.
}
process.stdout.write(`${JSON.stringify({assertions: 'passed', scenarios}, null, 2)}\n`);
