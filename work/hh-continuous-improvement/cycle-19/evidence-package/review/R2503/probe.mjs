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
const text = value => typeof value === 'string' ? value : (value?.children || []).map(text).join('');

const base = createFixtureProvider({fixture: true});
const calls = Object.fromEntries(Object.keys(base.services).map(port => [port, 0]));
const provider = {...base, services: Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
  calls[port] += 1;
  return invoke(input);
}]))};
const controller = createPublicController({runtime: createServiceRuntime(provider)});
await controller.navigate('#/contact');
for (const [name, value] of Object.entries({
  name: 'Synthetic Visitor',
  email: 'invalid-local-address',
  subject: 'Synthetic question',
  message: 'volatile draft only',
})) assert.equal(controller.updateDraft(name, value), true);

const render = () => renderPublicSite({route: controller.route, journey: controller.state.journey});
const firstTree = render();
const firstField = find(firstTree, 'hh-contact-message');
const firstCounter = find(firstTree, 'hh-contact-counter');
assert.ok(firstField && firstCounter, 'message and counter are in the rendered tree');
assert.equal(firstField.attrs['aria-describedby'], firstCounter.attrs.id);
assert.equal(text(firstCounter).trim(), `${250 - 'volatile draft only'.length} characters remaining`);
assert.equal(firstField.attrs.value, 'volatile draft only');

const updatedDraft = 'volatile draft updated';
assert.equal(controller.updateDraft('message', updatedDraft), true);
const updatedTree = render();
const updatedField = find(updatedTree, 'hh-contact-message');
const updatedCounter = find(updatedTree, updatedField.attrs['aria-describedby']);
assert.equal(updatedField.attrs.value, updatedDraft);
assert.ok(updatedCounter, 'aria-describedby resolves to an id in the updated rendered tree');
assert.equal(text(updatedCounter).trim(), `${250 - updatedDraft.length} characters remaining`);

const validation = await controller.dispatch('public:contact', {
  name: controller.state.journey.contact.name,
  email: controller.state.journey.contact.email,
  subject: controller.state.journey.contact.subject,
  message: controller.state.journey.contact.message,
});
assert.equal(validation.ok, false);
assert.equal(validation.error?.code, 'validation_failed');
const afterTree = render();
const afterField = find(afterTree, 'hh-contact-message');
const afterCounter = find(afterTree, afterField.attrs['aria-describedby']);
assert.equal(afterField.attrs.value, updatedDraft, 'draft survives invalid submit');
assert.equal(text(afterCounter).trim(), `${250 - updatedDraft.length} characters remaining`);
const feedback = visit(afterTree).find(node => node.attrs?.role === 'status' && node.attrs?.class?.includes('hh-status'));
assert.ok(feedback);
assert.equal(text(feedback), 'Enter your name, a valid email, a subject, and a message.');
assert.ok(Object.values(calls).every(count => count === 0), 'no fixture provider port was invoked');

console.log(JSON.stringify({
  probe: 'R2503-H2-contact-controller-tree',
  scope: 'volatile fixture-backed controller + renderer tree; no DOM/browser/screen-reader claim',
  association: {reference: afterField.attrs['aria-describedby'], resolves: !!afterCounter,
    counterText: text(afterCounter).trim(), draftRetained: afterField.attrs.value === updatedDraft},
  invalidEmailSubmit: {code: validation.error.code, feedback: text(feedback), draftRetained: afterField.attrs.value === updatedDraft},
  providerCalls: calls,
  result: {job_id: 'R2503', worker: 'H2', outcome: 'accepted',
    summary: 'aria-describedby resolves to the live rendered counter as the draft changes; invalid-email feedback is unchanged, the draft remains, and no provider port runs.'},
}, null, 2));
