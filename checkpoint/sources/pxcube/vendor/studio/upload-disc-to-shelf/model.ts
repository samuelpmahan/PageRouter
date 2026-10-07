import { Part, PxC } from '../part-first-kernel/src/pxc.mjs';
import { renderDiscPainting } from './paint.ts';
import { validatePaintRecipe, recipeFromDraft, renderDepiction, type PaintRecipe } from './paint-recipe.ts';
import { shelfQuery } from './shelf-query.ts';
import { createBag } from './bags.ts';
import { plasticGuides } from './plastics.ts';
import { catalog } from './catalog.ts';
import { create, read, update, destroy, runStage, type Stage } from './operations.ts';
import { find } from './devtools-data.mjs';
import type { State } from './persistence.ts';

export type Seed = { id: string; manufacturer: string; mold: string; flight: (number | null)[]; source?: string; sourceKind?: string; observations?: { flight: (number | null)[]; source: string }[]; conflicting?: boolean; reviewStatus?: string };
export const flightFields = ['speed', 'glide', 'turn', 'fade'] as const;
type Flights = Record<typeof flightFields[number], number | null>;
export type Mold = Omit<Seed, 'mold' | 'flight'> & Flights & { name: string };
type Correction = Pick<Mold, 'manufacturer' | 'name'> & Partial<Flights>;
export type Draft = Partial<Flights> & { mold: string; nickname: string; weight: number | null; plastic: string; Color1: string; Color2: string; paintMode: 'split' | 'halo'; colorPainting: boolean };
export type Depiction = { kind: 'painted' | 'photo'; src: string; name: string };
export type Disc = Draft & { id: string; depiction: Depiction; paintRecipe?: string; photo?: string; choice?: string; art?: string };
export type DepictionSources = { recipe?: PaintRecipe; photo?: Depiction | null };
export const seeds: Seed[] = catalog;
// {?} Seed facts are editable starter material, not a complete product catalog.
export const paintings: readonly Depiction[] = Object.freeze(['pressed-fern', 'chevron-run', 'contour-basin'].map(name => Object.freeze({ kind: 'painted' as const, name, src: `./art/${name}.svg` })));
const seedAddress = (id: string) => `ds.px.seed.${id}`;
export const initialDraft = (): Draft => ({ mold: seedAddress('buzzz'), nickname: '', weight: null, plastic: '', Color1: '#98d4ba', Color2: '#f8b393', paintMode: 'split', colorPainting: false });
function checkFlights(value: Partial<Flights>) {
  for (const field of flightFields) if (Object.hasOwn(value, field) && value[field] !== null && !Number.isFinite(value[field])) throw Error(`${field} must be finite or null; remove the field to inherit.`);
}
function checkDraft(draft: Draft) {
  if (!/^ds\.px\.seed\.[\w.-]+$/.test(draft.mold)) throw new Error('Choose a seeded disc.');
  checkFlights(draft);
  if (draft.weight !== null && (!Number.isFinite(draft.weight) || draft.weight <= 0)) throw new Error('Weight must be positive grams, or blank.');
  for (const color of [draft.Color1, draft.Color2]) if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Choose two valid colors.');
  if (!['split', 'halo'].includes(draft.paintMode) || typeof draft.colorPainting !== 'boolean') throw new Error('Choose a paint mode and color setting.');
}
export function createExperience(log: (event: Record<string, unknown>) => void = event => console.info(JSON.stringify(event)), options: { state?: State; persist?: (state: State) => void; status?: () => string } = {}) {
  const pxc = options.state?.pxc ?? new PxC();
  if (!options.state) {
  seeds.forEach(({ mold, flight, ...seed }) => pxc.set(seedAddress(seed.id), new Part(Object.freeze({ ...seed, name: mold, ...Object.fromEntries(flightFields.map((field, i) => [field, flight[i]])) }))));
  pxc.set('ds.px.paintings', new Part(paintings));
  pxc.set('ds.px.plasticGuides', new Part(plasticGuides));
  for (const [address, implementation] of Object.entries({ 'fn.read': read, 'fn.find': find, 'oc.create': create, 'oc.update': update, 'oc.destroy': destroy,
    'fn.tick': (outputs: any) => Object.freeze({ outputs: Object.freeze(Object.keys(outputs)) }),
    'fn.renderPainting': renderDiscPainting, 'fn.selectPainting': ({ catalog, choice }: any) => catalog[choice],
    'fn.paintRecipe': ({ recipe }: any) => validatePaintRecipe(recipe), 'fn.renderDepiction': renderDepiction,
    'fn.shelfQuery': shelfQuery, 'fn.createBag': createBag,
    'fn.shelfRows': ({ references, ...parts }: any) => Object.freeze(references.map((address: string, i: number) => Object.freeze({ address, disc: parts[`disc${i}`], seed: parts[`seed${i}`], art: parts[`art${i}`] }))),
    'fn.addReference': ({ collection, reference, value }: any) => {
      if (!value.id || collection.includes(reference)) throw Error('Reference already retained.');
      return Object.freeze([...collection, reference]);
    },
  })) pxc.set(address, new Part(implementation));
  pxc.set('fn.addToShelf', new Part(({ shelf, reference, disc }: any) => {
    if (!disc.id || shelf.includes(reference)) throw new Error('Disc is already on the shelf.');
    return Object.freeze([...shelf, reference]);
  }));
  pxc.set('ds.px.shelf.0', new Part(Object.freeze([])));
  }
  let shelfAddress = options.state?.shelfAddress ?? 'ds.px.shelf.0', serial = options.state?.serial ?? 0;
  let bagsAddress = options.state?.bagsAddress ?? 'ds.px.bags.0';
  if (!pxc.entries().some(([name]: [string, unknown]) => name === bagsAddress)) pxc.set(bagsAddress, new Part(Object.freeze([])));
  let saving = false;
  const events: Record<string, unknown>[] = [];
  const emit = (event: Record<string, unknown>) => { events.push(event); try { log(event); } catch (error) { console.warn('Diagnostic sink failed; receipt remains in PxC.', error); } };
  const selected = new Map<Depiction, string>();
  const currentSeeds = new Map(options.state?.currentSeeds ?? seeds.map(seed => [seed.id, seedAddress(seed.id)]));
  // Keep the immutable catalog index outside PxC for read/search paths. PxC
  // remains authoritative for corrections and persistence, but asking for
  // suggestions should not perform hundreds of browser-side Part lookups on
  // every keystroke.
  const baseSeedOptions = new Map(seeds.map(({ mold, flight, ...seed }) => [seedAddress(seed.id), Object.freeze({ ...seed, name: mold, ...Object.fromEntries(flightFields.map((field, i) => [field, flight[i]])) })]));
  let seedCacheKey = '', seedCache: { address: string; seed: Mold }[] = [];
  const indexedSeeds = () => {
    const key = [...currentSeeds].map(([id, address]) => `${id}:${address}`).join('|');
    if (key === seedCacheKey) return seedCache;
    seedCacheKey = key;
    seedCache = [...currentSeeds].map(([id, address]) => ({ address, seed: (address === seedAddress(id) ? baseSeedOptions.get(address) : pxc.get(address).value) as Mold }));
    return seedCache;
  };
  const persist = (nextShelf = shelfAddress, molds = currentSeeds, nextBags = bagsAddress) => options.persist?.({ pxc, serial, shelfAddress: nextShelf, currentSeeds: [...molds], bagsAddress: nextBags });
  const candidates = new Map<string, string>();
  const artAt = (disc: Disc) => disc.art ?? `ds.px.art.${disc.id}`;
  async function projectRows(operationId: string) {
    const inputs: Record<string, any> = { references: shelfAddress };
    (pxc.get(shelfAddress).value as string[]).forEach((address, i) => {
      const disc = pxc.get(address).value as Disc;
      inputs[`disc${i}`] = address; inputs[`seed${i}`] = disc.mold; inputs[`art${i}`] = artAt(disc);
    });
    const into = `ds.px.shelf.rows.${operationId}`;
    await pxc.compose({ into, calculation: 'fn.shelfRows', inputs });
    return into;
  }
  function checkPhoto(photo: Depiction | null) {
    if (photo !== null && (photo.kind !== 'photo' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo.src))) throw Error('Invalid prepared photo.');
  }
  return {
    pxc, events,
    get persistenceStatus() { return options.status?.() ?? 'Session only · reload starts fresh.'; },
    get shelfAddress() { return shelfAddress; },
    get bagsAddress() { return bagsAddress; },
    seedOptions(query = ''): { address: string; seed: Mold }[] { return find({ collection: indexedSeeds(), query, fields: (row: any) => [row.seed.manufacturer, row.seed.name] }); },
    seedAt(address: string): Mold { return pxc.get(address).value; },
    resolve(disc: Draft) { return read({ base: pxc.get(disc.mold).value, own: disc }); },
    depictionSources(address: string) {
      const disc = pxc.get(address).value as Disc;
      return { recipe: disc.paintRecipe ? pxc.get(disc.paintRecipe).value as PaintRecipe : recipeFromDraft(disc, disc.depiction.kind === 'painted' ? disc.depiction : paintings[0]),
        photo: disc.photo ? pxc.get(disc.photo).value as Depiction | null : disc.depiction.kind === 'photo' ? disc.depiction : null,
        choice: disc.choice ? pxc.get(disc.choice).value as 'painted' | 'photo' : disc.depiction.kind };
    },
    async queryShelf(request: Parameters<typeof shelfQuery>[0]['request'] = {}) {
      const id = `query-${++serial}`, rows = await projectRows(id), into = `ds.px.shelf.query.${id}`;
      // Snapshot request arrays: later control changes must not rewrite this query's inputs.
      const snapshot = structuredClone(request);
      await pxc.compose({ into, calculation: 'fn.shelfQuery', inputs: { rows, request: new Part(snapshot) } });
      return { address: into, ...pxc.get(into).value };
    },
    bags() {
      const current = new Map((pxc.get(shelfAddress).value as string[]).map(address => [pxc.get(address).value.id, address]));
      return (pxc.get(bagsAddress).value as string[]).map(address => {
        const bag = pxc.get(address).value;
        return { address, bag, discs: bag.discIds.map((id: string) => {
          const version = current.get(id); if (!version) throw Error(`Bag disc ${id} is missing from the shelf.`);
          const disc = pxc.get(version).value as Disc;
          return { address: version, disc, seed: pxc.get(disc.mold).value as Mold, art: pxc.get(artAt(disc)).value as string };
        }) };
      });
    },
    async createBag(name: string, selection: string[]) {
      if (saving) throw Error('A collection write is already in progress.');
      saving = true;
      const id = `bag-${++serial}`, into = `ds.px.bag.${id}`, next = `ds.px.bags.${id}`;
      try {
        const rows = await projectRows(id);
        await pxc.compose({ into, calculation: 'fn.createBag', inputs: { name: new Part(name), selection: new Part(Object.freeze([...selection])), rows, id: new Part(id) } });
        await pxc.compose({ into: next, calculation: 'fn.addReference', inputs: { collection: bagsAddress, reference: new Part(into), value: into } });
        const bag = pxc.get(into).value;
        if (bag.versions.length !== selection.length || bag.versions.some((v: any, i: number) => v.address !== selection[i]) || pxc.get(next).value.at(-1) !== into) throw Error('Bag readback failed.');
        persist(shelfAddress, currentSeeds, next);
        bagsAddress = next;
        emit({ event: 'bag.create.completed', bagAddress: into, bagsAddress: next, discIds: bag.discIds, readbackMatched: true });
        return into;
      } finally { saving = false; }
    },
    async updateDepiction(address: string, changes: { recipe?: PaintRecipe; photo?: Depiction | null; choice?: 'painted' | 'photo'; mold?: string }) {
      const disc = pxc.get(address).value as Disc, retained = this.depictionSources(address);
      const recipe = validatePaintRecipe(changes.recipe === undefined ? retained.recipe : changes.recipe);
      const photo = changes.photo === undefined ? retained.photo : changes.photo;
      checkPhoto(photo);
      const choice = changes.choice ?? retained.choice;
      if (!['painted', 'photo'].includes(choice) || (choice === 'photo' && !photo)) throw Error('Choose a retained depiction source.');
      const mold = changes.mold ?? disc.mold; pxc.get(mold); checkDraft({ ...disc, mold });
      const id = `depict-${++serial}`, into = `ds.px.disc.${id}`;
      const recipeAddress = `ds.px.recipe.${id}`, photoAddress = `ds.px.photo.${id}`, choiceAddress = `ds.px.choice.${id}`, artAddress = `ds.px.art.${id}`;
      await pxc.compose({ into: recipeAddress, calculation: 'fn.paintRecipe', inputs: { recipe: new Part(recipe) } });
      pxc.set(photoAddress, new Part(photo ? Object.freeze({ ...photo }) : null)); pxc.set(choiceAddress, new Part(choice));
      await pxc.compose({ into: artAddress, calculation: 'fn.renderDepiction', inputs: { recipe: recipeAddress, photo: photoAddress, choice: choiceAddress, seed: mold } });
      const depiction: Depiction = choice === 'photo' ? photo! : Object.freeze({ kind: 'painted', name: recipe.family, src: `./art/${recipe.family}.svg` });
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ mold, depiction, paintRecipe: recipeAddress, photo: photoAddress, choice: choiceAddress, art: artAddress })) } });
      candidates.set(into, address);
      return into;
    },
    async updateDisc(address: string, patch: Partial<Flights>, remove: string[] = []) {
      if (!pxc.get(address).value.mold) throw Error('Select a Disc.');
      if ([...Object.keys(patch), ...remove].some(key => !(flightFields as readonly string[]).includes(key))) throw Error('This editor updates flight fields only.');
      checkFlights(patch);
      const into = `ds.px.disc.edit-${++serial}`;
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ ...patch })), remove: new Part(Object.freeze([...remove])) } });
      candidates.set(into, address);
      return into;
    },
    async keepDisc(before: string, candidate: string) {
      if (saving) throw Error('A shelf write is already in progress.');
      saving = true;
      const operationId = `keep-${++serial}`;
      try {
        const previousShelf = shelfAddress, members = pxc.get(previousShelf).value as string[];
        const index = members.indexOf(before);
        if (index < 0 || candidates.get(candidate) !== before) throw Error('This selection changed. Reopen the current disc before keeping an edit.');
        const into = `ds.px.shelf.${operationId}`;
        await pxc.compose({ into, calculation: 'oc.update', inputs: { value: previousShelf, patch: new Part(Object.freeze({ [index]: candidate })) } });
        const actual = pxc.get(into).value as string[];
        if (actual.length !== members.length || actual.some((ref, i) => ref !== (i === index ? candidate : members[i]))) throw Error('Shelf readback failed.');
        const receipt = Object.freeze({ event: 'disc.edit.kept', operationId, before, candidate, previousShelf, shelfAddress: into, readbackMatched: true, storage: 'session-memory' });
        pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
        persist(into);
        shelfAddress = into; emit(receipt);
        return candidate;
      } finally { saving = false; }
    },
    async reviewSeed(address: string, verdict: 'confirmed' | 'corrected', correction?: Correction) {
      const seed = pxc.get(address).value as Mold;
      if (currentSeeds.get(seed.id) !== address) throw new Error('This seed has a newer correction. Review the current one.');
      if (!['confirmed', 'corrected'].includes(verdict)) throw new Error('Choose a review result.');
      const operationId = `review-${++serial}`;
      if (verdict === 'corrected' && !correction) throw new Error('Supply the correction.');
      const into = `ds.px.seed.${seed.id}.${operationId}`;
      const patch: Partial<Correction> = verdict === 'confirmed' ? {} : correction!;
      checkFlights(patch);
      if (verdict === 'corrected' && (!patch.manufacturer?.trim() || !patch.name?.trim())) throw Error('Enter manufacturer and mold.');
      await pxc.compose({ into, calculation: 'oc.update', inputs: { value: address, patch: new Part(Object.freeze({ ...patch, reviewStatus: verdict })) } });
      const receipt = Object.freeze({ event: 'seed.review.completed', operationId, verdict, before: address, after: into, flight: flightFields.map(field => pxc.get(into).value[field]) });
      pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
      persist(shelfAddress, new Map([...currentSeeds, [seed.id, into]]));
      currentSeeds.set(seed.id, into);
      seedCacheKey = '';
      emit(receipt);
      return into;
    },
    async selectPainting(random = Math.random): Promise<Depiction> {
      const id = ++serial;
      const value = random();
      if (!(value >= 0 && value < 1)) throw new Error('Random choice must be in [0,1).');
      const address = `ds.px.painting.${id}`;
      await pxc.compose({ into: address, calculation: 'fn.selectPainting', inputs: { catalog: 'ds.px.paintings', choice: new Part(Math.floor(value * paintings.length)) } });
      const depiction = pxc.get(address).value;
      selected.set(depiction, address);
      return depiction;
    },
    async save(draft: Draft, depiction: Depiction, sources: DepictionSources = {}) {
      if (saving) throw new Error('A save is already in progress.');
      saving = true;
      const operationId = `save-${++serial}`;
      const discAddress = `ds.px.disc.${operationId}`, nextShelf = `ds.px.shelf.${operationId}`;
      try {
        checkDraft(draft);
        if (depiction.kind === 'painted' && !sources.recipe && !paintings.some(p => p.src === depiction.src)) throw new Error('Unknown painting.');
        if (depiction.kind === 'photo' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(depiction.src)) throw new Error('Invalid prepared photo.');
        const draftAddress = `ds.px.draft.${operationId}`, depictionAddress = `ds.px.depiction.${operationId}`;
        if (!['painted', 'photo'].includes(depiction.kind)) throw Error('Unknown depiction kind.');
        pxc.get(draft.mold);
        pxc.set(draftAddress, new Part(Object.freeze({ ...draft })));
        const selectedAddress = selected.get(depiction);
        pxc.set(depictionAddress, selectedAddress ? pxc.get(selectedAddress) : new Part(Object.freeze({ ...depiction })));
        const artAddress = `ds.px.art.${operationId}`;
        const recipe = validatePaintRecipe(sources.recipe === undefined ? recipeFromDraft(draft, depiction.kind === 'painted' ? depiction : paintings[0]) : sources.recipe);
        const photo = sources.photo === undefined ? (depiction.kind === 'photo' ? depiction : null) : sources.photo;
        checkPhoto(photo);
        if (depiction.kind === 'photo' && (!photo || photo.src !== depiction.src)) throw Error('Selected photo must match the retained source.');
        if (depiction.kind === 'painted' && recipe.family !== depiction.name) throw Error('Selected painting must match its recipe.');
        const recipeAddress = `ds.px.recipe.${operationId}`, photoAddress = `ds.px.photo.${operationId}`, choiceAddress = `ds.px.choice.${operationId}`;
        pxc.set(photoAddress, new Part(photo ? Object.freeze({ ...photo }) : null));
        pxc.set(choiceAddress, new Part(depiction.kind));
        const stage: Stage = [
          { into: `ds.px.tick.${operationId}.specialize`, calculations: [
            { into: recipeAddress, calculation: 'fn.paintRecipe', inputs: { recipe: new Part(recipe) } },
            { into: discAddress, calculation: 'oc.create', inputs: { value: draftAddress, id: new Part(operationId), depiction: depictionAddress, paintRecipe: new Part(recipeAddress), photo: new Part(photoAddress), choice: new Part(choiceAddress), art: new Part(artAddress) } },
            { into: `ds.px.resolved.${operationId}`, calculation: 'fn.read', inputs: { base: draft.mold, own: discAddress } },
          ] },
          { into: `ds.px.tick.${operationId}.depict`, calculations: [{ into: artAddress, calculation: 'fn.renderDepiction', inputs: { recipe: recipeAddress, photo: photoAddress, choice: choiceAddress, seed: draft.mold } }] },
          { into: `ds.px.tick.${operationId}.retain`, calculations: [{ into: nextShelf, calculation: 'fn.addToShelf', inputs: { shelf: shelfAddress, reference: new Part(discAddress), disc: discAddress } }] },
        ];
        pxc.set(`ds.px.stage.${operationId}`, new Part(Object.freeze(stage)));
        for await (const _boundary of runStage(pxc, stage)) { /* Boundary Parts are inspectable in DevTools. */ }
        const disc = pxc.get(discAddress).value as Disc;
        const shelf = pxc.get(nextShelf).value as string[];
        const expected = { ...draft, id: operationId, depiction, paintRecipe: recipeAddress, photo: photoAddress, choice: choiceAddress, art: artAddress };
        if (JSON.stringify(disc) !== JSON.stringify(expected) || !shelf.includes(discAddress)) throw new Error('Save readback failed.');
        const receipt = Object.freeze({ event: 'disc.save.completed', operationId, calculation: 'fn.addToShelf', discAddress, shelfAddress: nextShelf, artAddress, ticks: stage.map(tick => tick.into), paintMode: disc.paintMode, colorPainting: disc.colorPainting, seedAddress: disc.mold, paintingRef: disc.depiction.src.startsWith('data:') ? 'local-photo' : disc.depiction.src, readbackMatched: true, shelfContainsDisc: true, storage: 'session-memory' });
        pxc.set(`ds.px.receipt.${operationId}`, new Part(receipt));
        persist(nextShelf);
        shelfAddress = nextShelf;
        emit(receipt);
        return discAddress;
      } catch (error) {
        emit({ event: 'disc.save.failed', operationId, message: String(error) });
        throw error;
      } finally { saving = false; }
    },
    shelf(query = ''): { address: string; disc: Disc; seed: Mold; art: string }[] {
      const collection = pxc.get(shelfAddress).value.map((address: string) => {
        const disc = pxc.get(address).value as Disc;
        return { address, disc, seed: pxc.get(disc.mold).value, art: pxc.get(artAt(disc)).value };
      });
      // Shelf navigation uses shared disc facts. Nickname is retained for final
      // recognition in the inspector, never an index or a search field.
      return find({ collection, query: query.replace(/[·•,]/g, ' '), fields: (row: any) => [row.seed.manufacturer, row.seed.name, row.disc.plastic, String(row.disc.weight ?? '')] });
    },
  };
}
// {?} Persist the retained compositions across reload; this first shelf is session-local.
