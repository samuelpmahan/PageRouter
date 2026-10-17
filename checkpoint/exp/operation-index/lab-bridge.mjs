import { normalizeLabExecution } from './adapters.mjs';

export const LAB_OBSERVATION_SCHEMA = 'capability-atlas.lab-observation/v1';
export const LAB_OBSERVATION_MAX_BYTES = 512 * 1024;
const receiptKeys = new WeakMap();
let nextReceiptKey = 0;
const PRODUCER_SESSION_ID = createSessionId();

function createSessionId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* Use the local fallback when browser crypto is unavailable. */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function receiptKey(receipt, sessionId) {
  if (!receipt || typeof receipt !== 'object') return undefined;
  let bySession = receiptKeys.get(receipt);
  if (!bySession) {
    bySession = new Map();
    receiptKeys.set(receipt, bySession);
  }
  let key = bySession.get(sessionId);
  if (!key) {
    key = `lab-receipt-${sessionId}-${++nextReceiptKey}`;
    bySession.set(sessionId, key);
  }
  return key;
}

function safeClock(now) {
  try {
    const value = now();
    if (Number.isFinite(value)) return value;
  } catch { /* A diagnostic clock cannot interrupt the native run. */ }
  try { return Date.now(); } catch { return 0; }
}

function isFiniteJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  let valid = true;
  if (Array.isArray(value)) valid = value.every(item => isFiniteJson(item, seen));
  else {
    const proto = Object.getPrototypeOf(value);
    valid = (proto === Object.prototype || proto === null) && Object.entries(value).every(([key, item]) => typeof key === 'string' && isFiniteJson(item, seen));
  }
  seen.delete(value);
  return valid;
}

function safeError(error) {
  const message = typeof error?.message === 'string' ? error.message : String(error);
  return message.slice(0, 1000);
}

function boundedMessage(payload, maxBytes) {
  if (!isFiniteJson(payload)) return null;
  let serialized;
  try { serialized = JSON.stringify(payload); } catch { return null; }
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).byteLength > maxBytes) return null;
  return payload;
}

/**
 * Observe only the synchronous native runtime boundary. The observer is best-effort:
 * postMessage errors never replace the runtime's return value or exception.
 */
export function observeLabRun({ action, id, prior, run, env = globalThis, now = () => Date.now(), maxBytes = LAB_OBSERVATION_MAX_BYTES, sessionId = PRODUCER_SESSION_ID }) {
  if (typeof run !== 'function') throw new TypeError('observeLabRun requires a run function');
  const safeSessionId = typeof sessionId === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(sessionId) ? sessionId : PRODUCER_SESSION_ID;
  const startedAt = safeClock(now);
  let execution;
  let replayReport;
  let failure;
  try {
    const result = run();
    if (action === 'replay') {
      replayReport = result;
      execution = result?.receipt;
    } else execution = result;
    const finishedAt = Math.max(startedAt, safeClock(now));
    const observation = {
      schema: LAB_OBSERVATION_SCHEMA,
      action,
      id,
      startedAt,
      finishedAt,
      status: 'succeeded',
      execution,
      receiptKey: receiptKey(execution, safeSessionId),
    };
    if (action === 'replay') {
      observation.replay = {
        matches: replayReport?.matches,
        exact: replayReport?.exact,
        hash: replayReport?.hash,
        mismatches: replayReport?.mismatches,
        priorReceiptKey: receiptKey(prior, safeSessionId),
      };
    }
    deliver(observation, env, maxBytes);
    return result;
  } catch (error) {
    failure = error;
    const finishedAt = Math.max(startedAt, safeClock(now));
    deliver({ schema: LAB_OBSERVATION_SCHEMA, action, id, startedAt, finishedAt, status: 'failed', error: safeError(error) }, env, maxBytes);
    throw failure;
  }
}

function deliver(payload, env, maxBytes) {
  try {
    const parent = env?.parent;
    if (!parent || parent === env || typeof parent.postMessage !== 'function') return;
    const bounded = boundedMessage(payload, maxBytes);
    if (!bounded) return;
    const origin = env.location?.origin;
    if (typeof origin !== 'string' || origin === 'null') return;
    parent.postMessage(bounded, origin);
  } catch { /* Delivery must never affect native runtime behavior. */ }
}

function validObservation(payload, maxBytes) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isFiniteJson(payload)) return false;
  if (payload.schema !== LAB_OBSERVATION_SCHEMA || !['execute', 'replay'].includes(payload.action)) return false;
  if (typeof payload.id !== 'string' || payload.id.length > 160) return false;
  if (!Number.isFinite(payload.startedAt) || !Number.isFinite(payload.finishedAt) || payload.finishedAt < payload.startedAt) return false;
  if (payload.status !== 'succeeded' && payload.status !== 'failed') return false;
  if (payload.status === 'succeeded' && (!payload.execution || typeof payload.execution !== 'object')) return false;
  if (payload.status === 'succeeded' && (typeof payload.receiptKey !== 'string' || payload.receiptKey.length > 128)) return false;
  if (payload.action === 'replay' && payload.status === 'succeeded' && typeof payload.replay?.priorReceiptKey !== 'string') return false;
  if (payload.status === 'failed' && (typeof payload.error !== 'string' || payload.error.length > 1000 || 'execution' in payload)) return false;
  try { return new TextEncoder().encode(JSON.stringify(payload)).byteLength <= maxBytes; } catch { return false; }
}

/** Build a parent-side listener that accepts messages only from the designated frame and origin. */
export function createLabMessageHandler({ getFrame, origin, index, source, maxBytes = LAB_OBSERVATION_MAX_BYTES, normalize = normalizeLabExecution }) {
  if (typeof getFrame !== 'function') throw new TypeError('getFrame must be a function');
  if (!index || typeof index.record !== 'function') throw new TypeError('index.record is required');
  const receiptRecords = new Map();
  return function handleLabMessage(event) {
    if (!event || event.origin !== origin) return false;
    let frame;
    try { frame = getFrame(); } catch { return false; }
    if (!frame?.contentWindow || event.source !== frame.contentWindow) return false;
    const payload = event.data;
    if (!validObservation(payload, maxBytes)) return false;

    let normalized = { status: 'failed', operations: [], edges: [], evidence: [] };
    if (payload.status === 'succeeded') {
      try { normalized = normalize(payload.execution, { replay: payload.action === 'replay' }) ?? normalized; }
      catch { normalized = { status: 'failed', operations: [], edges: [], evidence: [] }; }
    }
    const replayOf = payload.action === 'replay' && payload.replay?.priorReceiptKey
      ? receiptRecords.get(payload.replay.priorReceiptKey)
      : undefined;
    const record = index.record({
      runtime: 'capability-lab', action: payload.action, source,
      startedAt: payload.startedAt, finishedAt: payload.finishedAt,
      status: payload.status === 'failed' ? 'failed' : normalized.status ?? 'succeeded',
      operations: payload.status === 'failed' ? [] : normalized.operations ?? [],
      edges: payload.status === 'failed' ? [] : normalized.edges ?? [],
      evidence: payload.status === 'failed'
        ? [{ kind: 'runtime-error', message: payload.error }]
        : normalized.evidence ?? [],
      ...(replayOf ? { replayOf } : {}),
      ...(payload.action === 'replay' ? { replay: payload.replay } : {}),
    });
    if (payload.status === 'succeeded' && record?.id) {
      receiptRecords.set(payload.receiptKey, record.id);
    }
    return record ?? true;
  };
}
