export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const prefix = 'thro-interned@1:';
const minimumTokenLength = 512;
const maxDictionary = Math.ceil(MAX_ARCHIVE_BYTES / minimumTokenLength);
const maxSegments = maxDictionary * 2 + 1;
const maxContainerBytes = MAX_ARCHIVE_BYTES * 8 + 4096;
const encoder = new TextEncoder();
const quotedTokens = /"(?:[^"\\]|\\.)*"/g;
const quotedToken = /^"(?:[^"\\]|\\.)*"$/;
const failure = (code, message) => Object.assign(Error(message), { code });
const invalid = message => failure('THRO_ARCHIVE_INVALID', message);
const tooLarge = () => failure('THRO_ARCHIVE_TOO_LARGE', 'The archive exceeds the 64 MiB raw-data limit.');

function rawSize(raw) {
  if (typeof raw !== 'string') throw invalid('Archive data must be a string.');
  if (raw.length > MAX_ARCHIVE_BYTES) throw tooLarge();
  const bytes = encoder.encode(raw).byteLength;
  if (bytes > MAX_ARCHIVE_BYTES) throw tooLarge();
  return bytes;
}

/**
 * Intern exact repeated long quoted tokens, not parsed JSON values. Literal
 * spans retain whitespace and escape spelling. The injected codecs supply the
 * existing gzip format; no Part, address, image or SVG is omitted or rewritten.
 */
export function createArchiveCodec({ pack, unpack } = {}) {
  if (typeof pack !== 'function' || typeof unpack !== 'function') {
    throw invalid('Archive pack and unpack functions are required.');
  }
  return Object.freeze({
    async packArchive(raw) {
      rawSize(raw);
      // One scan of the raw text: the long tokens and where they are, kept for the second step (it used to scan twice).
      const counts = new Map(), long = [];
      for (const match of raw.matchAll(quotedTokens)) {
        const token = match[0];
        if (token.length >= minimumTokenLength) { counts.set(token, (counts.get(token) ?? 0) + 1); long.push(match.index, token); }
      }
      const dictionary = [], references = new Map();
      for (const [token, count] of counts) if (count > 1) {
        references.set(token, dictionary.length); dictionary.push(token);
      }
      const segments = []; let cursor = 0;
      for (let i = 0; i < long.length; i += 2) {
        const index = long[i], token = long[i + 1], reference = references.get(token);
        if (reference === undefined) continue;
        segments.push(raw.slice(cursor, index), reference);
        cursor = index + token.length;
      }
      segments.push(raw.slice(cursor));
      const container = JSON.stringify({ version: 1, dictionary, segments });
      const packed = await pack(container);
      if (typeof packed !== 'string') throw invalid('Archive packer returned non-string data.');
      if (packed.length > maxContainerBytes) throw tooLarge();
      return prefix + packed;
    },
    async unpackArchive(packed) {
      if (packed === null) return null;
      if (typeof packed !== 'string') throw invalid('Stored archive data must be a string.');
      if (packed.length > maxContainerBytes) throw tooLarge();
      if (!packed.startsWith(prefix)) {
        const raw = await unpack(packed); rawSize(raw); return raw;
      }
      const text = await unpack(packed.slice(prefix.length));
      if (typeof text !== 'string') throw invalid('Archive unpacker returned non-string data.');
      if (text.length > maxContainerBytes || encoder.encode(text).byteLength > maxContainerBytes) throw tooLarge();
      let contents;
      try { contents = JSON.parse(text); }
      catch { throw invalid('The interned archive container is malformed.'); }
      if (!contents || Array.isArray(contents) || contents.version !== 1
          || !Array.isArray(contents.dictionary) || !Array.isArray(contents.segments)
          || contents.dictionary.length > maxDictionary || contents.segments.length > maxSegments) {
        throw invalid('The interned archive structure is invalid.');
      }
      const { dictionary, segments } = contents;
      const sizes = []; let dictionaryBytes = 0;
      for (const token of dictionary) {
        if (typeof token !== 'string' || token.length > MAX_ARCHIVE_BYTES || !quotedToken.test(token)) {
          throw invalid('An interned token is not one bounded quoted string.');
        }
        const size = encoder.encode(token).byteLength;
        dictionaryBytes += size;
        if (dictionaryBytes > MAX_ARCHIVE_BYTES) throw tooLarge();
        sizes.push(size);
      }
      const pieces = []; let totalBytes = 0, totalCharacters = 0;
      for (const segment of segments) {
        let piece, size;
        if (typeof segment === 'string') {
          piece = segment;
          if (piece.length > MAX_ARCHIVE_BYTES) throw tooLarge();
          size = encoder.encode(piece).byteLength;
        } else if (Number.isSafeInteger(segment) && segment >= 0 && segment < dictionary.length) {
          piece = dictionary[segment]; size = sizes[segment];
        } else throw invalid('An archive segment contains an invalid token reference or type.');
        totalBytes += size; totalCharacters += piece.length;
        if (totalBytes > MAX_ARCHIVE_BYTES || totalCharacters > MAX_ARCHIVE_BYTES) throw tooLarge();
        pieces.push(piece);
      }
      return pieces.join('');
    },
  });
}

