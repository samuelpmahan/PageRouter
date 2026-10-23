// thro as a PxC world (kernel v0.6, vendored in ./pxc with PIN.json).
//
// Every decision that shapes what the site shows is a Contract; every alternative is an Implementation;
// the site's choices are its fill. Running 'thro.site' under the fill says what the site shows, and the
// receipt says which choice made each part and why (chosenBy: decided by a fill, or the only implementation).
// A later decision subsumes an earlier one by being chosen over it; the earlier implementation stays
// registered and provable. Sam's rule is a check contract with its own examples.
//
// The kernel decides; the DiscStudio card renderer draws whatever recipe was decided (it is async canvas
// work, and kernel runs are synchronous), so pixels stay outside the world and recipes stay inside it.
import { createWorld } from './pxc/kernel.mjs';
import { nativeCardRecipe, nativeBuild, cardRevisions, nativeStudies, lineupStudies } from './native-cards.mjs';

/** The site's decisions: the fill. Who decided each, and when, is on the implementation it names. */
export const SITE_FILL = Object.freeze({
  'thro.single.layouts': 'thro.single.layouts/one-renderer',
  'thro.bag.layouts': 'thro.bag.layouts/thro-lineups',
  'thro.battle.engine': 'thro.battle.engine/layouts-with-points',
  'thro.card.revision': 'thro.card.revision/thro-r2',
});
/** Decisions still open: a choice is in the fill so the site can run, but it is waiting on someone. */
export const OPEN = Object.freeze({
  'thro.battle.engine': 'dab: the saved-data shape for the formats model (mailbox, 17:27); then Sam picks',
  'thro.card.revision': 'Sam: visual review of revision 2 (B01 upright, U04 manufacturer below the numbers); dab: integration receipt once 8dcb656 is pushed',
});

const enumOf = (...values) => ({ type: values.every(v => typeof v === 'number') ? 'integer' : 'string', enum: values });

/** Sam's rule over one card's recorded layout (thro-adapter.mjs records it as the renderer draws). */
export function hierarchyVerdict(layout) {
  const disc = layout?.photo?.w ?? 0, name = layout?.name?.size ?? 0, numbers = layout?.numbers?.size ?? 0;
  const other = (layout?.other ?? []).reduce((best, item) => (item.size > best.size ? item : best), { size: 0, text: '' });
  const labels = (layout?.other ?? []).filter(item => /^(speed|glide|turn|fade)$/i.test(String(item.text).trim()));
  if (!(disc > name)) return { accepted: false, reason: `The disc photo (${Math.round(disc)} px) must be bigger than the mold name (${Math.round(name)} px).` };
  if (!(name > numbers)) return { accepted: false, reason: `The mold name (${Math.round(name)} px) must be bigger than the flight numbers (${Math.round(numbers)} px).` };
  if (!(numbers > other.size)) return { accepted: false, reason: `"${other.text}" (${Math.round(other.size)} px) is bigger than the flight numbers (${Math.round(numbers)} px).` };
  if (labels.length) return { accepted: false, reason: `Flight numbers carry no labels; found "${labels.map(l => l.text).join('", "')}".` };
  if (layout?.photo?.skewed) return { accepted: false, reason: 'The disc photo is squashed or skewed.' };
  const angle = layout?.photo?.angle ?? 0;
  if (Math.abs(angle) > 0.5) return { accepted: false, reason: `The disc photo is rotated ${Math.round(angle)}°; it is always drawn upright.` };
  return { accepted: true, reason: `Disc ${Math.round(disc)} > name ${Math.round(name)} > numbers ${Math.round(numbers)} > everything else ${Math.round(other.size)}.` };
}

