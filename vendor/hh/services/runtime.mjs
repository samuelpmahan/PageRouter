import {Part, PxC} from './pxc.mjs';
import {HH_PORTS, HH_CONTRACT_VERSION, failure, deepFreeze, clone} from './contract.mjs';
import {createReadonlyDevToolsBoard} from './devtools-board.mjs';

const SECRET_KEYS = /password|credential|token|secret|authorization|cookie/i;
function unsafeInput(value, seen = new Set()) {
  if (typeof value === 'string') {
    try { const url = new URL(value); return !!(url.username || url.password) || [...url.searchParams.keys()].some((key) => SECRET_KEYS.test(key)); }
    catch { return false; }
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => SECRET_KEYS.test(key) || unsafeInput(child, seen));
}
function freezeInput(value) {
  return deepFreeze(clone(value));
}

/** Provider DI and explicit service execution through the recovered real PxC kernel. */
export function createServiceRuntime(provider) {
  if (!provider || !['fixture', 'http'].includes(provider.mode) ||
      HH_PORTS.some((port) => typeof provider.services?.[port] !== 'function')) throw new TypeError('Provider must implement every HH service port.');
  const pxc = new PxC();
  pxc.set('hh.contract', new Part(deepFreeze({kind: 'TeacherJourneyContract', version: HH_CONTRACT_VERSION, ports: HH_PORTS})));
  pxc.set('hh.provider', new Part(provider));
  pxc.set('hh.capabilities', new Part(provider.capabilities));
  pxc.set('hh.calculation.bind-service-functions', new Part(({provider: selected}) => Object.freeze(Object.fromEntries(
    HH_PORTS.map((port) => [port, new Part(async ({request}) => {
      try { return await selected.services[port](request); }
      catch { return failure(port, selected.mode, 'provider_failure', 'The selected provider failed. Check state before trying again.', {outcomeKnown: false}); }
    })]),
  ))));
  const ready = pxc.compose({into: 'hh.service-bindings', calculation: 'hh.calculation.bind-service-functions', inputs: {provider: 'hh.provider'}})
    .then((part) => {
      for (const [port, functionPart] of Object.entries(part.value)) pxc.set(`hh.service.${port}`, functionPart);
      return part;
    });
  let sequence = 0;
  async function invoke(port, input = {}, boundary = {}) {
    // Check before even recording an input Part. Error messages never echo rejected values.
    if (!HH_PORTS.includes(port)) return failure(String(port), provider.mode, 'unknown_port', 'Unknown HH service port.');
    if (unsafeInput(input)) return failure(port, provider.mode, 'unsafe_input', 'Credentials must stay outside fixture Parts and storage.');
    let credentialConfirmationValid;
    if (boundary?.credentials !== undefined) {
      const {password, confirmPassword} = boundary.credentials || {};
      credentialConfirmationValid = typeof password === 'string' && password.length > 0 && password === confirmPassword;
      // Only the boolean crosses the Part boundary. Raw values are never retained or returned.
    }
    const request = freezeInput({...input, ...(credentialConfirmationValid === undefined ? {} : {confirmationValid: credentialConfirmationValid})});
    await ready;
    const id = ++sequence;
    const requestAddress = `hh.request.${id}`;
    pxc.set(requestAddress, new Part(request));
    try {
      const part = await pxc.compose({into: `hh.result.${id}`, calculation: `hh.service.${port}`, inputs: {request: requestAddress}});
      return part.value;
    } catch {
      // Provider errors cannot leak untrusted error text or credentials into public results.
      return failure(port, provider.mode, 'provider_failure', 'The selected provider failed. Check state before trying again.', {outcomeKnown: false});
    }
  }
  function inspect() {
    // Safe projections avoid serializing provider closures or arbitrary thrown errors.
    return deepFreeze({contractVersion: HH_CONTRACT_VERSION, mode: provider.mode,
      parts: pxc.entries().map(([address, part]) => ({address, kind: typeof part.value === 'function' ? 'functionPart' : address === 'hh.provider' ? 'providerPart' : 'valuePart'})),
      receipts: pxc.receipts().map((r) => ({status: r.status, into: r.into,
        inputNames: Object.keys(r.composition.inputs), calculationKind: 'functionPart'}))});
  }
  const devtoolsBoard = provider.fixture === true && provider.mode === 'fixture'
    ? createReadonlyDevToolsBoard(pxc, {fixture: true}) : null;
  return Object.freeze({pxc, ready, invoke, snapshot: provider.snapshot, inspect, devtoolsBoard, capabilities: provider.capabilities,
    mode: provider.mode, fixture: provider.fixture});
}
