import { createPxC, registerPart, readPart, MissingPartError } from './pxc.js';
import { createPxcHost } from './pxc-kernel.mjs';
import { worlds as seedWorlds, NAMESPACES } from './mock-pxc.mjs';
import { SCENARIOS, scenarioUrl } from './scenario-loader.mjs';
const $ = id => document.getElementById(id);
const state = JSON.parse($('ntc-state').textContent);
const manifests = new Map(state.manifests.map(m => [m.id, m]));
const results = new Map(state.results.map(r => [r.id, r]));
const packaged = new Set(state.packagedIds);
const retainedFrames = new Map();
let activeId = null, view = 'experiences';
const CONTROL_DRAWER_KEY = 'pxcube.controlDrawer.collapsed.v1';
let controlDrawerPreference = null;
try {
  const saved = localStorage.getItem(CONTROL_DRAWER_KEY);
  if (saved !== null) controlDrawerPreference = saved === 'true';
} catch { /* Storage can be unavailable in hardened or embedded browsers. */ }

function setControlDrawerCollapsed(collapsed, { remember = true } = {}) {
  const isCollapsed = Boolean(collapsed);
  document.body.classList.toggle('controls-collapsed', isCollapsed);
  const toggle = $('control-drawer-toggle');
  toggle.setAttribute('aria-expanded', String(!isCollapsed));
  toggle.setAttribute('aria-label', isCollapsed ? 'Show workspace controls' : 'Hide workspace controls');
  toggle.querySelector('.drawer-label').textContent = isCollapsed ? 'Controls' : 'Hide controls';
  if (!remember) return;
  controlDrawerPreference = isCollapsed;
  try { localStorage.setItem(CONTROL_DRAWER_KEY, String(isCollapsed)); } catch { /* Keep the in-memory choice. */ }
}
setControlDrawerCollapsed(controlDrawerPreference ?? false, { remember: false });
// The shell owns every Experience's PxC boards. Frames on the same page
// reach the kernel API directly through window.parent.pxc, no messages.
// Same storage keys as before, so retained browser state loads untouched.
const pxcHost = createPxcHost({ storage: localStorage, seeds: { worlds: seedWorlds, namespaces: NAMESPACES }, pxc: { createPxC, registerPart, readPart } });
// The one-page API frames use: ownerFor hands out the kernel (owner) for a
// storage key, creating it on first use. The shell stays the single writer.
window.pxc = Object.freeze({
  ownerFor(key, experienceId, seedIdentity) {
    if (typeof key !== 'string' || !key) throw Error('ownerFor needs a storage key');
    if (experienceId) pxcHost.experienceForKey.set(key, experienceId);
    return pxcHost.kernelFor(key, seedIdentity);
  },
});
const make = (tag, text, className) => {
  const el = document.createElement(tag); el.textContent = text ?? '';
  if (className) el.className = className;
  return el;
};
const short = value => value ? value.slice(0, 8) : 'not recorded';
const pretty = value => JSON.stringify(value, (_, v) => typeof v === 'function' ? '[Calculation function — inspect in owning DevTools]' : v, 2);
function button(text, action) { const el = make('button', text); el.onclick = action; return el; }
function inspect(kind, title, value, note = '') {
  $('inspector-kind').textContent = kind; $('inspector-title').textContent = title;
  $('inspector-value').textContent = pretty(value); $('inspector-note').textContent = note;
  if (!$('inspector').open) $('inspector').showModal();
}
function inspectManifest(id) {
  const manifest = manifests.get(id);
  inspect('tidy / manifest', manifest.title, { manifest, tidyType: Object.entries(state.types).find(([, value]) => value.root === `experiences/${id}`) ?? null }, 'Definition and registration captured with this artifact.');
}
function inspectBuild(id) {
  inspect('crisp / build', manifests.get(id).title, results.get(id) ?? manifests.get(id).attempt ?? { status: 'No build evidence supplied' }, `Artifact ${state.runId ?? 'not recorded'} · timings are packaging times, not runtime performance.`);
}
function inspectWork(item) { inspect('neat / work', item.id, item, 'The actual work item retained with this build.'); }

