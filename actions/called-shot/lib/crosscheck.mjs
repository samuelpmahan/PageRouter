// Crosscheck: do a shot's sentences say exactly what its clauses check?
//
// Built in the cross-verification form of PageRouter's Atlas
// (checkpoint/exp/atlas/cross-language.mjs):
// a content-addressed case (the batch), one observation per independent
// checker, and a comparison composed through a PxC FunctionalGuarantee
// into /crosscheck/agreement with the first disagreement named by path.
//
// Checkers never grade whether a shot went in; grade.mjs owns that. They
// answer one question per item: is every claim in this sentence checked by
// these clauses? "covered", or "gap" with a verbatim quote of the unchecked
// words. A quote that is not a substring of the sentence is not an answer.

import crypto from 'node:crypto';
import { Part, PxC } from '../vendor/pxc.mjs';
import { canonical } from './canonical.mjs';

export const BATCH = 'kompozed.shots.crosscheck-batch.v1';
export const KEY = 'kompozed.shots.crosscheck-key.v1';
export const OBSERVATION = 'kompozed.shots.crosscheck-observation.v1';
export const COMPARISON = 'kompozed.shots.crosscheck-comparison.v1';
const VERDICTS = ['covered', 'gap'];
const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// What each clause kind checks, as a checker needs to read it.
export const CLAUSE_KINDS = {
  'ast.moved': 'Top-level function `symbol` is declared in `from` and not in `to` on the baseline, and in `to` and not in `from` on the candidate. With body: "identical", the declaration text is unchanged; without it, the body is not checked.',
  'ast.onlyImportsChanged': 'In each of `files`, every top-level statement other than imports, comments and the `except` declarations is textually identical.',
  'source.changedExactly': 'The source files modified, added and removed are exactly the listed ones. It checks which files changed, not what is inside them.',
  'output.changedExactly': 'The built output files modified, added and removed are exactly the listed ones. Empty lists mean the output is byte-identical.',
  'site.changedExactly': 'The same as output.changedExactly (an older name).',
  'json.changedPathsExactly': 'In the JSON `file`, exactly the listed JSON paths have different values; every other value is equal.',
  'json.valueEquals': 'In the candidate\'s JSON `file`, the value at `path` equals `value`.',
  'text.onlyLinesAdded': 'In each of `files`, every baseline line survives in order and exactly `lines` lines are added. It does not check what the added lines say.',
  'crudlint.findingsChangedExactly': 'Running the crudlint predicate set, exactly the listed findings appear and disappear.',
};

// Claims no clause kind can check: appended to a real sentence, each makes a known gap.
const UNCHECKABLE = ['and the build runs faster than before', 'and no reviewer needs to read the diff'];

const itemId = content => 'x' + sha(canonical(content)).slice(0, 6);
const realItem = (shot, sentence) => ({ sentence: { id: sentence.id, text: sentence.text }, clauses: shot.clauses.filter(c => c.covers.includes(sentence.id)).map(({ covers, ...c }) => c) });

export function buildBatch(shots) {
  const items = [], key = { real: {}, gold: {}, controls: {} };
  const add = (bucket, content, answer) => {
    const id = itemId(content);
    if (items.some(item => item.id === id)) return;
    items.push({ id, ...content });
    key[bucket][id] = answer;
  };
  for (const shot of shots) for (const sentence of shot.call) add('real', realItem(shot, sentence), { shot: shot.id, sentence: sentence.id });
  const real = shots.flatMap(shot => shot.call.map(sentence => ({ shot, sentence, item: realItem(shot, sentence) })));
  // Gold: an uncheckable claim appended to the first two real sentences.
  real.slice(0, UNCHECKABLE.length).forEach(({ shot, sentence, item }, i) => {
    const text = `${item.sentence.text.replace(/\.$/, '')}, ${UNCHECKABLE[i]}.`;
    add('gold', { ...item, sentence: { ...item.sentence, text } }, { expect: 'gap', span: UNCHECKABLE[i], mutation: 'appended-claim', from: `${shot.id}/${sentence.id}`, fromItem: itemId(item) });
  });
  // Gold: an ast.moved clause stripped of body: "identical" under a sentence that promises an unchanged body.
  for (const { shot, sentence, item } of real) {
    const span = item.sentence.text.match(/body unchanged/)?.[0];
    if (!span || !item.clauses.some(c => c.kind === 'ast.moved' && c.body === 'identical')) continue;
    add('gold', { ...item, clauses: item.clauses.map(c => c.kind === 'ast.moved' ? (({ body, ...rest }) => rest)(c) : c) },
      { expect: 'gap', span, mutation: 'dropped-body-check', from: `${shot.id}/${sentence.id}` });
    break;
  }
  // Gold: a JSON clause pointed at a different path than the sentence names.
  for (const { shot, sentence, item } of real) {
    const span = item.sentence.text.match(/\$\.[A-Za-z.]+[A-Za-z]/)?.[0];
    if (!span || !item.clauses.some(c => c.kind === 'json.changedPathsExactly')) continue;
    add('gold', { ...item, clauses: item.clauses.map(c => c.kind === 'json.changedPathsExactly' ? { ...c, paths: ['$.release.version'] } : c) },
      { expect: 'gap', span, mutation: 'swapped-json-path', from: `${shot.id}/${sentence.id}` });
    break;
  }
  // Controls: sentences that say exactly what their clause checks.
  add('controls', { sentence: { id: 'K1', text: 'Source changes are exactly src/a.mjs modified; nothing is added or removed.' },
    clauses: [{ id: 'C1', kind: 'source.changedExactly', modified: ['src/a.mjs'], added: [], removed: [] }] }, { expect: 'covered' });
  add('controls', { sentence: { id: 'K2', text: 'In data/catalog.json, only $.release.siteBuildId changes.' },
    clauses: [{ id: 'C1', kind: 'json.changedPathsExactly', file: 'data/catalog.json', paths: ['$.release.siteBuildId'] }] }, { expect: 'covered' });
  items.sort((a, b) => a.id.localeCompare(b.id));
  const payload = { format: BATCH, clauseKinds: CLAUSE_KINDS, items };
  const case_id = 'sha256:' + sha(canonical(payload));
  return { batch: { ...payload, case_id }, key: { format: KEY, case_id, ...key } };
}

