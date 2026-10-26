// A store-only zip writer (no compression, no dependencies): enough to hand a video editor one file holding a PNG per disc.
// PNG is already compressed, so storing loses nothing. Entries are UTF-8 named; sizes up to 4 GB (no zip64).
const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, as zip stores them (local time, 2-second steps, years from 1980).
function dosStamp(date) {
  const year = Math.max(1980, date.getFullYear());
  return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() };
}

/** entries: [{ name, data: Uint8Array }]. Returns the zip file's bytes. */
export function zipStore(entries, { date = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length > 0xffff) throw Error('A zip holds up to 65535 files.');
  const encoder = new TextEncoder(), stamp = dosStamp(date), names = new Set();
  const prepared = entries.map(({ name, data }) => {
    if (typeof name !== 'string' || !name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw Error(`Unsafe zip entry name: ${name}`);
    if (names.has(name)) throw Error(`Two zip entries are named ${name}.`);
    names.add(name);
    if (!(data instanceof Uint8Array)) throw Error(`Zip entry ${name} needs bytes.`);
    return { name: encoder.encode(name), data, crc: crc32(data) };
  });
  const local = prepared.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0), central = prepared.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = local + central + 22;
  if (total > 0xffffffff) throw Error('This zip would be over 4 GB.');
  const out = new Uint8Array(total), view = new DataView(out.buffer);
  let at = 0; const offsets = [];
  const u16 = v => { view.setUint16(at, v, true); at += 2; }, u32 = v => { view.setUint32(at, v, true); at += 4; };
  for (const e of prepared) {
    offsets.push(at);
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date); u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0);
    out.set(e.name, at); at += e.name.length; out.set(e.data, at); at += e.data.length;
  }
  const centralStart = at;
  prepared.forEach((e, i) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date); u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i]);
    out.set(e.name, at); at += e.name.length;
  });
  const centralSize = at - centralStart;
  u32(0x06054b50); u16(0); u16(0); u16(prepared.length); u16(prepared.length); u32(centralSize); u32(centralStart); u16(0);
  return out;
}

/** Read a zip written by zipStore (store-only): [{ name, data }]. For tests and for checking what was downloaded. */
export function unzipStore(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error('Not a zip file.');
  const count = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true); const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw Error('Broken zip directory.');
    const method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true), size = view.getUint32(at + 24, true), nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), offset = view.getUint32(at + 42, true);
    if (method !== 0) throw Error('Only stored entries can be read here.');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true), data = bytes.slice(start, start + size);
    if (crc32(data) !== crc) throw Error(`Checksum mismatch in ${name}.`);
    entries.push({ name, data }); at += 46 + nameLength + extra + comment;
  }
  return entries;
}