function showView(next) {
  view = next;
  for (const id of ['experience-panel', 'work-panel', 'builds-panel', 'mounts-panel', 'console-panel', 'viewer']) $(id).hidden = true;
  document.querySelectorAll('.nav-button').forEach(el => el.classList.toggle('selected', el.dataset.view === next));
  if (next === 'experiences' || next === 'manifests') {
    $('experience-panel').hidden = false;
    if (next === 'manifests') selectTab('manifests');
  } else if (next === 'experience') $('viewer').hidden = false;
  else $(`${next}-panel`).hidden = false;
  updateFrameLabels();
  refreshMounts();
}
function updateFrameLabels() {
  for (const el of document.querySelectorAll('.experience-link')) {
    if (retainedFrames.has(el.dataset.open)) el.querySelector('small').textContent = view === 'experience' && activeId === el.dataset.open ? 'Opened · in view' : 'Opened · retained';
  }
}
function selectTab(key) {
  document.querySelectorAll('#tabs button').forEach(el => el.classList.toggle('active', el.dataset.tab === key));
  document.querySelectorAll('.tab').forEach(el => { el.hidden = el.id !== `tab-${key}`; });
}
function openExperience(id) {
  const manifest = manifests.get(id);
  if (!manifest || !packaged.has(id)) return;
  for (const frame of retainedFrames.values()) { frame.hidden = true; frame.removeAttribute('id'); }
  let frame = retainedFrames.get(id);
  if (!frame) {
    frame = document.createElement('iframe'); frame.className = 'thing'; frame.title = manifest.title;
    frame.setAttribute('sandbox', (manifest.sandbox?.length ? manifest.sandbox : ['allow-scripts', 'allow-same-origin']).filter(t => !['allow-top-navigation', 'allow-top-navigation-by-user-activation'].includes(t)).join(' '));
    frame.src = `./experiences/${id}/index.html`;
    frame.addEventListener('load', refreshMounts);
    retainedFrames.set(id, frame); $('viewer').append(frame);
  }
  activeId = id; frame.id = 'thing'; frame.hidden = false;
  $('thing-title').textContent = manifest.title;
  $('frame-count').textContent = `${retainedFrames.size} opened frame${retainedFrames.size === 1 ? '' : 's'}`;
  document.querySelectorAll('.experience-link').forEach(el => el.classList.toggle('current', el.dataset.open === id));
  showView('experience');
  // OneStepOneViewport: an Experience owns the viewport while it is active.
  // The polished trigger keeps workspace controls one tap away without making
  // the work/build dashboard part of the Experience itself.
  setControlDrawerCollapsed(true, { remember: false });
}
const scenarioSelect = $('scenario-select');
for (const scenario of SCENARIOS) scenarioSelect.append(new Option(scenario.label, scenario.id));
function loadScenario() {
  if (!activeId) return;
  const frame = retainedFrames.get(activeId);
  if (frame) frame.src = scenarioUrl(`./experiences/${activeId}/index.html`, scenarioSelect.value);
}

