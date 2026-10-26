// The whole pipeline once (seed 20261025), then every claim as a test. Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPipeline, DEFAULT_SEED, MIN_SHARED } from './pipeline.mjs';
import { FRAMES, effectiveTerminals, effectiveExpect, lineage } from './frames.mjs';
import { allMismatches, handlerFor } from './minsky.mjs';
import { allCandidates } from './variants.mjs';
import { serializeWorld } from './world-json.mjs';
import { buildSeason } from './season.mjs';
import { oracle } from './oracle.mjs';
import { diffProjections } from './projection.mjs';

const R = runPipeline(DEFAULT_SEED);
const { cases, verdicts, metrics, base } = R;
const here = (f) => fileURLToPath(new URL(f, import.meta.url));

test('all nine registered Calculations pass their guarantees', () => {
  assert.equal(R.reports.length, 9);
  for (const rep of R.reports) assert.equal(rep.status, 'PASS', `${rep.calculationId}: ${rep.guarantees.filter((g) => !g.passed).map((g) => `${g.id} ${g.failures[0]}`).join('; ')}`);
});

test('every Case passes every one of its checks', () => {
  const bad = cases.filter((c) => !verdicts[c.id].pass).map((c) => `${c.id} ${c.slug}: ${verdicts[c.id].checks.filter((k) => !k.ok).map((k) => `${k.id} ${k.detail}`).join(' | ')}`);
  assert.deepEqual(bad, []);
});

test('Cases: ids are c001.., slugs are unique, every kind is present, observed Cases are at least a third', () => {
  assert.deepEqual(cases.map((c) => c.id), cases.map((_, n) => `c${String(n + 1).padStart(3, '0')}`));
  assert.equal(new Set(cases.map((c) => c.slug)).size, cases.length);
  for (const k of ['observed', 'chained', 'expectation', 'boundary', 'variant', 'relink', 'enum']) assert.ok(R.kinds[k] >= 1, `no ${k} Cases`);
  assert.ok(cases.length >= 150, `${cases.length} Cases`);
  assert.ok(R.kinds.observed >= 40);
});

test('every departure Case has an observable effect on linked results or on a sentence, and says what changed', () => {
  for (const c of cases.filter((x) => !['observed', 'chained'].includes(x.kind))) {
    const v = verdicts[c.id];
    assert.ok(v.deltaCount > 0 || v.sentenceDelta.length > 0, c.id);
    assert.ok(c.departures.length > 0 && c.departures.every((d) => d.id && 'from' in d && 'to' in d), c.id);
    assert.ok(v.checks.some((k) => k.id === 'locality' && k.ok), `${c.id} locality`);
  }
});

test('the pipeline equals the independent oracle in the base season and after every departure (differential, not self-agreement)', () => {
  assert.ok(cases.every((c) => verdicts[c.id].checks.find((k) => k.id === 'pipeline-equals-oracle').ok));
  const O = oracle(JSON.parse(JSON.stringify(R.instances)));
  assert.deepEqual(diffProjections(O, base.P), []);
});

test('oracle.mjs imports nothing: it re-derives from raw JSON only', () => {
  const src = readFileSync(here('./oracle.mjs'), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false);
  assert.equal(/world\.mjs|metrics\.mjs|enrich\.mjs|frames\.mjs|util\.mjs/.test(src.replace(/\/\/.*$/gm, '')), false);
});

test('Minsky: every mismatch string has a handler, and selection is driven by the frames\' own expectations', () => {
  for (const m of allMismatches()) assert.equal(typeof handlerFor(m), 'function', m);
  const enrichSrc = readFileSync(here('./enrich.mjs'), 'utf8');
  assert.ok(/selectAlternates/.test(enrichSrc));
  assert.equal(/\.mismatch\s*===/.test(enrichSrc), false, 'enrich must not re-code the mismatch rules');
  assert.ok(base.E.alternates.length > 50, `${base.E.alternates.length} alternates selected`);
  assert.ok(base.E.transformations.every((n) => n.mismatch && n.action), 'every note names its mismatch string and the action taken');
});

test('Minsky: alternates inherit their parent frame and carry their own expectations; a chain is selected by those expectations', () => {
  for (const alt of base.E.alternates) {
    const parent = FRAMES[alt.frame].inherits;
    assert.ok(parent, `${alt.frame} inherits nothing`);
    for (const t of Object.keys(effectiveTerminals(parent))) assert.ok(t in effectiveTerminals(alt.frame), `${alt.frame} lost ${t}`);
    assert.ok(lineage(alt.frame).includes(parent));
  }
  const own = ['PreReleaseAppearance', 'OtherBrandAppearance', 'ProvisionalMoldDisc', 'ShownOnlyCard', 'CardlessAppearance', 'AwaitingViewsVideo', 'ClicksOnlyChannel', 'UnattributedClick', 'OffBrandLink'];
  for (const f of own) assert.ok(Object.values(FRAMES[f].terminals).some((t) => t.expect.length), `${f} has no expectations of its own`);
  const chained = cases.find((c) => c.kind === 'chained');
  assert.ok(chained && verdicts[chained.id].chainLength >= 2);
  assert.ok(verdicts[chained.id].checks.find((k) => k.id === 'chain-selected-by-own-expectations').ok);
});

