import {
  applyWatchAction,
  canonicalWatchJson,
  componentSources,
  describeWatchComponent,
  replayWatchRun,
  watchGeometry,
} from '../watches/index.mjs';
import { buildEvidenceContext, checkExplanationClaims } from './grounding.mjs';

const TRACE_VERSION = 'explain-watch-1';
const MAX_STATE_BYTES = 1_048_576;
const MAX_STATE_DEPTH = 64;
const MAX_STATE_NODES = 100_000;
const supportedQuestions = new Set([
  'selected-component', 'energy-path', 'timing-path', 'current-vs-nominal-rate',
  'divider', 'gear-ratio', 'tick-boundary', 'view-invariance', 'physical-accuracy',
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new TypeError(`${label} must be a plain object`);
  return value;
}

function utf8Length(text) {
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Bound traversal before canonicalization, then require an exact retained-run replay. */
function verifyWatchState(state) {
  const topLevel = new Set([
    'schema', 'config', 'rates', 'time', 'paused', 'visibilityHidden', 'energy',
    'operatingTime', 'cycles', 'counters', 'displayTime', 'softwareTransport',
    'models', 'history', 'calculationTrace',
  ]);
  for (const key of Object.keys(state)) if (!topLevel.has(key)) throw new TypeError(`unknown watch state field ${key}`);

  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  const charge = amount => {
    bytes += amount;
    if (bytes > MAX_STATE_BYTES) throw new RangeError(`watch state exceeds ${MAX_STATE_BYTES} bytes before canonicalization`);
  };
  const visit = (value, path, depth) => {
    nodes += 1;
    if (nodes > MAX_STATE_NODES) throw new RangeError(`watch state exceeds ${MAX_STATE_NODES} JSON nodes`);
    if (depth > MAX_STATE_DEPTH) throw new RangeError(`watch state exceeds maximum JSON depth ${MAX_STATE_DEPTH}`);
    if (value === null) { charge(4); return; }
    if (typeof value === 'boolean') { charge(value ? 4 : 5); return; }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new TypeError(`${path} must be finite`);
      charge(JSON.stringify(value).length);
      return;
    }
    if (typeof value === 'string') { charge(utf8Length(value) + 2); return; }
    if (typeof value !== 'object') throw new TypeError(`${path} must contain only JSON values`);
    if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} must be a plain JSON array`);
      if (value.length > MAX_STATE_NODES) throw new RangeError(`${path} exceeds the bounded array length`);
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => key !== 'length' && !(typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length))) throw new TypeError(`${path} contains a non-index array property`);
      charge(2 + Math.max(0, value.length - 1));
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is sparse`);
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}[${index}] must be a plain data value`);
        visit(value[index], `${path}[${index}]`, depth + 1);
      }
    } else {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain only plain JSON objects`);
      if (Object.getOwnPropertySymbols(value).length) throw new TypeError(`${path} cannot contain symbol properties`);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const entries = Object.entries(descriptors);
      charge(2 + Math.max(0, entries.length - 1));
      for (const [key, descriptor] of entries) {
        if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new TypeError(`${path}.${key} must be a plain data value`);
        charge(utf8Length(key) + 3);
        visit(value[key], `${path}.${key}`, depth + 1);
      }
    }
    ancestors.delete(value);
  };
  visit(state, 'state', 0);

  const stateCanonical = canonicalWatchJson(state);
  const actualBytes = utf8Length(stateCanonical);
  if (actualBytes > MAX_STATE_BYTES) throw new RangeError(`watch state exceeds ${MAX_STATE_BYTES} canonical bytes`);
  let replay;
  try {
    replay = replayWatchRun(state.config, state.history?.actions).state;
  } catch (error) {
    throw new TypeError(`watch state could not be replayed from its retained config and actions: ${error.message}`);
  }
  const replayCanonical = canonicalWatchJson(replay);
  const matches = replayCanonical === stateCanonical;
  const verification = {
    id: 'src/watches/index.mjs#replayWatchRun',
    source: 'capability-lab',
    version: TRACE_VERSION,
    input: {
      configIdentity: identity(canonicalWatchJson(state.config), 'watch-config'),
      actionCount: state.history.actions.length,
      actionsIdentity: identity(canonicalWatchJson(state.history.actions), 'watch-actions'),
    },
    result: {
      matched: matches,
      replayIdentity: identity(replayCanonical, 'watch-state'),
      stateIdentity: identity(stateCanonical, 'watch-state'),
      canonicalBytes: actualBytes,
      eventCount: state.history.events.length,
    },
  };
  if (!matches) throw new TypeError('watch state does not match a fresh replay of its retained config and actions');
  return { stateCanonical, verification };
}

