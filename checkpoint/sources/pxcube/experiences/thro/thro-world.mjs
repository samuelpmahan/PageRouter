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
import { nativeCardRecipe, nativeBuild, cardRevisions, cardParts, nativeStudies, lineupStudies, accentName } from './native-cards.mjs';

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
    notes: 'DISC IMAGE > MOLD NAME > FLIGHT NUMBERS > everything else. Flight numbers carry no labels: written like a score, 6.5 · 5 · −1 · 2. (Sam, 22 Oct.) A working scaffold, not a law of design: it keeps agent-made cards consistent and makes agents drop what does not matter. It binds agents; on a person\'s own card it is a reference line they can overrule. (Sam, 22 Oct, 23:31)',
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

  // ---- The material guarantee as a check: the bytes drawn are the bytes the photo's definition names.
  // A photo is defined by which disc it shows, its source file and its preparation; the SHA-256 is only how the bytes are checked.
  const servoPhoto = { disc: 'sample-servo', of: 'MVP Servo, Neutron', source: 'servo.jpg', prepared: 'assets/discs/sample-servo.webp', size: '1013 × 1013', preparation: 'ellipse refit (version 2), turned 3°', build: 'a9ba3f6b86f5fb1e', sha256: servo.photo };
  world.contract({ id: 'thro.photo.material', kind: 'check', description: 'Is each photo drawn the one its definition names?',
    notes: 'The recipe carries the prepared bytes\' SHA-256; the definition says which photo that should be. Same bytes: the photo is what it says it is.',
    in: { photos: { type: 'array' }, recipe: { type: 'object' } }, out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    examples: [
      { name: 'the Servo card drawn from the Servo photo', in: { photos: [servoPhoto], recipe: { photo: servo.photo } }, out: { accepted: true } },
      { name: 'the Servo card drawn from other bytes', in: { photos: [servoPhoto], recipe: { photo: 'd1d03b92'.padEnd(64, '0') } }, out: { accepted: false } },
      { name: 'a photo with no definition yet', in: { photos: [null], recipe: { photo: servo.photo } }, out: { accepted: false } },
    ] });
  world.implement({ id: 'thro.photo.material/sha256', implements: 'thro.photo.material', description: 'Compare the bytes drawn with the bytes each definition names, by SHA-256.',
    origin: { by: 'claude-ed (rung 5)', iters: [33] },
    run: ({ photos, recipe }) => {
      const cards = recipe.value.cards ?? [recipe.value], defs = photos.value, lineup = Boolean(recipe.value.cards);
      const problems = cards.map((card, i) => {
        const def = defs[i], at = lineup ? `Card ${i + 1}: ` : '';
        if (!def) return `${at}this photo has no definition yet; only its bytes are known.`;
        if (def.sha256 !== card.photo) return `${at}the bytes drawn are not ${photoWords(def)}.`;
        return null;
      }).filter(Boolean);
      return problems.length ? { accepted: false, reason: problems.join(' ') }
        : { accepted: true, reason: `${cards.length === 1 ? 'The photo drawn is' : 'Each photo drawn is'} the one its definition names: ${defs.slice(0, cards.length).map(photoWords).join('; ')}.` };
    } });

  // ---- The person's reading order (rung 6): swapping two parts is a capability, so a handle on the card and a script invoke the same
  // thing and get the same order (Capability Lab's question: can a UI and a script consume the same capability?). null = the scaffold.
  const parts = ['disc', 'name', 'numbers', 'other'];
  world.contract({ id: 'thro.reading.order', description: 'Which part of a card does this person mean to be read first, second, third, fourth?',
    notes: 'Swap two parts of the order. Starts from Sam\'s scaffold when the person has not set one. The scaffold itself is unchanged: it still checks agent-made cards.',
    in: { order: { oneOf: [{ type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', enum: parts } }, { type: 'null' }] }, swap: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', enum: parts } } },
    out: { order: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', enum: parts } } },
    examples: [
      { name: 'the name onto the disc, from the scaffold', in: { order: null, swap: ['name', 'disc'] }, out: { order: ['name', 'disc', 'numbers', 'other'] } },
      { name: 'everything else above the numbers', in: { order: ['disc', 'name', 'numbers', 'other'], swap: ['other', 'numbers'] }, out: { order: ['disc', 'name', 'other', 'numbers'] } },
      { name: 'swapping back restores the scaffold', in: { order: ['name', 'disc', 'numbers', 'other'], swap: ['disc', 'name'] }, out: { order: ['disc', 'name', 'numbers', 'other'] } },
    ] });
  world.implement({ id: 'thro.reading.order/swap', implements: 'thro.reading.order', description: 'Exchange the two parts\' places.', origin: { by: 'Sam (handles) · claude-ed (rung 6)', iters: [34] },
    run: ({ order, swap }) => {
      const next = [...(order.value ?? parts)], [a, b] = swap.value, i = next.indexOf(a), j = next.indexOf(b);
      if (i < 0 || j < 0 || new Set(next).size !== parts.length) throw Error('An order names each of disc, name, numbers and everything else once.');
      [next[i], next[j]] = [next[j], next[i]];
      return { order: next };
    } });

  // ---- Every way this disc could be a card (rung 8): each Single layout is an implementation of one contract, so world.sum runs
  // them all and records the provenance polynomial (kernel seq 62); ways.mjs evaluates it in the Lab's semirings. A layout's
  // measurements come from the thumbnail the renderer already drew; a layout with none is a missing term, not a guess.
  world.contract({ id: 'thro.card.way', description: 'Does this layout keep the order, and how comfortably?',
    notes: 'One implementation per Single layout: another way to draw this disc as a card.',
    in: { layouts: { type: 'object' }, disc: { type: 'object' }, intended: { type: 'array', minItems: 4, maxItems: 4 } },
    out: { keeps: { type: 'boolean' }, margin: { type: 'number' }, quiet: { type: 'number' } } });
  for (const study of nativeStudies) world.implement({ id: `thro.card.way/${study.id.replace('discstudio:', '')}`, implements: 'thro.card.way',
    description: String(study.label ?? study.id), origin: { by: 'claude-ed (rung 8)', iters: [36] },
    run: ({ layouts, disc, intended }) => {
      const layout = layouts.value[study.id];
      if (!layout) throw Error(`${study.id} has not been measured for this disc`);
      const reading = readingOf(layout, disc.value.name, disc.value.flights), fit = orderFit(reading, intended.value);
      return { keeps: fit.keeps, margin: fit.margin, quiet: Math.round(reading.other.size * 10) / 10 };
    } });

  // ---- Every way this lineup could be (rung 10): each lineup layout is an implementation (the ways, +); within a way, every card
  // has to keep the order (the cards, ×). The cards' factors are reported per card so ways.mjs can write them into the polynomial.
  world.contract({ id: 'thro.lineup.way', description: 'Does every card in this lineup layout keep the order, and how comfortably?',
    notes: 'One implementation per lineup layout; the lineup is the product of its cards.',
    in: { layouts: { type: 'object' }, cards: { type: 'array', minItems: 2, maxItems: 5 }, intended: { type: 'array', minItems: 4, maxItems: 4 } },
    out: { fits: { type: 'array' } } });
  for (const study of lineupStudies) world.implement({ id: `thro.lineup.way/${study.preset}`, implements: 'thro.lineup.way',
    description: String(study.name), origin: { by: 'claude-ed (rung 10)', iters: [38] },
    run: ({ layouts, cards, intended }) => {
      const drawn = layouts.value[study.id];
      if (!Array.isArray(drawn) || drawn.length !== cards.value.length) throw Error(`${study.id} has not been measured for these ${cards.value.length} discs`);
      return { fits: cards.value.map((card, i) => { const r = readingOf(drawn[i], card.name, card.flights), fit = orderFit(r, intended.value); return { keeps: fit.keeps, margin: fit.margin, quiet: Math.round(r.other.size * 10) / 10 }; }) };
    } });

  // ---- The screen: one run from the site's decisions down to the card on screen and Sam's rule on it.
  // The layout is what the renderer measured while drawing that recipe, so the rule judges the actual card.
  world.contract({ id: 'thro.screen', description: 'What is on screen, and does it keep the rule?',
    in: { disc: { type: 'object' }, facts: { type: 'object' }, design: { type: 'object' }, photo: { type: 'string' }, layout: { type: 'object' }, photos: { type: 'array' } },
    out: { single: { type: 'string' }, bag: { type: 'string' }, battle: { type: 'string' }, revision: { type: 'integer' }, recipe: { type: 'object' }, accepted: { type: 'boolean' }, reason: { type: 'string' }, material: { type: 'boolean' }, materialReason: { type: 'string' } } });
  world.compose({ id: 'thro.screen/thro', implements: 'thro.screen',
    steps: [
      { name: 'site', call: 'thro.site', bind: {} },
      { name: 'card', call: 'thro.card.recipe', bind: { disc: '$in.disc', facts: '$in.facts', design: '$in.design', photo: '$in.photo' } },
      { name: 'rule', call: 'thro.rule', bind: { layout: '$in.layout' } },
      { name: 'photos', call: 'thro.photo.material', bind: { photos: '$in.photos', recipe: 'card.recipe' } },
    ],
    returns: { single: 'site.single', bag: 'site.bag', battle: 'site.battle', revision: 'site.revision', recipe: 'card.recipe', accepted: 'rule.accepted', reason: 'rule.reason', material: 'photos.accepted', materialReason: 'photos.reason' } });
  world.contract({ id: 'thro.screen.lineup', description: 'What is on screen (a lineup), and does every card keep the rule?',
    in: { preset: { type: 'string' }, featured: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, cards: { type: 'array' }, layouts: { type: 'array' }, photos: { type: 'array' } },
    out: { single: { type: 'string' }, bag: { type: 'string' }, battle: { type: 'string' }, revision: { type: 'integer' }, recipe: { type: 'object' }, accepted: { type: 'boolean' }, reason: { type: 'string' }, material: { type: 'boolean' }, materialReason: { type: 'string' } } });
  world.compose({ id: 'thro.screen.lineup/thro', implements: 'thro.screen.lineup',
    steps: [
      { name: 'site', call: 'thro.site', bind: {} },
      { name: 'lineup', call: 'thro.lineup.recipe', bind: { preset: '$in.preset', featured: '$in.featured', cards: '$in.cards' } },
      { name: 'rule', call: 'thro.lineup.rule', bind: { layouts: '$in.layouts' } },
      { name: 'photos', call: 'thro.photo.material', bind: { photos: '$in.photos', recipe: 'lineup.recipe' } },
    ],
    returns: { single: 'site.single', bag: 'site.bag', battle: 'site.battle', revision: 'site.revision', recipe: 'lineup.recipe', accepted: 'rule.accepted', reason: 'rule.reason', material: 'photos.accepted', materialReason: 'photos.reason' } });
  return world;
}

/** Run the screen: the site under the fill, the card on screen, and the rule on its measured layout. */
export function screen(world, inputs, fill = SITE_FILL) {
  const photos = inputs.photos ?? (inputs.cards ?? [inputs]).map(() => null); // a photo with no definition says so
  const { outputs, receipt } = world.run(inputs.cards ? 'thro.screen.lineup' : 'thro.screen', { ...inputs, photos }, { fill: { ...fill }, landing: 'none' });
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
const photoName = (h, def) => (def && def.sha256 === h ? photoWords(def) : typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? `known only by its hash (${h.slice(0, 8)}…)` : 'missing');
/** How a photo is said: which disc, which source, which preparation. */
export function photoWords(def) { return `the ${def.of} photo (${def.source ?? 'source unknown'}${def.size ? `, cut to a ${def.size} disc` : ''}${def.preparation ? ` by ${def.preparation}` : ''})`; }
/** A photo's definition from its prepared record: which disc, the source photo, the preparation. The SHA-256 is kept only as the check. */
export function photoDefinition(record) {
  if (!record || !/^[0-9a-f]{64}$/.test(record.sha256 ?? '')) return null;
  const refit = record.preparation?.refit, turn = refit?.rotation ? Math.round(refit.rotation * 180 / Math.PI) : 0;
  return { disc: record.id, of: `${record.manufacturer} ${record.name}${record.plastic ? `, ${record.plastic}` : ''}`, source: record.original ?? null, prepared: record.file ?? null,
    size: record.width && record.height ? `${record.width} × ${record.height}` : null,
    preparation: refit ? `${refit.kind === 'ellipse' ? 'ellipse' : 'circle'} refit (version ${refit.version})${turn ? `, turned ${turn}°` : ''}` : null,
    build: record.preparation?.sourceBuild ?? null, sha256: record.sha256 };
}
// An accent is said by its palette name; the layout's own accent as such; anything else is a custom colour.
const accentWords = (hex, study) => accentName(hex) ?? (study && String(study.accent).toLowerCase() === String(hex).toLowerCase() ? `the layout's own (${hex})` : hex === undefined ? undefined : `custom ${hex}`);
// A layout is named by what it is (Hero rail), not its code (B01); the code is a name by convention, like a hash.
const layoutName = (id, list) => { const study = list.find(s => s.id === id); return study ? String(study.label ?? study.name).replace(/^[A-Z0-9-]+(?: ·)? /, '') : id; };
function cardFeatures(r, prefix = '', label = '', photo = null) {
  const a = r.appearance ?? {}, f = [], study = nativeStudies.find(s => s.id === `discstudio:${r.preset}`);
  // A proprium: side and highlight follow from the layout when they are its own; otherwise they were chosen.
  const add = (key, name, value, follows, picture) => { if (value !== undefined) f.push({ key: prefix + key, label: label + name, value, ...(follows ? { follows: 'layout' } : {}), ...(picture ? { picture } : {}) }); };
  add('disc', 'disc', discName(r.disc), false, { disc: r.disc?.id });
  add('flights', 'flight numbers', (r.flights ?? []).map(num).join(' · '));
  add('accent', 'accent', accentWords(a.accentColor, study), false, a.accentColor ? { color: a.accentColor } : null);
  add('side', 'disc side', a.discSide, study && a.discSide === study.side);
  add('highlight', 'highlight', a.highlightTarget, study && a.highlightTarget === study.highlight);
  add('plate', 'plate', a.plate);
  add('photo', 'photo', photoName(r.photo, photo), false, { disc: r.disc?.id });
  return f;
}
/** A recipe's definition: its features in order, each { key, label, value }. Two recipes with the same definition are the same card. */
const PART_NAMES = { plateW: ['plate width', 'px'], discD: ['disc size', 'px'], discOX: ['disc overhang', ''], discOY: ['disc lift', ''], peakAt: ['peak along the plate', ''],
  arcRise: ['arc rise', 'px'], tile: ['number tile', 'px'], coinD: ['zoom circle', 'px'], nameMax: ['largest name size', 'px'] };
// B05's disc hangs below the plate's top edge, so its offset reads as a drop.
const partName = (preset, k) => (preset === 'b05' && k === 'discOY' ? 'disc drop' : PART_NAMES[k][0]);
export function recipeDefinition(recipe, photos = []) {
  if (!recipe) return [];
  if (recipe.cards) return [
    { key: 'kind', label: 'graphic', value: 'Bag lineup' },
    { key: 'layout', label: 'layout', value: layoutName(`discstudio-lineup:${recipe.preset}`, lineupStudies), picture: { study: `discstudio-lineup:${recipe.preset}` } },
    { key: 'discs', label: 'discs', value: recipe.cards.map(c => c.disc?.name).join(', ') },
    { key: 'featured', label: 'featured', value: recipe.featured === null || recipe.featured === undefined ? 'none' : recipe.cards[recipe.featured]?.disc?.name },
    ...recipe.cards.flatMap((c, i) => cardFeatures(c, `card${i + 1}.`, `card ${i + 1} `, photos[i])),
  ];
  return [
    { key: 'kind', label: 'graphic', value: 'Single card' },
    { key: 'layout', label: 'layout', value: layoutName(`discstudio:${recipe.preset}`, nativeStudies), picture: { study: `discstudio:${recipe.preset}` } },
    ...cardFeatures(recipe, '', '', photos[0]),
    { key: 'size', label: 'size', value: recipe.scale === undefined ? undefined : `${Math.round(recipe.scale * 100)}%` },
    { key: 'position', label: 'position', value: recipe.nudge ? `${num(recipe.nudge.x)}, ${num(recipe.nudge.y)}` : 'as laid out' },
    { key: 'drawing', label: 'drawing', value: `revision ${recipe.revision ?? 1}` },
    // Parts pinned with the card's handles (card-parts.mjs); a part not pinned follows the rules.
    ...(recipe.parts ? Object.keys(cardParts[recipe.preset] ?? {}).map(k => [k, partName(recipe.preset, k), PART_NAMES[k][1]]).map(([k, label, unit]) => ({ key: `part.${k}`, label,
      value: Object.hasOwn(recipe.parts, k) ? `${unit ? Math.round(recipe.parts[k]) + ' ' + unit : recipe.parts[k].toFixed(2)} pinned` : 'by the rules' })) : []),
  ].filter(x => x.value !== undefined);
}
/** What changed between two definitions, feature by feature (same change on every card is said once). */
/** What changed between two definitions, as structured changes: { feature, cards, from, to, fromPicture, toPicture, with, line }.
 * The same change on every card is one change; what came with a new layout is said with the layout. Pictures are what the change is
 * of (a colour, a layout, a disc), so a page can show it without words. */
export function definitionChanges(before, after) {
  if (!before.length) return [];
  const kind = d => d.find(x => x.key === 'kind')?.value;
  if (kind(before) !== kind(after)) return [{ feature: 'graphic', cards: [], from: kind(before), to: kind(after), with: [], line: `${kind(before)} → ${kind(after)}` }];
  const at = d => new Map(d.map(x => [x.key, x])), a = at(before), b = at(after), groups = new Map();
  const layoutChanged = a.get('layout')?.value !== b.get('layout')?.value, withLayout = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key), y = b.get(key);
    if (x?.value === y?.value) continue;
    if (key.startsWith('part.') && (x?.value ?? 'by the rules') === (y?.value ?? 'by the rules')) continue; // a part that follows the rules either way
    if (key === 'discs' && x && y && x.value.split(', ').length === y.value.split(', ').length) continue; // each card says its own disc
    if (layoutChanged && y?.follows === 'layout' && !/^card\d+\./.test(key)) { withLayout.push(`${y.label} ${y.value}`); continue; } // came with the new layout
    const m = /^card(\d+)\.(.+)$/.exec(key), feature = m ? (x ?? y).label.replace(/^card \d+ /, '') : (x ?? y).label;
    const g = `${feature}\u0000${x?.value ?? 'none'}\u0000${y?.value ?? 'none'}`;
    if (!groups.has(g)) groups.set(g, { feature, from: x?.value ?? 'none', to: y?.value ?? 'none', fromPicture: x?.picture ?? null, toPicture: y?.picture ?? null, cards: [], with: [] });
    if (m) groups.get(g).cards.push(Number(m[1]));
  }
  const changes = [...groups.values()];
  if (withLayout.length) changes.find(c => c.feature === 'layout').with = withLayout;
  for (const c of changes) {
    const where = c.cards.length ? (c.cards.length > 1 ? ` (cards ${c.cards.join(', ')})` : ` (card ${c.cards[0]})`) : '';
    // A photo with no definition is known only by its hash: say that it changed, not two strings of hex.
    const what = c.feature === 'photo' && /known only by its hash/.test(c.to) ? 'a different photo, known only by its hash' : `${c.from} → ${c.to}`;
    c.line = `${c.feature}${where}: ${what}${c.with.length ? ` (and with it: ${c.with.join(', ')})` : ''}`;
  }
  return changes;
}
/** What changed between two definitions, one line per change. */
export function definitionDiff(before, after) { return definitionChanges(before, after).map(c => c.line); }

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
export function guarantees(world, run, viewer = {}) {
  const o = run.outputs, recipe = o.recipe, cards = recipe.cards ?? [recipe];
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
    // Checked in the world (thro.photo.material): unknown, not failed, when a photo has no definition yet.
    { cause: 'material', question: 'What is it made from?', ok: (run.receipt.inputValues?.photos ?? []).slice(0, cards.length).some(p => !p) ? null : o.material,
      what: `The disc facts for ${cards.map(c => discName(c.disc)).join('; ')}, and ${o.materialReason.charAt(0).toLowerCase()}${o.materialReason.slice(1)}` },
    { cause: 'formal', question: 'What shape must it have?', ok: proofs.length > 0 && proofs.every(p => p.ok),
      what: `The recipe has the shape thro.card.recipe declares; its ${proofs.length} examples prove the implementation (${proofs.filter(p => p.ok).length}/${proofs.length}).` },
    { cause: 'efficient', question: 'What made it, and is that what the site decided?', ...efficient },
    finalCause(run, viewer),
  ];
}

