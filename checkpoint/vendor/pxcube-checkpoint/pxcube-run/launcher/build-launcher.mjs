// launcher/build-launcher.mjs
//
// Reads experiences/*/experience.json and the per-Experience crisp outputs
// in staging/exp-*, then writes dist/:
//   dist/index.html               the launcher: Clean / Exp tabs + manifest accordion
//   dist/experiences/<id>/...     each THING that built green, with its crisp
//                                 receipt.json riding alongside
//
// Each THING is built by crisp, not by this script: the Actions workflow runs
// `crisp package` (validates mounts, builds, content-addresses the output
// chunks into a wiring-manifest receipt) and `crisp verify` (re-hashes the
// chunks against the receipt) per experience. This script only wires the
// resulting artifacts together: it copies the staged chunks into place and
// renders the receipt's wiring info in the manifest accordion, so what Sam
// reviews is exactly the bytes the receipt names.
//
// The manifest is the extension point. Known fields render as rows; every
// other key lands in the accordion's "everything else" block as JSON, so
// wiring in whatever you need never requires touching this generator.

import {
  readdirSync, readFileSync, mkdirSync,
  writeFileSync, existsSync, renameSync, rmSync,
} from 'node:fs';
import { loadManifest } from '../crisp/lib/manifest.mjs';
import { join } from 'node:path';

const EXP = 'experiences';
const STAGING = 'staging';
const DIST = 'dist';

// A THING must never navigate the shelf page itself. The launcher strips
// these tokens even if a manifest declares them; the back button is the
// only way home.
const FORBIDDEN_TOKENS = new Set([
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
]);

const KNOWN_FIELDS = new Set([
  'title', 'description', 'version', 'track', 'entry', 'build', 'outDir',
  'sandbox', 'mounts', 'source',
]);

const esc = (s) =>
  String(s ?? '').replace(/[&<>\"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]
  ));

const shortHash = (hex) => (hex ? `${hex.slice(0, 12)}` : '');