function clone(value) {
  return JSON.parse(canonicalWatchJson(value));
}

function identity(value, prefix) {
  const canonical = typeof value === 'string' ? value : canonicalWatchJson(value);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(canonical)) {
    hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `${prefix}:${hash.toString(16).padStart(16, '0')}`;
}

function sourceRecords(stateIdentity) {
  return [
    ...componentSources().map(source => ({
      ...source,
      title: source.id,
      identity: 'watch-sources-v1',
    })),
    {
      id: 'watch-state',
      title: 'Retained simulated watch run state',
      scope: 'simulation state and counters',
      identity: stateIdentity,
      url: null,
    },
  ];
}

function sourceFact(source, field) {
  const isLimit = field === 'limits';
  return {
    id: `source:${source.id}:${field}`,
    value: source[field],
    unit: isLimit ? 'scope limitation' : 'source note',
    kind: 'fact',
    permittedScopes: ['source.mechanismFact'],
    citationIds: [source.id],
  };
}

function sourceEvidence(sources, ids) {
  const byId = new Map(sources.map(source => [source.id, source]));
  const evidence = [];
  for (const id of [...new Set(ids)]) {
    const source = byId.get(id);
    if (source) {
      evidence.push(sourceFact(source, 'supports'));
      evidence.push(sourceFact(source, 'limits'));
    }
  }
  return evidence;
}

function stateEvidence({ id, value, unit, kind = 'simulation', scope, citationIds = ['watch-state'] }) {
  return { id, value, unit, kind, permittedScopes: [scope], citationIds };
}

function sourceForComponent(component) {
  return component?.source ? [component.source.id] : [];
}

function traceForState(state) {
  const calls = Array.isArray(state.calculationTrace?.calls) ? clone(state.calculationTrace.calls) : [];
  return calls;
}

function geometryCall(state, stateIdentity, explode, selected) {
  const input = { stateIdentity, explode, selected };
  const geometry = watchGeometry(state, explode, selected);
  const canonical = canonicalWatchJson(geometry);
  return {
    record: {
      id: 'src/watches/geometry.mjs#watchGeometry',
      source: 'capability-lab',
      version: TRACE_VERSION,
      input,
      result: {
        canonicalIdentity: identity(canonical, 'geometry'),
        canonicalBytes: new TextEncoder().encode(canonical).length,
        watchCount: geometry.watches.length,
        partCount: geometry.watches.reduce((sum, watch) => sum + watch.parts.length, 0),
      },
    },
    canonical,
  };
}

function buildContext({ stateIdentity, modelIdentity, questionId, componentId, evidence, sourceKind = 'curated-source' }) {
  const sources = sourceRecords(stateIdentity);
  return buildEvidenceContext({
    contextId: `watch-explanation:${questionId}:${componentId ?? 'none'}:${stateIdentity}`,
    stateIdentity,
    modelIdentity,
    sourceKind,
    sources,
    evidence,
  });
}

function roleScope(component) {
  if (component.roleStatus !== 'fact') return null;
  if (component.role === 'energy' && component.valueStatus === 'simulation' && typeof component.value === 'boolean') return 'watch.energyRole';
  if (component.role === 'timing' && component.valueStatus === 'simulation' && component.id !== 'quartz.divider') return 'watch.timingRole';
  if (component.role === 'display' && component.valueStatus === 'derived') return 'watch.displayAngle';
  return null;
}

