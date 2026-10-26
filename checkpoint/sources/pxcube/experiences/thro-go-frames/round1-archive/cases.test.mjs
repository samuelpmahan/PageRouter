// node --test : every generated Case's executable expectation must pass, on the default seed and on other seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runPipeline, DEFAULT_SEED } from './pipeline.mjs';
import { FRAMES, frameSystem } from './frames.mjs';
import { DEPARTURES } from './departures.mjs';
import { serializeWorld } from './world-json.mjs';
import { registry } from './registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = runPipeline(DEFAULT_SEED);

test('frames: at least 15 input frames, each terminal has a type, a default and a list of expectations', () => {
  const inputs = Object.entries(FRAMES).filter(([, f]) => f.role === 'input');
  assert.ok(inputs.length >= 15, `only ${inputs.length} input frames`);
  for (const [id, f] of Object.entries(FRAMES)) for (const [name, t] of Object.entries(f.terminals)) {
    assert.equal(typeof t.type, 'string', `${id}.${name} type`);
    assert.ok('default' in t, `${id}.${name} default`);
    assert.ok(Array.isArray(t.expect), `${id}.${name} expect`);
  }
  const { edges } = frameSystem();
  assert.ok(edges.length >= 25, 'frames link into a frame system through reference terminals');
});

test('the required frames exist', () => {
  for (const f of ['Creator', 'Channel', 'SponsorDeal', 'Disc', 'Mold', 'Manufacturer', 'Release', 'Bag', 'Video', 'RetentionCurve', 'CardPlacement', 'Appearance', 'Link', 'Click']) assert.ok(FRAMES[f], f);
});

test('every departure hangs off a real Frame.terminal', () => {
  for (const key of Object.keys(DEPARTURES)) { const [f, t] = key.split('.'); assert.ok(FRAMES[f]?.terminals[t], key); }
});

test('Cases are generated from the frames: every Case names the frame terminals it departs from (or is the baseline)', () => {
  for (const c of run.world.cases) {
    if (c.kind === 'baseline') continue;
    assert.ok(c.departures.length > 0, c.slug);
    for (const p of c.parts) { const [f, t] = p.frameTerminal.split('.'); assert.ok(FRAMES[f].terminals[t], p.frameTerminal); }
  }
});

test('the registered Calculations all pass their guarantees', () => {
  for (const rep of run.reports) {
    for (const g of rep.guarantees) assert.ok(g.passed, `${rep.calculationId} / ${g.id}: ${g.failures.join('; ')}`);
    assert.equal(rep.status, 'PASS', rep.calculationId);
  }
  assert.equal(run.reports.length, 8);
});

test('required kinds of Case are present', () => {
  const slugs = run.world.cases.map((c) => c.slug).join('\n');
  const need = {
    'pre-release hype': /preRelease/, 'release window': /releaseWindow/, 'same disc in many videos via one Bag': /manyVideos/, 'Bag changes between videos': /bagChange/,
    'two discs of the same mold': /twoPlastics/, 'brand switch mid-quarter': /brandSwitch/, 'non-sponsor brand': /nonSponsorBrand/, 'card but never thrown': /shownNotThrown/,
    'thrown with no card': /thrownNoCard/, 'overlapping placements': /overlapDifferentDiscs/, 'placement past video end': /pastVideoEnd/, 'zero-length placement': /zeroLength/,
    'click on a link whose disc never appeared': /discNeverAppeared/, 'click with timestamp inside a placement': /insideCard/, 'Short': /short/, 'zero views': /zeroViews/,
    'views growing': /growth/, 'retention dip': /:dip/, 'flat retention': /flat/, 'unknown mold': /unknownMold/, 'month-precision release': /monthInside/, 'cross-creator rollup': /crossCreator/,
  };
  for (const [what, re] of Object.entries(need)) assert.ok(re.test(slugs), what);
  assert.ok(run.world.cases.filter((c) => c.kind === 'combination').length >= 8, 'seeded combinations');
});

test('every soft expectation (one that selects an alternate frame or transformation) is exercised by at least one Case', () => {
  const soft = [];
  for (const [fid, f] of Object.entries(FRAMES)) for (const [tid, t] of Object.entries(f.terminals)) for (const e of t.expect) if (e.mismatch) soft.push(e.id);
  const seen = new Set();
  for (const E of Object.values(run.enriched)) for (const t of E.transformations) seen.add(t.expectationId);
  const missing = soft.filter((id) => !seen.has(id));
  assert.deepEqual(missing, [], 'unexercised soft expectations');
});

test('every attention-seconds number carries a Capability Lab receipt rooted in the registry', () => {
  let n = 0;
  for (const M of Object.values(run.metrics)) for (const a of Object.values(M.attention.attention)) if (a.value != null) {
    n++;
    assert.equal(a.receipt.capability, 'thro.attentionSeconds');
    assert.ok(a.receipt.calls.some((c) => c.id === 'statistics.sum'), 'rooted in statistics.sum');
  }
  assert.ok(n > 30);
  for (const id of ['thro.attentionSeconds', 'thro.retentionDip', 'thro.ratio', 'statistics.sum', 'statistics.mean']) assert.ok(registry.get(id), id);
});

test('same seed, same bytes; and data/toy-world.json is that output (run `node build.mjs` if this fails)', () => {
  const again = runPipeline(DEFAULT_SEED);
  assert.equal(serializeWorld(again.world), serializeWorld(run.world));
  assert.equal(readFileSync(join(here, 'data', 'toy-world.json'), 'utf8'), serializeWorld(run.world));
});

test('different seeds give different worlds, and every Case still passes on them', () => {
  const base = serializeWorld(run.world);
  for (const seed of [1, 42, 20260101, 987654]) {
    const r = runPipeline(seed);
    assert.notEqual(serializeWorld(r.world), base, `seed ${seed} should differ`);
    const bad = Object.values(r.verdicts).filter((v) => !v.pass);
    assert.deepEqual(bad.map((v) => `${v.id}: ${v.checks.filter((c) => !c.pass).map((c) => c.label).join(' | ')}`), [], `seed ${seed}`);
  }
});

test('the creator panel exists for every creator of every Case and always carries the clicks disclaimer', () => {
  for (const v of Object.values(run.verdicts)) for (const p of Object.values(v.panels)) assert.match(p.footnote, /not people, sales or revenue/);
});

// One test per Case: all of its checks must pass.
for (const c of run.world.cases) {
  test(`${c.id} ${c.slug}`, () => {
    const v = run.verdicts[c.id];
    const failed = v.checks.filter((k) => !k.pass).map((k) => `${k.label}: expected ${JSON.stringify(k.expected)}, got ${JSON.stringify(k.actual)}`);
    assert.deepEqual(failed, []);
    assert.ok(v.checks.length >= 7, 'a Case asserts something');
    assert.ok(v.meaning.every(Boolean), 'meaning sentence produced from linked data');
  });
}
