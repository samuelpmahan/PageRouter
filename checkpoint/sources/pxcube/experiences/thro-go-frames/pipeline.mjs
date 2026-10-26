// The whole pipeline, every step a registered Calculation run through runWitnessedCalculation:
//   season (one shared world) -> analysis chain (enrich/link, attention, dips, release support, clicks, sponsor exposure)
//   -> Cases (observed + derived from frames) -> verify every Case -> graph richness of the world and of the Cases together.
import { buildSeason, SEASON_SUMMARY, SEASON_END } from './season.mjs';
import { analyzeWorld } from './analysis.mjs';
import { deriveCases, refIndex, THEMES } from './cases.mjs';
import { verifyCase } from './verify.mjs';
import { oracle } from './oracle.mjs';
import { typeProblems, FRAMES, effectiveTerminals } from './frames.mjs';
import { graphMetrics, buildGraph, caseEntities, STRICT_FRAMES, nodeLabel } from './graph.mjs';
import { discOwnerLabel } from './meaning.mjs';
import { calculation, guarantee, runCalculation } from './calc.mjs';
import { capabilityCount } from './registry.mjs';
import { fnv32 } from './util.mjs';

export const DEFAULT_SEED = 20261025;
export const MIN_SHARED = 120;
export const MIN_DEGREE = 4;
export const ROUND1_GRAPH = { nodes: 781, edges: 1208, components: 47, crossCaseEdges: 0, entitiesInMoreThanOneCase: 0, avgDegree: 3.093, source: 'tools/critic-graph.mjs on the Round 1 data (the Critic\'s measurement)' };

// ---------- the season ----------
const dupes = (list) => { const seen = new Set(), out = new Set(); for (const x of list) { if (seen.has(x)) out.add(x); seen.add(x); } return [...out]; };
export const seasonCalc = calculation({
  id: 'thro.go.season',
  description: 'Generate the one shared toy season (3 creators, 5 manufacturers, molds, releases, shelves, bags, videos, retention curves, links and clicks) from a seed. The structure is fixed; the seed varies only the numbers.',
  calculate: (entry) => {
    const instances = buildSeason(entry.seed);
    return { output: { instances, count: instances.length } };
  },
  guarantees: [
    guarantee('types-and-references', 'Every terminal has its declared type and every reference resolves to an instance of the right frame.', (it) => { const p = typeProblems(indexWorldLazy(it.output.instances)); return p.length ? JSON.stringify(p[0]) : true; }),
    guarantee('no-hard-expectation-violated', 'No hard expectation (one without a mismatch rule) is violated by the generated world.', (it) => { const a = hardViolations(it.output.instances); return a.length ? a[0] : true; }),
    guarantee('display-names-unique', 'Creator names, channel titles, manufacturer names, mold names, video titles and bag names are unique, so a name on the page points at one thing.', (it) => {
      for (const f of ['Creator.name', 'Channel.title', 'Manufacturer.name', 'Mold.name', 'Video.title', 'Bag.name']) {
        const [frame, term] = f.split('.');
        const d = dupes(it.output.instances.filter((i) => i.frame === frame).map((i) => i.t[term]));
        if (d.length) return `${f}: ${d[0]}`;
      }
      return true;
    }),
    guarantee('same-seed-same-bytes', 'Generating twice from the same seed gives the same bytes.', (it) => (fnv32(JSON.stringify(buildSeason(it.input.seed))) === fnv32(JSON.stringify(it.output.instances)) ? true : 'differs')),
  ],
});
import { indexWorld } from './world.mjs';
import { violationsOf } from './frames.mjs';
const indexWorldLazy = (instances) => indexWorld(instances);
const hardViolations = (instances) => { const W = indexWorld(instances); const out = []; for (const inst of instances) if (FRAMES[inst.frame].role === 'input') for (const v of violationsOf(W, inst)) if (!v.mismatch) out.push(`${v.instanceId}#${v.expectationId}`); return out; };

// ---------- verification of the Cases ----------
export const verifyCalc = calculation({
  id: 'thro.go.verifyCase',
  description: 'Verify one Case against the shared season: valid world, all Calculations pass, the pipeline equals an independent recomputation from raw JSON, the departure has an observable and local effect, the failed expectation selected what its mismatch string names, and the claim of the Case holds.',
  calculate: (entry) => ({ output: verifyCase(entry.case, entry.base, entry.baseOracle) }),
  guarantees: [
    guarantee('every-check-passes', 'All checks of the Case pass.', (it) => (it.output.pass ? true : it.output.checks.filter((k) => !k.ok).map((k) => `${k.id}: ${k.detail}`).join(' | '))),
    guarantee('has-claim', 'A Case states what it expects: an expectation of the world, a change in linked results, or sentences.', (it) => (it.output.checks.length >= 4 ? true : 'too few checks')),
  ],
});