// The kernels are the owners now: frames reach them through window.pxc and the
// shell reads their boards directly. No frame poking, no copied stores.
function kernelForExperience(id) {
  const found = [...pxcHost.kernels].find(([key]) => (pxcHost.experienceForKey.get(key) ?? guessExperienceForKey(key)) === id);
  return found?.[1] ?? null;
}
async function inspectOwner(id = activeId) {
  try {
    const kernel = kernelForExperience(id);
    inspect('runtime / owner', manifests.get(id).title, kernel ? await kernel.inspect() : { status: 'This Experience has not bound a kernel yet.' }, 'Read now from the hypervisor kernel that owns this Experience’s boards.');
  } catch (error) { inspect('runtime / unavailable', manifests.get(id)?.title ?? id, { error: error.message }); }
}
async function inspectMountRun(key, runName) {
  try {
    const kernel = pxcHost.kernels.get(key);
    inspect('runtime / mount', runName, kernel ? await kernel.handle(runName).inspect() : { status: 'This kernel is no longer bound.' }, 'Read now from the hypervisor kernel. The console has not written to this world.');
  } catch (error) { inspect('runtime / unavailable', runName, { error: error.message }); }
}
async function refreshMounts() {
  const mounts = [];
  for (const [key, kernel] of pxcHost.kernels) {
    const id = pxcHost.experienceForKey.get(key) ?? guessExperienceForKey(key);
    try {
      const entries = await kernel.list();
      if (!entries.length) mounts.push({ id, key, unavailable: 'No mounts reported' });
      for (const entry of entries) mounts.push({ id, key, name: entry.name, kind: entry.kind, active: view === 'experience' && id === activeId });
    } catch { mounts.push({ id, key, unavailable: 'Mount inspection unavailable' }); }
  }
  $('mount-count').textContent = mounts.filter(m => m.name).length;
  if (view !== 'mounts') return;
  $('mount-rows').replaceChildren();
  if (!mounts.length) { const row = make('tr'); const cell = make('td', 'No Experience frames opened. Open one from the left to see its mounts.'); cell.colSpan = 5; row.append(cell); $('mount-rows').append(row); }
  for (const mount of mounts) {
    const row = make('tr'); row.dataset.owner = mount.id;
    const owner = make('td'); owner.append(button(manifests.get(mount.id).title, () => openExperience(mount.id)));
    const address = make('td'); address.append(make('code', mount.name ?? mount.unavailable));
    const actions = make('td'); actions.append(button('Owner', () => inspectMountRun(mount.key, mount.name)));
    row.append(owner, address, make('td', mount.kind ?? 'unknown'), make('td', mount.name ? (mount.active ? 'In view' : 'Retained') : 'No mounts yet'), actions);
    $('mount-rows').append(row);
  }
}

