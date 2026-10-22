import {createFixtureProvider, createServiceRuntime} from '../../../PageRouter/checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../PageRouter/checkpoint/vendor/hh/src/public-site.mjs';
import {createCommunity} from '../../../PageRouter/checkpoint/vendor/hh/src/community.mjs';

const base = createFixtureProvider({fixture: true, storage: null});
const calls = Object.fromEntries(Object.entries(base.services).map(([port]) => [port, 0]));
const provider = {...base, services: Object.fromEntries(Object.entries(base.services).map(([port, fn]) => [port, async input => {
  calls[port] += 1;
  return fn(input);
}]))};
const runtime = createServiceRuntime(provider);
let tree;
const controller = createPublicController({runtime, community: createCommunity(), onChange(state, route) {
  tree = renderPublicSite({route, state, journey: state.journey});
}});
await controller.navigate('#/contact');
const initial = renderPublicSite({route: controller.route, state: controller.state, journey: controller.state.journey});
const find = (root, id) => {
  if (root?.attrs?.id === id) return root;
  for (const child of root?.children || []) { const found = find(child, id); if (found) return found; }
  return null;
};
const text = root => typeof root === 'string' ? root : (root?.children || []).map(text).join('');
const intro = text(find(initial, 'hh-main'));
const button = text(find(initial, 'hh-contact-submit'));
if (!intro.includes('This preview lets you prepare a contact note. Nothing is sent.') || button !== 'Prepare note') {
  throw new Error('Initial contact disclosure/button mismatch');
}
const callsBefore = {...calls};
const response = await controller.dispatch('public:contact', {
  name: 'Synthetic HH18 visitor', email: 'h1.e2403@example.test',
  subject: 'Synthetic local contact probe', message: 'Synthetic text only; no real message.',
});
const outcome = controller.state.journey.outcome;
const draft = controller.state.journey.contact;
const deltas = Object.fromEntries(Object.entries(calls).map(([port, count]) => [port, count - callsBefore[port]]));
if (!response.ok || response.remote !== false || outcome.remote !== false ||
    outcome.kind !== 'local-simulation' || !outcome.message.includes('Nothing was sent.') ||
    draft.name !== 'Synthetic HH18 visitor' || draft.subject !== 'Synthetic local contact probe' ||
    Object.values(deltas).some(count => count !== 0)) {
  throw new Error('Contact outcome, local draft, or provider delta mismatch');
}
process.stdout.write(`${JSON.stringify({intro: 'This preview lets you prepare a contact note. Nothing is sent.', button, submit: {ok: response.ok, remote: response.remote, message: response.message}, draft: {name: draft.name, subject: draft.subject}, outcome: outcome.kind, providerCallDelta: deltas})}\n`);
