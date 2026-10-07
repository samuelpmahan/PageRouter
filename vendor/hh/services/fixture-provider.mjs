import {HH_PORTS, HH_MESSAGES, HH_CONTRACT_VERSION, clone, deepFreeze, success, failure} from './contract.mjs';
import {SCHOOL_FIXTURES, SEED_PUBLIC_PROFILES, newFixtureState} from './fixtures.mjs';

export const FIXTURE_STORAGE_KEY = 'hh.teacher-journey.fixture.v1';
const SECRET_KEYS = /password|credential|token|secret|authorization|cookie/i;
const asText = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const emailKey = (value) => asText(value, 254).toLowerCase();
const isDemoEmail = (value) => /^[^\s@]+@[^\s@]+\.test$/i.test(value);
const isDemoName = (value) => /^Demo\s+\S/.test(value);
const sameSchool = (a, b) => ['state', 'county', 'district', 'school'].every((key) => a?.[key] === b[key]);
const unique = (items) => [...new Set(items)].sort();

function hasSecret(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { const url = new URL(value); return !!(url.username || url.password) || [...url.searchParams.keys()].some((key) => SECRET_KEYS.test(key)); }
    catch { return false; }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => SECRET_KEYS.test(key) || hasSecret(child, seen));
}
function fixtureWishlistUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname === 'www.amazon.com' && !url.port &&
      !url.username && !url.password && !url.search && !url.hash &&
      /^\/hz\/wishlist\/ls\/DEMO(?:-[A-Z0-9]+)+$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
function validStoredState(value) {
  if (!value || value.version !== 1 || value.fixture !== true || hasSecret(value) ||
      !Number.isSafeInteger(value.nextId) || value.nextId < 1 || !Array.isArray(value.teachers) || value.teachers.length > 100) return false;
  const ids = new Set();
  const emails = new Set();
  for (const record of value.teachers) {
    if (!record || typeof record.id !== 'string' || !record.id.startsWith('demo-') || ids.has(record.id) ||
        !isDemoName(record.teacher?.name) || !isDemoEmail(record.teacher?.email) || emails.has(record.teacher.email) ||
        !['', 'DEMO'].includes(record.teacher?.phoneNumber) ||
        !SCHOOL_FIXTURES.some((school) => sameSchool(record.school, school)) ||
        !['pending', 'approved'].includes(record.registrationStatus)) return false;
    if (record.profile && (record.registrationStatus !== 'approved' || record.profile.teacherId !== record.id ||
        !isDemoName(record.profile.displayName) || typeof record.profile.id !== 'string' ||
        !Array.isArray(record.profile.subjects) || !fixtureWishlistUrl(record.profile.wishlistUrl) ||
        Object.hasOwn(record.profile, 'wishlist') ||
        !sameSchool(record.profile.school, record.school))) return false;
    ids.add(record.id); emails.add(record.teacher.email);
  }
  if (value.selectedTeacherId !== null && !ids.has(value.selectedTeacherId)) return false;
  if (value.sessionTeacherId !== null && !value.teachers.some((r) => r.id === value.sessionTeacherId && r.registrationStatus === 'approved')) return false;
  return true;
}
function canonicalState(value) {
  // Rebuild the only permitted fields instead of retaining arbitrary saved JSON.
  return {version: 1, fixture: true, nextId: value.nextId, selectedTeacherId: value.selectedTeacherId,
    sessionTeacherId: value.sessionTeacherId, teachers: value.teachers.map((r) => ({
      id: r.id, teacher: {name: r.teacher.name, email: r.teacher.email, phoneNumber: r.teacher.phoneNumber},
      school: Object.fromEntries(['state', 'county', 'district', 'school'].map((key) => [key, r.school[key]])),
      registrationStatus: r.registrationStatus, profile: r.profile ? publicProfile(r.profile) : null,
    }))};
}
function publicProfile(profile) {
  return {id: profile.id, teacherId: profile.teacherId, displayName: profile.displayName,
    bio: asText(profile.bio, 600), subjects: profile.subjects.map((v) => asText(v, 80)).filter(Boolean).slice(0, 8),
    wishlistUrl: fixtureWishlistUrl(profile.wishlistUrl),
    school: clone(profile.school), seeded: profile.seeded === true};
}

