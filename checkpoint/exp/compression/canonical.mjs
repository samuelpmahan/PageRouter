import {canonicalJson} from '../canonical-json/canonical-json.mjs';

/** canonical-json@1 with -0 kept apart from 0: this codec is lossless and must tell them apart on decode. */
export function canonical(value) {
  return canonicalJson(value, {negativeZero: 'preserve'});
}

export function clone(value) {
  return JSON.parse(canonical(value));
}

export function byteLength(value) {
  return new TextEncoder().encode(canonical(value)).byteLength;
}

/** Freeze a JSON tree in place, children first. Was a copy in feedback.mjs and graph.mjs. */
export function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