export function validateAnswer(item, answer) {
  if (!answer || !VERDICTS.includes(answer.verdict)) return 'verdict must be covered or gap';
  if (answer.verdict === 'covered') return answer.unchecked == null ? null : 'a covered answer quotes nothing';
  if (typeof answer.unchecked !== 'string' || !answer.unchecked.trim()) return 'a gap must quote the unchecked words';
  if (!item.sentence.text.includes(answer.unchecked.trim())) return `quote is not verbatim from the sentence: "${answer.unchecked}"`;
  return null;
}

// The FunctionalGuarantee: every item needs two of three valid answers to agree.
function agreementCalculation(items) {
  return inputs => {
    const checkers = Object.keys(inputs).sort();
    const rows = items.map(item => {
      const answers = Object.fromEntries(checkers.map(name => {
        const answer = inputs[name][item.id], problem = validateAnswer(item, answer);
        return [name, problem ? { invalid: problem } : { verdict: answer.verdict, unchecked: answer.unchecked?.trim() ?? null }];
      }));
      const counts = {};
      for (const a of Object.values(answers)) if (a.verdict) counts[a.verdict] = (counts[a.verdict] ?? 0) + 1;
      const majority = Object.entries(counts).find(([, n]) => n >= 2)?.[0] ?? null;
      const unanimous = Object.values(answers).every(a => a.verdict && a.verdict === majority);
      return { id: item.id, majority, unanimous, answers };
    });
    const split = rows.find(r => !r.unanimous);
    return {
      accepted: rows.every(r => r.majority),
      item_count: rows.length,
      first_difference: split ? { path: `items.${split.id}.verdict`, reason: split.majority ? 'not unanimous' : 'no two checkers agree',
        values: Object.fromEntries(Object.entries(split.answers).map(([n, a]) => [n, a.verdict ?? `invalid: ${a.invalid}`])) } : null,
      items: rows,
    };
  };
}

export async function compare(batch, observations) {
  for (const o of observations) {
    if (o.format !== OBSERVATION) throw TypeError(`${o.checker}: observation format must be ${OBSERVATION}`);
    if (o.case_id !== batch.case_id) throw TypeError(`${o.checker}: observation is for case ${o.case_id}, not ${batch.case_id}`);
  }
  const kernel = new PxC(), inputs = {};
  for (const o of observations) { kernel.set(`/crosscheck/${o.checker}`, new Part(o.observables)); inputs[o.checker] = `/crosscheck/${o.checker}`; }
  kernel.set('/crosscheck/fg', new Part(agreementCalculation(batch.items)));
  const output = await kernel.compose({ into: '/crosscheck/agreement', calculation: '/crosscheck/fg', inputs });
  return { format: COMPARISON, case_id: batch.case_id, agreement: output.value,
    producer: { calculation: 'crosscheck_agreement_fg', calculation_part: '/crosscheck/fg', output_part: '/crosscheck/agreement', kernel: 'vendor/hh/services/pxc.mjs' } };
}