// ---- The final cause, demonstrated (Sam, 22 Oct: '"I followed the rule" is a copout. This is for… It does… Thus… QED').
// The purpose is the major premise; the rule is not the reason, it is the purpose applied through one premise about reading.
export const PURPOSE = Object.freeze({
  card: 'Someone watching a disc golf video knows at a glance which disc is being thrown and how it flies.',
  lineup: 'Someone watching compares these discs side by side, reading each one the same way.',
  reading: 'Bigger usually reads first, a disc is recognised by its face upright, and a flight number needs no label. A rule of thumb about reading, not a law.',
  // What the rule is for, and whom it binds (Sam, 22 Oct, 23:31): a pragmatic scaffold, kept visible as one so it never hardens into what must be.
  scaffold: 'Sam\'s order (disc image, mold name, flight numbers, everything else) is a working scaffold: it keeps agent-made cards consistent and makes agents drop what does not matter. It binds agents. A card can break it and still serve its purpose.',
});
const px = v => `${Math.round(v ?? 0)} px`;
export function readingOf(layout, name, flights) {
  const other = (layout?.other ?? []).reduce((best, item) => (item.size > best.size ? item : best), { size: 0, text: '' });
  return { angle: layout?.photo?.angle ?? 0, skewed: Boolean(layout?.photo?.skewed), labels: (layout?.other ?? []).filter(item => /^(speed|glide|turn|fade)$/i.test(String(item.text).trim())).map(item => item.text), disc: layout?.photo?.w ?? 0, name: layout?.name?.size ?? 0, numbers: layout?.numbers?.size ?? 0, other, nameText: name, numbersText: (flights ?? []).map(num).join(' · ') };
}
// The parts of a card in Sam's scaffold order. A viewer may set their own order; the measured order is a plain fact either way.
export const PARTS = Object.freeze(['disc', 'name', 'numbers', 'other']);
const measure = (r, part) => (part === 'disc' ? r.disc : part === 'other' ? r.other.size : r[part]);
const say = (r, part) => (part === 'disc' ? 'the disc' : part === 'name' ? `the name ${r.nameText}` : part === 'numbers' ? `the numbers ${r.numbersText}` : r.other.text ? `"${r.other.text}"` : 'everything else');
const gives = (r, part) => (part === 'disc' ? 'which disc it is' : part === 'name' ? `the name ${r.nameText}` : part === 'numbers' ? 'how it flies' : r.other.text ? `"${r.other.text}"` : 'everything else');
/** The order a card is actually read in: its parts by measured size, biggest first (ties keep the scaffold order). */
export function measuredOrder(r) { return [...PARTS].sort((a, b) => measure(r, b) - measure(r, a) || PARTS.indexOf(a) - PARTS.indexOf(b)); }
// What a viewer reads out of the intended order, as a consequence for the purpose (null when the card keeps it).
function misread(r, intended = PARTS) {
  for (let i = 0; i + 1 < intended.length; i++) {
    const a = intended[i], b = intended[i + 1];
    if (!(measure(r, a) > measure(r, b))) return `${say(r, b)} (${px(measure(r, b))}) is read before ${say(r, a)} (${px(measure(r, a))}), so the viewer gets ${gives(r, b)} before ${gives(r, a)}.`;
  }
  if (r.labels.length) return `the numbers carry labels ("${r.labels.join('", "')}"), so the viewer reads words where a glance should do.`;
  if (r.skewed) return 'the disc photo is squashed, so the face a viewer recognises a disc by is distorted.';
  if (Math.abs(r.angle) > 0.5) return `the disc is turned ${Math.round(r.angle)}°, so the face a viewer recognises it by is not upright.`;
  return null;
}
/** Does a card keep this order, and how comfortably? margin = the smallest size ratio between neighbours in the order
 * (1.25 means every part is at least 25% bigger than the next); 0 when the card does not keep it. */
