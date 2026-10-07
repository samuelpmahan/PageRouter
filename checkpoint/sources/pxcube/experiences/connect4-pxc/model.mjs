import { applyConnect4Event, projectConnect4Tree, restoreConnect4State } from './rules.mjs';

const clone = value => structuredClone(value);

// This is the same game transition as the baseline, now executed by real PxC
// function-valued Parts. Callers supply the existing PxC runtime module so
// the cartridge and Node tests use the exact same Part/PxC implementation.
export function createConnect4PxCRuntime({ initialState = null, Part, PxC } = {}) {
  if (typeof Part !== 'function' || typeof PxC !== 'function') throw new TypeError('Connect4 PxC runtime needs the existing Part and PxC constructors.');
  const pxc = new PxC();
  pxc.set('connect4.initial-state', new Part(restoreConnect4State(initialState)));
  pxc.set('connect4.transition', new Part(async ({ state, event }) => applyConnect4Event(state, event)));
  pxc.set('connect4.state', new Part(async ({ transition }) => transition.state));
  pxc.set('connect4.seek', new Part(async ({ state }) => projectConnect4Tree(state)));

  let stateAddress = 'connect4.initial-state';
  let transitionSequence = 0;
  let projectionSequence = 0;
  let queue = Promise.resolve();
  const serialize = action => {
    const next = queue.then(action, action);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  function inspect() {
    const entries = pxc.entries();
    const addressByPart = new Map(entries.map(([address, part]) => [part, address]));
    const calculationKinds = new Map([
      ['connect4.transition', 'transition'],
      ['connect4.state', 'state'],
      ['connect4.seek', 'projection'],
    ]);
    return Object.freeze({
      modelKind: 'Connect4 live PxC Parts',
      state: clone(pxc.get(stateAddress).value),
      currentState: stateAddress,
      parts: Object.freeze(entries.map(([address, part]) => Object.freeze({
        address,
        kind: typeof part.value === 'function' ? (calculationKinds.get(address) ?? 'functionPart') : 'valuePart',
        valueType: typeof part.value === 'function' ? 'function' : typeof part.value,
        part: 'actual',
      }))),
      receipts: Object.freeze(pxc.receipts().map(receipt => {
        const composition = receipt.composition ?? {};
        const calculation = addressByPart.get(composition.calculation) ?? null;
        return Object.freeze({
          status: receipt.status,
          into: receipt.into,
          kind: calculationKinds.get(calculation) ?? 'calculation',
          calculation,
          inputNames: Object.freeze(Object.keys(composition.inputs ?? {})),
          inputs: Object.freeze(Object.fromEntries(Object.entries(composition.inputs ?? {})
            .map(([name, part]) => [name, addressByPart.get(part) ?? null]))),
        });
      })),
    });
  }

  return Object.freeze({
    dispatch(event) {
      return serialize(async () => {
        const sequence = ++transitionSequence;
        const requestAddress = `connect4.input.event.${sequence}`;
        const transitionAddress = `connect4.output.transition.${sequence}`;
        const outputAddress = `connect4.output.state.${sequence}`;
        pxc.set(requestAddress, new Part(clone(event)));
        const transition = await pxc.compose({
          into: transitionAddress,
          calculation: 'connect4.transition',
          inputs: { state: stateAddress, event: requestAddress },
        });
        const output = await pxc.compose({
          into: outputAddress,
          calculation: 'connect4.state',
          inputs: { transition: transitionAddress },
        });
        stateAddress = outputAddress;
        return { ...transition.value, state: clone(output.value) };
      });
    },
    seek() {
      return serialize(async () => {
        const sequence = ++projectionSequence;
        const outputAddress = `connect4.output.projection.${sequence}`;
        const output = await pxc.compose({
          into: outputAddress,
          calculation: 'connect4.seek',
          inputs: { state: stateAddress },
        });
        return output.value;
      });
    },
    state() { return clone(pxc.get(stateAddress).value); },
    inspect,
    pxc,
  });
}
