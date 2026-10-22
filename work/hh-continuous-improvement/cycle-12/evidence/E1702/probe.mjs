import assert from 'node:assert/strict';
import {createFixtureProvider} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixture-provider.mjs';
import {SCHOOL_FIXTURES} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/fixtures.mjs';
import {createServiceRuntime} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/services/runtime.mjs';
import {createPublicController} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-controller.mjs';
import {renderPublicSite} from '/workspace/scratch/8528bb251845/PageRouter/checkpoint/vendor/hh/src/public-site.mjs';

const ensure = (condition, code) => assert.ok(condition, code);
function createMemoryStorage() {
  const values = new Map();
  let writes = 0;
  return {
    values,
    get writes() { return writes; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { writes += 1; values.set(key, String(value)); },
    removeItem(key) { writes += 1; values.delete(key); },
  };
}
function findById(tree, id) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.attrs?.id === id) return tree;
  for (const child of tree.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}
function render(controller) {
  return renderPublicSite({route: controller.route, state: controller.state, journey: controller.state.journey});
}
function mountedForm(controller, expected) {
  const tree = render(controller);
  const form = findById(tree, 'hh-profile-create-form');
  return {
    formPresent: Boolean(form),
    nameMatches: findById(tree, 'hh-profile-name')?.attrs?.value === expected.name,
    bioMatches: findById(tree, 'hh-profile-bio')?.attrs?.value === expected.bio,
    wishlistMatches: findById(tree, 'hh-profile-wishlist-url')?.attrs?.value === expected.wishlistUrl,
  };
}

