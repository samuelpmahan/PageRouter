import {randomBytes} from 'node:crypto';
import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const cases = [
  {name: 'mismatch', accepted: true, matching: false},
  {name: 'missing-terms', accepted: false, matching: true},
  {name: 'valid', accepted: true, matching: true},
];
const results = [];
for (const [index, scenario] of cases.entries()) {
  const controller = createPublicController({
    runtime: createServiceRuntime(createFixtureProvider({fixture: true})),
    community: createCommunity(),
  });
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy',
  })) await controller.selectSchool(key, value);
  const identity = {
    name: `Synthetic E1302 ${scenario.name}`,
    email: `e1302-${index}@example.test`,
    phone: '555-0102',
  };
  for (const [key, value] of Object.entries(identity)) controller.updateDraft(key, value);
  if (scenario.accepted) await controller.dispatch('public:terms-consent', {accepted: true});
  const password = randomBytes(24).toString('base64url');
  const confirmation = scenario.matching ? password : `${password}x`;
  const result = await controller.dispatch('public:register', {
    ...identity, password, confirmPassword: confirmation,
  });
  const tree = renderPublicSite({route: controller.route, state: controller.state});
  const stack = [tree];
  const inputs = new Map();
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (node.attrs?.name && ['name', 'email', 'phone'].includes(node.attrs.name)) {
      inputs.set(node.attrs.name, node.attrs.value || '');
    }
    stack.push(...(node.children || []));
  }
  results.push({
    scenario: scenario.name,
    resultOk: result.ok,
    resultError: result.error?.code || null,
    identity: controller.state.journey.registration.identity,
    renderedIdentity: Object.fromEntries(inputs),
    registrationStatus: controller.state.journey.registration.status,
    outcome: controller.state.journey.outcome?.message || null,
  });
  // Password and confirmation exist only in this iteration's ephemeral scope.
}
process.stdout.write(`${JSON.stringify({cases: results}, null, 2)}\n`);
