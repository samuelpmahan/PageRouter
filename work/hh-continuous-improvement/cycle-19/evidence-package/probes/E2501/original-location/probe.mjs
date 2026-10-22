import {createFixtureProvider, createServiceRuntime} from '../../../checkpoint/vendor/hh/services/index.mjs';
import {createPublicController} from '../../../checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '../../../checkpoint/vendor/hh/src/public-site.mjs';
import {createCommunity} from '../../../checkpoint/vendor/hh/src/community.mjs';

const fixture = createFixtureProvider({fixture: true, storage: null});
const calls = Object.fromEntries(Object.keys(fixture.services).map(port => [port, 0]));
const provider = {
  ...fixture,
  services: Object.fromEntries(Object.entries(fixture.services).map(([port, service]) => [port, async input => {
    calls[port] += 1;
    return service(input);
  }]))
};
const runtime = createServiceRuntime(provider);
let tree = null;
const controller = createPublicController({
  runtime,
  community: createCommunity(),
  onChange(state, route) {
    tree = renderPublicSite({route, state, journey: state.journey});
  }
});

const findById = (root, id) => {
  if (root?.attrs?.id === id) return root;
  for (const child of root?.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
};
const text = root => typeof root === 'string'
  ? root
  : (root?.children || []).map(text).join('');
const fieldLabel = (root, fieldId) => {
  if (root?.tag === 'label' && root.attrs?.for === fieldId) return text(root);
  for (const child of root?.children || []) {
    const found = fieldLabel(child, fieldId);
    if (found) return found;
  }
  return null;
};
const idReferences = value => String(value || '').split(/\s+/).filter(Boolean);
const callsBefore = {...calls};

await controller.navigate('#/contact');
const initialField = findById(tree, 'hh-contact-message');
const initialCounter = findById(tree, 'hh-contact-counter');
const initial = {
  route: controller.route.page,
  fieldTag: initialField?.tag || null,
  fieldLabel: fieldLabel(tree, 'hh-contact-message'),
  maximumLength: initialField?.attrs?.maxlength || null,
  describedBy: initialField?.attrs?.['aria-describedby'] || null,
  counterId: initialCounter?.attrs?.id || null,
  counterText: text(initialCounter).trim()
};

controller.updateDraft('message', 'S'.repeat(243));
const editedField = findById(tree, 'hh-contact-message');
const editedCounter = findById(tree, 'hh-contact-counter');
const draftUpdate = {
  draftLength: controller.state.journey.contact.message.length,
  renderedFieldLength: String(editedField?.attrs?.value || '').length,
  counterText: text(editedCounter).trim()
};

const submitted = await controller.dispatch('public:contact', {
  name: 'Synthetic HH19 visitor',
  email: 'h1.e2501@example.test',
  subject: 'Synthetic local validation probe',
  message: 'V'.repeat(251)
});
const messageField = findById(tree, 'hh-contact-message');
const describedByIds = idReferences(messageField?.attrs?.['aria-describedby']);
const counter = findById(tree, 'hh-contact-counter');
const feedbackNodes = [];
const collectFeedback = root => {
  if (root?.attrs?.role === 'status') feedbackNodes.push(root);
  for (const child of root?.children || []) collectFeedback(child);
};
collectFeedback(tree);
const feedback = feedbackNodes.find(node => text(node).includes('250 characters')) || null;
const feedbackId = feedback?.attrs?.id || null;
const validation = {
  rejected: submitted.ok === false && submitted.error?.code === 'validation_failed',
  feedbackText: feedback ? text(feedback).trim() : null,
  feedbackRole: feedback?.attrs?.role || null,
  feedbackLive: feedback?.attrs?.['aria-live'] || null,
  feedbackHasId: !!feedbackId,
  associatedWithMessage: (feedbackId && describedByIds.includes(feedbackId)) || false,
  counterId: counter?.attrs?.id || null,
  counterAssociatedWithMessage: describedByIds.includes(counter?.attrs?.id || '')
};
const providerCallDelta = Object.fromEntries(Object.entries(calls).map(([port, count]) => [port, count - callsBefore[port]]));

process.stdout.write(`${JSON.stringify({
  route: initial.route,
  initial,
  draftUpdate,
  validation,
  providerCallDelta,
  probeBoundary: 'One source-level controller/renderer flow; synthetic fixture only; no browser DOM, FormData, account, backend, or outbound message.'
})}\n`);