async function scenario({label, failWith = null, explicitResubmit = false}) {
  const storage = createMemoryStorage();
  const base = createFixtureProvider({fixture: true, storage});
  let profileCalls = 0;
  let announceStart, release;
  const started = new Promise(resolve => { announceStart = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const services = Object.fromEntries(Object.entries(base.services).map(([port, invoke]) => [port, async input => {
    if (port !== 'TeacherProfile.createProfile') return invoke(input);
    profileCalls += 1;
    if (failWith && profileCalls === 1) {
      announceStart();
      await held;
      return invoke({...input, failWith});
    }
    return invoke(input);
  }]));
  const provider = {...base, services: Object.freeze(services)};
  const runtime = createServiceRuntime(provider);
  const controller = createPublicController({runtime, storage});

  // Fixture-only identity is constructed without passwords or credentials.
  const email = `h2-${label}-${Date.now()}@example.test`;
  const school = SCHOOL_FIXTURES[0];
  const registered = await runtime.invoke('Registration.registerTeacher', {
    teacher: {name: 'Demo H2 Reviewer', email, phoneNumber: 'DEMO'},
    school, demoAccount: true, termsAccepted: true,
  });
  ensure(registered.ok, 'fixture_register');
  const approved = await runtime.invoke('Demo.simulateApproval', {teacherId: registered.data.registration.teacherId});
  ensure(approved.ok, 'fixture_approval');
  const loggedIn = await runtime.invoke('Session.login', {email, demoAccount: true});
  ensure(loggedIn.ok, 'fixture_login');
  await controller.initialize('#/profile');
  ensure(controller.state.journey.profile.status === 'absent', 'profile_form_initially_absent');

  const submitted = {
    name: `H2 ${label} initial`,
    bio: `Initial draft ${label}`,
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-INITIAL',
  };
  for (const [key, value] of Object.entries(submitted)) ensure(controller.updateDraft(key, value), `draft_input_${key}`);
  const initialForm = mountedForm(controller, submitted);
  ensure(initialForm.formPresent && initialForm.nameMatches && initialForm.bioMatches && initialForm.wishlistMatches, 'initial_render_matches');

  const before = {
    provider: runtime.snapshot(),
    receiptCount: runtime.inspect().receipts.length,
    partCount: runtime.inspect().parts.length,
    storageWrites: storage.writes,
    storedValue: storage.getItem('hh.teacher-journey.fixture.v1'),
  };
  const current = {
    name: `H2 ${label} current`,
    bio: `Current draft ${label}`,
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-CURRENT',
  };
  const creating = controller.dispatch('public:profile-create');
  if (failWith) {
    await started;
    for (const [key, value] of Object.entries(current)) ensure(controller.updateDraft(key, value), `pending_draft_input_${key}`);
    const pendingForm = mountedForm(controller, current);
    ensure(pendingForm.formPresent && pendingForm.nameMatches && pendingForm.bioMatches && pendingForm.wishlistMatches, 'pending_render_matches');
  }
  release();
  const result = await creating;
  const outcome = {
    label,
    expectedFailure: Boolean(failWith),
    resultOk: result.ok === true,
    errorCode: result.error?.code || null,
    providerAbsentAfterAttempt: runtime.snapshot().ownProfile.status === 'absent',
    oneProviderCall: profileCalls === 1,
    oneReceipt: runtime.inspect().receipts.length === before.receiptCount + 1,
    twoParts: runtime.inspect().parts.length === before.partCount + 2,
    noStorageWrite: storage.writes === before.storageWrites,
    storedStateUnchanged: storage.getItem('hh.teacher-journey.fixture.v1') === before.storedValue,
    retainedForm: false,
    retryDisabled: false,
    retryDidNotCallProvider: false,
    explicitResubmitUsesDraft: null,
    finalProfileOverlayMatches: null,
    overlayNameMatches: null,
    overlayBioMatches: null,
    overlayWishlistMatches: null,
    finalProviderPresent: null,
    finalProviderCalls: null,
    finalReceiptDelta: null,
    finalPartDelta: null,
    successStorageWriteDeltaIsOne: null,
    finalCreateDraftCleared: null,
    finalFormClosed: null,
  };

  if (failWith) {
    ensure(!result.ok, 'failure_expected');
    ensure(JSON.stringify(runtime.snapshot()) === JSON.stringify(before.provider), 'provider_unchanged_after_failure');
    const retained = mountedForm(controller, current);
    outcome.retainedForm = retained.formPresent && retained.nameMatches && retained.bioMatches && retained.wishlistMatches;
    ensure(outcome.retainedForm, 'failure_retains_rendered_live_draft');
    outcome.retryDisabled = controller.canRetry === false;
    ensure(outcome.retryDisabled, 'failure_retry_disabled');
    const receiptsBeforeRetry = runtime.inspect().receipts.length;
    const retry = await controller.dispatch('public:retry');
    outcome.retryDidNotCallProvider = retry.error?.code === 'nothing_to_retry' && profileCalls === 1 && runtime.inspect().receipts.length === receiptsBeforeRetry;
    ensure(outcome.retryDidNotCallProvider, 'explicit_retry_does_not_replay_write');
    if (!explicitResubmit) return outcome;
    const receiptsBeforeResubmit = runtime.inspect().receipts.length;
    const resubmitted = await controller.dispatch('public:profile-create');
    outcome.explicitResubmitUsesDraft = resubmitted.ok === true && profileCalls === 2 && runtime.inspect().receipts.length === receiptsBeforeResubmit + 1;
    ensure(outcome.explicitResubmitUsesDraft, 'fresh_explicit_submission_succeeds');
  } else {
    ensure(result.ok, 'success_expected');
    outcome.retainedForm = mountedForm(controller, submitted).formPresent === false;
  }

  const profile = controller.state.journey.profile.value;
  const expectedSuccess = failWith ? current : submitted;
  outcome.overlayNameMatches = profile?.name === expectedSuccess.name;
  outcome.overlayBioMatches = profile?.bio === expectedSuccess.bio;
  outcome.overlayWishlistMatches = profile?.wishlistUrl === expectedSuccess.wishlistUrl;
  outcome.finalProfileOverlayMatches = outcome.overlayNameMatches && outcome.overlayBioMatches && outcome.overlayWishlistMatches;
  outcome.finalProviderPresent = runtime.snapshot().ownProfile.status === 'present';
  outcome.finalCreateDraftCleared = ['name', 'bio', 'wishlistUrl'].every(key => controller.state.journey.profile.createDraft[key] === '');
  outcome.finalFormClosed = findById(render(controller), 'hh-profile-create-form') === null;
  outcome.finalProviderCalls = profileCalls;
  outcome.finalReceiptDelta = runtime.inspect().receipts.length - before.receiptCount;
  outcome.finalPartDelta = runtime.inspect().parts.length - before.partCount;
  ensure(outcome.overlayNameMatches, 'profile_overlay_name_mismatch');
  ensure(outcome.overlayBioMatches, 'profile_overlay_bio_mismatch');
  ensure(outcome.overlayWishlistMatches, 'profile_overlay_wishlist_mismatch');
  ensure(outcome.finalProviderPresent, 'provider_profile_present_after_success');
  ensure(outcome.finalCreateDraftCleared, 'success_clears_create_draft');
  ensure(outcome.finalFormClosed, 'success_closes_creation_form');
  if (failWith) {
    outcome.finalProviderPresent = runtime.snapshot().ownProfile.status === 'present' && profileCalls === 2;
    outcome.oneReceipt = runtime.inspect().receipts.length === before.receiptCount + 2;
    outcome.twoParts = runtime.inspect().parts.length === before.partCount + 4;
    ensure(outcome.finalProviderPresent && outcome.oneReceipt && outcome.twoParts, 'single_profile_created_by_fresh_submit');
  } else {
    outcome.successStorageWriteDeltaIsOne = storage.writes === before.storageWrites + 1;
    ensure(outcome.oneProviderCall && outcome.oneReceipt && outcome.twoParts && outcome.successStorageWriteDeltaIsOne, 'success_has_one_provider_mutation');
  }
  return outcome;
}

try {
  const results = [];
  results.push(await scenario({label: 'known', failWith: 'transport_failure', explicitResubmit: true}));
  results.push(await scenario({label: 'unknown', failWith: 'outcome_unknown', explicitResubmit: true}));
  results.push(await scenario({label: 'success'}));
  console.log(JSON.stringify({status: 'passed', results}));
} catch (error) {
  console.error(JSON.stringify({status: 'failed', errorCode: String(error?.message || 'probe_error').split('\n')[0]}));
  process.exitCode = 1;
}
