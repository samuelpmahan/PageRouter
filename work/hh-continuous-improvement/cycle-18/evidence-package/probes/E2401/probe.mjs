import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';

const provider = createFixtureProvider({fixture: true, storage: null});
const calls = Object.fromEntries(Object.entries(provider.services).map(([port, fn]) => [port, 0]));
const countedProvider = {...provider, services: Object.fromEntries(Object.entries(provider.services).map(([port, fn]) => [port, async input => {
  calls[port] += 1;
  return fn(input);
}]))};
const runtime = createServiceRuntime(countedProvider);
let tree;
const controller = createPublicController({runtime, community: createCommunity(), onChange(state, route) {
  tree = renderPublicSite({route, state, journey: state.journey});
}});
const visit = await controller.navigate('#/contact');
const initial = renderPublicSite({route: controller.route, state: controller.state, journey: controller.state.journey});
const find = (root, id) => {
  if (root?.attrs?.id === id) return root;
  for (const child of root?.children || []) { const found = find(child, id); if (found) return found; }
  return null;
};
const text = root => (typeof root === 'string' ? root : (root?.children || []).map(text).join(''));
const initialContactPageCopy = text(find(initial, 'hh-main'));
const initialButton = find(initial, 'hh-contact-submit');
const callsBeforeSubmit = {...calls};
const submitted = await controller.dispatch('public:contact', {
  name: 'Synthetic HH18 visitor', email: 'h1.e2401@example.test',
  subject: 'Synthetic local contact probe', message: 'Synthetic text only; no real message.',
});
const outcome = controller.state.journey.outcome;
const result = {
  route: visit.route.page,
  initialContactPageCopy,
  submitButton: text(initialButton),
  submitDataEvent: find(initial, 'hh-contact-form').attrs['data-submit'],
  submitted: {ok: submitted.ok, remote: submitted.remote, message: submitted.message},
  outcome: {kind: outcome.kind, remote: outcome.remote, message: outcome.message},
  request: controller.state.request.status,
  providerCallDelta: Object.fromEntries(Object.entries(calls).map(([port, count]) => [port, count - callsBeforeSubmit[port]])),
  providerMode: runtime.mode,
  providerFixture: runtime.fixture,
  renderedStatus: find(tree, 'hh-contact-form').children[2]?.children?.map?.(text)?.join('') || '',
};
process.stdout.write(`${JSON.stringify(result)}\n`);