// PxConsole: discover / read / trace over retained and live worlds.
// Retained worlds are read straight from this browser's storage (the kernel's
// storage shape); live worlds are read from the hypervisor kernels that own
// them, through real PxC reads on the Experience's own board. The console
// never writes and never executes.
const describeIdentities = new WeakMap();
let describeNextId = 1;
function describeIdentity(value) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return null;
  if (!describeIdentities.has(value)) describeIdentities.set(value, describeNextId++);
  return `object#${describeIdentities.get(value)}`;
}
// The devtools read boundary: own property descriptors with identity
// labels. Accessors and toJSON are never invoked; circular-safe.
function safeDescribe(value, depth = 3, seen = new Set()) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return { kind: 'primitive', type: typeof value, value };
  }
  if (seen.has(value)) return { kind: 'circular', identity: describeIdentity(value) };
  if (depth <= 0) return { kind: typeof value, identity: describeIdentity(value), note: 'depth limit' };
  seen.add(value);
  const own = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const name = typeof key === 'symbol' ? key.toString() : String(key);
    if ('get' in descriptor || 'set' in descriptor) {
      own[name] = { kind: 'accessor', enumerable: !!descriptor.enumerable, getter: !!descriptor.get, setter: !!descriptor.set, note: 'never invoked' };
    } else {
      own[name] = { kind: 'data', enumerable: !!descriptor.enumerable, writable: !!descriptor.writable, value: safeDescribe(descriptor.value, depth - 1, seen) };
    }
  }
  const proto = Object.getPrototypeOf(value);
  return { kind: typeof value, identity: describeIdentity(value), class: value.constructor?.name ?? null, prototype: proto?.constructor?.name ? `${proto.constructor.name}.prototype` : null, own };
}
function flattenParts(value, prefix, out) {
  out.push([prefix, value]);
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((entry, index) => [String(index), entry]) : Object.entries(value);
    for (const [key, child] of entries) flattenParts(child, `${prefix}.${key}`, out);
  }
  return out;
}
function hydrateWorld(entry) {
  let pxc = createPxC();
  for (const [address, value] of flattenParts(entry.run.value ?? {}, entry.world, [])) {
    pxc = registerPart(pxc, address, value);
  }
  return pxc;
}
function guessExperienceForKey(key) {
  const suffix = key.split(':').slice(1).join(':');
  if (manifests.has(suffix)) return suffix;
  if (key.startsWith('pxcube.mock-smoke.')) return 'mock-smoke';
  return suffix || 'unknown';
}
async function discoverWorlds() {
  const worlds = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('pxcube.')) continue;
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(key)); } catch { continue; }
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.runs || Array.isArray(parsed.runs)) continue;
    const experienceId = guessExperienceForKey(key);
    for (const run of Object.values(parsed.runs)) {
      worlds.push({ world: run.name, experienceId, kind: run.kind ?? 'unknown', writes: run.changes?.length ?? 0, revision: parsed.revision, source: 'Retained', run });
    }
  }
  for (const [key, kernel] of pxcHost.kernels) {
    try {
      const inspected = await kernel.inspect();
      const experienceId = pxcHost.experienceForKey.get(key) ?? guessExperienceForKey(key);
      for (const run of Object.values(inspected?.runs ?? {})) {
        worlds.push({ world: run.name, experienceId, kind: run.kind ?? 'unknown', writes: run.changes?.length ?? 0, revision: inspected.revision, source: 'Live', run, kernelKey: key });
      }
    } catch { /* kernel unreadable; the retained copy still lists */ }
  }
  return worlds;
}
let consoleSelected = null;
async function selectWorld(entry) {
  consoleSelected = entry;
  $('console-detail').hidden = false;
  $('console-detail-eyebrow').textContent = `World · ${entry.source}`;
  $('console-detail-title').textContent = `${entry.experienceId} · ${entry.world}`;
  // Direct inspection. Live worlds are read through the hypervisor kernel's
  // own board, the same board the Experience executes against: every open
  // goes through readPart, reads are recorded in the live board's telemetry,
  // and unknown addresses raise MissingPartError. Retained worlds hydrate
  // into a fresh PxC instance. The console never writes and never executes.
  let addresses, readOne, peekOne, sessionReads = 0, sessionNote;
  if (entry.source === 'Live' && entry.kernelKey && pxcHost.kernels.has(entry.kernelKey)) {
    const handle = pxcHost.kernelFor(entry.kernelKey).handle(entry.world);
    addresses = () => handle.addresses();
    peekOne = address => handle.peek(`${entry.world}.${address}`);
    readOne = async address => {
      const result = await handle.read(address);
      sessionReads += 1;
      return { value: result.value, receipt: result.receipt };
    };
    sessionNote = 'Read through PxC on the Experience’s live board. Console reads recorded in the live telemetry; the console has not written to this world.';
  } else {
    let pxc = hydrateWorld(entry);
    addresses = () => [...pxc.parts.keys()].sort();
    peekOne = address => pxc.parts.get(address);
    readOne = address => {
      const result = readPart(pxc, address);
      pxc = result.pxc;
      sessionReads += 1;
      return { value: result.value, receipt: result.pxc.telemetry.reads.at(-1) };
    };
    sessionNote = 'Retained world hydrated into a fresh PxC instance. The console has not written to this world.';
  }
  const addressList = $('console-addresses'); addressList.replaceChildren();
  for (const address of await addresses()) {
    const value = await peekOne(address);
    const row = make('tr');
    const name = make('td'); name.append(make('code', address));
    const actions = make('td');
    actions.append(button('Read', async () => {
      try {
        const result = await readOne(address);
        inspect('pxc / read', address, { value: safeDescribe(result.value), read: result.receipt }, `${sessionNote} ${sessionReads} console reads recorded this session.`);
      } catch (error) {
        if (error instanceof MissingPartError) {
          inspect('pxc / missing', address, { address, found: false }, 'PxC raised MissingPartError: the address is not a registered part.');
        } else inspect('pxc / error', address, { error: error.message });
      }
    }));
    row.append(name, make('td', value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value), actions); addressList.append(row);
  }
  const writes = $('console-writes'); writes.replaceChildren();
  const changes = entry.run.changes ?? [];
  if (!changes.length) { const row = make('tr'); const cell = make('td', 'No recorded writes.'); cell.colSpan = 4; row.append(cell); writes.append(row); }
  for (const change of changes) {
    const row = make('tr');
    row.append(make('td', String(change.step)), make('td', change.address), make('td', JSON.stringify(change.before)), make('td', JSON.stringify(change.after)));
    writes.append(row);
  }
  $('console-trace').textContent = 'Reading composition…';
  const trace = { world: entry.world, experience: entry.experienceId, kind: entry.kind, source: entry.source, mount: `${entry.world}.px.*` };
  try {
    const response = await fetch(`./experiences/${entry.experienceId}/pxcube-receipt.json`);
    if (response.ok) {
      const receipt = await response.json();
      trace.composition = receipt.composition ?? 'No composition recorded (not a cartridge overlay).';
    } else trace.composition = 'No receipt published for this experience.';
  } catch { trace.composition = 'Receipt unavailable.'; }
  $('console-trace').textContent = JSON.stringify(trace, null, 2);
  return full;
}
async function refreshConsole() {
  if (view !== 'console') return;
  const query = $('console-filter').value.trim().toLowerCase();
  const deduped = new Map();
  for (const entry of await discoverWorlds()) {
    const key = `${entry.experienceId}::${entry.world}`;
    if (!deduped.has(key) || entry.source === 'Live') deduped.set(key, entry);
  }
  const rows = [...deduped.values()]
    .filter(entry => !query || `${entry.world} ${entry.experienceId} ${entry.kind}`.toLowerCase().includes(query))
    .sort((a, b) => a.experienceId.localeCompare(b.experienceId) || a.world.localeCompare(b.world));
  $('console-status').textContent = `${rows.length} world${rows.length === 1 ? '' : 's'}`;
  const tbody = $('console-rows'); tbody.replaceChildren();
  if (!rows.length) { const row = make('tr'); const cell = make('td', 'No worlds discovered. Open an Experience and do something in it, then refresh.'); cell.colSpan = 7; row.append(cell); tbody.append(row); }
  for (const entry of rows) {
    const row = make('tr');
    const name = make('td'); name.append(make('code', entry.world));
    const experience = make('td', manifests.get(entry.experienceId)?.title ?? entry.experienceId);
    const actions = make('td');
    actions.append(button('Read', () => selectWorld(entry)));
    actions.append(button('Value', () => inspect('runtime / world', `${entry.experienceId} · ${entry.world}`, safeDescribe(entry.run), 'Descriptor walk: accessors and toJSON are never invoked. The console has not written to this world.')));
    row.append(name, experience, make('td', entry.kind), make('td', String(entry.writes)), make('td', String(entry.revision ?? '—')), make('td', entry.source), actions);
    tbody.append(row);
  }
  if (consoleSelected) {
    const stillThere = rows.find(entry => entry.experienceId === consoleSelected.experienceId && entry.world === consoleSelected.world);
    if (stillThere) await selectWorld(stillThere); else { consoleSelected = null; $('console-detail').hidden = true; }
  }
}
$('refresh-console').onclick = refreshConsole;
$('console-filter').oninput = refreshConsole;
$('control-drawer-toggle').onclick = () => setControlDrawerCollapsed(!document.body.classList.contains('controls-collapsed'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.body.classList.contains('controls-collapsed') && !$('inspector').open) {
    setControlDrawerCollapsed(true);
    $('control-drawer-toggle').focus();
  }
});
$('artifact-id').textContent = state.runId?.split('T')[1]?.replace(/Z-.*/, 'Z') ?? 'not recorded';
$('artifact-id').title = state.runId ?? '';
$('source-id').textContent = short(state.sourceSnapshot?.digest ?? state.sourceCommit);
$('experience-count').textContent = manifests.size;
$('work-summary').textContent = `${state.work.length} work items · ${state.work.filter(item => item.status === 'review').length} in review`;
$('manifest-summary').textContent = `${manifests.size} Experience manifests`;
const passed = state.results.filter(result => result.ok).length, failed = state.results.filter(result => !result.ok).length;
$('build-summary').textContent = state.results.length ? `${passed} packaged · ${failed} failed` : 'Build evidence not supplied';
$('build-summary').className = failed ? 'bad' : '';
$('artifact-status').textContent = state.results.length ? `${passed} packaged` : `${manifests.size} declared`;