export function createThroWorld() {
  const world = createWorld({ name: 'thro' });
  const decision = ({ id, question, out, why, alternatives }) => {
    world.contract({ id, in: {}, out, description: question, ...(why ? { notes: why } : {}) });
    for (const alt of alternatives) world.implement({ id: `${id}/${alt.id}`, implements: id, description: alt.choice, origin: alt.origin, run: () => alt.value });
  };

  // ---- Sam's rule: a check, proven by real measurements from the renderer.
  world.contract({ id: 'thro.rule', kind: 'check', in: { layout: { type: 'object' } }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    description: 'What matters most on a card?',
    notes: 'DISC IMAGE > MOLD NAME > FLIGHT NUMBERS > everything else. Flight numbers carry no labels: written like a score, 6.5 · 5 · −1 · 2. (Sam, 22 Oct)',
    examples: [
      { name: 'B01 Servo as drawn (iter-16)', in: { layout: { photo: { w: 277, skewed: false }, name: { size: 53 }, numbers: { size: 22 }, other: [{ text: 'Neutron', size: 17 }] } }, out: { accepted: true } },
      { name: 'U04 Servo as drawn: the manufacturer outranks the numbers', in: { layout: { photo: { w: 238, skewed: false }, name: { size: 57 }, numbers: { size: 22 }, other: [{ text: 'MVP', size: 25 }] } }, out: { accepted: false } },
      { name: 'a labelled flight number', in: { layout: { photo: { w: 300 }, name: { size: 60 }, numbers: { size: 30 }, other: [{ text: 'speed', size: 12 }] } }, out: { accepted: false } },
      // Measured by local/test/thro-card-revision-browser.mjs on the Servo photo, card at 66% (frame pixels).
      { name: 'B01 Servo, card revision 1: the disc is tilted 12°', in: { layout: { photo: { w: 277, angle: 12, skewed: false }, name: { size: 69 }, numbers: { size: 29 }, other: [{ text: 'Neutron', size: 22 }] } }, out: { accepted: false } },
      { name: 'B01 Servo, card revision 2: upright', in: { layout: { photo: { w: 277, angle: 0, skewed: false }, name: { size: 69 }, numbers: { size: 29 }, other: [{ text: 'Neutron', size: 22 }] } }, out: { accepted: true } },
      { name: 'U04 Servo, card revision 1: MVP (34 px) outranks the numbers (29 px)', in: { layout: { photo: { w: 238, skewed: false }, name: { size: 74 }, numbers: { size: 29 }, other: [{ text: 'MVP', size: 34 }] } }, out: { accepted: false } },
      { name: 'U04 Servo, card revision 2: MVP (20 px) below the numbers', in: { layout: { photo: { w: 238, skewed: false }, name: { size: 74 }, numbers: { size: 29 }, other: [{ text: 'MVP', size: 20 }] } }, out: { accepted: true } },
    ] });
  world.implement({ id: 'thro.rule/hierarchy', implements: 'thro.rule', description: 'Measured from the layout the card renderer records as it draws.',
    origin: { by: 'Sam', iters: [16], commits: ['131edd6'] }, run: ({ layout }) => hierarchyVerdict(layout.value) });

  // ---- What each mode offers.
  decision({ id: 'thro.single.layouts', question: 'How are Single cards composed?', out: { source: enumOf('cards', 'compositions') },
    alternatives: [
      { id: 'one-renderer', value: { source: 'cards' }, choice: 'One renderer: every Single card is a DiscStudio card, composed the same way.', origin: { by: 'Sam', iters: [15], commits: ['a3319df'] } },
      { id: 'vector-compositions', value: { source: 'compositions' }, choice: 'Studio vector compositions (placement grid, title field).', origin: { by: 'claude-ed', iters: [3, 4, 10, 14], subsumedBy: 'thro.single.layouts/one-renderer' } },
    ] });
  decision({ id: 'thro.bag.layouts', question: 'What does a Bag lineup look like?', out: { source: enumOf('lineups', 'compositions') },
    alternatives: [
      { id: 'thro-lineups', value: { source: 'lineups' }, choice: 'Each disc is its exact card, side by side; no points; one disc can be featured.', origin: { by: 'Sam (no points) · claude-ed', iters: [17, 18, 20], commits: ['bc9462a', 'a6ddc8b', 'daddc1d'] } },
      { id: 'vector-compositions', value: { source: 'compositions' }, choice: 'Studio lineup compositions with "UP NOW · 0 PTS".', origin: { by: 'claude-ed', iters: [10, 14], subsumedBy: 'thro.bag.layouts/thro-lineups' } },
    ] });
  decision({ id: 'thro.battle.engine', question: 'How does Battle work?', out: { engine: enumOf('layouts', 'formats') },
    why: 'Sam, 22 Oct: Battle gets its own editor; generalize it; "one of the few places where Object Orientation works perfectly"; compare(a, b) → int.',
    alternatives: [
      { id: 'layouts-with-points', value: { engine: 'layouts' }, choice: 'Studio battle layouts with a points field per disc.', origin: { by: 'claude-ed', iters: [10, 14] } },
      { id: 'formats', value: { engine: 'formats' }, choice: 'One model: entries × holes; each format (Round, Closest to the pin, Skins) is a class with compare(a, b) → int.', origin: { by: 'Sam · claude-ed', iters: [21, 22], commits: ['ce81a93', '76e98a8', '6f768e4'] } },
    ] });
  decision({ id: 'thro.card.revision', question: 'Which revision of the card drawing?', out: { revision: enumOf(1, 2) },
    why: 'B01 tilts the disc 12° and U04 draws the manufacturer bigger than the flight numbers; revision 2 fixes both (dab assigned, claude-a9). The revision decided here is what new B01 and U04 cards draw; a saved card keeps its own until "Use the fixed card" is chosen in the card editor.',
    alternatives: [
      { id: 'discstudio-6.6.1', value: { revision: 1 }, choice: 'The pinned DiscStudio 6.6.1 cards, byte-identical.', origin: { by: 'dab · claude-ed', iters: [15, 16], commits: ['a3319df', '131edd6'] } },
      { id: 'thro-r2', value: { revision: 2 }, choice: 'Card revision 2 for B01 and U04: the disc upright, the manufacturer below the flight numbers. The other nine layouts draw exactly as 6.6.1.', origin: { by: 'dab (assigned) · claude-a9', commits: ['8dcb656'] } },
    ] });

  // ---- A card: what exactly it draws. The implementation is the same function the renderer's request is built from
  // (native-cards.mjs nativeCardRecipe), so the world and the pixels cannot drift apart. The photo enters by its SHA-256.
  const servo = { disc: { id: 'sample-servo', mold: 'mvp--servo', plastic: 'Neutron', weight: null },
    facts: { name: 'Servo', manufacturer: 'MVP', speed: 6.5, glide: 5, turn: -1, fade: 2 }, photo: 'b720aca1a38562e5ccba1e1ea5f82d4429d790fde1a983fad2b773b7b0c5ef2e' };
  const servoFacts = { id: 'sample-servo', mold: 'mvp--servo', name: 'Servo', manufacturer: 'MVP', plastic: 'Neutron', weight: null };
  world.contract({ id: 'thro.card.recipe', description: 'What exactly does this card draw?',
    notes: 'Disc facts + design + the prepared photo\'s SHA-256 → the recipe the DiscStudio renderer draws. Same recipe, same pixels.',
    in: { disc: { type: 'object' }, facts: { type: 'object' }, design: { type: 'object' }, photo: { type: 'string' } }, out: { recipe: { type: 'object' } },
    examples: [
      { name: 'B01 Servo, fixed drawing (revision 2), defaults', in: { ...servo, design: { study: 'discstudio:b01', rendererBuild: nativeBuild, nativeRevision: 2, accent: '#c8f23d' } },
        out: { recipe: { disc: servoFacts, flights: [6.5, 5, -1, 2], preset: 'b01', placement: 'panel-default', scale: 0.66, appearance: { discSide: 'right', highlightTarget: 'digits', accentColor: '#c8f23d' }, revision: 2, photo: servo.photo } } },
      { name: 'U04 Servo saved before the fix: no revision, solid plate, nudged', in: { ...servo, design: { study: 'discstudio:u04', rendererBuild: nativeBuild, accent: '#a6edda', nativePlate: 'solid', nativeNudge: { x: 40, y: -20 }, nativeScale: 0.8 } },
        out: { recipe: { disc: servoFacts, flights: [6.5, 5, -1, 2], preset: 'u04', placement: 'panel-default', scale: 0.8, appearance: { discSide: 'left', highlightTarget: 'tiles', accentColor: '#a6edda', plate: 'solid' }, nudge: { x: 40, y: -20 }, photo: servo.photo } } },
    ] });
  world.implement({ id: 'thro.card.recipe/discstudio', implements: 'thro.card.recipe', description: 'native-cards.mjs nativeCardRecipe: the function the renderer\'s request is built from.',
    origin: { by: 'claude-ed (rung 3)', iters: [28] },
    run: ({ disc, facts, design, photo }) => ({ recipe: { ...nativeCardRecipe({ disc: disc.value, resolved: facts.value, design: design.value }), photo: photo.value } }) });

  // ---- The site: one composition; each step is a decision, named by the part of the site it shapes.
  world.contract({ id: 'thro.site', in: {}, description: 'What the site shows.',
    out: { single: { type: 'string' }, bag: { type: 'string' }, battle: { type: 'string' }, revision: { type: 'integer' } } });
  world.compose({ id: 'thro.site/thro', implements: 'thro.site',
    steps: [
      { name: 'single', call: 'thro.single.layouts', slot: 'single', bind: {} },
      { name: 'bag', call: 'thro.bag.layouts', slot: 'bag', bind: {} },
      { name: 'battle', call: 'thro.battle.engine', slot: 'battle', bind: {} },
      { name: 'card', call: 'thro.card.revision', slot: 'card', bind: {} },
    ],
    returns: { single: 'single.source', bag: 'bag.source', battle: 'battle.engine', revision: 'card.revision' } });
  // ---- A lineup (Bag): one thro.card.recipe per disc, so each disc is its own Part, gathered with the lineup's own settings.
  // The plan (which design each disc gets, which disc is featured) comes from native-cards.mjs nativeLineupPlan, as the renderer's does.
  const slots = [0, 1, 2, 3, 4].map(i => `thro.card.recipe#card${i}`);
  world.contract({ id: 'thro.lineup.recipe', description: 'What exactly does this lineup draw?',
    notes: 'Each disc is its own card recipe; the lineup is their composition with its layout and its featured disc.',
    in: { preset: { type: 'string' }, featured: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, cards: { type: 'array', minItems: 2, maxItems: 5 } }, out: { recipe: { type: 'object' } } });
  world.implement({ id: 'thro.lineup.recipe/cards', implements: 'thro.lineup.recipe', uses: slots, description: 'One card recipe per disc, gathered.',
    origin: { by: 'claude-ed (rung 3)', iters: [29] },
    run: ({ preset, featured, cards }, ctx) => {
      const recipes = cards.value.map((_, i) => ctx.call('thro.card.recipe', { disc: ctx.at(cards, i, 'disc'), facts: ctx.at(cards, i, 'facts'), design: ctx.at(cards, i, 'design'), photo: ctx.at(cards, i, 'photo') }, { slot: `card${i}` }).recipe);
      return { recipe: ctx.gather({ preset, featured, cards: recipes.map(r => ({ disc: ctx.at(r, 'disc'), flights: ctx.at(r, 'flights'), appearance: ctx.at(r, 'appearance'), photo: ctx.at(r, 'photo') })) }) };
    } });
  // Sam's rule on every card the lineup drew (the renderer measures each one).
  world.contract({ id: 'thro.lineup.rule', kind: 'check', description: 'Does every card in the lineup keep the rule?',
    in: { layouts: { type: 'array', minItems: 2, maxItems: 5 } }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } } });
  world.implement({ id: 'thro.lineup.rule/every-card', implements: 'thro.lineup.rule', uses: [0, 1, 2, 3, 4].map(i => `thro.rule#card${i}`), description: 'thro.rule on each card.',
    run: ({ layouts }, ctx) => {
      const verdicts = layouts.value.map((_, i) => ctx.call('thro.rule', { layout: ctx.at(layouts, i) }, { slot: `card${i}` }));
      const failing = verdicts.map((v, i) => [i, v]).filter(([, v]) => !v.accepted.value);
      return { accepted: !failing.length, reason: failing.length ? failing.map(([i, v]) => `Card ${i + 1}: ${v.reason.value}`).join(' ') : `All ${verdicts.length} cards keep the rule.` };
    } });

  // ---- The screen: one run from the site's decisions down to the card on screen and Sam's rule on it.
  // The layout is what the renderer measured while drawing that recipe, so the rule judges the actual card.
  world.contract({ id: 'thro.screen', description: 'What is on screen, and does it keep the rule?',
    in: { disc: { type: 'object' }, facts: { type: 'object' }, design: { type: 'object' }, photo: { type: 'string' }, layout: { type: 'object' } },
    out: { single: { type: 'string' }, bag: { type: 'string' }, battle: { type: 'string' }, revision: { type: 'integer' }, recipe: { type: 'object' }, accepted: { type: 'boolean' }, reason: { type: 'string' } } });
  world.compose({ id: 'thro.screen/thro', implements: 'thro.screen',
    steps: [
      { name: 'site', call: 'thro.site', bind: {} },
      { name: 'card', call: 'thro.card.recipe', bind: { disc: '$in.disc', facts: '$in.facts', design: '$in.design', photo: '$in.photo' } },
      { name: 'rule', call: 'thro.rule', bind: { layout: '$in.layout' } },
    ],
    returns: { single: 'site.single', bag: 'site.bag', battle: 'site.battle', revision: 'site.revision', recipe: 'card.recipe', accepted: 'rule.accepted', reason: 'rule.reason' } });
  world.contract({ id: 'thro.screen.lineup', description: 'What is on screen (a lineup), and does every card keep the rule?',
    in: { preset: { type: 'string' }, featured: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, cards: { type: 'array' }, layouts: { type: 'array' } },
    out: { single: { type: 'string' }, bag: { type: 'string' }, battle: { type: 'string' }, revision: { type: 'integer' }, recipe: { type: 'object' }, accepted: { type: 'boolean' }, reason: { type: 'string' } } });
  world.compose({ id: 'thro.screen.lineup/thro', implements: 'thro.screen.lineup',
    steps: [
      { name: 'site', call: 'thro.site', bind: {} },
      { name: 'lineup', call: 'thro.lineup.recipe', bind: { preset: '$in.preset', featured: '$in.featured', cards: '$in.cards' } },
      { name: 'rule', call: 'thro.lineup.rule', bind: { layouts: '$in.layouts' } },
    ],
    returns: { single: 'site.single', bag: 'site.bag', battle: 'site.battle', revision: 'site.revision', recipe: 'lineup.recipe', accepted: 'rule.accepted', reason: 'rule.reason' } });
  return world;
}

