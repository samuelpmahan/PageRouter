import {createFixtureProvider, createServiceRuntime} from './services/index.mjs';
import {createPublicController} from './public-controller.mjs';
import {renderPublicSite, renderPreviewControls} from './public-site.mjs';
import {createCommunity} from './community.mjs';
import {registerWebMcp} from './webmcp.mjs';
import {mountDevTools} from './pxc-devtools/devtools.mjs';
import {createStyleInspectionBoard, registerBrowserStylePlayground} from './style-playground.mjs';

const root = document.getElementById('app');
const SVG_NS = 'http://www.w3.org/2000/svg';
let devTools;
let storage;
let lastRenderedRoute = null;
try { storage = window.sessionStorage; }
catch { storage = {getItem() { throw new Error('Session storage is unavailable'); }, setItem() { throw new Error('Session storage is unavailable'); }, removeItem() { throw new Error('Session storage is unavailable'); }}; }

const provider = createFixtureProvider({fixture: true, storage});
const runtime = createServiceRuntime(provider);
const community = createCommunity({storage});
let focusOnTerms = false;
let returnFocusId = null;

function isSvgElement(tree, inherited = false) { return inherited || tree.tag === 'svg'; }
function createElement(tree, inheritedSvg = false) {
  if (tree == null || typeof tree !== 'object') return document.createTextNode(String(tree ?? ''));
  const svg = isSvgElement(tree, inheritedSvg);
  const element = svg ? document.createElementNS(SVG_NS, tree.tag) : document.createElement(tree.tag);
  for (const [key, value] of Object.entries(tree.attrs || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled' || key === 'readonly') {
      if (key === 'readonly') element.readOnly = !!value;
      else element[key] = value;
    } else if (key === 'className') element.setAttribute('class', String(value));
    else element.setAttribute(key, String(value));
  }
  for (const child of tree.children || []) element.append(createElement(child, svg));
  return element;
}

function render(state, route) {
  const active = document.activeElement;
  const focusId = active?.id || null;
  const selection = active && typeof active.selectionStart === 'number'
    ? {start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection} : null;
  const activeScroll = active ? {top: active.scrollTop, left: active.scrollLeft} : null;
  const pageScroll = {left: window.scrollX, top: window.scrollY};
  // Password values live only in their current DOM inputs. This synchronous handoff
  // preserves them across a rerender without putting them in controller state.
  const routeKey = `${route.path || route.page}:${route.profileId || ''}:${route.communityRoute?.page || ''}:${route.communityRoute?.threadId || ''}`;
  const sameRoute = lastRenderedRoute === routeKey;
  const routeChanged = lastRenderedRoute !== null && !sameRoute;
  const disclosures = sameRoute
    ? [...root.querySelectorAll('details')].map((item, index, all) => {
      const summary = item.querySelector('summary')?.textContent?.trim() || '';
      const occurrence = all.slice(0, index).filter(previous => (previous.querySelector('summary')?.textContent?.trim() || '') === summary).length;
      return {summary, occurrence, open: item.open};
    })
    : [];
  const passwordValues = sameRoute
    ? [...root.querySelectorAll('input[type="password"]')].map(input => ({name: input.name, value: input.value}))
    : [];
  lastRenderedRoute = routeKey;
  const tree = renderPublicSite({route, state, journey: state.journey});
  root.replaceChildren(createElement(tree));
  const previewControls = document.getElementById('hh-preview-controls');
  if (previewControls) previewControls.replaceChildren(createElement(renderPreviewControls({journey: state.journey})));
  for (const {name, value} of passwordValues) {
    const input = [...root.querySelectorAll('input[type="password"]')].find(item => item.name === name);
    if (input) input.value = value;
  }
  const disclosureOccurrences = new Map();
  for (const item of root.querySelectorAll('details')) {
    const summary = item.querySelector('summary')?.textContent?.trim() || '';
    const occurrence = disclosureOccurrences.get(summary) || 0;
    disclosureOccurrences.set(summary, occurrence + 1);
    const previous = disclosures.find(saved => saved.summary === summary && saved.occurrence === occurrence);
    if (previous) item.open = previous.open;
  }
  if (focusOnTerms) {
    focusOnTerms = false;
    queueMicrotask(() => root.querySelector('#hh-terms-modal .hh-modal-close')?.focus({preventScroll: true}));
  } else if (routeChanged) {
    window.scrollTo(0, 0);
    if (route.termsOpen) {
      returnFocusId = 'hh-terms-open';
      queueMicrotask(() => root.querySelector('#hh-terms-modal .hh-modal-close')?.focus({preventScroll: true}));
    } else {
      root.querySelector('#hh-main, #community-main')?.focus({preventScroll: true});
    }
  } else if (focusId) {
    const replacement = document.getElementById(focusId);
    replacement?.focus({preventScroll: true});
    if (selection && replacement?.setSelectionRange) {
      try { replacement.setSelectionRange(selection.start, selection.end, selection.direction); } catch {}
    }
    if (activeScroll && replacement) {
      replacement.scrollTop = activeScroll.top;
      replacement.scrollLeft = activeScroll.left;
    }
  }
  if (sameRoute) window.scrollTo(pageScroll.left, pageScroll.top);
  const pageNames = {home: 'Home', about: 'About', contact: 'Contact', partners: 'Partners', login: 'Login', forgot: 'Password help', directory: 'Teacher directory', profile: 'Teacher profile', register: 'Sign up', community: 'Teachers’ Lounge'};
  document.title = `Homeroom Heroes · ${pageNames[route.page] || 'Preview'}`;
}