/** Local fixture provider. No password verification, network calls, or production authority. */
export function createFixtureProvider(options = {}) {
  if (options.fixture !== true) throw new TypeError('Fixture provider requires explicit fixture:true.');
  const mode = 'fixture';
  let storage = options.storage;
  let storageAccessError = false;
  if (storage === undefined && typeof window !== 'undefined') {
    try { storage = window.sessionStorage; } catch { storageAccessError = true; }
  }
  const storageKey = options.storageKey || FIXTURE_STORAGE_KEY;
  let state = newFixtureState();
  let initializationIssue = storageAccessError ? 'storage_unavailable' : null;
  if (storage && !initializationIssue) {
    let raw = null;
    try {
      raw = storage.getItem(storageKey);
    } catch { initializationIssue = 'storage_unavailable'; }
    if (raw !== null && !initializationIssue) {
      try {
        const restored = JSON.parse(raw);
        if (!validStoredState(restored)) initializationIssue = 'storage_invalid';
        else state = canonicalState(restored);
      } catch { initializationIssue = 'storage_invalid'; }
    }
  }
  const capabilities = deepFreeze({mode, fixture: true, productionAuthority: false,
    persistence: storage ? 'per-tab-sessionStorage' : storageAccessError ? 'unavailable' : 'volatile-memory',
    services: Object.fromEntries(HH_PORTS.map((port) => [port, {supported: true, fixtureOnly: true}])),
    profileEdit: false, realMail: false, passwordAuthentication: false, payments: false});
  const selected = (from = state) => from.teachers.find((r) => r.id === from.selectedTeacherId) || null;
  const signedIn = (from = state) => from.teachers.find((r) => r.id === from.sessionTeacherId) || null;
  const registrationOf = (record) => ({status: record?.registrationStatus || 'none', teacherId: record?.id || null, email: record?.teacher.email || null});
  const sessionOf = (record) => ({status: record ? 'authenticated' : 'anonymous', role: record ? 'teacher' : null, teacherId: record?.id || null});
  const profileOf = (record) => record ? {status: record.profile ? 'present' : 'absent', profile: record.profile ? publicProfile(record.profile) : null}
    : {status: 'unknown', profile: null};
  function existingPublicProfiles() {
    // Seed precedence and ID identity are the same for directory and public reads.
    // Only existing profiles are projected; registration/approval policy is unchanged.
    const profiles = new Map(SEED_PUBLIC_PROFILES.map((profile) => [profile.id, profile]));
    for (const record of state.teachers) {
      if (record.profile && !profiles.has(record.profile.id)) profiles.set(record.profile.id, record.profile);
    }
    return [...profiles.values()];
  }
  function snapshot() {
    return deepFreeze({kind: 'TeacherJourney', contractVersion: HH_CONTRACT_VERSION, mode, fixture: true,
      session: sessionOf(signedIn()), registration: registrationOf(selected()), ownProfile: profileOf(signedIn()),
      request: {status: 'idle'}, diagnostics: {persistence: capabilities.persistence, initializationIssue},
      demo: {selectedTeacher: selected() ? clone(selected().teacher) : null,
        selectedSchool: selected() ? clone(selected().school) : null,
        publicProfiles: existingPublicProfiles().map(publicProfile)}});
  }
  const reject = (port, code, message = code, details = {}) => failure(port, mode, code, message, details);
  function checkFailure(port, input) {
    if (hasSecret(input)) return reject(port, 'unsafe_input', 'Credentials must stay outside fixture Parts and storage.');
    const code = input?.failWith;
    if (code === 'transport_failure') return reject(port, code, 'Simulated transport failure; no change was made.', {retryable: true});
    if (code === 'store_failure') return reject(port, code, 'Simulated storage failure; no change was made.', {retryable: true});
    if (code === 'outcome_unknown') return reject(port, code, 'Simulated unknown outcome. Check state before trying again.', {outcomeKnown: false});
    if (code === 'denied') return reject(port, code, 'The fixture provider denied this operation.');
    return null;
  }
  function persist(next, port, {reset = false} = {}) {
    if (initializationIssue && !reset) return reject(port, initializationIssue,
      initializationIssue === 'storage_invalid' ? 'Saved fixture state is invalid. Use Demo reset before making changes.' : HH_MESSAGES.storage_unavailable);
    try {
      if (storageAccessError) throw new Error('Storage access unavailable');
      if (storage) {
        if (reset) storage.removeItem(storageKey);
        else storage.setItem(storageKey, JSON.stringify(next));
      }
    } catch { return reject(port, 'storage_unavailable', HH_MESSAGES.storage_unavailable, {retryable: true}); }
    state = next;
    initializationIssue = null;
    return null;
  }
  const services = {};
  function bind(port, method) {
    services[port] = async (input = {}) => {
      const denied = checkFailure(port, input);
      return denied || method(input, port);
    };
  }
  bind('SchoolData.getStates', (_input, port) => success(port, mode, 'loaded', {values: unique(SCHOOL_FIXTURES.map((r) => r.state))}));
  bind('SchoolData.getCounties', (input, port) => success(port, mode, 'loaded', {values: unique(SCHOOL_FIXTURES.filter((r) => r.state === input.state).map((r) => r.county))}));
  bind('SchoolData.getDistricts', (input, port) => success(port, mode, 'loaded', {values: unique(SCHOOL_FIXTURES.filter((r) => r.state === input.state && r.county === input.county).map((r) => r.district))}));
  bind('SchoolData.getSchools', (input, port) => success(port, mode, 'loaded', {values: unique(SCHOOL_FIXTURES.filter((r) => r.state === input.state && r.county === input.county && r.district === input.district).map((r) => r.school))}));
  bind('Registration.getOwnStatus', (_input, port) => success(port, mode, 'loaded', {registration: registrationOf(selected())}));
  bind('Session.getSession', (_input, port) => success(port, mode, 'loaded', {session: sessionOf(signedIn())}));
  bind('TeacherProfile.getOwnProfile', (_input, port) => signedIn()
    ? success(port, mode, 'loaded', {ownProfile: profileOf(signedIn())})
    : reject(port, 'authentication_required', HH_MESSAGES.authentication_required));
  bind('Registration.registerTeacher', (input, port) => {
    const teacher = {name: asText(input.teacher?.name, 160), email: emailKey(input.teacher?.email), phoneNumber: asText(input.teacher?.phoneNumber, 40)};
    if (!isDemoName(teacher.name) || !isDemoEmail(teacher.email) || !['', 'DEMO'].includes(teacher.phoneNumber)) return reject(port, 'synthetic_only', HH_MESSAGES.synthetic_only);
    if (input.demoAccount !== true || input.termsAccepted !== true) return reject(port, 'validation_failed', 'Confirm the demo account and preview terms before registering.');
    if (input.confirmationValid === false) return reject(port, 'validation_failed', 'Ephemeral credential confirmation did not match.');
    const school = SCHOOL_FIXTURES.find((r) => sameSchool(input.school, r));
    if (!school) return reject(port, 'validation_failed', 'Choose a complete fixture school lookup row.');
    if (signedIn()) return reject(port, 'session_conflict', 'Log out before registering a different demo teacher.');
    const existing = state.teachers.find((r) => r.teacher.email === teacher.email);
    if (existing) {
      const next = clone(state); next.selectedTeacherId = existing.id;
      const problem = persist(next, port); if (problem) return problem;
      const outcome = existing.registrationStatus === 'pending' ? 'already_pending' : 'registered_email';
      return reject(port, outcome, HH_MESSAGES[outcome], {data: {pending_saved: existing.registrationStatus === 'pending', registration: registrationOf(existing)}});
    }
    if (state.teachers.length >= 100) return reject(port, 'fixture_limit', 'This demo tab reached its disposable account limit. Use Demo reset.');
    const next = clone(state);
    const record = {id: `demo-teacher-${next.nextId++}`, teacher, school: clone(school), registrationStatus: 'pending', profile: null};
    next.teachers.push(record); next.selectedTeacherId = record.id;
    const problem = persist(next, port); if (problem) return problem;
    const failedMail = input.simulateMailFailure === true;
    return success(port, mode, 'pending_saved', {pending_saved: true, registration: registrationOf(record),
      mail: {status: failedMail ? 'simulated_failed' : 'simulated_sent', realEmailSent: false}},
      failedMail ? HH_MESSAGES.simulated_mail_failure : HH_MESSAGES.pending_saved);
  });
  bind('Demo.simulateApproval', (input, port) => {
    const id = input.teacherId || state.selectedTeacherId;
    const record = state.teachers.find((r) => r.id === id);
    if (!record) return reject(port, 'not_found', 'There is no demo registration to approve.');
    const next = clone(state); const changed = next.teachers.find((r) => r.id === id);
    changed.registrationStatus = 'approved'; next.selectedTeacherId = id;
    const problem = persist(next, port); if (problem) return problem;
    return success(port, mode, 'approval_simulated', {registration: registrationOf(changed), session: sessionOf(signedIn()), simulated: true}, HH_MESSAGES.approval_simulated);
  });
  bind('Session.login', (input, port) => {
    if (input.demoAccount !== true) return reject(port, 'demo_account_required', 'Use the clearly marked demo account login.');
    const record = state.teachers.find((r) => r.teacher.email === emailKey(input.email));
    if (!record) return reject(port, 'not_found', 'This demo email is not registered.');
    if (record.registrationStatus !== 'approved') return reject(port, 'pending_denied', HH_MESSAGES.pending_denied);
    const next = clone(state); next.sessionTeacherId = record.id; next.selectedTeacherId = record.id;
    const problem = persist(next, port); if (problem) return problem;
    return success(port, mode, 'logged_in', {session: sessionOf(record), registration: registrationOf(record), ownProfile: profileOf(record)}, 'Demo account logged in. No password authentication occurred.');
  });
  bind('Session.logout', (_input, port) => {
    const next = clone(state); next.sessionTeacherId = null;
    const problem = persist(next, port); if (problem) return problem;
    return success(port, mode, 'logged_out', {session: sessionOf(null)}, 'Demo account logged out.');
  });
  bind('TeacherProfile.createProfile', (input, port) => {
    const record = signedIn();
    if (!record || record.registrationStatus !== 'approved') return reject(port, 'authentication_required', HH_MESSAGES.authentication_required);
    if (record.profile) return reject(port, 'profile_exists', HH_MESSAGES.profile_exists);
    const displayName = asText(input.displayName, 160);
    const wishlistUrl = fixtureWishlistUrl(input.wishlistUrl);
    if (!isDemoName(displayName) || !Array.isArray(input.subjects || []) || !wishlistUrl || Object.hasOwn(input, 'wishlist')) return reject(port, 'validation_failed',
      'Use a Demo display name and a synthetic https Amazon wishlist URL with a DEMO-prefixed identifier. Wishlist items are deferred.');
    const profile = publicProfile({id: `profile-${record.id}`, teacherId: record.id, displayName,
      bio: input.bio || '', subjects: input.subjects || [], wishlistUrl, school: record.school, seeded: false});
    const next = clone(state); next.teachers.find((r) => r.id === record.id).profile = profile;
    const problem = persist(next, port); if (problem) return problem;
    return success(port, mode, 'profile_created', {profile, ownProfile: {status: 'present', profile}}, 'One session-only demo profile created.');
  });
  bind('TeacherProfile.openPublicProfile', (input, port) => {
    const profile = existingPublicProfiles().find((p) => p.id === input.profileId);
    return profile ? success(port, mode, 'loaded', {profile: publicProfile(profile)}) : reject(port, 'not_found', 'This public demo profile is unavailable in this tab.');
  });
  bind('Demo.reset', (_input, port) => {
    const problem = persist(newFixtureState(), port, {reset: true}); if (problem) return problem;
    return success(port, mode, 'reset', {journey: snapshot()}, 'Disposable demo state reset. Seed public profiles remain available.');
  });
  return Object.freeze({mode, fixture: true, capabilities, services: Object.freeze(services), snapshot,
    get diagnostics() { return deepFreeze({persistence: capabilities.persistence, initializationIssue}); }});
}