/** Run the screen: the site under the fill, the card on screen, and the rule on its measured layout. */
export function screen(world, inputs, fill = SITE_FILL) {
  const { outputs, receipt } = world.run(inputs.cards ? 'thro.screen.lineup' : 'thro.screen', inputs, { fill: { ...fill }, landing: 'none' });
  return { outputs, receipt, recipeHash: receipt.outputs.recipe }; // the receipt names every output by its Part hash
}

/** Run the site under a fill. Returns what it shows, the receipt, and, per decision, the choice and why. */
export function decide(world, fill = SITE_FILL) {
  const { outputs, receipt, trace } = world.run('thro.site', {}, { fill: { ...fill }, landing: 'none' });
  const choices = Object.fromEntries(trace.calls.map(node => [node.contract, { impl: node.impl, slot: node.slot, rung: node.chosenBy?.rung, key: node.chosenBy?.key }]));
  return { site: outputs, receipt, choices };
}

// ---- Reading a run (rung 4). Identity is the definition: a recipe's named features, each set by some decision.
// The Part hash is only an index for "same definition?" and a check that the bytes match; it is never shown as what a thing is.
const num = v => (v === null || v === undefined ? '–' : String(v).replace('-', '−'));
const discName = d => [d?.manufacturer, d?.name].filter(Boolean).join(' ') + (d?.plastic ? `, ${d.plastic}` : '');
const photoName = h => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? `known only by its hash (${h.slice(0, 8)}…)` : 'missing');
// A layout is named by what it is (Hero rail), not its code (B01); the code is a name by convention, like a hash.
const layoutName = (id, list) => { const study = list.find(s => s.id === id); return study ? String(study.label ?? study.name).replace(/^[A-Z0-9-]+(?: ·)? /, '') : id; };
function cardFeatures(r, prefix = '', label = '') {
  const a = r.appearance ?? {}, f = [], study = nativeStudies.find(s => s.id === `discstudio:${r.preset}`);
  // A proprium: side and highlight follow from the layout when they are its own; otherwise they were chosen.
  const add = (key, name, value, follows) => { if (value !== undefined) f.push({ key: prefix + key, label: label + name, value, ...(follows ? { follows: 'layout' } : {}) }); };
  add('disc', 'disc', discName(r.disc));
  add('flights', 'flight numbers', (r.flights ?? []).map(num).join(' · '));
  add('accent', 'accent', a.accentColor);
  add('side', 'disc side', a.discSide, study && a.discSide === study.side);
  add('highlight', 'highlight', a.highlightTarget, study && a.highlightTarget === study.highlight);
  add('plate', 'plate', a.plate);
  add('photo', 'photo', photoName(r.photo));
  return f;
}
/** A recipe's definition: its features in order, each { key, label, value }. Two recipes with the same definition are the same card. */
export function recipeDefinition(recipe) {
  if (!recipe) return [];
  if (recipe.cards) return [
    { key: 'kind', label: 'graphic', value: 'Bag lineup' },
    { key: 'layout', label: 'layout', value: layoutName(`discstudio-lineup:${recipe.preset}`, lineupStudies) },
    { key: 'discs', label: 'discs', value: recipe.cards.map(c => c.disc?.name).join(', ') },
    { key: 'featured', label: 'featured', value: recipe.featured === null || recipe.featured === undefined ? 'none' : recipe.cards[recipe.featured]?.disc?.name },
    ...recipe.cards.flatMap((c, i) => cardFeatures(c, `card${i + 1}.`, `card ${i + 1} `)),
  ];
  return [
    { key: 'kind', label: 'graphic', value: 'Single card' },
    { key: 'layout', label: 'layout', value: layoutName(`discstudio:${recipe.preset}`, nativeStudies) },
    ...cardFeatures(recipe),
    { key: 'size', label: 'size', value: recipe.scale === undefined ? undefined : `${Math.round(recipe.scale * 100)}%` },
    { key: 'position', label: 'position', value: recipe.nudge ? `${num(recipe.nudge.x)}, ${num(recipe.nudge.y)}` : 'as laid out' },
    { key: 'drawing', label: 'drawing', value: `revision ${recipe.revision ?? 1}` },
  ].filter(x => x.value !== undefined);
}
/** What changed between two definitions, feature by feature (same change on every card is said once). */
export function definitionDiff(before, after) {
  if (!before.length) return [];
  const kind = d => d.find(x => x.key === 'kind')?.value;
  if (kind(before) !== kind(after)) return [`${kind(before)} → ${kind(after)}`];
  const at = d => new Map(d.map(x => [x.key, x])), a = at(before), b = at(after), groups = new Map();
  const layoutChanged = a.get('layout')?.value !== b.get('layout')?.value, withLayout = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key), y = b.get(key);
    if (x?.value === y?.value) continue;
    if (key === 'discs' && x && y && x.value.split(', ').length === y.value.split(', ').length) continue; // each card says its own disc
    if (layoutChanged && y?.follows === 'layout' && !/^card\d+\./.test(key)) { withLayout.push(`${y.label} ${y.value}`); continue; } // came with the new layout
    const m = /^card(\d+)\.(.+)$/.exec(key), feature = m ? (x ?? y).label.replace(/^card \d+ /, '') : (x ?? y).label;
    const g = `${feature}\u0000${x?.value ?? 'none'}\u0000${y?.value ?? 'none'}`;
    if (!groups.has(g)) groups.set(g, { feature, from: x?.value ?? 'none', to: y?.value ?? 'none', cards: [] });
    if (m) groups.get(g).cards.push(Number(m[1]));
  }
  // A photo has no definition yet, only a hash: say that it changed, not two strings of hex.
  const lines = [...groups.values()].map(g => `${g.feature}${g.cards.length ? (g.cards.length > 1 ? ` (cards ${g.cards.join(', ')})` : ` (card ${g.cards[0]})`) : ''}: ${g.feature === 'photo' ? 'a different photo, known only by its hash' : `${g.from} → ${g.to}`}`);
  if (withLayout.length) lines[lines.findIndex(l => l.startsWith('layout: '))] += ` (and with it: ${withLayout.join(', ')})`;
  return lines;
}

