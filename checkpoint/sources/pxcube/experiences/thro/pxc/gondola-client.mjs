// Gondola browser mount client for Cross-Seam Transport ({MOUNT}.{px|oc}.*).
// Zero external dependencies; local-first with offline outbox persistence.

// Garth's local cabin is only tried when the editor itself runs on this computer; on thro.dev it goes straight to /api/gondola.
const onLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname ?? '');
const DEFAULT_LOCAL_URL = 'http://127.0.0.1:7866/pxc/gondola/cabin';
const DEFAULT_FALLBACK_URL = '/api/gondola';
const DEFAULT_OUTBOX_KEY = 'thro.gondola.outbox.v1';
const DEFAULT_TIMEOUT_MS = 1500;
const MAX_OUTBOX_ITEMS = 100;

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (typeof fetchImpl !== 'function') return null;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readOutbox(storage, key) {
  try {
    const raw = storage?.getItem?.(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendOutbox(storage, key, entry) {
  try {
    if (!storage?.setItem) return;
    const next = [...readOutbox(storage, key), entry].slice(-MAX_OUTBOX_ITEMS);
    storage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage unavailable or quota full: keep in-flight operation non-throwing.
  }
}

export function createGondolaMount(mountName, options = {}) {
  const mount = String(mountName || '').trim();
  if (!mount) throw new Error('Gondola mount name is required.');

  const localUrl = options.localUrl ?? (onLocalHost() ? DEFAULT_LOCAL_URL : null);
  const fallbackUrl = options.fallbackUrl ?? DEFAULT_FALLBACK_URL;
  const storageKey = options.storageKey ?? DEFAULT_OUTBOX_KEY;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const getStorage = () => options.storage ?? globalThis.localStorage;
  const getFetch = () => options.fetch ?? globalThis.fetch?.bind(globalThis);

  async function postCabin(url, body) {
    const res = await fetchWithTimeout(getFetch(), url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }, timeoutMs);
    if (!res || !res.ok) return null;
    try { return await res.json(); } catch { return { ok: true }; }
  }

  return Object.freeze({
    mount,
    async oc(name, payload, meta = {}) {
      const action = String(name || '').trim();
      if (!action) throw new Error('Gondola oc name is required.');
      const cabin = {
        mount,
        kind: 'oc',
        address: `${mount}.oc.${action}`,
        payload,
        ts: new Date().toISOString(),
        ...meta,
      };
      const body = JSON.stringify(cabin);
      let deliveredVia = 'offline';
      let remote = localUrl ? await postCabin(localUrl, body) : null;
      if (remote) {
        deliveredVia = 'local';
      } else if (fallbackUrl) {
        remote = await postCabin(fallbackUrl, body);
        if (remote) deliveredVia = 'fallback';
      }
      const receipt = { ok: true, deliveredVia, cabin, remote };
      appendOutbox(getStorage(), storageKey, { cabin, deliveredVia, savedAt: cabin.ts });
      return receipt;
    },

    async px(name) {
      const queryName = String(name || '').trim();
      if (!queryName) return null;
      const base = localUrl ?? fallbackUrl;
      const sep = base.includes('?') ? '&' : '?';
      const url = `${base}${sep}mount=${encodeURIComponent(mount)}&name=${encodeURIComponent(queryName)}`;
      const res = await fetchWithTimeout(getFetch(), url, { method: 'GET' }, timeoutMs);
      if (!res || !res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    },

    outbox() {
      return readOutbox(getStorage(), storageKey);
    },
  });
}