test('every soft expectation (one with a mismatch rule) has a generated violating value and a Case, or a stated rejection', () => {
  const W = base.W;
  const ids = new Set();
  for (const f of Object.values(FRAMES)) for (const def of Object.values(f.terminals)) for (const e of def.expect) if (e.mismatch) { assert.equal(typeof e.violate, 'function', e.id); ids.add(e.id); }
  const candidate = new Set(allCandidates(W).filter((c) => c.kind === 'expectation').map((c) => c.expectationId));
  for (const id of ids) assert.ok(candidate.has(id), `no violating candidate for ${id}`);
  const covered = new Set(cases.filter((c) => c.kind === 'expectation').map((c) => c.expectationId));
  const uncovered = [...ids].filter((id) => !covered.has(id) && !R.rejected.some((r) => r.slot?.includes(`|${id}|`)));
  assert.deepEqual(uncovered, []);
});

test('survivor: the named soft expectations each produce a Case that really fires (zero-length-kept: an expectation weakened to always-true is rejected here, not tolerated)', () => {
  const pinned = ['retentionAvailable', 'dayPrecision', 'moldResolved', 'hasViews', 'releasedByPublish', 'underActiveSponsor', 'startInsideVideo', 'notInverted', 'hasLength', 'withinVideo', 'confirmedThrown', 'hasCard', 'destinationMatchesBrand', 'linkIsVideoScoped', 'discAppearedInVideo', 'notBeforePublish', 'insidePlacement'];
  const covered = new Set(cases.filter((c) => c.kind === 'expectation').map((c) => c.expectationId));
  for (const id of pinned) assert.ok(covered.has(id), `no Case whose violation fires ${id}`);
  const hl = cases.find((c) => c.kind === 'expectation' && c.expectationId === 'hasLength');
  assert.ok(verdicts[hl.id].pass);
  assert.ok(verdicts[hl.id].selected && verdicts[hl.id].selected.some((x) => /zero-length/.test(JSON.stringify(x))), 'the zero-length transformation is the one selected');
});

test('the terminal audit: every terminal changes some Case or has a stated reason, and a skipped terminal really has no Case', () => {
  assert.deepEqual(metrics.cases.terminalsUnaccounted, []);
  for (const row of R.audit) assert.ok(row.cases > 0 || row.skip, row.terminal);
  assert.ok(R.audit.filter((r) => r.cases > 0).length >= 50);
  assert.ok(R.audit.filter((r) => r.skip).length <= 14);
});

test('richness: one connected world, every reference resolves, no island Cases, entities shared by many Cases', () => {
  assert.equal(metrics.world.components, 1);
  assert.equal(metrics.world.dangling, 0);
  assert.equal(metrics.cases.islandCases.length, 0);
  assert.equal(metrics.cases.caseComponents, 1);
  assert.ok(metrics.cases.strictSharedEntities >= MIN_SHARED, `${metrics.cases.strictSharedEntities}`);
  assert.ok(metrics.cases.crossCaseEdges > 1000);
  assert.ok(metrics.world.avgDegreeNonClick >= 4);
  assert.ok(metrics.world.nodes > 1000);
});

test('rollups across creators: per sponsor and per mold, and each adds up', () => {
  assert.ok(metrics.rollups.sponsorRowsWithManyCreators >= 2);
  assert.ok(metrics.rollups.moldsWithManyCreators >= 5);
  assert.deepEqual(metrics.rollups.moldSumsOff, []);
  const multi = base.M.exposure.rows.filter((r) => r.creators.length > 1 && r.state !== 'unmeasurable');
  for (const r of multi) assert.ok(Math.abs(Object.values(r.byCreator).filter((x) => x != null).reduce((s, x) => s + x, 0) - r.viewerMinutes) < 1e-6 * Math.max(1, r.viewerMinutes), r.key);
});

test('names are unique: creators, channels, makers, molds, videos, bags and disc labels', () => {
  const seen = (frame, term) => { const l = R.instances.filter((i) => i.frame === frame).map((i) => i.t[term]); return l.length === new Set(l).size; };
  for (const [f, t] of [['Creator', 'name'], ['Channel', 'title'], ['Manufacturer', 'name'], ['Mold', 'name'], ['Video', 'title'], ['Bag', 'name']]) assert.ok(seen(f, t), `${f}.${t}`);
  assert.deepEqual(metrics.names.duplicateDiscLabels, []);
});

