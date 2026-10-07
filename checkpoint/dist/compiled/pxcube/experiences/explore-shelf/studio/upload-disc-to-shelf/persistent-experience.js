import { createExperience } from './model.js';
import { archive, restore, storageKey } from './persistence.js';

export async function openExperience(storage                                      , log                                           ) {
  let status = 'Local storage ready · changes are saved on Save or Keep.', blocked = false, state;
  try {
    const raw = storage.getItem(storageKey);
    if (raw !== null) { state = await restore(raw, createExperience(() => {}).pxc); status = 'Restored local shelf · composition outputs verified.'; }
  } catch (error) { blocked = true; status = `Recovery required: ${String(error)} Stored bytes preserved; writes blocked.`; }
  const experience = createExperience(log, { state, status: () => status, persist(next) {
    if (blocked) throw Error(status);
    try {
      const raw = archive(next);
      storage.setItem(storageKey, raw);
      status = 'Saved locally · survives reload on this browser and origin.';
    } catch (error) { status = `Not saved locally: ${String(error)} Previous stored shelf preserved.`; throw Error(status); }
  } });
  return experience;
}