for (const [id, manifest] of manifests) {
  const el = button('', () => openExperience(id)); el.className = 'experience-link'; el.dataset.open = id;
  el.append(make('span', manifest.title), make('small', packaged.has(id) ? 'Packaged · not opened' : 'Build failed'));
  el.disabled = !packaged.has(id); $('experience-nav').append(el);
}
for (const item of state.work) {
  const row = make('tr'); row.dataset.work = item.id;
  const name = make('td'); name.append(make('code', item.id), make('small', item.location?.component));
  const actions = make('td'); actions.append(button('Work item', () => inspectWork(item)));
  const id = item.location?.component?.split('/').at(-1);
  if (manifests.has(id)) actions.append(button('Manifest', () => inspectManifest(id)));
  row.append(name, make('td', item.status), make('td', item.outcome), actions); $('work-rows').append(row);
}
if (!state.work.length) { const row = make('tr'), cell = make('td', 'No neat work snapshot supplied with this artifact.'); cell.colSpan = 4; row.append(cell); $('work-rows').append(row); }
for (const [id, manifest] of manifests) {
  const result = results.get(id); const row = make('tr'); row.dataset.build = id;
  const name = make('td', manifest.title); name.append(make('small', manifest.build));
  const outcome = make('td', result ? (result.ok ? 'Packaged' : 'Failed') : 'No evidence', result ? (result.ok ? 'good' : 'bad') : '');
  const actions = make('td'); actions.append(button('Build', () => inspectBuild(id)), button('Manifest', () => inspectManifest(id)));
  row.append(name, outcome, make('td', result?.build ? `${result.build.durationMs} ms` : '—'), make('td', result?.outputHashes ? Object.keys(result.outputHashes).length : '—'), actions); $('build-rows').append(row);
}
document.querySelectorAll('[data-view]').forEach(el => el.onclick = () => { if (el.dataset.view === 'experiences') selectTab('exp'); showView(el.dataset.view); });
document.querySelectorAll('#tabs button').forEach(el => el.onclick = () => selectTab(el.dataset.tab));
document.querySelectorAll('button.card[data-id]').forEach(el => el.onclick = () => openExperience(el.dataset.id));
$('back').onclick = () => {
  selectTab('exp');
  showView('experiences');
  // Leaving an Experience restores the workspace chrome. The collapse is a
  // viewport ownership rule, not a persistent user preference.
  setControlDrawerCollapsed(false, { remember: false });
};
$('load-scenario').onclick = loadScenario;
$('inspect-owner').onclick = () => inspectOwner();
$('inspect-manifest').onclick = () => inspectManifest(activeId);
$('inspect-build').onclick = () => inspectBuild(activeId);
$('close-inspector').onclick = () => $('inspector').close();
$('refresh-mounts').onclick = refreshMounts;
const initialRun = state.runId ?? state.manifests.find(m => m.attempt?.runId)?.attempt.runId;
async function checkBuild() {
  try {
    const response = await fetch('./pxcube-run.json', { cache: 'no-store' });
    if (!response.ok) return;
    const run = await response.json();
    $('refresh-build').hidden = !initialRun || run.runId === initialRun;
    // The loaded artifact remains the authority until an explicit reload.
  } catch { /* Static artifacts can be inspected offline. */ }
}
$('refresh-build').onclick = async () => {
  const button=$('refresh-build'); if(button.dataset.refreshing==='1') return;
  button.dataset.refreshing='1'; button.disabled=true;
  let reloaded=false; const reload=()=>{if(reloaded)return;reloaded=true;location.reload();};
  const fallback=setTimeout(reload,1800);
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(fallback);reload();},{once:true});
      const registration=await navigator.serviceWorker.getRegistration();
      if(registration) await registration.update(); else clearTimeout(fallback),reload();
    } else clearTimeout(fallback),reload();
  } catch { clearTimeout(fallback); reload(); }
};
window.pxCubeControl = Object.freeze({ inspect: () => ({ artifact: state.runId, view, activeId, frames: [...retainedFrames.keys()], controlsCollapsed: document.body.classList.contains('controls-collapsed') }) });
checkBuild(); setInterval(checkBuild, 5000);
setInterval(() => { refreshMounts(); refreshConsole(); }, 2000);