// ---------- how richly linked the world and the Cases are ----------
export const richnessCalc = calculation({
  id: 'thro.go.graphRichness',
  description: 'How cross-linked the dataset is: one connected world, every reference resolving, entities shared by several Cases, no island Cases, rollups across creators per sponsor and per mold, unique names.',
  calculate: (entry) => ({ output: entry.metrics }),
  guarantees: [
    guarantee('one-connected-component', 'The world is a single connected component (every instance reaches every other through references).', (it) => (it.output.world.components === 1 ? true : `${it.output.world.components} components`)),
    guarantee('every-reference-resolves', 'No reference points at something that does not exist.', (it) => (it.output.world.dangling === 0 ? true : `${it.output.world.dangling} dangling`)),
    guarantee('entities-shared-by-cases', `At least ${MIN_SHARED} entities (discs, videos, molds, releases, deals, bags, links, clicks, cards, curves) appear in two or more Cases.`, (it) => (it.output.cases.strictSharedEntities >= MIN_SHARED ? true : `only ${it.output.cases.strictSharedEntities}`)),
    guarantee('no-island-cases', 'Every Case shares at least one such entity with another Case.', (it) => (it.output.cases.islandCases.length === 0 ? true : `${it.output.cases.islandCases.length} island Cases, first ${it.output.cases.islandCases[0]}`)),
    guarantee('cases-form-one-network', 'The Cases, linked through shared entities, form one connected network.', (it) => (it.output.cases.caseComponents === 1 ? true : `${it.output.cases.caseComponents} Case components`)),
    guarantee('cross-creator-sponsor-rollups', 'At least 2 sponsor-view rows add up more than one creator, and every brand that has discs with several creators has such a row.', (it) => (it.output.rollups.sponsorRowsWithManyCreators >= 2 && it.output.rollups.brandsMissingRollup.length === 0 ? true : `rows ${it.output.rollups.sponsorRowsWithManyCreators}, brands missing ${it.output.rollups.brandsMissingRollup.join(',')}`)),
    guarantee('cross-creator-mold-rollups', 'At least 5 molds appear with more than one creator and have one combined total.', (it) => (it.output.rollups.moldsWithManyCreators >= 5 ? true : `only ${it.output.rollups.moldsWithManyCreators}`)),
    guarantee('mold-rollups-add-up', 'A mold\'s combined attention equals the sum of its creators\' parts.', (it) => (it.output.rollups.moldSumsOff.length === 0 ? true : it.output.rollups.moldSumsOff[0])),
    guarantee('display-names-unique-for-discs', 'Every disc has its own label (brand, mold, plastic, run, owner) so no two discs read the same.', (it) => (it.output.names.duplicateDiscLabels.length === 0 ? true : it.output.names.duplicateDiscLabels[0])),
    guarantee('average-degree', `Counting every instance except the Click leaves (each click is one edge by nature), the average number of references in and out is at least ${MIN_DEGREE}.`, (it) => (it.output.world.avgDegreeNonClick >= MIN_DEGREE ? true : String(it.output.world.avgDegreeNonClick))),
    guarantee('required-situations-present', 'The Cases include the boundary situations the product cares about (deal first / last day, release day, window edges, click at a card\'s last second, quarter edge, month precision, time zone, chained frames).', (it) => (it.output.cases.missingSituations.length === 0 ? true : `missing ${it.output.cases.missingSituations.join(', ')}`)),
    guarantee('every-terminal-audited', 'Every terminal of every input frame either changes some result or sentence in at least one Case, or is listed with the reason it cannot.', (it) => (it.output.cases.terminalsUnaccounted.length === 0 ? true : `unaccounted: ${it.output.cases.terminalsUnaccounted.slice(0, 6).join(', ')}`)),
  ],
});

