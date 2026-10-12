// validateJson and canonicalJson live in exp/kernel/canonical.mjs; this module
// re-exports them so block5 modules keep importing them from ./canonical.mjs.
import { canonicalJson, validateJson } from '../../kernel/canonical.mjs';

export { canonicalJson, validateJson };

export function hashState(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonicalJson(value))) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function cloneJson(value) {
  validateJson(value);
  return structuredClone(value);
}
