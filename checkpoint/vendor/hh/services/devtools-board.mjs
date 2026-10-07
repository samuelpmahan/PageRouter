import {HH_PORTS} from './contract.mjs';

const SECRET_KEYS = /password|credential|token|secret|authorization|cookie/i;
function displayData(value, capabilityFlags = false, seen = new Set()) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => SECRET_KEYS.test(key))) return false;
    } catch { /* Plain text is not a URL. */ }
    return true;
  }
  if (value === null || ['undefined', 'boolean', 'number'].includes(typeof value)) return true;
  if (typeof value !== 'object' || !Object.isFrozen(value)) return false;
  if (seen.has(value)) return true;
  const prototype = Object.getPrototypeOf(value);
  if (![Object.prototype, Array.prototype, null].includes(prototype)) return false;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return false; // Never evaluate getters.
    if (SECRET_KEYS.test(key) && !(capabilityFlags && typeof descriptor.value === 'boolean')) return false;
    if (!displayData(descriptor.value, capabilityFlags, seen)) return false;
  }
  return true;
}

/** Read-only view of real runtime Parts, not a second board or execution log. */
export function createReadonlyDevToolsBoard(pxc, {fixture} = {}) {
  if (fixture !== true) throw new TypeError('HH DevTools inspection is fixture-only.');
  const serviceAddresses = new Set(HH_PORTS.map((port) => `hh.service.${port}`));
  function visibleEntries() {
    const entries = pxc.entries().filter(([address, part]) => {
      if (serviceAddresses.has(address)) return typeof part.value === 'function' && part.composition === null;
      if (address === 'hh.contract') return part.composition === null && displayData(part.value);
      if (address === 'hh.capabilities') return part.composition === null && displayData(part.value, true);
      if (/^hh\.(request|result)\.[1-9]\d*$/.test(address)) return displayData(part.value);
      return false;
    });
    const parts = new Set(entries.map(([, part]) => part));
    // Produced Parts are shown only when all actual composition edges stay in view.
    const closed = entries.filter(([, part]) => !part.composition ||
      (parts.has(part.composition.calculation) && serviceAddresses.has(entries.find(([, p]) => p === part.composition.calculation)?.[0]) &&
       Object.values(part.composition.inputs).every((input) => parts.has(input) && input.composition === null)));
    return Object.freeze(closed.map((entry) => Object.freeze(entry)));
  }
  function receipts() {
    const entries = visibleEntries();
    const byAddress = new Map(entries);
    const parts = new Set(byAddress.values());
    return Object.freeze(pxc.receipts().filter((receipt) => receipt.status === 'produced' &&
      /^hh\.result\.[1-9]\d*$/.test(receipt.into) && byAddress.get(receipt.into) === receipt.output &&
      parts.has(receipt.composition.calculation) &&
      Object.values(receipt.composition.inputs).every((part) => parts.has(part))));
  }
  const denied = () => { throw new TypeError('HH DevTools board is read-only.'); };
  return Object.freeze({entries: visibleEntries,
    get(address) {
      const part = visibleEntries().find(([name]) => name === address)?.[1];
      if (!part) throw new Error('Missing visible HH Part.');
      return part;
    },
    receipts, set: denied, async compose() { denied(); }});
}