const manifests = [];
for (const ent of readdirSync(EXP, { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const mf = join(EXP, ent.name, 'experience.json');
  if (!existsSync(mf)) continue;
  // Resolve through crisp: tidy-typed experiences declare their manifest in
  // the tidy registry, not in experience.json. The launcher renders the
  // resolved manifest, so cards and accordions show the real title, entry,
  // sandbox tokens, and mounts.
  const resolved = await loadManifest(join(EXP, ent.name));
  manifests.push({ id: ent.name, ...resolved });
}

// The crisp receipt staged next to each THING's chunks, when the build job
// packaged it. Absent for failed builds.
const receipts = new Map();
for (const m of manifests) {
  const rp = join(STAGING, `exp-${m.id}`, 'receipt.json');
  if (existsSync(rp)) {
    try {
      receipts.set(m.id, JSON.parse(readFileSync(rp, 'utf8')));
    } catch {
      // a corrupt receipt is a failed build; the THING still ships by path
    }
  }
}

// Anything that is not explicitly clean is exp. The clean tab stays honest:
// only deliberately promoted THINGs appear there.
const trackOf = (m) => (m.track === 'clean' ? 'clean' : 'exp');

const sandboxFor = (m) =>
  (m.sandbox && m.sandbox.length ? m.sandbox : ['allow-scripts'])
    .filter((t) => !FORBIDDEN_TOKENS.has(t))
    .join(' ');

const extrasOf = (m) => {
  const o = {};
  for (const [k, v] of Object.entries(m)) {
    if (k !== 'id' && !KNOWN_FIELDS.has(k)) o[k] = v;
  }
  return o;
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'experiences'), { recursive: true });

const shipped = [];
const failed = [];
for (const m of manifests) {
  const staged = join(STAGING, `exp-${m.id}`);
  if (existsSync(staged)) {
    renameSync(staged, join(DIST, 'experiences', m.id));
    shipped.push(m);
  } else {
    failed.push(m);
  }
}

const card = (m) => `
      <button class="card" data-id="${esc(m.id)}" data-sandbox="${esc(sandboxFor(m))}">
        <strong>${esc(m.title || m.id)}</strong>
        <span>${esc(m.description || '')}</span>
        <em>${esc(m.version || '')}</em>
      </button>`;

const failedCard = (m) => `
      <div class="card failed">
        <strong>${esc(m.title || m.id)}</strong>
        <span>build failed, not shipped this run</span>
      </div>`;

const shelfFor = (track) => {
  const items = shipped.filter((m) => trackOf(m) === track);
  const fails = failed.filter((m) => trackOf(m) === track);
  const empty = items.length === 0 && fails.length === 0
    ? `<p class="empty">${track === 'clean' ? 'Nothing promoted to clean yet.' : 'No experiments yet.'}</p>`
    : '';
  return items.map(card).join('') + fails.map(failedCard).join('') + empty;
};

const receiptBlock = (m) => {
  const r = receipts.get(m.id);
  if (!r) return '';
  const chunkRows = (r.chunks || [])
    .map((c) => `<div class="row"><dt>${esc(c.path)}</dt><dd><code>${esc(shortHash(c.sha256))}</code></dd></div>`)
    .join('');
  return `
      <h4>wiring manifest, crisp receipt</h4>
      <div class="row"><dt>entry chunk</dt><dd><code>${esc(shortHash(r.entryChunk))}</code></dd></div>
      <div class="row"><dt>chunks</dt><dd>${(r.chunks || []).length}</dd></div>
      <div class="row"><dt>packaged at</dt><dd>${esc(r.packagedAt || '')}</dd></div>
      ${chunkRows}`;
};

const manifestAccordion = (m) => {
  const rows = [
    ['title', m.title], ['description', m.description], ['version', m.version],
    ['track', trackOf(m)], ['entry', m.entry], ['build', m.build],
    ['outDir', m.outDir], ['sandbox', sandboxFor(m)],
    ['mounts', (m.mounts || []).join(', ')], ['source', m.source],
  ].map(([k, v]) => `<div class="row"><dt>${esc(k)}</dt><dd>${esc(v ?? '')}</dd></div>`).join('');
  const ex = extrasOf(m);
  const extraBlock = Object.keys(ex).length
    ? `<h4>everything else, wired in as needed</h4><pre>${esc(JSON.stringify(ex, null, 2))}</pre>`
    : '';
  return `
    <details class="manifest">
      <summary><code>${esc(m.id)}</code> ${esc(m.title || '')} <span class="badge ${trackOf(m)}">${esc(trackOf(m))}</span></summary>
      <div class="panel"><dl>${rows}</dl>${receiptBlock(m)}${extraBlock}</div>
    </details>`;
};

const state = existsSync('ntc-state.json') ? JSON.parse(readFileSync('ntc-state.json', 'utf8')) : { schemaVersion: 1, work: [], types: {}, results: [] };
const payload = JSON.stringify({ ...state, manifests, packagedIds: shipped.map(m => m.id) }).replaceAll('<', '\\u003c');

// The hypervisor's review surface: every work item in review becomes a tick,
// its requirements become parts, and the human-inspection requirement becomes
// a review check linking straight at the experience under review. Ticks persist
// per artifact (storage-key carries the run id). No submission-id here: the
// inspection export stays with neat submissions, this is the review surface.
const reviewTicks = (state.work ?? [])
  .filter((item) => item.status === 'review')
  .map((item) => {
    const expId = item.location?.component?.split('/').at(-1);
    const href = expId && manifests.some((m) => m.id === expId)
      ? `./experiences/${expId}/index.html`
      : './neat.html';
    return {
      id: item.id,
      label: `${item.id} — ${item.outcome ?? item.status}`,
      parts: (item.requirements ?? []).map((req) => ({
        id: req.id,
        label: req.text ?? req.id,
        ...(req.id === 'review'
          ? { reviewId: `${item.id}:${req.id}`, action: { href, label: expId ? 'Open the experience' : 'Open the work board' } }
          : {}),
      })),
    };
  });
const reviewChecklist = reviewTicks.length
  ? `<tick-part-checklist data-checklist="${esc(JSON.stringify(reviewTicks))}" storage-key="pxcube-review:${esc(state.runId ?? 'local')}" subject-commit="${esc(state.sourceCommit ?? '')}"></tick-part-checklist>`
  : '';
const html = readFileSync(new URL('./shell.html', import.meta.url), 'utf8')
  .replace('<!-- CLEAN -->', shelfFor('clean'))
  .replace('<!-- EXP -->', shelfFor('exp'))
  .replace('<!-- MANIFESTS -->', manifests.map(manifestAccordion).join(''))
  .replace('<!-- REVIEW-CHECKLIST -->', reviewChecklist)
  .replace('<!-- STATE -->', payload);
writeFileSync(join(DIST, 'index.html'), html);
for (const file of ['shell.css', 'shell.mjs', 'scenario-loader.mjs']) writeFileSync(join(DIST, file), readFileSync(new URL('./' + file, import.meta.url)));
// The review checklist component is vendored (vendor/neat/tick-part-checklist.js)
// so the launcher makes no cross-origin requests and works offline.
writeFileSync(join(DIST, 'tick-part-checklist.js'), readFileSync(new URL('../vendor/neat/tick-part-checklist.js', import.meta.url)));
// neat's PxC execution store is browser-safe (no node: imports). The shell
// hosts the PxC kernels the Experiences bind to, so it ships the kernel
// (import-free), the vendored PxC, and the seed definitions.
writeFileSync(join(DIST, 'pxc.js'), readFileSync(new URL('../vendor/neat/dist/pxc.js', import.meta.url)));
writeFileSync(join(DIST, 'pxc-kernel.mjs'), readFileSync(new URL('../local/pxc-kernel.mjs', import.meta.url)));
writeFileSync(join(DIST, 'mock-pxc.mjs'), readFileSync(new URL('../mock-pxc/mock-pxc.mjs', import.meta.url)));
console.log(`launcher: ${shipped.length} shipped, ${failed.length} failed`);
