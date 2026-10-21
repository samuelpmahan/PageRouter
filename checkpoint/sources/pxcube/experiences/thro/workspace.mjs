import { openDemo } from './model.mjs';
import { archive } from './studio/upload-disc-to-shelf/persistence.js';
import { createExperience, initialDraft } from './studio/upload-disc-to-shelf/model.js';
import { pack, unpack } from './archive-storage.mjs';
import { openLockedArchive } from './locked-storage.mjs';
import { createArchiveCodec } from './archive-codec.mjs';

const codec = createArchiveCodec({ pack, unpack });

export const archiveKey = 'thro.v1:prepared-samples:archive';
const clone = value => structuredClone(value);
const memory = initial => {
  let raw = initial;
  return { getItem: () => raw, setItem: (_key, value) => { raw = value; }, async flush() {}, get raw() { return raw; } };
};
const failure = (code, message) => Object.assign(Error(message), { code });

// Collection heads in the legacy Experience are mutable. A candidate world
// isolates those mutations until the complete archive has durably committed.
export async function openWorkspace({ storage = globalThis.localStorage, locks = globalThis.navigator?.locks, fixture, key = archiveKey } = {}) {
  const retained = await openLockedArchive(storage, key, { locks, pack: codec.packArchive, unpack: codec.unpackArchive });
  let committedRaw = retained.getItem(''), model, conflict = null, draft = null, queue = Promise.resolve();
  if (committedRaw === null) {
    if (!Array.isArray(fixture) || fixture.length === 0) throw Error('A prepared sample shelf is required.');
    let seededState;
    const seed = createExperience(() => {}, { persist(state) { seededState = state; } });
    for (const item of fixture) {
      const mold = seed.seedOptions().find(row => row.seed.id === item.mold);
      if (!mold) throw Error(`Prepared sample mold is missing: ${item.mold}.`);
      await seed.save({ ...initialDraft(), mold: mold.address, nickname: '', plastic: item.plastic, weight: item.weight }, item.depiction);
    }
    const staged = memory(archive(seededState));
    model = await openDemo(staged);
    await model.patch({ name: 'Prepared sample bag', selection: model.experience.shelf().map(row => row.address), throMode: 'single' });
    committedRaw = staged.raw;
    retained.setItem('', committedRaw);
    await retained.flush();
  } else {
    const staged = memory(committedRaw);
    model = await openDemo(staged);
    if (staged.raw !== committedRaw) {
      retained.setItem('', staged.raw);
      await retained.flush();
      committedRaw = staged.raw;
    }
  }

  const serial = (intent, action) => {
    const operation = queue.then(async () => {
      if (conflict) throw conflict;
      draft = clone(intent);
      const staged = memory(committedRaw);
      let candidate;
      try {
        candidate = await openDemo(staged);
        const result = await action(candidate);
        retained.setItem('', staged.raw);
        await retained.flush();
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
    queue = operation.catch(() => {});
    return operation;
  };

  return {
    get model() { return model; },
    get draft() { return draft && clone(draft); },
    get conflict() { return conflict; },
    get key() { return key; },
    settled: () => queue,
    change(changes) {
      return serial({ operation: 'change', context: changes }, candidate => candidate.patch(changes));
    },
    createBag(name, selection) {
      return serial({ operation: 'create-bag', name, selection }, async candidate => {
        await candidate.patch({ name, selection });
        return candidate.createBag();
      });
    },
    async single(discAddress, design = model.context.design) {
      const result = await model.render(discAddress, design);
      return { ...result, design: clone(design) };
    },
    async battle(selection, design = model.context.design) {
      const current = model.context.competitionAddress;
      const addresses = current ? model.value(current).entries.map(entry => entry.address) : [];
      if (JSON.stringify(addresses) !== JSON.stringify(selection)) {
        await serial({ operation: 'start-battle', selection, design }, candidate => candidate.startCompetition(selection));
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
      return serial({ operation: 'keep', discAddress: result.discAddress, materialAddress: result.materialAddress, design }, async candidate => {
        const rebuilt = result.materialAddress
          ? await candidate.renderCompetition(design, result.materialAddress)
          : await candidate.render(result.discAddress, design);
        if (rebuilt.graphic.svg !== result.graphic.svg) throw failure('THRO_PREVIEW_CHANGED', 'The prepared output changed. Review the current preview before keeping it.');
        return result.materialAddress
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
      const next = await openWorkspace({ storage, locks, fixture, key });
      // Caller receives the old draft explicitly; no automatic merge or save.
      return { workspace: next, recovery };
    },
  };
}