function componentEvidenceValue(component) {
  if (component.id === 'quartz.divider' && Array.isArray(component.value)) {
    return { value: component.value.map(stage => stage.outputCount), unit: 'modeled divider stage output counts in order', scope: 'watch.counter' };
  }
  if (component.role === 'energy' && typeof component.value === 'number' && Number.isSafeInteger(component.value)) {
    return { value: component.value, unit: component.unit, scope: 'watch.counter' };
  }
  if (component.id.endsWith('.goingTrain') || component.id === 'quartz.gears') {
    return { value: component.value, unit: component.unit, scope: 'watch.gearRatio' };
  }
  if (component.role === 'display' && typeof component.value === 'number' && Number.isFinite(component.value)) {
    return { value: component.value, unit: component.unit, scope: 'watch.displayAngle' };
  }
  if (component.role === 'control' || component.role === 'support' || component.roleStatus !== 'fact' || component.valueStatus === 'illustrative') return null;
  if (typeof component.value === 'number' && Number.isSafeInteger(component.value)) {
    return { value: component.value, unit: component.unit, scope: 'watch.counter' };
  }
  if (component.value && typeof component.value === 'object' && !Array.isArray(component.value)
      && Number.isSafeInteger(component.value.numerator) && Number.isSafeInteger(component.value.denominator)) {
    return { value: component.value, unit: component.unit, scope: 'watch.counter' };
  }
  if (Array.isArray(component.value) && component.value.every(Number.isSafeInteger)) {
    return { value: component.value, unit: component.unit, scope: 'watch.counter' };
  }
  if (component.id === 'mechanical.palletFork' && ['lock', 'release', 'impulse'].includes(component.value)) {
    return { value: component.value, unit: component.unit, scope: 'watch.timingRole' };
  }
  return null;
}

function rateDetails(state, model, currentKey, nominalKey) {
  const details = {
    currentHz: clone(model[currentKey]),
    nominalHz: clone(model[nominalKey]),
  };
  return {
    details,
    evidence: [
      stateEvidence({ id: `rate:${model === state.models.mechanical ? 'mechanical' : model === state.models.quartz ? 'quartz' : 'software'}:current`, value: details.currentHz, unit: 'rational hertz', scope: 'watch.currentRate' }),
      stateEvidence({ id: `rate:${model === state.models.mechanical ? 'mechanical' : model === state.models.quartz ? 'quartz' : 'software'}:nominal`, value: details.nominalHz, unit: 'rational hertz', scope: 'watch.nominalRate' }),
    ],
  };
}

function addOneSecond(state) {
  return applyWatchAction(state, { type: 'advance', duration: { numerator: 1, denominator: 1 }, origin: 'manual' });
}

function counters(state) {
  return {
    mechanicalBeats: state.counters.mechanicalBeats,
    quartzCycles: state.counters.quartzCycles,
    motorCommands: state.counters.motorCommands,
    softwareUpdates: state.counters.softwareUpdates,
  };
}

function checkedEvidence(context) {
  const claims = context.evidence.map(item => ({
    evidenceId: item.id,
    value: item.value,
    unit: item.unit,
    kind: item.kind,
    scope: item.permittedScopes[0],
    citationIds: item.citationIds,
  }));
  return checkExplanationClaims({ context, draft: {
    contextId: context.contextId,
    stateIdentity: context.stateIdentity,
    modelIdentity: context.modelIdentity,
    claims,
  } });
}