export function orderFit(r, intended = PARTS) {
  const keeps = misread(r, intended) === null;
  const margin = keeps ? Math.min(...intended.slice(0, -1).map((a, i) => measure(r, a) / Math.max(1e-9, measure(r, intended[i + 1])))) : 0;
  return { keeps, margin };
}
const partWords = order => order.map(p => ({ disc: 'disc', name: 'name', numbers: 'numbers', other: 'everything else' })[p]).join(', ');
/** viewer: { order, purpose: { card, lineup } }, set by the person on the page; absent means the site's purpose and Sam's scaffold order. */
function finalCause(run, viewer = {}) {
  const o = run.outputs, recipe = o.recipe, inputs = run.receipt.inputValues ?? {};
  const cards = recipe.cards ?? [recipe], layouts = recipe.cards ? inputs.layouts ?? [] : [inputs.layout];
  const reads = cards.map((c, i) => readingOf(layouts[i], c.disc?.name, c.flights));
  const intended = Array.isArray(viewer.order) && viewer.order.length === PARTS.length && PARTS.every(p => viewer.order.includes(p)) ? viewer.order : PARTS;
  const own = intended.join() !== PARTS.join();
  const sizes = r => `disc photo ${px(r.disc)}, the name ${r.nameText} ${px(r.name)}, the numbers ${r.numbersText} ${px(r.numbers)}, the largest other text${r.other.text ? ` ("${r.other.text}")` : ''} ${px(r.other.size)}; read as ${partWords(measuredOrder(r))}`;
  const does = recipe.cards ? `Card by card: ${reads.map((r, i) => `${i + 1}. ${r.nameText}: ${sizes(r)}`).join('; ')}.` : `On this card: ${sizes(reads[0])}.`;
  const sentence = t => t.charAt(0).toUpperCase() + t.slice(1);
  const misreads = reads.map((r, i) => { const why = misread(r, intended); return why ? (recipe.cards ? `Card ${i + 1}: ${why}` : sentence(why)) : ''; }).filter(Boolean);
  const ok = misreads.length === 0;
  const inOrder = r => intended.map(p => say(r, p)).join(', then ');
  const thus = ok
    ? (recipe.cards ? `Every card is read in the same order (${reads.map(inOrder).join('; ')}), so like is compared with like.` : `A viewer gets ${inOrder(reads[0])}: the order ${own ? 'you set' : 'the purpose needs'}.`)
    : `Not served${own ? ' in your order' : ''}. ${misreads.join(' ')}`;
  const purpose = recipe.cards ? viewer.purpose?.lineup ?? PURPOSE.lineup : viewer.purpose?.card ?? PURPOSE.card;
  const because = `${own ? `Your order: ${partWords(intended)}. ` : ''}${PURPOSE.reading}`;
  const scaffold = `${PURPOSE.scaffold}${own ? ` Your order differs from it; the scaffold still checks agent-made cards.` : ''}`;
  const demonstration = { for: purpose, because, scaffold, does, thus, own, intended, purposeOwn: purpose !== (recipe.cards ? PURPOSE.lineup : PURPOSE.card) };
  return { cause: 'final', question: 'What is it for, and does it do it?', ok, demonstration,
    what: `This is for: ${demonstration.for} Because: ${demonstration.because} It does: ${demonstration.does} Thus: ${demonstration.thus}${ok ? ' QED.' : ''}` };
}