const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
const overlaps = (quote, span) => !!quote && (norm(quote).includes(norm(span)) || norm(span).includes(norm(quote)));

export function score(comparison, key) {
  const rows = new Map(comparison.agreement.items.map(r => [r.id, r]));
  const checkers = Object.keys(comparison.agreement.items[0]?.answers ?? {});
  const perChecker = Object.fromEntries(checkers.map(name => [name, { goldCaught: 0, goldPointed: 0, gold: 0, falseAlarms: 0, controls: 0, invalid: 0 }]));
  for (const [id, answer] of Object.entries(key.gold)) for (const name of checkers) {
    const a = rows.get(id).answers[name], s = perChecker[name];
    s.gold++;
    // An appended claim comes after the original sentence, so a checker that
    // quotes the same earlier gap it found in the unmutated sentence is right.
    const earlier = answer.fromItem && rows.get(answer.fromItem)?.answers[name]?.unchecked;
    if (a.verdict === 'gap') { s.goldCaught++; if (overlaps(a.unchecked, answer.span) || (earlier && a.unchecked === earlier)) s.goldPointed++; }
  }
  for (const id of Object.keys(key.controls)) for (const name of checkers) {
    const a = rows.get(id).answers[name];
    perChecker[name].controls++;
    if (a.verdict === 'gap') perChecker[name].falseAlarms++;
  }
  for (const row of rows.values()) for (const name of checkers) if (row.answers[name].invalid) perChecker[name].invalid++;
  const majorityGold = Object.keys(key.gold).filter(id => rows.get(id).majority === 'gap').length;
  return { perChecker, majorityGoldCaught: majorityGold, gold: Object.keys(key.gold).length };
}

export function renderReport(batch, key, comparison, scores, shots) {
  const rows = new Map(comparison.agreement.items.map(r => [r.id, r]));
  const checkers = Object.keys(scores.perChecker);
  const out = [`# Crosscheck ${batch.case_id.slice(7, 19)}`, '',
    `Checkers: ${checkers.join(', ')}. Items: ${batch.items.length} (${Object.keys(key.real).length} real, ${scores.gold} gold, ${Object.keys(key.controls).length} controls).`,
    `Agreement: ${comparison.agreement.accepted ? 'accepted, every item has two of three' : 'not accepted'}${comparison.agreement.first_difference ? `; first difference at ${comparison.agreement.first_difference.path} (${comparison.agreement.first_difference.reason})` : ''}.`,
    '', '## Gold and controls', '', '| checker | gold caught | gold quote on the seeded words, or on the same earlier gap | controls flagged | invalid answers |', '|---|---|---|---|---|'];
  for (const [name, s] of Object.entries(scores.perChecker)) out.push(`| ${name} | ${s.goldCaught} of ${s.gold} | ${s.goldPointed} of ${s.gold} | ${s.falseAlarms} of ${s.controls} | ${s.invalid} |`);
  out.push('', `Majority caught ${scores.majorityGoldCaught} of ${scores.gold} gold items.`, '');
  for (const [id, g] of Object.entries(key.gold)) {
    const row = rows.get(id);
    out.push(`- gold ${id} (${g.mutation}, from ${g.from}), seeded words "${g.span}": ${checkers.map(n => `${n} ${row.answers[n].verdict ?? 'invalid'}${row.answers[n].unchecked ? ` "${row.answers[n].unchecked}"` : ''}`).join('; ')}`);
    const earlier = g.fromItem && checkers.filter(n => row.answers[n].unchecked && row.answers[n].unchecked === rows.get(g.fromItem)?.answers[n]?.unchecked && !overlaps(row.answers[n].unchecked, g.span));
    if (earlier?.length) out.push(`  - ${earlier.join(', ')} quoted the same earlier unchecked claim they found in the unmutated ${g.from}, which comes first in reading order.`);
  }
  out.push('', '## Real sentences', '');
  for (const shot of shots) {
    out.push(`### ${shot.id}`, '');
    for (const sentence of shot.call) {
      const id = Object.entries(key.real).find(([, v]) => v.shot === shot.id && v.sentence === sentence.id)?.[0];
      const row = rows.get(id);
      const verdict = row.majority ? (row.unanimous ? row.majority : `${row.majority}, two of three`) : 'split, to Sam';
      out.push(`- **${sentence.id}** ${verdict}. ${sentence.text}`);
      for (const n of checkers) if (row.answers[n].unchecked) out.push(`  - ${n}: unchecked "${row.answers[n].unchecked}"`);
      for (const n of checkers) if (row.answers[n].invalid) out.push(`  - ${n}: invalid answer (${row.answers[n].invalid})`);
    }
    out.push('');
  }
  return out.join('\n');
}