let controller;
controller = createPublicController({
  runtime,
  storage,
  community,
  onChange: render,
  onNavigate(path) {
    const hash = `#${path === '/' ? '/' : path}`;
    if (location.hash === hash) void controller.navigate(hash);
    else location.hash = hash;
  },
});

function dataPayload(element) {
  const data = element.dataset || {};
  return {
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value])),
    threadId: data.threadId || data.postId || data.threadId,
    postId: data.postId || data.threadId,
    replyId: data.replyId || data.commentId,
    commentId: data.commentId || data.replyId,
  };
}
function clearPasswordInputs() {
  root.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
}
function focusTermsOpener() {
  const id = returnFocusId;
  returnFocusId = null;
  if (id) document.getElementById(id)?.focus({preventScroll: true});
}
async function dispatchEvent(eventName, payload = {}) {
  if (eventName === 'public:open-terms' || eventName === 'public-open-terms') {
    returnFocusId = document.activeElement?.id || 'hh-terms-open';
    const result = await controller.dispatch(eventName, payload);
    focusOnTerms = true;
    render(controller.state, controller.route);
    return result;
  }
  if (eventName === 'public:close-terms' || eventName === 'public:accept-terms' || eventName === 'public-close-terms' || eventName === 'public-accept-terms') {
    const result = await controller.dispatch(eventName, payload);
    focusTermsOpener();
    return result;
  }
  return controller.dispatch(eventName, payload);
}

root.addEventListener('click', async event => {
  if (event.target.closest('a[href="#hh-main"],a[href="#community-main"],a[href="#main"]')) {
    event.preventDefault();
    document.getElementById('hh-main')?.focus() || document.getElementById('community-main')?.focus() || document.getElementById('main')?.focus();
    return;
  }
  const routeLink = event.target.closest('a[href^="#/"]');
  if (routeLink) {
    event.preventDefault();
    const hash = routeLink.getAttribute('href');
    if (location.hash === hash) void controller.navigate(hash);
    else location.hash = hash;
    return;
  }
  const control = event.target.closest('[data-event]');
  if (!control) return;
  if (['public:logout', 'public:reset', 'logout', 'reset'].includes(control.dataset.event)) clearPasswordInputs();
  await dispatchEvent(control.dataset.event, dataPayload(control));
});

document.getElementById('hh-preview-controls')?.addEventListener('click', async event => {
  const control = event.target.closest('[data-event]');
  if (!control) return;
  if (['public:logout', 'public:reset', 'logout', 'reset'].includes(control.dataset.event)) clearPasswordInputs();
  await dispatchEvent(control.dataset.event, dataPayload(control));
});

