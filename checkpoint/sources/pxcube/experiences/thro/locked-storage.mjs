const identity = value => value;
const codes = Object.freeze({
  conflict: 'THRO_STORAGE_CONFLICT', unavailable: 'THRO_STORAGE_UNAVAILABLE',
  changed: 'THRO_STORAGE_CHANGED', uncertain: 'THRO_STORAGE_UNCERTAIN',
});
function failure(code, message, cause) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}
const isStorageFailure = error => Object.values(codes).includes(error?.code);

/**
 * One new thro archive, with a staged raw value and a confirmed durable value.
 * Codecs encode/decode strings; null means no archive exists. Every writer of
 * this key must use this lock protocol. The lock is local to the browser origin,
 * not an account, authentication mechanism, or cross-device transaction.
 */
export async function openLockedArchive(storage, key, {
  locks = globalThis.navigator?.locks, pack = identity, unpack = identity,
} = {}) {
  if (typeof key !== 'string' || !/^thro[.:]/.test(key)) {
    throw failure(codes.unavailable, 'Only a new thro storage namespace may be opened.');
  }
  if (typeof storage?.getItem !== 'function' || typeof storage?.setItem !== 'function'
      || typeof pack !== 'function' || typeof unpack !== 'function') {
    throw failure(codes.unavailable, 'Archive storage or its codecs are unavailable.');
  }
  let heldPacked, committedRaw;
  try {
    heldPacked = storage.getItem(key);
    if (heldPacked !== null && typeof heldPacked !== 'string') throw Error('Invalid stored archive bytes.');
    committedRaw = heldPacked === null ? null : await unpack(heldPacked);
    if (committedRaw !== null && typeof committedRaw !== 'string') throw Error('Invalid decoded archive bytes.');
  } catch (cause) {
    throw failure(codes.unavailable, 'The saved archive could not be opened. Stored bytes were not changed.', cause);
  }
  let pendingRaw = committedRaw, latched = null;
  const lockName = `thro.archive:${key}`;
  const stop = (code, message, cause) => {
    const error = failure(code, message, cause);
    if (code === codes.conflict || code === codes.uncertain) latched = error;
    return error;
  };
  return Object.freeze({
    getItem: () => pendingRaw,
    setItem(_ignored, raw) {
      if (typeof raw !== 'string') throw failure(codes.unavailable, 'A staged archive must contain raw string bytes.');
      pendingRaw = raw;
    },
    get committedRaw() { return committedRaw; },
    get pendingRaw() { return pendingRaw; },
    async flush() {
      if (latched) throw latched;
      if (typeof locks?.request !== 'function') {
        throw failure(codes.unavailable, 'Safe saving requires browser lock support. The pending archive is retained.');
      }
      const candidate = pendingRaw;
      if (candidate === committedRaw) return;
      let packed;
      try {
        packed = await pack(candidate);
        if (typeof packed !== 'string') throw Error('Invalid encoded archive bytes.');
      } catch (cause) {
        throw failure(codes.unavailable, 'The pending archive could not be encoded. It is retained without a write.', cause);
      }
      if (pendingRaw !== candidate) {
        throw failure(codes.changed, 'The draft changed during compression. Its latest raw bytes are retained.');
      }
      let attemptedWrite = false;
      try {
        await locks.request(lockName, { mode: 'exclusive' }, () => {
          if (latched) throw latched;
          if (pendingRaw !== candidate) {
            throw failure(codes.changed, 'The draft changed while waiting to save. Its latest raw bytes are retained.');
          }
          // Another flush of this same adapter may already have committed it.
          if (candidate === committedRaw) return;
          let latest;
          try { latest = storage.getItem(key); }
          catch (cause) { throw failure(codes.unavailable, 'The saved archive could not be checked. No write was attempted.', cause); }
          if (latest !== heldPacked) {
            throw stop(codes.conflict, 'This archive changed elsewhere. The pending draft is retained; reload before saving.');
          }
          if (pendingRaw !== candidate) {
            throw failure(codes.changed, 'The draft changed before the write. Its latest raw bytes are retained.');
          }
          attemptedWrite = true;
          try { storage.setItem(key, packed); }
          catch (cause) {
            let observed;
            try { observed = storage.getItem(key); }
            catch (readCause) {
              throw stop(codes.uncertain, 'The write outcome could not be checked. No rollback was attempted; reload before saving.', readCause);
            }
            if (observed === heldPacked) {
              throw failure(codes.unavailable, 'The archive write failed. Previous stored bytes and the pending draft are retained.', cause);
            }
            throw stop(codes.uncertain, 'Stored bytes changed during a failed write. No rollback was attempted; reload before saving.', cause);
          }
          let observed;
          try { observed = storage.getItem(key); }
          catch (cause) {
            throw stop(codes.uncertain, 'The written archive could not be read back. No rollback was attempted; reload before saving.', cause);
          }
          if (observed !== packed) {
            throw stop(codes.uncertain, 'Archive readback differs from the attempted write. No rollback was attempted; reload before saving.');
          }
          heldPacked = packed;
          committedRaw = candidate;
        });
      } catch (cause) {
        if (isStorageFailure(cause)) throw cause;
        if (attemptedWrite) {
          throw stop(codes.uncertain, 'The save lock failed after a write began. No rollback was attempted; reload before saving.', cause);
        }
        throw failure(codes.unavailable, 'The save lock could not be acquired. The pending draft is retained.', cause);
      }
    },
  });
}
