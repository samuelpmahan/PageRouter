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