const cellPrefix = 'thro-workspace-cell@2:';
function metadataCopy(value) {
  let values = 0;
  const copy = (item, depth = 0) => {
    if (++values > 20000 || depth > 64) throw invalid('Workspace metadata exceeds its structural budget.');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || ![Object.prototype, Array.prototype].includes(Object.getPrototypeOf(item))) throw invalid('Workspace metadata must be JSON data.');
    const out = Array.isArray(item) ? [] : {};
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key) || !field.enumerable || !Object.hasOwn(field, 'value')) throw invalid('Invalid workspace metadata field.');
      if (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key)) throw invalid('Invalid workspace metadata array.');
      out[key] = copy(field.value, depth + 1);
    }
    if (Array.isArray(item) && Object.keys(out).length !== item.length) throw invalid('Sparse workspace metadata is unsupported.');
    return out;
  };
  const result = copy(value);
  if (!result || Array.isArray(result) || Object.keys(result).length !== 2 || !Object.hasOwn(result, 'origin') || !Object.hasOwn(result, 'extensions')
    || !result.origin || Array.isArray(result.origin) || typeof result.origin !== 'object' || !result.extensions || Array.isArray(result.extensions) || typeof result.extensions !== 'object'
    || encoder.encode(JSON.stringify(result)).byteLength > 65536) throw invalid('Workspace metadata exceeds its supported envelope.');
  return result;
}

/** Per-workspace wrapper: metadata and the existing exact graph commit as one cell. */
export function createWorkspaceCodec({ pack, unpack, metadata = null } = {}) {
  const archive = createArchiveCodec({ pack, unpack });
  let retained = metadata === null ? null : metadataCopy(metadata);
  return Object.freeze({
    get metadata() { return retained === null ? null : metadataCopy(retained); },
    async packArchive(raw) {
      const packed = await archive.packArchive(raw);
      return retained === null ? packed : cellPrefix + JSON.stringify({ version: 2, metadata: retained, archive: packed });
    },
    async unpackArchive(packed) {
      if (typeof packed !== 'string' || !packed.startsWith(cellPrefix)) return archive.unpackArchive(packed);
      if (packed.length > maxContainerBytes + 70000) throw tooLarge();
      let cell; try { cell = JSON.parse(packed.slice(cellPrefix.length)); } catch { throw invalid('Malformed workspace cell.'); }
      if (!cell || Array.isArray(cell) || cell.version !== 2 || Object.keys(cell).length !== 3 || !Object.hasOwn(cell, 'metadata') || typeof cell.archive !== 'string') throw invalid('Unsupported workspace cell.');
      const next = metadataCopy(cell.metadata), raw = await archive.unpackArchive(cell.archive);
      retained = next; return raw;
    },
  });
}