/** Explain one selected, retained watch state with its actual values and source-bound context. */
export function explainWatch(input) {
  object(input, 'input');
  for (const key of Object.keys(input)) if (!['state', 'componentId', 'questionId'].includes(key)) throw new TypeError(`unknown explainWatch field ${key}`);
  const state = object(input.state, 'state');
  if (typeof input.questionId !== 'string' || input.questionId.trim() === '') throw new TypeError('questionId must be a non-empty string');
  if (input.componentId !== undefined && (typeof input.componentId !== 'string' || input.componentId.trim() === '')) throw new TypeError('componentId must be a non-empty string when supplied');
  const questionId = input.questionId;
  const componentId = input.componentId;
  const { stateCanonical, verification } = verifyWatchState(state);
  const stateIdentity = identity(stateCanonical, 'watch-state');
  const modelIdentity = identity({ config: state.config, models: state.models }, 'watch-model');
  const sources = componentSources();
  const evidence = [];
  const calls = [verification, ...traceForState(state)];
  let component = null;
  if (componentId !== undefined) component = describeWatchComponent(state, componentId);

  let selectedTick = null;
  let unsupportedTickReason = null;
  if (questionId === 'tick-boundary') {
    const action = state.history?.actions?.at(-1);
    if (action?.type !== 'step') {
      unsupportedTickReason = 'No explicit step action is selected. The latest stored range may aggregate several event types, so this answer will not guess which one is the selected tick.';
    } else {
      const modelByEvent = { mechanicalBeat: 'mechanical', quartzCycle: 'quartz', motorCommand: 'quartz', softwareUpdate: 'software' };
      const selectedSequence = state.history.actions.length;
      selectedTick = state.history.events.find(event => event.session === state.history.session
        && event.sequence === selectedSequence
        && event.event === action.event && event.model === modelByEvent[action.event]);
      if (!selectedTick) unsupportedTickReason = `The latest ${action.event} step has no matching retained range for this session.`;
    }
  }

  if (!supportedQuestions.has(questionId) || unsupportedTickReason) {
    const reason = unsupportedTickReason ?? 'This question is outside the checked watch evidence set. No physical measurement or universal mechanism claim is inferred.';
    const unsupportedEvidence = unsupportedTickReason
      ? sourceEvidence(sources, ['fixed-timestep-author']).filter(item => item.unit === 'scope limitation')
      : [];
    const unsupportedContext = unsupportedEvidence.length ? buildContext({
      stateIdentity,
      modelIdentity,
      questionId,
      componentId,
      evidence: unsupportedEvidence,
    }) : null;
    return {
      schema: 'explain.watch.v1', supported: false, stateIdentity, modelIdentity,
      component: component ? clone(component) : null,
      question: { id: questionId, explanation: null, ...(unsupportedTickReason ? { selectedAction: clone(state.history.actions.at(-1)) } : {}) },
      limitation: reason,
      evidence: unsupportedEvidence,
      sources: unsupportedContext ? sourceRecords(stateIdentity) : [],
      calculationTrace: { calls, bytes: state.calculationTrace?.bytes ?? 0 },
      context: unsupportedContext,
      ...(unsupportedContext ? { checkedClaims: checkedEvidence(unsupportedContext) } : {}),
    };
  }

  let question;
  let citedSourceIds = [];
  if (questionId === 'selected-component') {
    if (!component) throw new TypeError('selected-component requires componentId');
    citedSourceIds = sourceForComponent(component);
    const recognizedScope = roleScope(component);
    const componentEvidence = recognizedScope ? { value: component.value, unit: component.unit, scope: recognizedScope } : componentEvidenceValue(component);
    if (componentEvidence) {
      evidence.push(stateEvidence({
        id: component.id, value: componentEvidence.value, unit: componentEvidence.unit,
        kind: component.valueStatus, scope: componentEvidence.scope,
      }));
    }
    if (citedSourceIds.length) evidence.push(...sourceEvidence(sources, citedSourceIds));
    question = {
      id: questionId,
      explanation: `${component.name} is classified as ${component.roleStatus} role evidence with a ${component.valueStatus} value. ${component.formula}`,
      role: component.role,
      roleStatus: component.roleStatus,
      valueStatus: component.valueStatus,
      statePath: component.statePath,
    };
  } else if (questionId === 'energy-path') {
    const mechanical = describeWatchComponent(state, 'mechanical.mainspring');
    const quartz = describeWatchComponent(state, 'quartz.battery');
    evidence.push(stateEvidence({ id: mechanical.id, value: mechanical.value, unit: mechanical.unit, scope: 'watch.energyRole' }));
    evidence.push(stateEvidence({ id: quartz.id, value: quartz.value, unit: quartz.unit, scope: 'watch.energyRole' }));
    citedSourceIds = [mechanical.source.id, quartz.source.id];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    const powerOff = applyWatchAction(state, { type: 'energy', source: 'mainspring', enabled: false });
    const afterOneSecond = addOneSecond(powerOff);
    const beforeCounts = counters(state);
    const afterCounts = counters(afterOneSecond);
    calls.push(...traceForState(powerOff), ...traceForState(afterOneSecond));
    evidence.push(stateEvidence({ id: 'watch.energyPath.powerOffBeats', value: [beforeCounts.mechanicalBeats, afterCounts.mechanicalBeats], unit: 'mechanical beat counts before and after one modeled second with mainspring disabled', scope: 'watch.counter' }));
    question = {
      id: questionId,
      mechanical: { componentId: mechanical.id, available: mechanical.value, sourceId: mechanical.source.id },
      quartz: { componentId: quartz.id, available: quartz.value, sourceId: quartz.source.id },
      currentPath: {
        mechanical: { energyAvailable: clone(state.models.mechanical.energy.available), timingAvailable: clone(state.models.mechanical.timing.available), beats: state.models.mechanical.counts.beats, fullOscillations: clone(state.models.mechanical.counts.fullOscillations), gearTrain: clone(state.models.mechanical.gearTrain), handAnglesDegrees: clone(state.models.mechanical.handAnglesDegrees) },
        quartz: { energyAvailable: clone(state.models.quartz.energy.available), timingAvailable: clone(state.models.quartz.timing.available), referenceCycles: state.models.quartz.counts.referenceCycles, dividerStages: clone(state.models.quartz.dividerStages), motorCommands: state.models.quartz.counts.motorCommands, gearTrain: clone(state.models.quartz.gearTrain), handAnglesDegrees: clone(state.models.quartz.handAnglesDegrees) },
      },
      counterexample: {
        actions: [{ type: 'energy', source: 'mainspring', enabled: false }, { type: 'advance', duration: { numerator: 1, denominator: 1 }, origin: 'manual' }],
        beforeCounts,
        afterCounts,
        calculationTrace: [...traceForState(powerOff), ...traceForState(afterOneSecond)],
      },
      explanation: 'The mainspring and battery are separate modeled energy paths. Their booleans indicate whether each idealized path is enabled; they are not torque, voltage, or reserve measurements.',
    };
  } else if (questionId === 'timing-path') {
    const mechanical = describeWatchComponent(state, 'mechanical.balanceWheel');
    const quartz = describeWatchComponent(state, 'quartz.crystal');
    const software = describeWatchComponent(state, 'software.logicalTime');
    evidence.push(stateEvidence({ id: mechanical.id, value: mechanical.value, unit: mechanical.unit, scope: 'watch.timingRole' }));
    evidence.push(stateEvidence({ id: quartz.id, value: quartz.value, unit: quartz.unit, scope: 'watch.timingRole' }));
    evidence.push(stateEvidence({ id: 'software.logicalTime', value: software.value, unit: software.unit, kind: 'simulation', scope: 'watch.counter' }));
    citedSourceIds = [mechanical.source.id, quartz.source.id, software.source.id];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    const currentMechanicalHz = state.models.mechanical.frequencyHz.numerator / state.models.mechanical.frequencyHz.denominator;
    const alternateHz = currentMechanicalHz > 0 ? { numerator: 0, denominator: 1 } : clone(state.models.mechanical.nominalFrequencyHz);
    const rateChanged = applyWatchAction(state, { type: 'rate', model: 'mechanical', hz: alternateHz });
    const afterRateSecond = addOneSecond(rateChanged);
    const beforeCount = state.models.mechanical.counts.beats;
    const afterCount = afterRateSecond.models.mechanical.counts.beats;
    calls.push(...traceForState(rateChanged), ...traceForState(afterRateSecond));
    evidence.push(stateEvidence({ id: 'watch.timingPath.rateCounterexample', value: [beforeCount, afterCount], unit: 'mechanical beats before and after one modeled second at alternate current rate', scope: 'watch.counter' }));
    question = {
      id: questionId,
      mechanical: { oscillatorCycles: mechanical.value, timing: clone(state.models.mechanical.timing) },
      quartz: { referenceCycles: quartz.value, timing: clone(state.models.quartz.timing) },
      software: { logicalTime: software.value, updates: clone(state.models.software.counts.updates) },
      counterexample: {
        action: { type: 'rate', model: 'mechanical', hz: alternateHz },
        duration: { numerator: 1, denominator: 1 },
        beforeMechanicalBeats: beforeCount,
        afterMechanicalBeats: afterCount,
        changedRate: alternateHz,
        calculationTrace: [...traceForState(rateChanged), ...traceForState(afterRateSecond)],
      },
      explanation: 'The selected oscillator or logical update schedule determines modeled event timing. The software update count is separate from browser render callbacks.',
    };
  } else if (questionId === 'current-vs-nominal-rate') {
    const mech = rateDetails(state, state.models.mechanical, 'frequencyHz', 'nominalFrequencyHz');
    const quartz = rateDetails(state, state.models.quartz, 'frequencyHz', 'nominalFrequencyHz');
    const software = rateDetails(state, state.models.software, 'timingHz', 'nominalTimingHz');
    evidence.push(...mech.evidence, ...quartz.evidence, ...software.evidence);
    citedSourceIds = ['grand-seiko-mechanical', 'seiko-quartz-education', 'fixed-timestep-author'];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    question = {
      id: questionId,
      mechanical: mech.details,
      quartz: quartz.details,
      software: software.details,
      explanation: 'Current rates schedule later modeled events. Nominal rates stay fixed at the run configuration and define the teaching display gearing. A configured quartz rate is an example, not a universal specification.',
    };
  } else if (questionId === 'divider') {
    const stages = clone(state.models.quartz.dividerStages);
    const firstStage = stages[0] ?? null;
    const lastStage = stages.at(-1) ?? null;
    evidence.push(stateEvidence({ id: 'quartz.dividerStageOutputCounts', value: stages.map(stage => stage.outputCount), unit: 'modeled divide-by-two stage output counts in order', scope: 'watch.counter' }));
    evidence.push(stateEvidence({ id: 'quartz.referenceCycles', value: state.models.quartz.counts.referenceCycles, unit: 'reference cycles', scope: 'watch.counter' }));
    citedSourceIds = ['seiko-quartz-education'];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    question = {
      id: questionId,
      stageCount: stages.length,
      firstStage,
      lastStage,
      referenceCycleCount: state.models.quartz.counts.referenceCycles,
      explanation: stages.length === 0
        ? 'This run configures no divider stages, so the model has no divided output stages to inspect.'
        : `${stages.length} configured divide-by-two stages are shown from the retained state. This is a teaching configuration; quartz watches can use other frequencies and divider designs.`,
    };
  } else if (questionId === 'gear-ratio') {
    const modelNames = componentId?.startsWith('quartz.') ? ['quartz'] : componentId?.startsWith('mechanical.') ? ['mechanical'] : ['mechanical', 'quartz'];
    const trains = Object.fromEntries(modelNames.map(name => [name, clone(state.models[name].gearTrain)]));
    for (const name of modelNames) {
      evidence.push(stateEvidence({ id: `${name}.gearTrain`, value: trains[name], unit: 'teaching turns and gear ratios', kind: 'derived', scope: 'watch.gearRatio', citationIds: ['watch-state', 'gear-ratio-reference'] }));
    }
    citedSourceIds = ['gear-ratio-reference'];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    question = {
      id: questionId,
      trains,
      explanation: 'The displayed tooth counts and ratios are the model’s teaching gear train. They show how rotations are reduced and directions reverse at external meshes; they do not identify a specific watch caliber.',
    };
  } else if (questionId === 'tick-boundary') {
    const event = selectedTick;
    const modelName = event?.model ?? null;
    citedSourceIds = modelName === 'mechanical'
      ? ['grand-seiko-mechanical']
      : modelName === 'quartz'
        ? ['seiko-quartz-education', 'grand-seiko-quartz']
        : modelName === 'software'
          ? ['fixed-timestep-author', 'mdn-animation-frame']
          : ['fixed-timestep-author'];
    if (event) evidence.push(stateEvidence({ id: 'watch.lastEvent', value: clone(event), unit: 'retained compact event range', scope: 'watch.counter' }));
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    const explanations = {
      mechanicalBeat: 'One retained mechanical beat is half of a full balance oscillation; two escapement beats make one full oscillation in this model.',
      quartzCycle: 'A quartzCycle counts one reference oscillator cycle. It is not one motor command; the divider accumulates cycles before a command.',
      motorCommand: 'A motorCommand is a generic modeled drive command after the divider, not a universal electrical pulse pattern.',
      softwareUpdate: 'A softwareUpdate advances the logical model schedule; it is not a requestAnimationFrame callback or a physical watch tick.',
    };
    question = {
      id: questionId,
      event: event ? clone(event) : null,
      explanation: event ? explanations[event.event] : 'No event range has been retained yet, so there is no selected tick to explain.',
    };
  } else if (questionId === 'view-invariance') {
    const beforeState = canonicalWatchJson(state);
    const assembled = geometryCall(state, stateIdentity, 0, null);
    const selected = componentId ?? 'mechanical.escapeWheel';
    const exploded = geometryCall(state, stateIdentity, 0.75, selected);
    const afterState = canonicalWatchJson(state);
    const unchanged = beforeState === afterState;
    const changedGeometry = assembled.canonical !== exploded.canonical;
    calls.push(assembled.record, exploded.record);
    const countersBefore = {
      mechanicalBeats: state.counters.mechanicalBeats,
      quartzCycles: state.counters.quartzCycles,
      motorCommands: state.counters.motorCommands,
      updates: state.counters.softwareUpdates,
    };
    const countersAfter = { ...countersBefore };
    evidence.push(stateEvidence({
      id: 'watch.view.invariance',
      value: { stateUnchanged: unchanged, countersBefore, countersAfter, geometryChanged: changedGeometry },
      unit: 'state and counter invariance with changed illustrative geometry',
      kind: 'derived',
      scope: 'watch.renderingInvariant',
      citationIds: ['watch-state', 'fixed-timestep-author', 'mdn-animation-frame'],
    }));
    citedSourceIds = ['fixed-timestep-author', 'mdn-animation-frame'];
    evidence.push(...sourceEvidence(sources, citedSourceIds));
    question = {
      id: questionId,
      stateUnchanged: unchanged,
      beforeIdentity: identity(beforeState, 'watch-state'),
      afterIdentity: identity(afterState, 'watch-state'),
      assembledGeometryIdentity: assembled.record.result.canonicalIdentity,
      explodedGeometryIdentity: exploded.record.result.canonicalIdentity,
      geometryChanged: changedGeometry,
      countersBefore,
      countersAfter,
      explanation: 'The geometry function receives explosion and selection as view arguments. It returns a different schematic transform while the canonical watch state and retained counters remain unchanged.',
    };
  } else {
    citedSourceIds = ['grand-seiko-mechanical', 'seiko-quartz-education', 'grand-seiko-quartz', 'fixed-timestep-author'];
    evidence.push(...sourceEvidence(sources, citedSourceIds).filter(item => item.unit === 'scope limitation'));
    question = {
      id: questionId,
      explanation: 'A physical accuracy claim is unsupported by this idealized model. It has no measured caliber, instrument readings, temperature response, friction, or tolerance data.',
    };
  }

  const context = buildContext({
    stateIdentity,
    modelIdentity,
    questionId,
    componentId,
    evidence,
  });
  const checked = checkedEvidence(context);
  return {
    schema: 'explain.watch.v1',
    supported: questionId !== 'physical-accuracy',
    stateIdentity,
    modelIdentity,
    component: component ? clone(component) : null,
    question,
    limitation: questionId === 'physical-accuracy'
      ? 'No physical measurement, caliber-specific tolerance, temperature response, friction, or hardware accuracy is present in this teaching state.'
      : 'Model state is an idealized simulation; cited mechanism references describe their stated scope and do not validate this schematic as a physical watch.',
    evidence: clone(evidence),
    sources: sourceRecords(stateIdentity),
    calculationTrace: { calls, bytes: new TextEncoder().encode(canonicalWatchJson(calls)).length },
    context,
    checkedClaims: checked,
  };
}