root.addEventListener('submit', async event => {
  const form = event.target.closest('[data-submit]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  if (payload.phone === undefined && payload.phone_number !== undefined) payload.phone = payload.phone_number;
  if (payload.confirmPassword === undefined && payload.confirm_password !== undefined) payload.confirmPassword = payload.confirm_password;
  delete payload.phone_number;
  delete payload.confirm_password;
  if (data.has('termsAccepted')) payload.termsAccepted = true;
  Object.assign(payload, dataPayload(form));
  const eventName = form.dataset.submit;
  if (['public:register', 'public:login'].includes(eventName)) clearPasswordInputs();
  const result = await controller.dispatch(eventName, payload);
  if (result?.ok && ['public:register', 'public:login'].includes(eventName)) clearPasswordInputs();
});

root.addEventListener('input', event => {
  const target = event.target;
  if (target?.name) controller.updateDraft(target.name, target.value);
  if (target?.dataset.event === 'forum-search') void controller.dispatch('forum-search', {query: target.value});
});

root.addEventListener('change', async event => {
  const target = event.target;
  if (target?.dataset.publicSelect) await controller.selectSchool(target.dataset.publicSelect, target.value);
  else if (target?.dataset.event === 'forum-role') await controller.dispatch('forum-role', {role: target.value});
  else if (target?.dataset.event === 'forum-category') await controller.dispatch('forum-category', {category: target.value});
  else if (target?.name === 'termsAccepted') await controller.dispatch('public:terms-consent', {accepted: target.checked});
});

document.addEventListener('keydown', async event => {
  if (event.defaultPrevented) return;
  const dialog = root.querySelector('#hh-terms-modal [role="dialog"]');
  if (dialog && event.key === 'Escape') {
    event.preventDefault();
    await dispatchEvent('public:close-terms');
    return;
  }
  if (dialog && event.key === 'Tab') {
    const focusable = [...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(item => !item.hidden && item.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    return;
  }
  if (!dialog && event.key === 'Escape' && controller?.state.journey.navOpen) {
    event.preventDefault();
    await dispatchEvent('public:toggle-nav');
    root.querySelector('#hh-public-nav-toggle')?.focus({preventScroll: true});
  }
});

window.addEventListener('hashchange', () => { void controller.navigate(location.hash || '#/'); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => render(controller.state, controller.route), 100); });

Object.defineProperty(window, 'hhPreview', {
  configurable: false,
  enumerable: false,
  get() {
    const frozenCopy = value => {
      const copy = structuredClone(value);
      const freeze = item => { if (item && typeof item === 'object' && !Object.isFrozen(item)) { Object.freeze(item); Object.values(item).forEach(freeze); } return item; };
      return freeze(copy);
    };
    return Object.freeze({
      get state() { return frozenCopy(controller.state); },
      get runtime() { return frozenCopy(runtime.inspect()); },
      get storage() {
        const snapshot = runtime.snapshot();
        let hasRememberedFilters = null;
        try { hasRememberedFilters = !!storage?.getItem?.('hh-public-directory-filters.v1'); } catch {}
        return Object.freeze({kind: storage ? 'sessionStorage' : 'memory_only', persistence: snapshot.diagnostics?.persistence || 'unknown',
          initializationIssue: snapshot.diagnostics?.initializationIssue || null, hasRememberedFilters});
      },
    });
  },
});

try {
  await controller.initialize(location.hash || '#/');
  if (controller.state.journey.terms.open) { focusOnTerms = true; render(controller.state, controller.route); }
  const stylePlayground = runtime.fixture === true ? registerBrowserStylePlayground(runtime.pxc) : null;
  const inspectionBoard = stylePlayground ? createStyleInspectionBoard(runtime.pxc, runtime.devtoolsBoard) : runtime.devtoolsBoard;
  devTools = mountDevTools(inspectionBoard, {label: 'Homeroom Heroes', readOnly: true,
    app: document.getElementById('hh-devtools-mount') || root, storage,
    getContext: () => {
      const journey = runtime.snapshot();
      return {session: journey.session.status, registration: journey.registration.status,
        currentTeacherName: journey.demo?.selectedTeacher?.name || null,
        hasCurrentProfile: (journey.demo?.publicProfiles || []).some(profile => profile.teacherId === journey.registration.teacherId),
        publicProfiles: journey.demo?.publicProfiles || []};
    }, stylePlayground});
  registerWebMcp(controller, {navigate: async path => {
    const hash = `#${path}`;
    if (location.hash !== hash) location.hash = hash;
    else await controller.navigate(hash);
  }});
} catch (error) {
  root.replaceChildren(createElement({tag: 'main', attrs: {class: 'hh-main'}, children: [
    {tag: 'section', attrs: {class: 'hh-card'}, children: [
      {tag: 'h1', attrs: {}, children: ['Homeroom Heroes preview could not open']},
      {tag: 'p', attrs: {}, children: ['Reload to retry. No production request was sent.']},
    ]},
  ]}));
  console.error('HH public preview initialization failed', error);
}