test('required situations exist as Cases: deal edges, release day, window edges 29/30/31, click at a card\'s last second, quarter edge, month precision, time zone, chained', () => {
  assert.deepEqual(metrics.cases.missingSituations, []);
  const windows = cases.filter((c) => c.frameTerminal === 'Release.windowDays').map((c) => c.departures[0].to);
  assert.ok(windows.length >= 2, `window Cases: ${windows}`);
  const offsets = new Set(Object.values(base.P.appearances).filter((a) => a.releaseClass).map((a) => a.offsetMin));
  for (const k of [0, 29, 30, 31]) assert.ok(offsets.has(k), `no appearance at release offset ${k}`);
});

test('the release window is a terminal: a release with its own length is judged by that length', () => {
  const tam = base.W.all('Release').find((r) => r.t.windowDays !== 30);
  assert.ok(tam, 'a release with its own window exists');
  assert.ok(base.M.releases.releases.some((r) => r.releaseId === tam.id && r.videos.every((v) => v.windowDays === tam.t.windowDays)));
});

test('Short and long videos are reported apart AND added into the total, and the sentence says only that', () => {
  const both = Object.entries(base.M.attention.byDisc).filter(([, d]) => d.byFormat.short && d.byFormat.long);
  for (const [id, d] of Object.entries(base.M.attention.byDisc)) assert.ok(Math.abs((d.byFormat.long?.value ?? 0) + (d.byFormat.short?.value ?? 0) - d.value) < 1e-6 * Math.max(1, d.value), id);
  assert.ok(Object.values(base.M.attention.byDisc).some((d) => d.byFormat.short), 'a Short exists in the season');
  void both;
  const shortFact = verdicts[cases.find((c) => c.slug === 'observed:short-attention').id].meaning.find((m) => m.kind === 'short');
  assert.match(shortFact.sentence, /reported apart/);
  assert.match(shortFact.sentence, /from Shorts/);
});

test('unmeasurable is null, never zero: sponsor rows, attention and the sentence', () => {
  const rows = base.M.exposure.rows;
  assert.ok(rows.some((r) => r.state === 'unmeasurable'), 'the season has an unmeasurable row');
  for (const r of rows) { if (r.state === 'unmeasurable') assert.equal(r.viewerMinutes, null, r.key); else assert.equal(typeof r.viewerMinutes, 'number'); }
  const c = cases.find((x) => x.slug === 'observed:unmeasurable-sponsor-row');
  assert.match(verdicts[c.id].meaning[0].sentence, /could not be measured/);
  assert.equal(JSON.stringify(R.base.P.sponsorRows).includes('"viewerMinutes":0,'), false);
});

test('units: the page and the sentences say viewer-minutes on screen, never "exposure minutes"', () => {
  const all = cases.flatMap((c) => verdicts[c.id].meaning.map((m) => m.sentence)).join('\n');
  assert.equal(/exposure minutes/i.test(all), false);
  assert.match(all, /viewer-minutes on screen/);
  for (const f of ['display.mjs', 'meaning.mjs', 'page.mjs', 'index.html']) assert.equal(/exposure minutes/i.test(readFileSync(here(`./${f}`), 'utf8')), false, f);
});

test('determinism: the same seed gives the same bytes; another seed changes numbers only, never the structure', () => {
  const a = buildSeason(20261025), b = buildSeason(20261025), c = buildSeason(7);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const structure = (l) => l.filter((i) => i.frame !== 'Click').map((i) => i.id);
  assert.deepEqual(structure(c), structure(a), 'the seed changes how many clicks arrive and when, never who, what or which videos');
  assert.notEqual(JSON.stringify(c), JSON.stringify(a));
  const ser = (cs) => serializeWorld({ seed: 1, summary: {}, instances: cs, cases: [] });
  assert.equal(ser(a), ser(b));
  const o = oracle(JSON.parse(JSON.stringify(c)));
  assert.ok(Object.keys(o.appearances).length >= 60);
});

test('every Case that cites the world cites things that exist and are linked to other Cases', () => {
  for (const c of cases) {
    const ents = R.entitiesByCase[c.id];
    assert.ok(ents.length >= 2, c.id);
    assert.ok(ents.every((id) => base.W.get(id)), c.id);
  }
});

test('meaning sentences exist for observed Cases and carry the oracle\'s numbers', () => {
  for (const c of cases.filter((x) => x.kind === 'observed' || x.kind === 'chained')) {
    const v = verdicts[c.id];
    if (v.checks.some((k) => k.id === 'has-meaning-sentence')) assert.ok(v.meaning.length > 0, c.id);
    assert.ok(v.checks.find((k) => k.id === 'meaning-numbers').ok, c.id);
  }
});
