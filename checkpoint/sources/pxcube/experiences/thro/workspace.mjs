import { openDemo } from './model.mjs';
import { archive } from './studio/upload-disc-to-shelf/persistence.js';
import { createExperience, initialDraft } from './studio/upload-disc-to-shelf/model.js';
import { pack, unpack } from './archive-storage.mjs';
import { openLockedArchive } from './locked-storage.mjs';
import { createWorkspaceCodec } from './archive-codec.mjs';
import { defaultDesign } from './graphics.mjs';
import { createNativeRenderer, isNativeStudy, isLineupStudy, workspaceDesignChange } from './native-cards.mjs';
import { validateFlightCorrection } from './prepared-fixture.mjs';
import { createWorkspacePackage, snapshotJson } from './workspace-package.mjs';
import { span, here, within } from './gestures.mjs';

export const archiveKey = 'thro.v1:prepared-samples:archive';
const clone = value => structuredClone(value);
const memory = initial => {
  let raw = initial;
  return { getItem: () => raw, setItem: (_key, value) => { raw = value; }, async flush() {}, get raw() { return raw; } };
};
const failure = (code, message) => Object.assign(Error(message), { code });

// Collection heads in the legacy Experience are mutable. A candidate world
// isolates those mutations until the complete archive has durably committed.
export async function openWorkspace({ storage = globalThis.localStorage, locks = globalThis.navigator?.locks, fixture, key = archiveKey, renderGraphic: drawWith = createNativeRenderer() } = {}) {
  // A drawing asked for by single() is timed under the stage that asked (its place, from here()), even though the model reaches
  // the renderer only after awaits of its own. The place is passed by the request (disc and design), not guessed.
  const places = new Map(), placeKey = (disc, design) => JSON.stringify([disc, design ?? null]);
  // Object.assign keeps the renderer's own entries (renderGraphic.lineup draws Bag and Battle lineups).
  const renderGraphic = Object.assign(input => within(places.get(placeKey(input?.discAddress, input?.design)), () => drawWith(input)), drawWith);
  // gzip is its own stage inside 'encode the archive'; what is left there is finding the repeated tokens.
  const codec = createWorkspaceCodec({ pack: text => span('gzip the archive', () => pack(text)), unpack });
  // The two steps of a save inside the storage adapter are stages too: encoding the archive (started while 'write it to storage'
  // runs, so it lands under it) and the locked write after it (given the same place explicitly; saves run one at a time).
  let savePlace = null;
  const timedPack = raw => { savePlace = here(); return span('encode the archive', () => codec.packArchive(raw)); };
  const timedLocks = locks && { request: (name, options, fn) => span('wait for the lock and write', () => locks.request(name, options, fn), savePlace ?? undefined) };
  const retained = await openLockedArchive(storage, key, { locks: timedLocks, pack: timedPack, unpack: codec.unpackArchive });
  let committedRaw = retained.getItem(''), model, conflict = null, draft = null, queue = Promise.resolve(), pending = 0;
  if (committedRaw === null) {
    if (!Array.isArray(fixture) || fixture.length === 0) throw Error('A prepared sample shelf is required.');
    let seededState;
    const seed = createExperience(() => {}, { persist(state) { seededState = state; } });
    for (const item of fixture) {
      const mold = seed.seedOptions().find(row => row.seed.id === item.mold);
      if (!mold) throw Error(`Prepared sample mold is missing: ${item.mold}.`);
      const correction = validateFlightCorrection(item);
      await seed.save({ ...initialDraft(), mold: mold.address, nickname: '', plastic: item.plastic, weight: item.weight,
        ...(correction?.flightOverrides ?? {}), ...(correction ? { flightCitation: correction.flightCitation } : {}) }, item.depiction);
    }
    const staged = memory(archive(seededState));
    model = await openDemo(staged, { renderGraphic });
    // The bag starts with the first three discs (the original prepared samples): a lineup holds 2–4, and the shelf can hold more.
    await model.patch({ name: 'Prepared sample bag', selection: model.experience.shelf().slice(0, 3).map(row => row.address), throMode: 'single' });
    committedRaw = staged.raw;
    retained.setItem('', committedRaw);
    await retained.flush();
  } else {
    const staged = memory(committedRaw);
    model = await openDemo(staged, { renderGraphic });
    if (staged.raw !== committedRaw) {
      retained.setItem('', staged.raw);
      await retained.flush();
      committedRaw = staged.raw;
    }
  }

  const serial = (intent, action) => {
    pending++;
    const at = here(); // the stage that asked for this (a save), kept for when the queue gets to it
    const operation = queue.then(async () => {
      if (conflict) throw conflict;
      draft = clone(intent);
      const staged = memory(committedRaw);
      let candidate;
      try {
        candidate = await span('open a copy of the workspace', () => openDemo(staged, { renderGraphic }), at);
        const result = await span('apply it to the copy', () => action(candidate), at);
        await span('write it to storage', async () => { retained.setItem('', staged.raw); await retained.flush(); }, at);
        committedRaw = staged.raw;
        model = candidate;
        draft = null;
        return result;
      } catch (error) {
        // The committed owning model and its visible heads never advance.
        // Keep intent outside it so a redraw or error cannot erase recovery.
        if (String(error.code ?? '').startsWith('THRO_STORAGE_')) conflict = error;
        throw error;
      }
    });
    const finished = operation.finally(() => { pending--; });
    queue = finished.catch(() => {});
    return finished;
  };

  return {
    get model() { return model; },
    get draft() { return draft && clone(draft); },
    get conflict() { return conflict; },
    get key() { return key; },
    settled: () => queue,
    saveDisc(draft, depiction, sources = {}) {
      const input = snapshotJson({ draft, depiction, sources });
      return serial({ operation: 'save-disc', ...input }, candidate => candidate.experience.save(input.draft, input.depiction, input.sources));
    },
    async exportPackage({ identity, provenance = {} } = {}) {
      const metadata = snapshotJson({ identity, provenance });
      if (pending || draft || conflict) throw failure('THRO_PACKAGE_BUSY', 'Finish or recover the pending workspace change before exporting a package.');
      return createWorkspacePackage({ raw: committedRaw, ...metadata, ...(codec.metadata ?? {}) });
    },
    change(changes) {
      return serial({ operation: 'change', context: changes }, async candidate => {
        const at = here();
        const next = await candidate.patch(workspaceDesignChange(candidate.context, changes, defaultDesign));
        if (isNativeStudy(next.design?.study) && (next.throMode ?? 'single') === 'single'
          && ['design', 'selectedDisc', 'throMode'].some(key => Object.hasOwn(changes, key))) {
          // patch() wrote only the private staging store. A native geometry,
          // photo or renderer failure must precede the outer durable flush.
          await span('check the card draws', () => candidate.render(next.selectedDisc, next.design), at);
        }
        return next;
      });
    },
    createBag(name, selection) {
      return serial({ operation: 'create-bag', name, selection }, async candidate => {
        await candidate.patch({ name, selection });
        return candidate.createBag();
      });
    },
    async single(discAddress, design = model.context.design) {
      const k = placeKey(discAddress, design), at = here();
      if (at?.j) places.set(k, at);
      try {
        const result = await model.render(discAddress, design);
        return { ...result, design: clone(design) };
      } finally { if (places.get(k) === at) places.delete(k); }
    },
    async battle(selection, design = model.context.design) {
      if (isNativeStudy(design?.study)) throw failure('THRO_NATIVE_SINGLE_ONLY', 'DiscStudio card layouts are available in Single. Choose a lineup composition for Battle or Bag.');
      const current = model.context.competitionAddress;
      const addresses = current ? model.value(current).entries.map(entry => entry.address) : [];
      if (JSON.stringify(addresses) !== JSON.stringify(selection)) {
        await serial({ operation: 'start-battle', selection, design }, async candidate => {
          await candidate.startCompetition(selection);
          // A new Bag lineup starts with every disc the same size; featuring one is a choice.
          if (isLineupStudy(design?.study)) await candidate.editCompetition({ kind: 'turn', id: null });
        });
      }
      const result = await model.renderCompetition(design);
      return { ...result, design: clone(design) };
    },
    editBattle(edit) {
      return serial({ operation: 'edit-battle', edit }, candidate => candidate.editCompetition(edit));
    },
    existingCapture(result) {
      const design = result.design ?? model.value(result.designAddress);
      for (const address of [...model.context.graphics].reverse()) {
        const capture = model.value(address), source = capture.source;
        const sameOrigin = result.materialAddress
          ? source.material === result.materialAddress && !source.disc
          : source.disc === result.discAddress && !source.material;
        if (sameOrigin && capture.graphic.svg === result.graphic.svg && JSON.stringify(capture.design) === JSON.stringify(design)) {
          return { address, capture };
        }
      }
      return null;
    },
    keep(result) {
      const design = result.design ?? model.value(result.designAddress);
      const requested = { ...result, design: clone(design), graphic: clone(result.graphic) };
      let previewSources = null;
      try {
        previewSources = clone({ design: model.value(result.designAddress), ...(result.materialAddress
          ? { material: model.value(result.materialAddress) }
          : { disc: model.value(result.discAddress), resolved: model.value(result.resolvedAddress) }) });
      } catch { /* An unbound preview can still use the original fresh-render path. */ }
      return serial({ operation: 'keep', discAddress: result.discAddress, materialAddress: result.materialAddress, design }, async candidate => {
        const retained = await candidate.tryRetainCapture(requested, { previewSources, mount: 'thro.prepared-samples',
          async matchesGraphic({ retained, preview, source, disc, resolved, resolvedAddress }) {
            const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
            if (!isNativeStudy(design.study)) return same(retained, preview);
            // Validate native geometry/pixels again without creating bound Parts.
            // The renderer receives the retained owning addresses, so its whole
            // output (including every provenance field) must remain exact.
            const validated = await renderGraphic({ discAddress: source.disc, disc, design,
              designAddress: source.design, resolvedAddress, resolved, purpose: 'single' });
            if (!validated || !same(validated, retained)) return false;
            const old = retained.provenance, current = preview.provenance;
            if (old?.schema !== 'thro-native-card@1') return false;
            if (current?.schema !== old.schema || old.discAddress !== source.disc || old.physicalDiscId !== disc.id
              || old.designAddress !== source.design || old.resolvedAddress !== resolvedAddress
              || current.discAddress !== requested.discAddress || current.physicalDiscId !== disc.id
              || current.designAddress !== requested.designAddress || current.resolvedAddress !== requested.resolvedAddress) return false;
            // Only these two address strings may differ. Their bound preview
            // values were checked against the exact retained design/facts.
            return same(retained, { ...preview, provenance: { ...current,
              designAddress: old.designAddress, resolvedAddress: old.resolvedAddress } });
          },
        });
        if (retained) return retained;
        const rebuilt = requested.materialAddress
          ? await candidate.renderCompetition(design, requested.materialAddress)
          : await candidate.render(requested.discAddress, design);
        if (rebuilt.graphic.svg !== requested.graphic.svg) throw failure('THRO_PREVIEW_CHANGED', 'The prepared output changed. Review the current preview before keeping it.');
        return requested.materialAddress
          ? candidate.captureCompetition(rebuilt, 'thro.prepared-samples')
          : candidate.capture(rebuilt, 'thro.prepared-samples');
      });
    },
    recordExport(record) {
      return serial({ operation: 'record-export', record }, candidate => candidate.recordExport(record));
    },
    async reload() {
      await queue;
      const recovery = draft && clone(draft);
      const next = await openWorkspace({ storage, locks, fixture, key, renderGraphic });
      // Caller receives the old draft explicitly; no automatic merge or save.
      return { workspace: next, recovery };
    },
  };
}
