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
      const counts = new Map();
      for (const match of raw.matchAll(quotedTokens)) {
        const token = match[0];
        if (token.length >= minimumTokenLength) counts.set(token, (counts.get(token) ?? 0) + 1);
      }
      const dictionary = [], references = new Map();
      for (const [token, count] of counts) if (count > 1) {
        references.set(token, dictionary.length); dictionary.push(token);
      }
      const segments = []; let cursor = 0;
      for (const match of raw.matchAll(quotedTokens)) {
        const reference = references.get(match[0]);
        if (reference === undefined) continue;
        segments.push(raw.slice(cursor, match.index), reference);
        cursor = match.index + match[0].length;
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