/** What a run recomputed and what it reused, from its receipt's trace: every call beneath the root, in order. */
export function propagation(receipt) {
  const calls = [];
  const walk = node => { for (const n of node.calls ?? []) { calls.push({ contract: n.contract, slot: n.slot ?? null, impl: n.impl, cached: n.cached === true, cachedFrom: n.cachedFrom ?? null }); if (!n.cached) walk(n); } };
  const root = receipt?.trace;
  if (root?.cached) return [{ contract: root.contract, slot: null, impl: root.impl, cached: true, cachedFrom: root.cachedFrom ?? null, whole: true }]; // the whole run was asked before
  if (root) walk(root);
  return calls;
}

/** The four causes as guarantees on what is on screen (Aristotle, via Sam, 22 Oct): what it is made from, what shape it must
 * have, what made it, and what it is for. ok is true, false, or null when the world cannot say yet. */
export function guarantees(world, run) {
  const o = run.outputs, recipe = o.recipe, cards = recipe.cards ?? [recipe];
  const hashed = cards.filter(c => /^[0-9a-f]{64}$/.test(c.photo ?? '')).length;
  const proofs = world.prove('thro.card.recipe');
  const makers = propagation(run.receipt).filter(n => !n.contract.startsWith('thro.screen'));
  const madeBy = [...new Set(makers.map(n => n.impl))];
  let efficient;
  if (recipe.cards) efficient = { ok: null, what: 'The lineup renderer is handed each card without its drawing revision, so the world can\'t yet say which drawing each card in a lineup used.' };
  else if (!(recipe.preset in cardRevisions)) efficient = { ok: true, what: `Made by ${madeBy.length} implementations, each chosen by the site's fill or the only one. ${String(recipe.preset).toUpperCase()} has one drawing, so the card revision doesn't apply.` };
  else {
    const have = recipe.revision ?? 1, want = o.revision;
    efficient = have === want ? { ok: true, what: `Drawn with card revision ${have}, the one the site decided (thro.card.revision).` }
      : { ok: false, what: `Drawn with card revision ${have}; the site now draws revision ${want}. This card was saved before the fix and keeps its drawing until you choose.` };
  }
  return [
    { cause: 'material', question: 'What is it made from?', ok: hashed === cards.length,
      what: `${cards.map(c => discName(c.disc)).join('; ')}: the disc facts, plus ${cards.length === 1 ? 'the prepared photo' : `${cards.length} prepared photos`}, each known only by its hash for now.` },
    { cause: 'formal', question: 'What shape must it have?', ok: proofs.length > 0 && proofs.every(p => p.ok),
      what: `The recipe has the shape thro.card.recipe declares; its ${proofs.length} examples prove the implementation (${proofs.filter(p => p.ok).length}/${proofs.length}).` },
    { cause: 'efficient', question: 'What made it, and is that what the site decided?', ...efficient },
    finalCause(run),
  ];
}