// terminals that cannot change a result, with the reason (the audit lists them instead of pretending)
export const TERMINAL_SKIPS = {
  'Channel.studioConnected': 'covered by the not-connected Case only if a creator is unconnected; the season connects every channel',
  'Manufacturer.shopHost': 'compared against link destinations (off-brand link); changing it is the same as changing the destination',
  'Shelf.creatorId': 'a Shelf has one terminal, the owner; Discs reach their owner through their own creatorId',
  'Disc.moldName': 'the typed name; covered by the Disc.moldId Cases (resolved by spelling, or provisional)',
  'Channel.title': 'shown in the creator panel header only; no sentence or result reads it',
  'Creator.handle': 'shown in the creator panel header and used to build link codes; no sentence or result reads it, and its uniqueness is a hard expectation',
  'Release.datePrecision': 'changing the precision alone leaves a day written as a month (hard expectation dateMatchesPrecision); the Release.datePrecision Case is the expectation Case that changes precision and date together',
  'RetentionCurve.seconds': 'the curve must cover the video (hard expectation coversVideo): shorter is an invalid world and longer changes nothing a reader sees',
  'Bag.creatorId': 'ownership is tied to other references by hard expectations (onShelf, onOwnersShelf, discBelongsToCreator, videosAreTheCreators); re-pointing one owner alone is an invalid world, so the relink Cases try it and every candidate is rejected with that reason',
  'Disc.creatorId': 'same: a disc must sit on its owner\'s own Shelf (onOwnersShelf)',
  'Disc.shelfId': 'same: a disc must sit on its owner\'s own Shelf (onOwnersShelf)',
  'Link.creatorId': 'same: a link\'s disc must belong to the link\'s creator (discBelongsToCreator)',
  'Channel.creatorId': 'same: re-pointing a channel orphans its videos, bags and discs (videosAreTheCreators); the full Calculations catch what the local validity check cannot',
  'Video.channelId': 'same: a video\'s bag and discs belong to the channel\'s creator (videosAreTheCreators)',
};

