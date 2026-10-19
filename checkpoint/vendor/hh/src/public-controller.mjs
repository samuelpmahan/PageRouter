import {SCHOOL_FIXTURES, FIXTURE_WISHLIST_URL} from '../services/index.mjs';
import {createCommunity, COMMUNITY_CATEGORIES, COMMUNITY_LIMITS} from './community.mjs';
import {teacherOfDayReference} from './site-data.mjs';

const clone = value => value == null ? value : structuredClone(value);
const FILTER_KEY = 'hh-public-directory-filters.v1';
const GRADES = Object.freeze(['Pre-K', 'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade', '6th Grade', '7th Grade', '8th Grade', 'High School']);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const boundedDraft = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
const boundedPostEditTitle = value => {
  if (typeof value !== 'string') return '';
  const source = value.length > COMMUNITY_LIMITS.title + 1 ? value.trim() : value;
  return boundedDraft(source, COMMUNITY_LIMITS.title + 1);
};
const boundedReplyDraft = value => {
  if (typeof value !== 'string') return '';
  const source = value.length > COMMUNITY_LIMITS.body + 1 ? value.trim() : value;
  return boundedDraft(source, COMMUNITY_LIMITS.body + 1);
};
const emailKey = value => clean(value, 254).toLowerCase();
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const routeKey = value => String(value || '').replace(/^#/, '').split(/[?#]/, 1)[0] || '/';

export function normalizePublicRoute(value = '') {
  const raw = String(value || '').replace(/^#/, '');
  const path = routeKey(raw);
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1).split('#', 1)[0] : '';
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean).map(part => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
  const first = (parts[0] || '').toLowerCase();
  const route = {page: 'home', path};
  if (['', 'home', 'index'].includes(first)) return route;
  if (['about', 'contact', 'partners', 'login', 'register'].includes(first)) return {...route, page: first};
  if (['forgot', 'forgotpassword', 'forgot-password', 'password-reset'].includes(first)) return {...route, page: 'forgot'};
  if (['directory', 'find-teachers', 'teachers'].includes(first) && parts.length === 1) return {...route, page: 'directory'};
  if ((first === 'teachers' || first === 'public-profile' || first === 'profile') && parts[1]) {
    return {...route, page: 'profile', profileId: parts[1]};
  }
  if (first === 'profile' && parts.length === 1) return {...route, page: 'profile'};
  if (['community', 'forum'].includes(first) && parts.length === 1) {
    return {...route, page: 'community', communityRoute: {page: 'forum'}};
  }
  if (first === 'create-post') return {...route, page: 'community', communityRoute: {page: 'create-post'}};
  if (first === 'posts' && parts[1]) return {...route, page: 'community', communityRoute: {page: 'post', threadId: parts[1]}};
  if (first === 'community' && parts[1] === 'thread' && parts[2]) {
    return {...route, page: 'community', communityRoute: {page: 'post', threadId: parts[2]}};
  }
  if (first === 'pages') {
    const file = String(parts[1] || '').toLowerCase();
    const filePages = {
      'homepage.html': 'home', 'index.html': 'directory', 'find_teachers.html': 'directory',
      'about.html': 'about', 'contact.html': 'contact', 'partners.html': 'partners',
      'login.html': 'login', 'forgot.html': 'forgot', 'register.html': 'register',
    };
    if (filePages[file]) return {...route, page: filePages[file]};
    if (file === 'terms_conditions.html') return {...route, page: 'register', termsOpen: true};
    if (file === 'forum.html') return {...route, page: 'community', communityRoute: {page: 'forum'}};
    if (file === 'create_post.html') return {...route, page: 'community', communityRoute: {page: 'create-post'}};
    if (file === 'post.html') {
      const threadId = clean(params.get('id') || params.get('publicid') || '', 120);
      return {...route, page: 'community', communityRoute: {page: 'post', ...(threadId ? {threadId} : {})}};
    }
    if (file === 'teacher.html') {
      const profileId = clean(params.get('id') || params.get('publicid') || teacherOfDayReference.id, 120);
      return {...route, page: 'profile', profileId};
    }
  }
  return {...route, page: 'not-found'};
}

function initialCommunity(community) {
  return {...community.snapshot(), query: '', category: 'All', composer: null, sort: 'date-newest', pageSize: 10, message: '',
    editingPostId: null, editingReplyId: null, editingThreadId: null, topicDraft: null, postEditDraft: null};
}

/**
 * Controller for the public HH preview. It projects the real fixture runtime,
 * while keeping entered display identity and edits in memory-only overlays.
 */
export function createPublicController({runtime, storage = null, onChange = () => {}, onNavigate = null, community: suppliedCommunity = null} = {}) {
  if (!runtime || typeof runtime.invoke !== 'function' || typeof runtime.snapshot !== 'function') {
    throw new TypeError('createPublicController needs the HH service runtime.');
  }
  const community = suppliedCommunity || createCommunity({storage});
  const state = {
    route: normalizePublicRoute('#/'),
    request: {status: 'idle', message: ''},
    journey: {
      runtime: clone(runtime.snapshot()),
      lookups: {states: [], counties: [], districts: [], schools: [], grades: [...GRADES]},
      school: {state: '', county: '', district: '', school: '', grade: ''},
      loading: false,
      error: '',
      lookupError: '',
      lookupRetryable: false,
      filters: {query: '', sort: 'date-newest', limit: 50},
      rememberedFilters: null,
      searchPerformed: false,
      matches: {status: 'idle', items: [], error: ''},
      registration: {status: runtime.snapshot().registration.status, identity: {name: '', email: '', phone: ''}},
      loginDraft: {email: null},
      terms: {open: false, accepted: false},
      session: {...clone(runtime.snapshot().session), email: ''},
      profile: {status: runtime.snapshot().ownProfile.status === 'present' ? 'present' : 'absent', value: null,
        editOpen: false, editDraft: {name: '', bio: '', wishlistUrl: ''},
        createDraft: {name: '', bio: '', wishlistUrl: ''}, source: 'runtime'},
      wishlist: {intent: false, remote: false, destination: null, profileId: null},
      share: {intent: false, url: '', profileId: null, remote: false, copied: false},
      contact: {name: '', email: '', subject: '', message: ''},
      outcome: null,
      communityRole: 'anonymous',
      navOpen: false,
    },
    community: initialCommunity(community),
  };

  let routeEpoch = 0;
  let schoolEpoch = 0;
  let directoryEpoch = 0;
  let mutation = false;
  let syntheticAccount = 0;
  let randomIndex = 0;
  let lastRetry = null;
  let schoolLookupRetry = null;
  const aliasToFixtureEmail = new Map();
  const identityByFixtureEmail = new Map();
  const profileOverlays = new Map();

  function notify() { onChange(state, state.route); }
  function setOutcome(kind, message, extras = {}) {
    state.journey.outcome = {kind, message: clean(message, 500), remote: false, ...extras};
  }
  function setRequest(status, message = '') {
    state.request = {status, message: clean(message, 500)};
  }
  function syncRuntime({email = ''} = {}) {
    const raw = clone(runtime.snapshot());
    state.journey.runtime = raw;
    const selectedEmail = email || (raw.session.status === 'authenticated'
      ? identityByFixtureEmail.get(emailKey(raw.registration.email))?.email || ''
      : identityByFixtureEmail.get(emailKey(raw.registration.email))?.email || '');
    state.journey.registration = {
      ...clone(raw.registration),
      identity: clone(identityByFixtureEmail.get(emailKey(raw.registration.email)) || {name: '', email: '', phone: ''}),
    };
    state.journey.session = {...clone(raw.session), email: selectedEmail};
    const own = raw.ownProfile?.profile;
    if (raw.ownProfile?.status === 'present' && own) {
      if (!state.route.profileId || state.route.profileId === own.id) {
        const overlay = profileOverlays.get(own.teacherId);
        state.journey.profile = {
          status: 'present',
          value: {...clone(own), name: overlay?.name || own.displayName, bio: overlay?.bio ?? own.bio,
            wishlistUrl: overlay?.wishlistUrl ?? own.wishlistUrl},
          editOpen: state.journey.profile.editOpen === true,
          editDraft: state.journey.profile.editDraft || {name: '', bio: '', wishlistUrl: ''},
          createDraft: state.journey.profile.createDraft || {name: '', bio: '', wishlistUrl: ''},
          source: overlay ? 'local-overlay' : 'runtime',
        };
      }
    } else if (!state.route.profileId) {
      state.journey.profile = {status: raw.session.status === 'authenticated' ? 'absent' : 'unknown', value: null,
        editOpen: false, editDraft: {name: '', bio: '', wishlistUrl: ''},
        createDraft: state.journey.profile.createDraft || {name: '', bio: '', wishlistUrl: ''}, source: 'runtime'};
    }
  }
  function setCommunityRole(role) {
    const nextRole = ['anonymous', 'teacher', 'moderator'].includes(role) ? role : 'anonymous';
    if (state.journey.communityRole !== nextRole) {
      state.community.postEditDraft = null;
      state.community.editingPostId = null;
    }
    if (state.journey.communityRole === 'teacher' && nextRole !== 'teacher') {
      state.community.topicDraft = null;
      state.community.replyDraft = null;
    }
    state.journey.communityRole = nextRole;
    refreshCommunity();
  }
  function refreshCommunity() {
    const snapshot = community.snapshot();
    state.community = {...snapshot, query: state.community.query || '', category: state.community.category || 'All',
      composer: state.community.composer || null, sort: state.community.sort || 'date-newest',
      pageSize: Math.max(1, Math.min(100, Number(state.community.pageSize) || 10)),
      message: state.community.message || '', editingPostId: state.community.editingPostId || null,
      editingReplyId: state.community.editingReplyId || null, editingThreadId: state.community.editingThreadId || null,
      topicDraft: state.community.topicDraft || null, replyDraft: state.community.replyDraft || null,
      postEditDraft: state.community.postEditDraft || null};
  }
  function clearMutationStatus() { setRequest('idle', ''); state.journey.error = ''; }
  function activeWishlistProfileId(route = state.route, projection = state.journey.profile) {
    if (route.page !== 'profile' || projection.status !== 'present') return null;
    const profile = projection.value;
    if (!profile || projection.readOnly || profile.readOnly || projection.source === 'captured-readonly') return null;
    if (route.profileId) return profile.id === route.profileId ? profile.id : null;
    return state.journey.session.status === 'authenticated' && profile.teacherId === state.journey.session.teacherId
      ? profile.id : null;
  }
  function clearWishlistHandoff() {
    state.journey.wishlist = {intent: false, remote: false, destination: null, profileId: null};
  }
  function clearShareHandoff() {
    state.journey.share = {intent: false, url: '', profileId: null, remote: false, copied: false};
  }

  async function service(port, input = {}, boundary = {}, {retry = false, beforeSync = null, after = null} = {}) {
    if (mutation) return {ok: false, ignored: true, error: {code: 'request_in_flight', message: 'A preview request is already running.'}};
    const startRouteEpoch = routeEpoch;
    mutation = true;
    setRequest('busy', 'Working on the local preview…');
    notify();
    let result;
    try { result = await runtime.invoke(port, input, boundary); }
    catch { result = {ok: false, error: {code: 'runtime_failure', message: 'The local preview request failed.'}, message: 'The local preview request failed.'}; }
    mutation = false;
    if (beforeSync) beforeSync(result);
    const registrationDraft = port === 'Registration.registerTeacher' && state.route.page === 'register'
      ? clone(state.journey.registration.identity) : null;
    syncRuntime();
    if (!result.ok && registrationDraft && state.route.page === 'register') {
      state.journey.registration.identity = registrationDraft;
    }
    if (result.ok) {
      setRequest('completed', result.message || 'Local preview updated.');
      setOutcome('local-simulation', result.message || 'Local preview updated.');
      lastRetry = null;
      if (after) await after(result, {routeCurrent: routeEpoch === startRouteEpoch});
    } else {
      const message = result.message || result.error?.message || 'The local preview request could not be completed.';
      setRequest(result.error?.outcomeKnown === false ? 'outcome_unknown' : 'failed', message);
      setOutcome('local-error', message, {code: result.error?.code || 'request_failed'});
      lastRetry = retry && result.error?.retryable && result.error?.outcomeKnown !== false ? retry : null;
    }
    notify();
    return result;
  }

  async function loadLookup(port, input, target, epoch = schoolEpoch) {
    if (state.journey.lookupError && state.journey.outcome?.kind === 'local-error') state.journey.outcome = null;
    state.journey.loading = true;
    state.journey.lookupError = '';
    state.journey.lookupRetryable = false;
    const retryInput = clone(input);
    const retryLookup = () => loadLookup(port, retryInput, target, epoch);
    notify();
    const failNext = state.journey.failNext === true;
    if (failNext) state.journey.failNext = false;
    const result = failNext
      ? {ok: false, message: 'Simulated local school-data failure; no state changed.', error: {code: 'transport_failure', retryable: true}}
      : await runtime.invoke(port, input);
    if (epoch !== schoolEpoch) return {ok: false, ignored: true};
    state.journey.loading = false;
    if (result.ok) {
      state.journey.lookups[target] = clone(result.data.values || []);
      state.journey.lookupError = '';
      state.journey.lookupRetryable = false;
      if (schoolLookupRetry?.epoch === epoch) schoolLookupRetry = null;
    } else {
      state.journey.lookupError = result.message || result.error?.message || 'School choices are unavailable.';
      state.journey.lookupRetryable = result.error?.retryable === true && result.error?.outcomeKnown !== false;
      state.journey.error = state.journey.lookupError;
      schoolLookupRetry = state.journey.lookupRetryable ? {epoch, run: retryLookup} : null;
      setOutcome('local-error', state.journey.lookupError, {code: result.error?.code || 'lookup_failed'});
    }
    notify();
    return result;
  }

  function validateRemembered(value) {
    if (!value || value.version !== 1 || !value.school || typeof value.school !== 'object' ||
        typeof value.query !== 'string' || value.query.length > 100 || !['date-newest', 'date-oldest', 'upvotes'].includes(value.sort || 'date-newest')) return null;
    const school = {state: clean(value.school.state, 80), county: clean(value.school.county, 80),
      district: clean(value.school.district, 80), school: clean(value.school.school, 100), grade: clean(value.school.grade, 40)};
    const hierarchy = ['state', 'county', 'district', 'school'];
    const hasSchoolSelection = hierarchy.some(key => school[key]);
    const coherentRow = SCHOOL_FIXTURES.some(item => hierarchy.every(key => !school[key] || item[key] === school[key]));
    if ((hasSchoolSelection && !coherentRow) || (school.grade && !GRADES.includes(school.grade))) return null;
    return {version: 1, school, query: clean(value.query, 100), sort: value.sort || 'date-newest'};
  }
  function readRememberedFilters() {
    if (!storage) return;
    try {
      const raw = storage.getItem(FILTER_KEY);
      if (!raw) return;
      if (raw.length > 2048) throw new Error('too_large');
      const saved = validateRemembered(JSON.parse(raw));
      if (!saved) throw new Error('invalid');
      state.journey.rememberedFilters = saved;
    } catch {
      try { storage.removeItem(FILTER_KEY); } catch {}
      setOutcome('local-warning', 'Saved directory filters were invalid and have been cleared.');
    }
  }
  function rememberFilters() {
    const value = {version: 1, school: clone(state.journey.school), query: clean(state.journey.filters.query, 100), sort: state.journey.filters.sort};
    state.journey.rememberedFilters = value;
    if (!storage) return;
    try { storage.setItem(FILTER_KEY, JSON.stringify(value)); }
    catch { setOutcome('local-warning', 'Filters are available for this page but could not be remembered in browser storage.'); }
  }

  async function initialize(hash = '') {
    await runtime.ready;
    syncRuntime();
    readRememberedFilters();
    await navigate(hash || '#/');
    if (state.route.page !== 'register' && !state.journey.lookups.states.length) {
      await loadLookup('SchoolData.getStates', {}, 'states', schoolEpoch);
    }
    return state;
  }

  async function loadRegistrationChoices() {
    const school = state.journey.school;
    if (!state.journey.lookups.states.length) return loadLookup('SchoolData.getStates', {}, 'states', schoolEpoch);
    if (school.state && !state.journey.lookups.counties.length) return loadLookup('SchoolData.getCounties', school, 'counties', schoolEpoch);
    if (school.county && !state.journey.lookups.districts.length) return loadLookup('SchoolData.getDistricts', school, 'districts', schoolEpoch);
    if (school.district && !state.journey.lookups.schools.length) return loadLookup('SchoolData.getSchools', school, 'schools', schoolEpoch);
    return {ok: true, local: true};
  }

  async function navigate(hash = '#/') {
    routeEpoch += 1;
    schoolEpoch += 1;
    const epoch = routeEpoch;
    state.journey.loading = false;
    const nextRoute = normalizePublicRoute(hash);
    const replyDraftRoute = nextRoute.page === 'community' && nextRoute.communityRoute?.page === 'post'
      ? nextRoute.communityRoute.threadId : null;
    if (state.community.replyDraft && replyDraftRoute !== state.community.replyDraft.threadId) state.community.replyDraft = null;
    const nextPostId = replyDraftRoute;
    if (state.community.editingPostId && state.community.editingPostId !== nextPostId) {
      state.community.editingPostId = null;
      state.community.postEditDraft = null;
    } else if (state.community.postEditDraft && nextPostId !== state.community.postEditDraft.postId) {
      state.community.postEditDraft = null;
    }
    state.route = nextRoute;
    const targetWishlistProfileId = activeWishlistProfileId();
    if (state.journey.wishlist.intent && state.journey.wishlist.profileId !== targetWishlistProfileId) clearWishlistHandoff();
    const targetShareProfileId = state.route.page === 'profile'
      ? state.route.profileId || state.journey.runtime?.ownProfile?.profile?.id || null
      : null;
    if (state.journey.share.intent && state.journey.share.profileId !== targetShareProfileId) clearShareHandoff();
    state.journey.navOpen = false;
    state.journey.error = '';
    state.journey.terms = {...state.journey.terms, open: state.route.termsOpen === true};
    if (state.journey.lookupError && state.journey.outcome?.kind === 'local-error') state.journey.outcome = null;
    state.journey.lookupError = '';
    state.journey.lookupRetryable = false;
    lastRetry = null;
    schoolLookupRetry = null;
    if (state.route.page === 'directory') {
      await loadDirectory(state.journey.filters.query, state.journey.school, epoch);
    } else if (state.route.page === 'profile' && state.route.profileId) {
      await loadPublicProfile(state.route.profileId, epoch);
    } else if (state.route.page === 'profile') {
      syncRuntime();
    } else if (state.route.page === 'register') {
      await loadRegistrationChoices();
    }
    notify();
    return {ok: true, route: clone(state.route)};
  }

  async function selectSchool(key, value) {
    const aliases = {region: 'state', schoolDistrict: 'district'};
    key = aliases[key] || key;
    if (key === 'grade') {
      state.journey.school.grade = clean(value, 40);
      notify();
      return {ok: true};
    }
    const keys = ['state', 'county', 'district', 'school'];
    const index = keys.indexOf(key);
    if (index < 0) throw new Error('Unknown school selection.');
    lastRetry = null;
    schoolLookupRetry = null;
    schoolEpoch += 1;
    const epoch = schoolEpoch;
    state.journey.school[key] = clean(value, 100);
    for (let i = index + 1; i < keys.length; i += 1) {
      state.journey.school[keys[i]] = '';
      const lookupKey = {state: 'states', county: 'counties', district: 'districts', school: 'schools'}[keys[i]];
      state.journey.lookups[lookupKey] = [];
    }
    if (state.journey.lookupError && state.journey.outcome?.kind === 'local-error') state.journey.outcome = null;
    state.journey.lookupError = '';
    state.journey.lookupRetryable = false;
    state.journey.error = '';
    clearMutationStatus();
    notify();
    if (!value || key === 'school') return {ok: true};
    const requests = [
      ['SchoolData.getCounties', 'counties'],
      ['SchoolData.getDistricts', 'districts'],
      ['SchoolData.getSchools', 'schools'],
    ];
    const [port, target] = requests[index];
    const input = {...state.journey.school};
    return loadLookup(port, input, target, epoch);
  }

  async function loadDirectory(query = '', school = state.journey.school, expectedRouteEpoch = routeEpoch) {
    const epoch = ++directoryEpoch;
    state.journey.matches = {status: 'loading', items: [], error: ''};
    state.journey.loading = true;
    state.journey.filters.query = clean(query, 100);
    state.journey.filters.sort = state.community.sort || 'date-newest';
    notify();
    await Promise.resolve();
    if (epoch !== directoryEpoch || expectedRouteEpoch !== routeEpoch || state.route.page !== 'directory') return {ok: false, ignored: true};
    try {
      if (state.journey.failNext === true) {
        state.journey.failNext = false;
        throw new Error('simulated_directory_read_failure');
      }
      const profiles = runtime.snapshot().demo?.publicProfiles || [];
      const needle = state.journey.filters.query.toLocaleLowerCase();
      const items = profiles.filter(profile => {
        if (school.school && profile.school?.school !== school.school) return false;
        if (school.state && profile.school?.state !== school.state) return false;
        if (school.county && profile.school?.county !== school.county) return false;
        if (school.district && profile.school?.district !== school.district) return false;
        const text = `${profile.displayName || ''} ${profile.bio || ''} ${profile.school?.school || ''} ${profile.subjects?.join(' ') || ''}`.toLocaleLowerCase();
        return !needle || text.includes(needle);
      }).map(profile => ({...clone(profile), name: profile.displayName, schoolName: profile.school?.school || '', grade: profile.subjects?.join(', ') || 'Teacher'}));
      state.journey.matches = {status: 'loaded', items, error: ''};
      state.journey.loading = false;
      state.journey.error = '';
      lastRetry = null;
      notify();
      return {ok: true, items: clone(items)};
    } catch {
      state.journey.matches = {status: 'error', items: [], error: 'Directory results could not be loaded.'};
      state.journey.loading = false;
      state.journey.error = state.journey.matches.error;
      lastRetry = () => loadDirectory(state.journey.filters.query, state.journey.school, routeEpoch);
      notify();
      return {ok: false, error: {code: 'directory_read_failed', message: state.journey.matches.error, retryable: true}};
    }
  }

  async function loadPublicProfile(profileId, expectedRouteEpoch = routeEpoch) {
    const epoch = ++directoryEpoch;
    state.journey.profile = {status: 'loading', value: null, editOpen: false, source: 'runtime'};
    notify();
    if (profileId === teacherOfDayReference.id) {
      const captured = clone(teacherOfDayReference);
      if (expectedRouteEpoch !== routeEpoch || epoch !== directoryEpoch) return {ok: false, ignored: true};
      state.journey.profile = {
        status: 'present',
        value: {
          id: captured.id,
          name: captured.name,
          displayName: captured.name,
          image: captured.image,
          school: {school: captured.school, county: captured.county, state: captured.state},
          bio: captured.bio,
          wishlistUrl: captured.wishlist.url,
          readOnly: true,
          provenance: captured.provenance,
        },
        editOpen: false,
        editDraft: {name: '', bio: '', wishlistUrl: ''},
        createDraft: {name: '', bio: '', wishlistUrl: ''},
        readOnly: true,
        source: 'captured-readonly',
      };
      setOutcome('captured-reference', 'Showing the read-only Teacher of the Day details from the anonymous public capture.');
      lastRetry = null;
      notify();
      return {ok: true, local: true, readOnly: true, source: captured.provenance, profile: clone(state.journey.profile.value)};
    }
    const result = await runtime.invoke('TeacherProfile.openPublicProfile', {profileId: clean(profileId, 120)});
    if (expectedRouteEpoch !== routeEpoch || epoch !== directoryEpoch) return {ok: false, ignored: true};
    if (result.ok) {
      const profile = clone(result.data.profile);
      const overlay = profileOverlays.get(profile.teacherId);
      state.journey.profile = {status: 'present', value: {...profile, name: overlay?.name || profile.displayName,
        bio: overlay?.bio ?? profile.bio, wishlistUrl: overlay?.wishlistUrl ?? profile.wishlistUrl},
        editOpen: false, source: overlay ? 'local-overlay' : 'runtime'};
      setOutcome('local-simulation', 'Showing a synthetic public teacher profile.');
      lastRetry = null;
    } else {
      state.journey.profile = {status: 'error', value: null, editOpen: false, source: 'runtime'};
      setOutcome('local-error', result.message || 'This synthetic profile is unavailable.');
      lastRetry = result.error?.retryable ? () => loadPublicProfile(profileId, routeEpoch) : null;
    }
    notify();
    return result;
  }

  function requestNavigation(path) {
    const normalized = routeKey(path);
    if (state.route.path === normalized) return navigate(`#${normalized}`);
    if (typeof onNavigate === 'function') onNavigate(normalized);
    else return navigate(`#${normalized}`);
    if (normalizePublicRoute(normalized).path === state.route.path) return navigate(`#${normalized}`);
    return {ok: true, route: normalizePublicRoute(normalized)};
  }

  async function directorySearch(payload = {}) {
    if (payload.school || payload.state || payload.county || payload.district) {
      const incoming = {...state.journey.school};
      for (const key of ['state', 'county', 'district', 'school', 'grade']) if (typeof payload[key] === 'string') incoming[key] = payload[key];
      state.journey.school = incoming;
    }
    state.journey.filters.query = clean(payload.query, 100);
    state.journey.filters.sort = ['date-newest', 'date-oldest', 'upvotes'].includes(payload.sort) ? payload.sort : state.journey.filters.sort;
    state.journey.searchPerformed = true;
    rememberFilters();
    return loadDirectory(state.journey.filters.query, state.journey.school, routeEpoch);
  }

  function syncCommunityNotice(result, message = '') {
    refreshCommunity();
    state.community.message = message || (result?.ok ? 'Local forum preview updated.' : result?.error || 'The forum action could not be completed.');
    notify();
    return result;
  }
  function roleArgs() { return {role: state.journey.communityRole, personaId: 'demo-teacher'}; }
  function forumAction(event, payload = {}) {
    const role = state.journey.communityRole;
    const postId = clean(payload.postId || payload.threadId || payload.id, 120);
    const replyId = clean(payload.replyId || payload.commentId, 120);
    let result;
    if (event === 'forum-role' || event === 'community:role') {
      setCommunityRole(payload.role);
      return syncCommunityNotice({ok: true}, `Local forum preview role is now ${state.journey.communityRole}.`);
    }
    if (event === 'forum-search') { state.community.query = boundedDraft(payload.query ?? payload.value, 250); return syncCommunityNotice({ok: true}, 'Forum search updated locally.'); }
    if (event === 'forum-clear-search') { state.community.query = ''; return syncCommunityNotice({ok: true}, 'Forum search cleared.'); }
    if (event === 'forum-category') { state.community.category = clean(payload.category ?? payload.value, 80) || 'All'; return syncCommunityNotice({ok: true}, 'Forum category updated.'); }
    if (event === 'forum-sort') {
      const sort = payload.sort ?? payload.value;
      if (!['date-newest', 'date-oldest', 'upvotes'].includes(sort)) return syncCommunityNotice({ok: false, error: 'invalid_sort'}, 'Choose a supported local sort.');
      state.community.sort = sort;
      return syncCommunityNotice({ok: true}, 'Forum sort updated locally.');
    }
    if (event === 'forum-load-more') { state.community.pageSize = Math.min(100, state.community.pageSize + 10); return syncCommunityNotice({ok: true}, 'More local topics are visible.'); }
    if (event === 'forum-compose-topic') {
      state.community.composer = 'topic';
      return requestNavigation('/create-post');
    }
    if (event === 'forum-topic' || event === 'forum-submit-topic') {
      const content = payload.body ?? payload.content;
      result = community.createThread({title: payload.title, body: content, category: payload.category,
        author: state.journey.registration.identity.name || 'Preview Teacher', role, authorId: 'demo-teacher'});
      if (result.ok) {
        state.community.topicDraft = null;
        requestNavigation(`/posts/${encodeURIComponent(result.value.id)}`);
      } else if (role === 'teacher') {
        state.community.topicDraft = {
          title: boundedDraft(payload.title, COMMUNITY_LIMITS.title + 1),
          category: boundedDraft(payload.category, COMMUNITY_LIMITS.category),
          content: boundedDraft(content, COMMUNITY_LIMITS.body + 1),
        };
      }
      return syncCommunityNotice(result);
    }
    if (event === 'forum-open-thread') return requestNavigation(`/posts/${encodeURIComponent(postId)}`);
    if (event === 'forum-reply' || event === 'forum-comment') {
      const content = payload.body ?? payload.content;
      result = community.reply(postId, {body: content, author: state.journey.registration.identity.name || 'Preview Teacher', role, authorId: 'demo-teacher'});
      if (result?.ok) {
        if (state.community.replyDraft?.threadId === postId) state.community.replyDraft = null;
      } else if (role === 'teacher' && ['reply_required', 'input_too_long', 'reply_limit_reached'].includes(result?.error)) {
        state.community.replyDraft = {threadId: postId, content: boundedReplyDraft(content)};
      } else if (state.community.replyDraft?.threadId === postId) {
        state.community.replyDraft = null;
      }
      return syncCommunityNotice(result);
    }
    if (event === 'forum-flag-thread') result = community.flag(postId, {role});
    else if (event === 'forum-flag-reply') result = community.flag(postId, {replyId, role});
    else if (event === 'forum-hide-thread' || event === 'forum-unhide-thread') result = community.moderate(postId, {hidden: event === 'forum-hide-thread', role});
    else if (event === 'forum-hide-reply' || event === 'forum-unhide-reply') result = community.moderate(postId, {replyId, hidden: event === 'forum-hide-reply', role});
    else if (event === 'forum-vote') result = community.vote(postId, {...roleArgs(), direction: payload.direction || 'upvote'});
    else if (event === 'forum-edit-post') {
      if (payload.title === undefined && payload.body === undefined && payload.content === undefined) {
        if (state.community.editingPostId !== postId) state.community.postEditDraft = null;
        state.community.editingPostId = postId;
        return syncCommunityNotice({ok: true}, 'Edit this local post in the forum editor.');
      }
      const saved = state.community.threads.find(thread => thread.id === postId);
      const title = payload.title === undefined ? saved?.title : payload.title;
      const body = payload.body ?? payload.content ?? saved?.body;
      result = community.updatePost(postId, {title: payload.title, body: payload.body ?? payload.content, ...roleArgs()});
      if (result?.ok) {
        state.community.postEditDraft = null;
      } else if (role === 'teacher' && state.community.editingPostId === postId &&
          ['title_and_body_required', 'input_too_long'].includes(result?.error)) {
        state.community.postEditDraft = {postId, title: boundedPostEditTitle(title), content: boundedReplyDraft(body)};
      } else if (state.community.postEditDraft?.postId === postId) {
        state.community.postEditDraft = null;
      }
    } else if (event === 'forum-delete-post') result = community.deletePost(postId, roleArgs());
    else if (event === 'forum-edit-comment') {
      if (payload.body === undefined && payload.content === undefined) {
        state.community.postEditDraft = null;
        state.community.editingPostId = null;
        state.community.editingReplyId = replyId;
        state.community.editingThreadId = postId;
        return syncCommunityNotice({ok: true}, 'Edit this local comment in the forum editor.');
      }
      result = community.updateReply(postId, replyId, {body: payload.body ?? payload.content, ...roleArgs()});
    } else if (event === 'forum-delete-comment') result = community.deleteReply(postId, replyId, roleArgs());
    else if (event === 'forum-cancel-edit') {
      state.community.postEditDraft = null;
      state.community.editingPostId = null;
      state.community.editingReplyId = null;
      state.community.editingThreadId = null;
      return syncCommunityNotice({ok: true}, 'Forum edit cancelled.');
    }
    else if (event === 'forum-reset') {
      state.community.topicDraft = null;
      state.community.replyDraft = null;
      state.community.postEditDraft = null;
      state.community.editingPostId = null;
      result = community.reset();
    }
    else if (event === 'forum-export') {
      const data = community.exportData();
      state.community.exportData = data;
      return syncCommunityNotice({ok: true, value: data}, 'Local forum data is ready to copy; no data was uploaded.');
    } else return null;
    if (result?.ok) {
      state.community.postEditDraft = null;
      state.community.editingPostId = null;
      state.community.editingReplyId = null;
      state.community.editingThreadId = null;
    }
    refreshCommunity();
    state.community.message = result?.ok ? 'Local forum preview updated.' : result?.error || 'The forum action could not be completed.';
    notify();
    return result;
  }

  async function dispatch(event, payload = {}) {
    const aliases = {
      'public-toggle-nav': 'public:toggle-nav',
      'public-open-terms': 'public:open-terms',
      'public-close-terms': 'public:close-terms',
      'public-accept-terms': 'public:accept-terms',
      'register': 'public:register',
      'login': 'public:login',
      'create-profile': 'public:profile-create',
      'reset': 'public:reset',
      'retry': 'public:retry',
      approve: 'public:approve',
      logout: 'public:logout',
      'arm-failure': 'public:fail-next',
      'directory-restore': 'public:directory-restore',
      'public-directory-search': 'public:directory-search',
    };
    event = aliases[event] || event;
    if (typeof event !== 'string') throw new TypeError('Expected a public preview event name.');
    if (event.startsWith('forum-') || event === 'community:role') return forumAction(event, payload);

    if (event === 'public:toggle-nav') { state.journey.navOpen = !state.journey.navOpen; notify(); return {ok: true}; }
    if (event === 'public:open-terms') { state.journey.terms.open = true; notify(); return {ok: true}; }
    if (event === 'public:close-terms') { state.journey.terms.open = false; notify(); return {ok: true}; }
    if (event === 'public:terms-consent') {
      state.journey.terms.accepted = payload.accepted === true;
      notify();
      return {ok: true};
    }
    if (event === 'public:accept-terms') { state.journey.terms = {open: false, accepted: true}; notify(); return {ok: true}; }
    if (event === 'public:directory-search') return directorySearch(payload);
    if (event === 'public:directory-restore') {
      const saved = validateRemembered(state.journey.rememberedFilters);
      if (!saved) return {ok: false, error: {code: 'no_remembered_filters', message: 'There are no valid remembered filters.'}};
      state.journey.school = {...saved.school};
      state.journey.filters.query = saved.query;
      state.community.sort = saved.sort;
      schoolEpoch += 1;
      const epoch = schoolEpoch;
      const school = saved.school;
      if (school.state) await loadLookup('SchoolData.getCounties', school, 'counties', epoch);
      if (school.county) await loadLookup('SchoolData.getDistricts', school, 'districts', epoch);
      if (school.district) await loadLookup('SchoolData.getSchools', school, 'schools', epoch);
      if (state.route.page === 'directory') return loadDirectory(saved.query, saved.school, routeEpoch);
      notify();
      return {ok: true};
    }
    if (event === 'public:random-teacher') {
      const items = state.journey.matches.items.length ? state.journey.matches.items : (runtime.snapshot().demo?.publicProfiles || []);
      if (!items.length) return {ok: false, error: {code: 'no_profiles', message: 'No synthetic teacher profiles are available.'}};
      const picked = items[randomIndex++ % items.length];
      return requestNavigation(`/public-profile/${encodeURIComponent(picked.id)}`);
    }
    if (event === 'public:wishlist') {
      const profile = state.journey.profile.value;
      if (state.route.page === 'profile' && (state.journey.profile.readOnly || profile?.readOnly || state.journey.profile.source === 'captured-readonly')) {
        return {ok: false, error: {code: 'read_only_reference', message: 'Captured public reference profiles do not use the synthetic wishlist handoff.'}};
      }
      const profileId = activeWishlistProfileId();
      if (state.route.page === 'profile' && !profileId) {
        return {ok: false, error: {code: 'profile_unavailable', message: 'Load the current profile before preparing its wishlist handoff.'}};
      }
      const destination = profile?.wishlistUrl || FIXTURE_WISHLIST_URL;
      state.journey.wishlist = {intent: true, remote: false, destination, profileId, choiceRequired: true, opened: false};
      setOutcome('handoff-ready', 'This synthetic wishlist is an external handoff. Choose whether to open the displayed fixture destination; this preview has not opened it.');
      notify();
      return {ok: true, handoff: clone(state.journey.wishlist)};
    }
    if (event === 'public:confirm-wishlist') {
      if (!state.journey.wishlist.intent) return {ok: false, error: {code: 'no_wishlist_handoff'}};
      if (state.route.page === 'profile' && (state.journey.profile.readOnly || state.journey.profile.value?.readOnly || state.journey.profile.source === 'captured-readonly')) {
        return {ok: false, error: {code: 'read_only_reference'}};
      }
      const activeProfileId = activeWishlistProfileId();
      if ((state.route.page === 'profile' && !activeProfileId) || state.journey.wishlist.profileId !== activeProfileId) {
        return {ok: false, error: {code: 'wishlist_profile_changed', message: 'Prepare a new handoff from the profile currently shown.'}};
      }
      state.journey.wishlist = {...state.journey.wishlist, choiceRequired: false, confirmed: true};
      setOutcome('handoff-confirmed', 'Wishlist handoff confirmed. Open the displayed link only if you choose to leave this local preview.');
      notify();
      return {ok: true, handoff: clone(state.journey.wishlist)};
    }
    if (event === 'public:donate-intent') {
      state.journey.donation = {intent: true, remote: false, destination: null};
      setOutcome('local-handoff', 'Donation is not connected in this preview. No payment page was opened.');
      notify();
      return {ok: true, handoff: clone(state.journey.donation)};
    }
    if (event === 'public:share') {
      const id = state.route.profileId || state.journey.profile.value?.id || 'demo-avery';
      const url = `#/public-profile/${encodeURIComponent(id)}`;
      state.journey.share = {intent: true, url, profileId: id, remote: false, copied: false};
      setOutcome('local-handoff', 'A local preview route is ready to copy. No public sharing service was called.');
      notify();
      return {ok: true, share: clone(state.journey.share)};
    }
    if (event === 'public:edit-profile') {
      if (state.journey.profile.status !== 'present') return {ok: false, error: {code: 'profile_unavailable'}};
      if (state.journey.profile.readOnly || state.journey.profile.value?.readOnly) {
        return {ok: false, error: {code: 'read_only_reference', message: 'Captured public reference profiles are read-only.'}};
      }
      if (state.journey.session.status !== 'authenticated') return {ok: false, error: {code: 'authentication_required'}};
      const ownershipError = profileOwnerError(state.journey.profile.value);
      if (ownershipError) return ownershipError;
      state.journey.profile.editOpen = !state.journey.profile.editOpen;
      state.journey.profile.editDraft = state.journey.profile.editOpen
        ? {name: state.journey.profile.value.name || '', bio: state.journey.profile.value.bio || '', wishlistUrl: state.journey.profile.value.wishlistUrl || ''}
        : {name: '', bio: '', wishlistUrl: ''};
      notify();
      return {ok: true};
    }
    if (event === 'public:profile-edit') {
      const profile = state.journey.profile.value;
      if (!profile || state.journey.session.status !== 'authenticated') return {ok: false, error: {code: 'authentication_required'}};
      if (state.journey.profile.readOnly || profile.readOnly || state.journey.profile.source === 'captured-readonly') {
        return {ok: false, error: {code: 'read_only_reference', message: 'Captured public reference profiles are read-only.'}};
      }
      const ownershipError = profileOwnerError(profile);
      if (ownershipError) return ownershipError;
      const draft = state.journey.profile.editDraft || {};
      const name = clean(payload.name ?? draft.name ?? profile.name, 100);
      const bio = clean(payload.bio ?? draft.bio ?? profile.bio, 500);
      const wishlistInput = payload.wishlistUrl ?? draft.wishlistUrl ?? profile.wishlistUrl;
      const wishlistUrl = typeof wishlistInput === 'string' ? wishlistInput.trim() : '';
      if (!name) return localValidation('Enter a display name.');
      if (wishlistUrl && !safeWishlist(wishlistUrl)) return localValidation('Use a synthetic preview wishlist URL such as https://www.amazon.com/hz/wishlist/ls/DEMO-CLASSROOM, or leave it blank to keep the current link.');
      const overlay = {name, bio, wishlistUrl: safeWishlist(wishlistUrl) ? wishlistUrl : profile.wishlistUrl};
      profileOverlays.set(profile.teacherId, overlay);
      state.journey.profile = {...state.journey.profile, value: {...profile, ...overlay}, editOpen: false,
        editDraft: {name: '', bio: '', wishlistUrl: ''}, source: 'local-overlay'};
      setOutcome('local-only', 'Profile changes are shown in this tab only. The provider has no profile-update operation.');
      notify();
      return {ok: true, localOnly: true, profile: clone(state.journey.profile.value)};
    }
    if (event === 'public:register') {
      if (mutation) return {ok: false, ignored: true, error: {code: 'request_in_flight'}};
      const name = clean(payload.name, 80), email = emailKey(payload.email), phone = clean(payload.phone ?? payload.phone_number, 32);
      const password = typeof payload.password === 'string' ? payload.password : '';
      const rawConfirmation = payload.confirmPassword ?? payload.confirm_password;
      const confirmPassword = typeof rawConfirmation === 'string' ? rawConfirmation : '';
      if (!name || !validEmail(email) || !password || !confirmPassword) return localValidation('Enter your name, a valid email, and both password fields.');
      if (password !== confirmPassword) return localValidation('The password confirmation does not match.');
      if (!state.journey.terms.accepted && payload.termsAccepted !== true) return localValidation('Read and accept the preview terms before registering.');
      for (const key of ['state', 'county', 'district', 'school', 'grade']) {
        if (typeof payload[key] === 'string') state.journey.school[key] = clean(payload[key], key === 'grade' ? 40 : 100);
      }
      const schoolName = clean(payload.school, 100) || state.journey.school.school;
      const school = SCHOOL_FIXTURES.find(item => item.school === schoolName &&
        ['state', 'county', 'district'].every(key => !state.journey.school[key] || state.journey.school[key] === item[key]));
      if (!school) return localValidation('Choose a school from the local fixture list.');
      if (payload.termsAccepted === true) state.journey.terms.accepted = true;
      state.journey.registration.identity = {name, email: clean(payload.email, 254), phone};
      state.journey.school = {...state.journey.school, ...school, grade: clean(payload.grade, 40) || state.journey.school.grade};
      const fixtureEmail = `public-teacher-${++syntheticAccount}@fixture.test`;
      const internalName = `Demo ${name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().slice(0, 60) || 'Teacher'}`;
      lastRetry = null;
      return service('Registration.registerTeacher', {
        teacher: {name: internalName, email: fixtureEmail, phoneNumber: 'DEMO'},
        school: {state: school.state, county: school.county, district: school.district, school: school.school},
        termsAccepted: true, demoAccount: true,
      }, {credentials: {password, confirmPassword}}, {beforeSync: result => {
        if (result.ok) {
          aliasToFixtureEmail.set(email, fixtureEmail);
          identityByFixtureEmail.set(fixtureEmail, {name, email: clean(payload.email, 254), phone});
        }
      }, after: async () => {
        state.journey.session.email = clean(payload.email, 254);
        state.journey.terms.open = false;
        setCommunityRole('anonymous');
      }});
    }
    if (event === 'public:approve') {
      const startRouteEpoch = routeEpoch;
      const result = await service('Demo.simulateApproval');
      if (result.ok) {
        state.journey.session.email = state.journey.registration.identity.email || state.journey.session.email;
        setCommunityRole('anonymous');
        if (routeEpoch === startRouteEpoch) requestNavigation('/login');
      }
      return result;
    }
    if (event === 'public:login') {
      const email = emailKey(payload.email), password = typeof payload.password === 'string' ? payload.password : '';
      if (!validEmail(email) || !password) return localValidation('Enter the demo email and password field to continue. The preview does not verify passwords.');
      const fixtureEmail = aliasToFixtureEmail.get(email) || email;
      const startRouteEpoch = routeEpoch;
      const result = await service('Session.login', {email: fixtureEmail, demoAccount: true}, {credentials: {password, confirmPassword: password}}, {after: async () => {
        const identity = identityByFixtureEmail.get(emailKey(fixtureEmail));
        state.journey.loginDraft = {email: null};
        state.journey.session.email = identity?.email || clean(payload.email, 254);
        setCommunityRole('teacher');
      }});
      if (result.ok && routeEpoch === startRouteEpoch) requestNavigation('/profile');
      return result;
    }
    if (event === 'public:logout') {
      const startRouteEpoch = routeEpoch;
      const ownProfileId = runtime.snapshot().ownProfile?.profile?.id || null;
      const result = await service('Session.logout');
      if (result.ok) {
        state.journey.loginDraft = {email: null};
        setCommunityRole('anonymous');
        if (!state.route.profileId || state.route.profileId === ownProfileId) {
          state.journey.profile = {status: 'unknown', value: null, editOpen: false, source: 'runtime'};
        }
        if (routeEpoch === startRouteEpoch) requestNavigation('/login');
      }
      return result;
    }
    if (event === 'public:profile-create') {
      if (state.journey.session.status !== 'authenticated') return {ok: false, error: {code: 'authentication_required', message: 'Log in to create a teacher profile.'}};
      const identity = identityByFixtureEmail.get(emailKey(state.journey.runtime.registration.email)) || state.journey.registration.identity;
      const createDraft = state.journey.profile.createDraft || {};
      const name = clean(payload.name ?? createDraft.name, 100) || identity?.name || 'Demo Teacher';
      const bio = clean(payload.bio ?? createDraft.bio, 500);
      const wishlistInput = payload.wishlistUrl ?? createDraft.wishlistUrl;
      const wishlistUrl = typeof wishlistInput === 'string' ? wishlistInput.trim() : '';
      if (wishlistUrl && !safeWishlist(wishlistUrl)) return localValidation('Use a synthetic preview wishlist URL such as https://www.amazon.com/hz/wishlist/ls/DEMO-CLASSROOM, or leave it blank to use the default link.');
      const internalName = `Demo ${name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().slice(0, 60) || 'Teacher'}`;
      const result = await service('TeacherProfile.createProfile', {
        displayName: internalName, bio: 'Synthetic local preview profile.', subjects: [], wishlistUrl: FIXTURE_WISHLIST_URL,
      });
      if (result.ok) {
        const profile = result.data.profile;
        profileOverlays.set(profile.teacherId, {name, bio: bio || profile.bio,
          wishlistUrl: safeWishlist(wishlistUrl) ? wishlistUrl : profile.wishlistUrl});
        syncRuntime({email: identity?.email || state.journey.session.email});
        if (state.route.page === 'profile' && (!state.route.profileId || state.route.profileId === profile.id) &&
            state.journey.profile.status === 'present' && state.journey.profile.value?.id === profile.id) {
          state.journey.profile.editOpen = false;
          state.journey.profile.createDraft = {name: '', bio: '', wishlistUrl: ''};
          state.journey.profile.source = 'local-overlay';
          state.journey.profile.value.name = name;
          state.journey.profile.value.bio = bio || profile.bio;
          state.journey.profile.value.wishlistUrl = safeWishlist(wishlistUrl) ? wishlistUrl : profile.wishlistUrl;
        }
        notify();
      }
      return result;
    }
    if (event === 'public:forgot') {
      const email = clean(payload.email, 254);
      if (!validEmail(email)) return localValidation('Enter a valid email address.');
      setOutcome('local-simulation', 'Password recovery is not connected. No email was sent.');
      setRequest('completed', state.journey.outcome.message);
      notify();
      return {ok: true, remote: false, message: state.journey.outcome.message};
    }
    if (event === 'public:contact') {
      const name = clean(payload.name, 100), email = clean(payload.email, 254), subject = clean(payload.subject, 120), message = typeof payload.message === 'string' ? payload.message.trim() : '';
      if (!name || !validEmail(email) || !subject || !message) return localValidation('Enter your name, a valid email, a subject, and a message.');
      if (message.length > 250) return localValidation('Keep the message at or below 250 characters.');
      state.journey.contact = {name, email, subject, message};
      setOutcome('local-simulation', 'Your contact note is ready in this preview only. Nothing was sent.');
      setRequest('completed', state.journey.outcome.message);
      notify();
      return {ok: true, remote: false, message: state.journey.outcome.message};
    }
    if (event === 'public:reset') {
      const startRouteEpoch = routeEpoch;
      const result = await service('Demo.reset');
      if (result.ok) {
        aliasToFixtureEmail.clear(); identityByFixtureEmail.clear(); profileOverlays.clear();
        syntheticAccount = 0; state.journey.school = {state: '', county: '', district: '', school: '', grade: ''};
        state.journey.filters = {query: '', sort: 'date-newest', limit: 50};
        state.journey.searchPerformed = false;
        state.journey.matches = {status: 'idle', items: [], error: ''};
        state.journey.registration.identity = {name: '', email: '', phone: ''};
        state.journey.loginDraft = {email: null};
        state.journey.terms = {open: false, accepted: false};
        state.journey.contact = {name: '', email: '', subject: '', message: ''};
        clearWishlistHandoff();
        state.journey.share = {intent: false, url: ''};
        state.journey.communityRole = 'anonymous';
        state.community.topicDraft = null;
        state.community.replyDraft = null;
        state.community.postEditDraft = null;
        state.community.editingPostId = null;
        state.journey.profile = {status: 'absent', value: null, editOpen: false, source: 'runtime'};
        try { storage?.removeItem(FILTER_KEY); } catch {}
        await community.reset(); refreshCommunity();
        for (const lookup of ['counties', 'districts', 'schools']) state.journey.lookups[lookup] = [];
        if (routeEpoch === startRouteEpoch) requestNavigation('/');
      }
      return result;
    }
    if (event === 'public:retry' || event === 'retry') {
      if (lastRetry) return lastRetry();
      if (schoolLookupRetry?.epoch === schoolEpoch) return schoolLookupRetry.run();
      return {ok: false, error: {code: 'nothing_to_retry', message: 'There is no safe read operation to retry.'}};
    }
    if (event === 'public:fail-next') {
      state.journey.failNext = !state.journey.failNext;
      notify();
      return {ok: true};
    }
    return null;
  }

  function localValidation(message) {
    setRequest('failed', message);
    setOutcome('validation-error', message);
    notify();
    return {ok: false, error: {code: 'validation_failed', message}};
  }
  function profileOwnerError(profile) {
    const teacherId = state.journey.session.teacherId;
    if (teacherId && profile?.teacherId === teacherId) return null;
    return {ok: false, error: {code: 'profile_owner_mismatch', message: 'You can only edit your own local profile.'}};
  }
  function safeWishlist(value) {
    if (typeof value !== 'string' || value.length > 512) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.amazon.com' && !url.username && !url.password &&
        !url.search && !url.hash && /^\/hz\/wishlist\/ls\/DEMO(?:-[A-Z0-9]+)+$/.test(url.pathname);
    } catch { return false; }
  }
  function updateDraft(name, value) {
    if (typeof name !== 'string' || /password|confirmPassword/i.test(name)) return false;
    if (name === 'query' && state.route.page === 'community') state.community.query = boundedDraft(value, 250);
    else if (name === 'query') state.journey.filters.query = boundedDraft(value, 100);
    else if (name === 'email' && state.route.page === 'login') state.journey.loginDraft = {email: boundedDraft(value, 254)};
    else if (name === 'name' && state.route.page === 'register') state.journey.registration.identity.name = boundedDraft(value, 80);
    else if (name === 'email' && state.route.page === 'register') state.journey.registration.identity.email = boundedDraft(value, 254);
    else if ((name === 'phone' || name === 'phone_number') && state.route.page === 'register') state.journey.registration.identity.phone = boundedDraft(value, 32);
    else if (name === 'name' && state.route.page === 'contact') state.journey.contact.name = boundedDraft(value, 100);
    else if (name === 'email' && state.route.page === 'contact') state.journey.contact.email = boundedDraft(value, 254);
    else if (name === 'subject' && state.route.page === 'contact') state.journey.contact.subject = boundedDraft(value, 120);
    else if (name === 'message' && state.route.page === 'contact') state.journey.contact.message = boundedDraft(value, 250);
    else if (['name', 'bio', 'wishlistUrl'].includes(name) && state.journey.profile.editOpen) {
      const max = name === 'name' ? 100 : name === 'bio' ? 500 : 512;
      state.journey.profile.editDraft = {...state.journey.profile.editDraft, [name]: boundedDraft(value, max)};
    }
    else if (['name', 'bio', 'wishlistUrl'].includes(name) && state.route.page === 'profile' && state.journey.profile.status === 'absent') {
      const max = name === 'name' ? 100 : name === 'bio' ? 500 : 512;
      state.journey.profile.createDraft = {...state.journey.profile.createDraft, [name]: boundedDraft(value, max)};
    }
    else return false;
    onChange(state, state.route, {draft: true});
    return true;
  }

  return Object.freeze({
    state,
    get route() { return state.route; },
    get canRetry() { return typeof lastRetry === 'function' || schoolLookupRetry?.epoch === schoolEpoch; },
    initialize, navigate, selectSchool, dispatch, updateDraft,
    community,
  });
}
