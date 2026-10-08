import { canonicalJson, validateJson } from './canonical.mjs';
import { hashState } from './canonical.mjs';
import { PROVIDER_IDENTITY } from './providers.mjs';

export function validateTickStream(stream) {
  validateJson(stream, 'tick stream');
  if (!stream || stream.format !== 'pagerouter.block5.tick-stream.v1') throw new TypeError('Unsupported Block5 tick stream format.');
  if (canonicalJson(stream.source) !== canonicalJson(PROVIDER_IDENTITY)) throw new TypeError('Tick stream provider identity mismatch.');
  if (!Array.isArray(stream.events) || !Array.isArray(stream.diagnosticEvents)) throw new TypeError('Tick stream needs semantic and diagnostic event arrays.');
  const eventIds = new Set();
  const outputOwners = new Map();
  for (const [ordinal, event] of stream.events.entries()) {
    if (event.kind !== 'calculation' || event.sequence !== ordinal * 2 || !Number.isInteger(event.tick) || event.tick < 0) throw new TypeError(`Invalid semantic event at ordinal ${ordinal}.`);
    if (typeof event.id !== 'string' || !event.id || eventIds.has(event.id) || typeof event.calculation !== 'string') throw new TypeError(`Invalid semantic event identity at ordinal ${ordinal}.`);
    if (canonicalJson(event.provider) !== canonicalJson(PROVIDER_IDENTITY)) throw new TypeError(`Provider identity mismatch at event ${event.id}.`);
    if (!Array.isArray(event.inputRefs) || event.inputRefs.length !== 2 || !Array.isArray(event.inputs) || event.inputs.length !== 2) throw new TypeError(`Event ${event.id} must retain exactly two inputs and refs.`);
    if (typeof event.outputRef !== 'string' || event.outputRef !== `event:${event.id}:output`) throw new TypeError(`Invalid outputRef for ${event.id}.`);
    const expectedDependencies = event.inputRefs.flatMap(ref => outputOwners.has(ref) ? [outputOwners.get(ref)] : []);
    if (canonicalJson(event.dependencies) !== canonicalJson(expectedDependencies)) throw new TypeError(`Dependencies do not match prior output refs for ${event.id}.`);
    if (event.stateHash !== hashState(event.output)) throw new TypeError(`State hash does not match output for ${event.id}.`);
    eventIds.add(event.id);
    outputOwners.set(event.outputRef, event.id);
  }
  const diagnosticSequences = new Set();
  const byEvent = new Map();
  let recipeStart = null;
  let simulationStart = null;
  let simulationEnd = null;
  for (const event of stream.diagnosticEvents) {
    if (!event || typeof event.id !== 'string' || diagnosticSequences.has(event.sequence)) throw new TypeError('Diagnostic event IDs and sequences must be unique.');
    diagnosticSequences.add(event.sequence);
    if (event.kind === 'recipe') {
      if (recipeStart || event.sequence !== -2 || event.recipeRef !== 'input:recipe' || event.recipeHash !== hashState(stream.recipe)) throw new TypeError('Invalid recipe lifecycle event.');
      recipeStart = event;
    } else if (event.kind === 'simulation' && event.phase === 'start') {
      if (simulationStart || event.sequence !== -1 || event.initialStateHash !== hashState(stream.initialState)) throw new TypeError('Invalid simulation start event.');
      simulationStart = event;
    } else if (event.kind === 'simulation' && event.phase === 'end') {
      if (simulationEnd || event.sequence !== stream.events.length * 2 + 1 || event.finalStateHash !== stream.finalStateHash || event.eventCount !== stream.events.length) throw new TypeError('Invalid simulation end event.');
      simulationEnd = event;
    } else if (event.kind === 'cache') {
      if (byEvent.has(event.eventId)) throw new TypeError(`Repeated cache diagnostic for ${event.eventId}.`);
      byEvent.set(event.eventId, event);
      for (const key of ['cacheHit', 'mayAffect', 'didAffect', 'firstExecution']) if (typeof event[key] !== 'boolean') throw new TypeError(`Diagnostic ${event.id} needs Boolean ${key}.`);
    } else throw new TypeError(`Unknown diagnostic event kind: ${String(event.kind)}.`);
  }
  if (!recipeStart || !simulationStart || !simulationEnd || byEvent.size !== stream.events.length) throw new TypeError('Recipe, simulation, and per-calculation lifecycle diagnostics are incomplete.');
  for (const [ordinal, semantic] of stream.events.entries()) {
    const diagnostic = byEvent.get(semantic.id);
    if (!diagnostic || diagnostic.sequence !== ordinal * 2 + 1 || diagnostic.tick !== semantic.tick) throw new TypeError(`Invalid cache diagnostic for ${semantic.id}.`);
  }
  for (const sequence of diagnosticSequences) if (new Set(stream.events.map(event => event.sequence)).has(sequence)) throw new TypeError(`Semantic and diagnostic sequences collide at ${sequence}.`);
  const endStateHash = stream.events.at(-1)?.stateHash ?? hashState(stream.initialState);
  if (stream.finalStateHash !== endStateHash || simulationEnd.finalStateHash !== endStateHash) throw new TypeError('Stream final state hash does not match the final semantic output.');
  return stream;
}