function sharedMetrics(cases, entitiesByCase, W) {
  const byEntity = new Map();
  for (const c of cases) for (const id of entitiesByCase[c.id]) (byEntity.get(id) ?? byEntity.set(id, new Set()).get(id)).add(c.id);
  const histogram = {};
  let multi = 0, strict = 0;
  const strictEntities = [];
  for (const [id, set] of byEntity) {
    const n = set.size;
    if (n >= 2) { multi++; if (STRICT_FRAMES.has(W.get(id).frame)) { strict++; strictEntities.push({ id, cases: n }); } }
    histogram[n >= 10 ? '10+' : n] = (histogram[n >= 10 ? '10+' : n] ?? 0) + 1;
  }
  // Case network: two Cases are linked when they share a strict entity
  const parent = new Map(cases.map((c) => [c.id, c.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const edgePairs = new Set();
  const linkedTo = new Map(cases.map((c) => [c.id, new Set()]));
  for (const [id, set] of byEntity) {
    if (!STRICT_FRAMES.has(W.get(id).frame) || set.size < 2) continue;
    const list = [...set].sort();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { edgePairs.add(`${list[i]}|${list[j]}`); linkedTo.get(list[i]).add(list[j]); linkedTo.get(list[j]).add(list[i]); parent.set(find(list[i]), find(list[j])); }
  }
  const comps = new Set(cases.map((c) => find(c.id)));
  return {
    entitiesInMoreThanOneCase: multi, strictSharedEntities: strict, histogram, crossCaseEdges: edgePairs.size, caseComponents: comps.size,
    islandCases: cases.filter((c) => linkedTo.get(c.id).size === 0).map((c) => c.id),
    topShared: strictEntities.sort((a, b) => b.cases - a.cases || (a.id < b.id ? -1 : 1)).slice(0, 12),
    avgEntitiesPerCase: Math.round((cases.reduce((s, c) => s + entitiesByCase[c.id].length, 0) / Math.max(1, cases.length)) * 10) / 10,
  };
}

const REQUIRED = [
  ['deal first day', (c) => c.slug === 'observed:deal-first-day'], ['deal last day', (c) => c.slug === 'observed:deal-last-day'],
  ['deal end boundary (generated)', (c) => c.frameTerminal === 'SponsorDeal.end' && c.kind === 'boundary'], ['deal start boundary (generated)', (c) => c.frameTerminal === 'SponsorDeal.start' && c.kind === 'boundary'],
  ['release day', (c) => c.slug === 'observed:release-day'], ['window last day', (c) => c.slug === 'observed:window-last-day'], ['window day after', (c) => c.slug === 'observed:window-day-after'],
  ['window edge (generated windowDays)', (c) => c.frameTerminal === 'Release.windowDays' && c.kind === 'boundary'],
  ['click at card last second', (c) => c.slug === 'observed:click-card-last-second'], ['click at the second the card goes', (c) => c.slug === 'observed:click-card-gone'],
  ['quarter edge (observed)', (c) => c.slug === 'observed:quarter-edge-time-zone'], ['quarter edge (generated)', (c) => c.kind === 'boundary' && c.expect?.kind === 'quarter'],
  ['month precision first day', (c) => c.slug === 'observed:release-month-first-day'], ['month precision last day', (c) => c.slug === 'observed:release-month-last-day'],
  ['time zone changes the local day', (c) => c.expect?.kind === 'localDay'], ['local day differs from UTC day', (c) => c.slug === 'observed:local-day-differs'],
  ['chained frames', (c) => c.kind === 'chained'],
];

export function richnessMetrics({ instances, base, cases, entitiesByCase, G }) {
  const world = graphMetrics(instances);
  const sharing = sharedMetrics(cases, entitiesByCase, base.W);
  const rows = base.M.exposure.rows;
  const discsByBrandCreators = {};
  for (const d of Object.values(base.E.discs)) if (d.manufacturerId) (discsByBrandCreators[d.manufacturerId] ??= new Set()).add(d.creatorId);
  const brandRows = {};
  for (const r of rows) if (r.creators.length > 1) brandRows[r.manufacturerId] = true;
  const moldSumsOff = [];
  let moldsMany = 0;
  for (const [id, m] of Object.entries(base.M.attention.byMold)) if (m.creators.length > 1) {
    moldsMany++;
    const s = Object.values(m.perCreator).reduce((a, x) => a + x, 0);
    if (Math.abs(s - m.value) > 1e-6 * Math.max(1, s)) moldSumsOff.push(id);
  }
  const labels = Object.keys(base.E.discs).map((id) => discOwnerLabel(base.W, base.E, id));
  return {
    seed: null,
    world,
    cases: { ...sharing, caseCount: cases.length, missingSituations: REQUIRED.filter(([, f]) => !cases.some(f)).map(([n]) => n), terminalsUnaccounted: [] },
    rollups: {
      sponsorRowsWithManyCreators: rows.filter((r) => r.kind === 'sponsor' && r.creators.length > 1).length,
      otherBrandRowsWithManyCreators: rows.filter((r) => r.kind !== 'sponsor' && r.creators.length > 1).length,
      rows: rows.length,
      brandsMissingRollup: Object.entries(discsByBrandCreators).filter(([, s]) => s.size > 1).map(([m]) => m).filter((m) => !brandRows[m]),
      moldsWithManyCreators: moldsMany, moldSumsOff,
    },
    names: { duplicateDiscLabels: dupes(labels) },
  };
}

// which terminals are exercised by at least one Case (a departure that patched it, or a base value an observed Case reads)
export function terminalAudit(cases, instances) {
  const used = new Set();
  for (const c of cases) for (const d of c.departures ?? []) if (d.terminal) used.add(`${d.frame}.${d.terminal}`);
  const rows = [];
  for (const [fid, f] of Object.entries(FRAMES)) {
    if (f.role !== 'input') continue;
    for (const [name, def] of Object.entries(effectiveTerminals(fid))) {
      if (def.derive) continue;
      const key = `${fid}.${name}`;
      rows.push({ terminal: key, cases: used.has(key) ? cases.filter((c) => (c.departures ?? []).some((d) => `${d.frame}.${d.terminal}` === key)).length : 0, skip: used.has(key) ? null : TERMINAL_SKIPS[key] ?? null });
    }
  }
  return rows;
}

export function runPipeline(seed = DEFAULT_SEED, { quiet = true } = {}) {
  const t0 = Date.now();
  const gen = runCalculation(seasonCalc, [{ name: 'season', seed }]);
  const instances = gen.outputs.season.instances;
  const base = analyzeWorld(instances, 'season');
  base.refBy = refIndex(base.W);
  const derived = deriveCases(instances, seed, base);
  const baseOracle = derived.oracleBase;
  const cases = derived.cases;
  const ver = runCalculation(verifyCalc, cases.map((c) => ({ name: c.id, case: c, base, baseOracle })));
  const verdicts = ver.outputs;
  const G = buildGraph(base.W, base.E);
  const entitiesByCase = Object.fromEntries(cases.map((c) => [c.id, caseEntities(c, base.W, base.E, G)]));
  const metrics = richnessMetrics({ instances, base, cases, entitiesByCase, G });
  metrics.seed = seed;
  const audit = terminalAudit(cases, instances);
  metrics.cases.terminalsUnaccounted = audit.filter((r) => r.cases === 0 && !r.skip).map((r) => r.terminal);
  const rich = runCalculation(richnessCalc, [{ name: 'season', metrics }]);
  const reports = [gen, ...base.reports, ver, rich].map(({ outputs, ...r }) => r);
  const kinds = {};
  for (const c of cases) kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
  return {
    seed, instances, base, cases, rejected: derived.rejected, verdicts, entitiesByCase, metrics, audit, reports, kinds,
    summary: { ...SEASON_SUMMARY(), seasonEnd: SEASON_END, instanceCount: instances.length, capabilityCount: capabilityCount(), seconds: quiet ? null : (Date.now() - t0) / 1000 },
  };
}
export { THEMES, nodeLabel, oracle };
