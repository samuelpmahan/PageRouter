import assert from 'node:assert/strict';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const visit = (value, nodes = []) => {
  if (!value || typeof value !== 'object') return nodes;
  nodes.push(value);
  for (const child of value.children || []) visit(child, nodes);
  return nodes;
};
const find = (tree, id) => visit(tree).find(node => node.attrs?.id === id);
const text = value => typeof value === 'string'
  ? value
  : (value?.children || []).map(text).join('');

// All controller/service state is in-memory and fixture-backed; no storage or network.
const runtime = createServiceRuntime(createFixtureProvider({fixture: true}));
const controller = createPublicController({runtime});
await controller.navigate('#/contact');
for (const [name, value] of Object.entries({
  name: 'Synthetic Visitor',
  email: 'invalid-local-address',
  subject: 'Synthetic question',
  message: 'volatile draft only',
})) assert.equal(controller.updateDraft(name, value), true);

const before = renderPublicSite({route: controller.route, journey: controller.state.journey});
const message = find(before, 'hh-contact-message');
const counter = find(before, 'hh-contact-counter');
assert.ok(message, 'message textarea is reachable in the rendered public tree');
assert.ok(counter, 'counter is reachable in the rendered public tree');
assert.equal(message.tag, 'textarea');
assert.equal(message.attrs.value, 'volatile draft only');
assert.equal(message.attrs.maxlength, '250');
assert.equal(text(counter), '231 characters remaining');

const validation = await controller.dispatch('public:contact', {
  name: controller.state.journey.contact.name,
  email: controller.state.journey.contact.email,
  subject: controller.state.journey.contact.subject,
  message: controller.state.journey.contact.message,
});
assert.equal(validation.ok, false);
assert.equal(validation.error?.code, 'validation_failed');
assert.equal(controller.state.request.status, 'failed');
assert.equal(controller.state.journey.outcome.kind, 'validation-error');
const after = renderPublicSite({route: controller.route, journey: controller.state.journey});
assert.equal(find(after, 'hh-contact-message').attrs.value, 'volatile draft only');
assert.equal(find(after, 'hh-contact-counter').attrs.id, 'hh-contact-counter');
const status = visit(after).find(node => node.attrs?.role === 'status' && node.attrs?.class?.includes('hh-status'));
assert.ok(status, 'validation feedback is rendered in the contact form tree');

const describedBy = message.attrs['aria-describedby'] || null;
const outcome = describedBy ? 'confirmed_reuse' : 'mixed_change';
console.log(JSON.stringify({
  probe: 'E2502-H2-contact-counter-validation-feedback',
  scope: 'synthetic fixture, rendered tree/controller only; no browser or assistive-technology claims',
  message: {id: message.attrs.id, tag: message.tag, maxlength: message.attrs.maxlength, draftRetained: true, describedBy},
  counter: {id: counter.attrs.id, text: text(counter)},
  invalidSubmit: {ok: validation.ok, code: validation.error.code, requestStatus: controller.state.request.status,
    outcome: controller.state.journey.outcome.kind, feedback: text(status), draftRetainedAfterValidation: true},
  result: {job_id: 'E2502', worker: 'H2', outcome, summary: describedBy
    ? 'Counter association is present; draft value and invalid-submit feedback remain in the local tree.'
    : 'Counter is reachable but not associated through aria-describedby; draft value and invalid-submit feedback remain in the local tree.'},
}, null, 2));