// ---- The final cause, demonstrated (Sam, 22 Oct: '"I followed the rule" is a copout. This is for… It does… Thus… QED').
// The purpose is the major premise; the rule is not the reason, it is the purpose applied through one premise about reading.
export const PURPOSE = Object.freeze({
  card: 'Someone watching a disc golf video knows at a glance which disc is being thrown and how it flies.',
  lineup: 'Someone watching compares these discs side by side, reading each one the same way.',
  reading: 'The eye reads a graphic biggest first, so the order of sizes is the order of reading. A disc is recognised by its face, upright, and a flight number needs no label to be read as one. (True for the most part, as design rules are: break it only where the card still does its job and you can say why.)',
});
const px = v => `${Math.round(v ?? 0)} px`;
function readingOf(layout, name, flights) {
  const other = (layout?.other ?? []).reduce((best, item) => (item.size > best.size ? item : best), { size: 0, text: '' });
  return { angle: layout?.photo?.angle ?? 0, skewed: Boolean(layout?.photo?.skewed), labels: (layout?.other ?? []).filter(item => /^(speed|glide|turn|fade)$/i.test(String(item.text).trim())).map(item => item.text), disc: layout?.photo?.w ?? 0, name: layout?.name?.size ?? 0, numbers: layout?.numbers?.size ?? 0, other, nameText: name, numbersText: (flights ?? []).map(num).join(' · ') };
}
// What a viewer reads out of order, as a consequence for the purpose (null when the sizes keep the reading order).
function misread(r) {
  if (!(r.disc > r.name)) return `the name ${r.nameText} (${px(r.name)}) is read before the disc (${px(r.disc)}), so the viewer reads a word before seeing which disc it is.`;
  if (!(r.name > r.numbers)) return `the numbers (${px(r.numbers)}) are read before the name ${r.nameText} (${px(r.name)}), so how it flies comes before which disc it is.`;
  if (r.labels.length) return `the numbers carry labels ("${r.labels.join('", "')}"), so the viewer reads words where a glance should do.`;
  if (r.skewed) return 'the disc photo is squashed, so the face a viewer recognises a disc by is distorted.';
  if (Math.abs(r.angle) > 0.5) return `the disc is turned ${Math.round(r.angle)}°, so the face a viewer recognises it by is not upright.`;
  if (!(r.numbers > r.other.size)) return `"${r.other.text}" (${px(r.other.size)}) is read before the flight numbers (${px(r.numbers)}), so the viewer gets "${r.other.text}" before how the disc flies.`;
  return null;
}
function finalCause(run) {
  const o = run.outputs, recipe = o.recipe, inputs = run.receipt.inputValues ?? {};
  const cards = recipe.cards ?? [recipe], layouts = recipe.cards ? inputs.layouts ?? [] : [inputs.layout];
  const reads = cards.map((c, i) => readingOf(layouts[i], c.disc?.name, c.flights));
  const sizes = r => `disc photo ${px(r.disc)}, the name ${r.nameText} ${px(r.name)}, the numbers ${r.numbersText} ${px(r.numbers)}, the largest other text${r.other.text ? ` ("${r.other.text}")` : ''} ${px(r.other.size)}`;
  const does = recipe.cards ? `Card by card: ${reads.map((r, i) => `${i + 1}. ${r.nameText}: ${sizes(r)}`).join('; ')}.` : `On this card: ${sizes(reads[0])}.`;
  const order = r => `the disc, then ${r.nameText}, then ${r.numbersText}, and only then anything else`;
  const thus = o.accepted
    ? (recipe.cards ? `Every card is read in the same order (${reads.map(order).join('; ')}), so like is compared with like.` : `A viewer sees ${order(reads[0])}: the order the purpose needs.`)
    : `Not served. ${reads.map((r, i) => { const why = misread(r); return why ? `${recipe.cards ? `Card ${i + 1}: ` : ''}${why}` : ''; }).filter(Boolean).join(' ') || o.reason}`;
  const demonstration = { for: recipe.cards ? PURPOSE.lineup : PURPOSE.card, because: PURPOSE.reading, does, thus };
  return { cause: 'final', question: 'What is it for, and does it do it?', ok: o.accepted, demonstration,
    what: `This is for: ${demonstration.for} Because: ${demonstration.because} It does: ${demonstration.does} Thus: ${demonstration.thus}${o.accepted ? ' QED.' : ''}` };
}
