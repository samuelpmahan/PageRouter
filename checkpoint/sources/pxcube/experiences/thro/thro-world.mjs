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
  return world;
}

/** Run the site under a fill. Returns what it shows, the receipt, and, per decision, the choice and why. */
export function decide(world, fill = SITE_FILL) {
  const { outputs, receipt, trace } = world.run('thro.site', {}, { fill: { ...fill }, landing: 'none' });
  const choices = Object.fromEntries(trace.calls.map(node => [node.contract, { impl: node.impl, slot: node.slot, rung: node.chosenBy?.rung, key: node.chosenBy?.key }]));
  return { site: outputs, receipt, choices };
}
