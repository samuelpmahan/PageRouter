import test from 'node:test';
import assert from 'node:assert/strict';
import {createFixtureProvider, createServiceRuntime} from '../services/index.mjs';
import {createCommunity} from './community.mjs';
import {createPublicController, normalizePublicRoute} from './public-controller.mjs';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function setup() {
  const storage = memoryStorage();
  const provider = createFixtureProvider({fixture: true, storage});
  const runtime = createServiceRuntime(provider);
  const community = createCommunity({storage});
  const controller = createPublicController({runtime, storage, community});
  return {controller, runtime, storage, community};
}

async function registeredProfileSetup() {
  const env = setup(), {controller} = env;
  await controller.initialize('#/register');
  for (const [key, value] of Object.entries({state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Academy'})) await controller.selectSchool(key, value);
  await controller.dispatch('public:terms-consent', {accepted: true});
  assert.equal((await controller.dispatch('public:register', {name: 'Synthetic Wishlist', email: 'wishlist@example.invalid', password: 'Volatile-Only-17', confirm_password: 'Volatile-Only-17'})).ok, true);
  assert.equal((await controller.dispatch('public:approve')).ok, true);
  assert.equal((await controller.dispatch('public:login', {email: 'wishlist@example.invalid', password: 'Volatile-Only-17'})).ok, true);
  await controller.navigate('#/profile');
  return env;
}

for (const action of ['create', 'edit']) {
  for (const [label, invalidUrl] of [['unsupported', 'https://example.invalid/wishlist'], ['overlength', 'https://www.amazon.com/hz/wishlist/ls/DEMO-' + 'A'.repeat(513)]]) test(`profile ${action} rejects ${label} wishlist before mutation and retains draft`, async () => {
    const {controller, runtime} = await registeredProfileSetup();
    if (action === 'edit') {
      assert.equal((await controller.dispatch('public:profile-create', {name: 'Saved name', wishlistUrl: ''})).ok, true);
      await controller.dispatch('public:edit-profile');
    }
    const draftKey = action === 'create' ? 'createDraft' : 'editDraft';
    controller.updateDraft('name', 'Typed name');
    controller.updateDraft('bio', 'Typed introduction');
    controller.updateDraft('wishlistUrl', invalidUrl);
    const retainedWishlistDraft = controller.state.journey.profile[draftKey].wishlistUrl;
    const beforeProfile = structuredClone(controller.state.journey.profile);
    const beforeRuntime = runtime.snapshot(), beforeParts = runtime.pxc.entries().length;
    const result = await controller.dispatch(`public:profile-${action}`, {wishlistUrl: invalidUrl});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'validation_failed');
    assert.match(result.error.message, /synthetic.*DEMO/i);
    assert.deepEqual(runtime.snapshot(), beforeRuntime);
    assert.equal(runtime.pxc.entries().length, beforeParts, 'invalid URL must not invoke a provider operation');
    assert.deepEqual(controller.state.journey.profile, beforeProfile, 'profile, open form and draft remain intact');
    assert.equal(controller.state.journey.profile[draftKey].wishlistUrl, retainedWishlistDraft);
    assert.equal(controller.state.journey.outcome.kind, 'validation-error');
  });
  for (const wishlistUrl of ['', 'https://www.amazon.com/hz/wishlist/ls/DEMO-CLASSROOM']) {
    test(`profile ${action} preserves ${wishlistUrl ? 'valid synthetic' : 'blank'} wishlist compatibility`, async () => {
      const {controller, runtime} = await registeredProfileSetup();
      if (action === 'edit') assert.equal((await controller.dispatch('public:profile-create', {name: 'Saved name', wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-SAVED'})).ok, true);
      const existing = controller.state.journey.profile.value?.wishlistUrl;
      assert.equal((await controller.dispatch(`public:profile-${action}`, {name: 'Typed name', wishlistUrl})).ok, true);
      assert.equal(controller.state.journey.profile.value.wishlistUrl, wishlistUrl || existing || 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW');
      assert.equal(runtime.snapshot().ownProfile.profile.wishlistUrl, 'https://www.amazon.com/hz/wishlist/ls/DEMO-PREVIEW', 'provider retains synthetic fixture data');
    });
  }
}

function deferredRuntime(portToDelay) {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  let pending = null;
  const runtime = {
    ready: base.ready,
    pxc: base.pxc,
    snapshot: () => base.snapshot(),
    inspect: () => base.inspect(),
    get capabilities() { return base.capabilities; },
    get fixture() { return base.fixture; },
    invoke(port, input, boundary) {
      if (port === portToDelay && !pending) return new Promise(resolve => {
        pending = () => base.invoke(port, input, boundary).then(resolve);
      });
      return base.invoke(port, input, boundary);
    },
  };
  return {runtime, release: async () => { const resolve = pending; pending = null; assert.ok(resolve, 'expected deferred service call'); await resolve(); }};
}

test('normalizes captured public route aliases and forum paths', () => {
  assert.equal(normalizePublicRoute('#/').page, 'home');
  assert.equal(normalizePublicRoute('#/forgot-password').page, 'forgot');
  assert.equal(normalizePublicRoute('#/find-teachers').page, 'directory');
  assert.equal(normalizePublicRoute('#/public-profile/demo-avery').profileId, 'demo-avery');
  assert.equal(normalizePublicRoute('#/pages/homepage.html').page, 'home');
  assert.equal(normalizePublicRoute('#/pages/index.html').page, 'directory');
  assert.equal(normalizePublicRoute('#/pages/find_teachers.html').page, 'directory');
  assert.equal(normalizePublicRoute('#/pages/teacher.html').profileId, 'reference-sarah');
  assert.equal(normalizePublicRoute('#/pages/teacher.html?id=demo-avery').profileId, 'demo-avery');
  assert.deepEqual(normalizePublicRoute('#/pages/create_post.html').communityRoute, {page: 'create-post'});
  assert.deepEqual(normalizePublicRoute('#/pages/post.html?publicid=abc').communityRoute, {page: 'post', threadId: 'abc'});
  assert.equal(normalizePublicRoute('#/pages/unknown.html').page, 'not-found');
  assert.deepEqual(normalizePublicRoute('#/forum').communityRoute, {page: 'forum'});
  assert.deepEqual(normalizePublicRoute('#/create-post').communityRoute, {page: 'create-post'});
  assert.deepEqual(normalizePublicRoute('#/posts/topic-local-1').communityRoute,
    {page: 'post', threadId: 'topic-local-1'});
});

test('captured Teacher of the Day opens as a read-only snapshot without invoking teacher services', async () => {
  const storage = memoryStorage();
  const base = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const calls = [];
  const runtime = {
    ready: base.ready,
    snapshot: () => base.snapshot(),
    inspect: () => base.inspect(),
    pxc: base.pxc,
    invoke(port, input, boundary) { calls.push(port); return base.invoke(port, input, boundary); },
  };
  const controller = createPublicController({runtime, storage});
  await controller.initialize('#/');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  calls.length = 0;
  const before = runtime.snapshot();
  const opened = await controller.navigate('#/pages/teacher.html');
  assert.equal(opened.ok, true);
  assert.equal(controller.route.profileId, 'reference-sarah');
  assert.equal(controller.state.journey.profile.source, 'captured-readonly');
  assert.equal(controller.state.journey.profile.value.name, 'Sarah Endsley');
  assert.equal(controller.state.journey.profile.value.school.school, 'Rochester Primary School');
  assert.equal(controller.state.journey.profile.value.school.county, 'Thurston County');
  assert.equal(controller.state.journey.profile.value.school.state, 'Washington');
  assert.ok(controller.state.journey.profile.value.provenance.profilePage.endsWith('/pages/teacher.html'));
  assert.deepEqual(calls, [], 'the captured reference route does not call the fixture provider');
  assert.deepEqual(runtime.snapshot(), before, 'captured display does not change provider state');
  assert.equal((await controller.dispatch('public:edit-profile')).error.code, 'read_only_reference');
  const edit = await controller.dispatch('public:profile-edit', {name: 'An unauthorized replacement', bio: 'forged', wishlistUrl: ''});
  assert.equal(edit.ok, false);
  assert.equal(edit.error.code, 'read_only_reference');
  assert.equal(controller.state.journey.profile.value.name, 'Sarah Endsley');
  assert.deepEqual(runtime.snapshot(), before, 'a logged-in demo account still cannot mutate captured reference data');
});

test('profile edit toggle rejects another authenticated teacher profile', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/public-profile/demo-jordan');

  const runtimeBefore = runtime.snapshot();
  const profileBefore = structuredClone(controller.state.journey.profile.value);
  assert.equal(runtimeBefore.session.teacherId, 'demo-seed-avery');
  assert.equal(profileBefore.teacherId, 'demo-seed-jordan');

  const result = await controller.dispatch('public:edit-profile');

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'profile_owner_mismatch');
  assert.equal(controller.state.journey.profile.editOpen, false);
  assert.deepEqual(controller.state.journey.profile.value, profileBefore);
  await controller.navigate('#/public-profile/demo-jordan');
  assert.equal(controller.state.journey.profile.value.name, profileBefore.displayName);
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('profile edit submit rejects another authenticated teacher profile without creating an overlay', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/public-profile/demo-jordan');

  const runtimeBefore = runtime.snapshot();
  const profileBefore = structuredClone(controller.state.journey.profile.value);
  assert.equal(runtimeBefore.session.teacherId, 'demo-seed-avery');
  assert.equal(profileBefore.teacherId, 'demo-seed-jordan');

  const result = await controller.dispatch('public:profile-edit', {name: 'Demo Jordan changed by Avery', bio: 'Unauthorized local overlay'});

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'profile_owner_mismatch');
  assert.deepEqual(controller.state.journey.profile.value, profileBefore);
  await controller.navigate('#/public-profile/demo-jordan');
  assert.equal(controller.state.journey.profile.value.name, profileBefore.displayName);
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('profile edit toggle fails closed for anonymous and missing teacher identities', async () => {
  const anonymous = setup();
  await anonymous.controller.initialize('#/public-profile/demo-jordan');
  const anonymousResult = await anonymous.controller.dispatch('public:edit-profile');
  assert.equal(anonymousResult.ok, false);
  assert.equal(anonymousResult.error.code, 'authentication_required');
  assert.equal(anonymous.controller.state.journey.profile.editOpen, false);

  const missingIdentity = setup();
  await missingIdentity.controller.initialize('#/login');
  assert.equal((await missingIdentity.controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await missingIdentity.controller.navigate('#/public-profile/demo-avery');
  missingIdentity.controller.state.journey.session.teacherId = '';
  const missingIdentityResult = await missingIdentity.controller.dispatch('public:edit-profile');
  assert.equal(missingIdentityResult.ok, false);
  assert.equal(missingIdentityResult.error.code, 'profile_owner_mismatch');
  assert.equal(missingIdentity.controller.state.journey.profile.editOpen, false);
});

test('profile edit remains available to its owner through a public profile alias', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  assert.equal((await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'local-demo'})).ok, true);
  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.session.teacherId, 'demo-seed-avery');
  assert.equal(controller.state.journey.profile.value.teacherId, 'demo-seed-avery');
  const runtimeBefore = runtime.snapshot();

  const result = await controller.dispatch('public:profile-edit', {name: 'Demo Avery public alias edit'});

  assert.equal(result.ok, true);
  assert.equal(result.localOnly, true);
  assert.equal(controller.state.journey.profile.value.name, 'Demo Avery public alias edit');
  await controller.navigate('#/teachers/demo-avery');
  assert.equal(controller.state.journey.profile.value.name, 'Demo Avery public alias edit');
  assert.deepEqual(runtime.snapshot(), runtimeBefore);
});

test('cascades school filters, loads local directory matches and restores remembered filters', async () => {
  const {controller} = setup();
  await controller.initialize('#/');
  assert.equal(controller.state.route.page, 'home');
  await controller.navigate('#/find-teachers');
  assert.equal(controller.state.journey.searchPerformed, false, 'route loading is not a submitted search');
  await controller.selectSchool('state', 'Demo Washington');
  await controller.selectSchool('county', 'Demo King');
  await controller.selectSchool('district', 'Demo District');
  await controller.selectSchool('school', 'Demo Academy');
  assert.equal(controller.state.journey.searchPerformed, false, 'filter selection alone is not a submitted search');
  assert.deepEqual(controller.state.journey.lookups.schools, ['Demo Academy', 'Demo STEM School']);
  const result = await controller.dispatch('public:directory-search', {query: 'avery'});
  assert.equal(result.ok, true);
  assert.equal(controller.state.journey.searchPerformed, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
  assert.ok(controller.state.journey.matches.items.some(item => item.id === 'demo-avery'));
  await controller.dispatch('public:directory-search', {query: 'no match'});
  assert.equal(controller.state.journey.searchPerformed, true, 'an explicit empty-result search still counts as a search');
  assert.equal(controller.state.journey.matches.items.length, 0);
  await controller.dispatch('public:directory-restore');
  assert.equal(controller.state.journey.filters.query, 'no match');
  assert.equal(controller.state.journey.matches.items.length, 0);
  await controller.selectSchool('state', '');
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  assert.deepEqual(controller.state.journey.lookups.districts, []);
  assert.deepEqual(controller.state.journey.lookups.schools, []);
});

test('school lookup retry stays bound to the failed current selection', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  assert.equal(controller.canRetry, true);
  assert.match(controller.state.journey.lookupError, /school-data failure/);

  const cleared = await controller.selectSchool('state', '');
  assert.equal(cleared.ok, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, false, 'a retry for an invalidated selection must be unavailable');
  assert.equal(controller.state.journey.school.state, '');
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  assert.equal(controller.canRetry, false);
});

test('school lookup retry recovers the same current selection', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('navigating away invalidates a failed registration school lookup retry', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  await controller.selectSchool('state', 'Demo Washington');
  assert.equal(controller.canRetry, true);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.equal(controller.canRetry, false);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.state.journey.outcome, null);
});

test('initial school choices remain retryable when the states read fails', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/register');
  assert.equal(controller.state.journey.lookupError, 'Simulated local school-data failure; no state changed.');
  assert.equal(controller.canRetry, true);
  assert.equal(controller.state.journey.lookupRetryable, true);
  const retry = await controller.dispatch('public:retry');
  assert.equal(retry.ok, true);
  assert.deepEqual(controller.state.journey.lookups.states, ['Demo California', 'Demo Washington']);
});

test('returning to registration reloads states after an invalidated initial lookup failure', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/register');
  assert.deepEqual(controller.state.journey.lookups.states, []);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.deepEqual(controller.state.journey.lookups.states, ['Demo California', 'Demo Washington']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('successful initial school-data read does not erase a directory retry', async () => {
  const {controller} = setup();
  await controller.dispatch('public:fail-next');
  await controller.initialize('#/directory');
  assert.equal(controller.state.journey.matches.status, 'error');
  assert.equal(controller.canRetry, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
});

test('returning to registration reloads a failed county cascade', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:fail-next');
  await controller.selectSchool('state', 'Demo Washington');
  assert.equal(controller.state.journey.lookupRetryable, true);
  assert.deepEqual(controller.state.journey.lookups.counties, []);
  await controller.navigate('#/login');
  await controller.navigate('#/register');
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
  assert.equal(controller.state.journey.lookupError, '');
  assert.equal(controller.canRetry, false);
});

test('school lookup retry remains available from directory when no directory retry owns it', async () => {
  const {controller} = setup();
  await controller.initialize('#/directory');
  await controller.dispatch('public:fail-next');
  const failed = await controller.selectSchool('state', 'Demo Washington');
  assert.equal(failed.ok, false);
  assert.equal(controller.canRetry, true);
  const retried = await controller.dispatch('public:retry');
  assert.equal(retried.ok, true);
  assert.deepEqual(controller.state.journey.lookups.counties, ['Demo King']);
});

test('distinguishes an explicit empty-filter search from the initial background directory load', async () => {
  const {controller} = setup();
  await controller.initialize('#/find-teachers');
  assert.equal(controller.state.journey.matches.status, 'loaded', 'the background read remains intact');
  assert.equal(controller.state.journey.searchPerformed, false);
  assert.deepEqual(controller.state.journey.school, {state: '', county: '', district: '', school: '', grade: ''});

  const submitted = await controller.dispatch('public:directory-search', {query: ''});
  assert.equal(submitted.ok, true);
  assert.equal(controller.state.journey.searchPerformed, true);
  assert.equal(controller.state.journey.matches.status, 'loaded');
});

test('bounded text drafts keep spaces while typing and normalize only on submit', async () => {
  const {controller} = setup();
  const typeIntoDraft = (name, value, read) => {
    let typed = '';
    for (const character of value) {
      typed += character;
      assert.equal(controller.updateDraft(name, typed), true);
      assert.equal(read(), typed, `draft ${name} should preserve ${JSON.stringify(typed)}`);
    }
  };

  await controller.initialize('#/find-teachers');
  typeIntoDraft('query', 'A certainly nonexistent classroom ', () => controller.state.journey.filters.query);
  await controller.dispatch('public:directory-search', {query: controller.state.journey.filters.query});
  assert.equal(controller.state.journey.filters.query, 'A certainly nonexistent classroom');

  await controller.navigate('#/contact');
  typeIntoDraft('subject', 'A local question ', () => controller.state.journey.contact.subject);
  typeIntoDraft('message', 'A note with spaces ', () => controller.state.journey.contact.message);
  await controller.dispatch('public:contact', {
    name: 'Guest', email: 'guest@example.org', subject: controller.state.journey.contact.subject,
    message: controller.state.journey.contact.message,
  });
  assert.equal(controller.state.journey.contact.subject, 'A local question');
  assert.equal(controller.state.journey.contact.message, 'A note with spaces');

  await controller.navigate('#/register');
  typeIntoDraft('name', 'Jamie Example ', () => controller.state.journey.registration.identity.name);
});

test('rejects stored school selections whose individual values do not form one fixture row', async () => {
  const contradictory = {version: 1, school: {
    state: 'Demo Washington', county: 'Demo King', district: 'Demo District', school: 'Demo Bay School', grade: '',
  }, query: 'avery', sort: 'date-newest'};
  const storage = memoryStorage({'hh-public-directory-filters.v1': JSON.stringify(contradictory)});
  const runtime = createServiceRuntime(createFixtureProvider({fixture: true, storage}));
  const controller = createPublicController({runtime, storage});
  await controller.initialize('#/');
  assert.equal(storage.getItem('hh-public-directory-filters.v1'), null);
  assert.equal(controller.state.journey.rememberedFilters, null);
  assert.equal(controller.state.journey.outcome.kind, 'local-warning');
});

test('registration keeps passwords ephemeral, approval and login stay separate, and edits remain local', async () => {
  const {controller, runtime, storage} = setup();
  await controller.initialize('#/register');
  await controller.selectSchool('state', 'Demo Washington');
  await controller.selectSchool('county', 'Demo King');
  await controller.selectSchool('district', 'Demo District');
  await controller.selectSchool('school', 'Demo Academy');
  await controller.dispatch('public:accept-terms');
  const password = 'Transient-Only-Secret-71';
  const registered = await controller.dispatch('public:register', {
    name: 'Avery Sample', email: 'avery.sample@example.org', phone_number: '312-555-0117',
    password, confirm_password: password,
  });
  assert.equal(registered.ok, true, JSON.stringify(registered));
  assert.equal(controller.state.journey.runtime.registration.status, 'pending');
  assert.equal(controller.state.journey.registration.identity.name, 'Avery Sample');
  assert.equal(controller.state.journey.registration.identity.email, 'avery.sample@example.org');
  assert.equal(controller.state.journey.registration.identity.phone, '312-555-0117');
  assert.equal(JSON.stringify(controller.state).includes(password), false);
  assert.equal([...storage.values.values()].join('\n').includes(password), false);
  assert.equal(JSON.stringify(runtime.inspect()).includes(password), false);
  assert.equal(JSON.stringify(runtime.pxc.entries().map(([, part]) => part.value)).includes(password), false);

  const denied = await controller.dispatch('public:login', {email: 'avery.sample@example.org', password});
  assert.equal(denied.ok, false);
  assert.equal(controller.state.journey.runtime.registration.status, 'pending');
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous');
  assert.equal((await controller.dispatch('approve')).ok, true);
  assert.equal(controller.state.journey.runtime.registration.status, 'approved');
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous');
  const loggedIn = await controller.dispatch('public:login', {email: 'avery.sample@example.org', password});
  assert.equal(loggedIn.ok, true);
  assert.equal(controller.state.journey.runtime.session.status, 'authenticated');

  const made = await controller.dispatch('public:profile-create', {
    name: 'Avery Sample', bio: 'A local classroom profile.', wishlistUrl: '',
  });
  assert.equal(made.ok, true, JSON.stringify(made));
  const savedRuntimeName = runtime.snapshot().ownProfile.profile.displayName;
  assert.match(savedRuntimeName, /^Demo /);
  await controller.dispatch('public:profile-edit', {name: 'Avery Newname', bio: 'Edited only in this view.', wishlistUrl: ''});
  assert.equal(controller.state.journey.profile.value.name, 'Avery Newname');
  assert.equal(runtime.snapshot().ownProfile.profile.displayName, savedRuntimeName);
  assert.equal(controller.state.journey.profile.source, 'local-overlay');
  await controller.dispatch('public:edit-profile');
  controller.updateDraft('name', 'Avery Draftname ');
  controller.updateDraft('bio', ' Retained through render replacement. ');
  controller.updateDraft('wishlistUrl', 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  assert.deepEqual(controller.state.journey.profile.editDraft, {
    name: 'Avery Draftname ', bio: ' Retained through render replacement. ',
    wishlistUrl: 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY',
  });
  await controller.dispatch('public:profile-edit', {});
  assert.equal(controller.state.journey.profile.value.name, 'Avery Draftname');
  assert.equal(controller.state.journey.profile.value.wishlistUrl, 'https://www.amazon.com/hz/wishlist/ls/DEMO-AVERY');
  const profileId = controller.state.journey.profile.value.id;
  await controller.navigate(`#/teachers/${profileId}`);
  assert.equal(controller.state.journey.profile.value.name, 'Avery Draftname');
  assert.equal(controller.state.journey.profile.source, 'local-overlay');
});

test('Terms checkbox consent tracks both checking and unchecking without opening the modal', async () => {
  const {controller} = setup();
  await controller.initialize('#/register');
  await controller.dispatch('public:terms-consent', {accepted: true});
  assert.deepEqual(controller.state.journey.terms, {open: false, accepted: true});
  await controller.dispatch('public:terms-consent', {accepted: false});
  assert.deepEqual(controller.state.journey.terms, {open: false, accepted: false});
  await controller.navigate('#/pages/terms_conditions.html');
  assert.equal(controller.state.journey.terms.open, true);
  await controller.navigate('#/about');
  assert.equal(controller.state.journey.terms.open, false);
});

test('seeded UI login, local contact and reset never claim remote effects', async () => {
  const {controller, runtime} = setup();
  await controller.initialize('#/login');
  const login = await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'entered-but-not-verified'});
  assert.equal(login.ok, true);
  assert.equal(runtime.snapshot().session.status, 'authenticated');
  assert.equal(controller.state.journey.outcome.kind, 'local-simulation');
  const contact = await controller.dispatch('public:contact', {name: 'Guest', email: 'guest@example.org', subject: 'A local question', message: 'A'.repeat(250)});
  assert.equal(contact.ok, true);
  assert.equal(controller.state.journey.outcome.kind, 'local-simulation');
  const tooLong = await controller.dispatch('public:contact', {name: 'Guest', email: 'guest@example.org', subject: 'A local question', message: 'A'.repeat(251)});
  assert.equal(tooLong.ok, false);
  assert.equal((await controller.dispatch('public:forgot', {email: 'avery@fixture.test'})).ok, true);
  assert.equal(controller.state.journey.outcome.remote, false);
  await controller.navigate('#/find-teachers');
  await controller.dispatch('public:directory-search', {query: 'avery'});
  assert.equal(controller.state.journey.searchPerformed, true);
  await controller.dispatch('reset');
  assert.equal(runtime.snapshot().session.status, 'anonymous');
  assert.equal(controller.state.journey.registration.status, 'none');
  assert.equal(controller.state.journey.searchPerformed, false);
});

test('wishlist and community actions are explicit local preview handoffs', async () => {
  const {controller, community} = setup();
  await controller.initialize('#/');
  await controller.dispatch('public:wishlist');
  assert.equal(controller.state.journey.wishlist.intent, true);
  assert.equal(controller.state.journey.wishlist.remote, false);
  await controller.dispatch('community:role', {role: 'teacher'});
  const created = await controller.dispatch('forum-topic', {title: 'Local topic', content: 'Only in preview.', category: 'Questions'});
  assert.equal(created.ok, true);
  assert.ok(community.snapshot().threads.some(thread => thread.id === created.value.id));
  assert.equal(controller.state.journey.runtime.session.status, 'anonymous', 'forum role does not create an HH login');
  await controller.navigate(`#/posts/${created.value.id}`);
  assert.deepEqual(controller.state.route.communityRoute, {page: 'post', threadId: created.value.id});
});

test('late login, approval and logout results never redirect away from the current route', async () => {
  {
    const {runtime, release} = deferredRuntime('Session.login');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/login');
    const pending = controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'temporary'});
    await controller.navigate('#/about');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'about');
  }
  {
    const {runtime, release} = deferredRuntime('Demo.simulateApproval');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/register');
    for (const [level, value] of [['state', 'Demo Washington'], ['county', 'Demo King'], ['district', 'Demo District'], ['school', 'Demo Academy']]) {
      await controller.selectSchool(level, value);
    }
    await controller.dispatch('public:accept-terms');
    await controller.dispatch('public:register', {name: 'Taylor Rivera', email: 'taylor@example.org', password: 'one', confirmPassword: 'one'});
    const pending = controller.dispatch('approve');
    await controller.navigate('#/partners');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'partners');
  }
  {
    const {runtime, release} = deferredRuntime('Session.logout');
    const controller = createPublicController({runtime, storage: memoryStorage()});
    await controller.initialize('#/login');
    await controller.dispatch('public:login', {email: 'avery@fixture.test', password: 'temporary'});
    const pending = controller.dispatch('public:logout');
    await controller.navigate('#/contact');
    await release();
    assert.equal((await pending).ok, true);
    assert.equal(controller.route.page, 'contact');
  }
});
