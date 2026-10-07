import { applyConnect4Event, projectConnect4Tree, restoreConnect4State } from './rules.mjs';

const clone = value => structuredClone(value);

// Baseline cartridge runtime: ordinary game state and pure rules, with no PxC
// calculation store. The ROM only dispatches input edges and caches seek().
export function createConnect4PlainRuntime({ initialState = null } = {}) {
  let state = restoreConnect4State(initialState);
  let queue = Promise.resolve();
  const serialize = action => {
    const next = queue.then(action, action);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };

  return Object.freeze({
    dispatch(event) {
      return serialize(() => {
        const transition = applyConnect4Event(state, event);
        state = transition.state;
        return { ...transition, state: clone(state) };
      });
    },
    seek() { return serialize(() => projectConnect4Tree(state)); },
    state() { return clone(state); },
  });
}
