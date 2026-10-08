import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceContext, checkExplanationClaims, groundingLimits } from '../../src/explain/grounding.mjs';
import { componentSources, describeWatchComponent } from '../../src/watches/components.mjs';
import { mechanismSnapshot } from '../../src/watches/mechanisms.mjs';
import { explainWatch } from '../../src/explain/watch.mjs';
import { applyWatchAction, watchStateAt } from '../../src/watches/index.mjs';

const identity = { contextId: 'ctx-a', stateIdentity: 'watch-state:abc', modelIdentity: 'ml-model:def' };
const watchSource = componentSources().find(source => source.id === 'grand-seiko-quartz');
const source = { ...watchSource, title: 'Grand Seiko quartz overview', identity: 'watch-sources-v1' };
const evidence = {
  id: 'quartz.motorCommands', value: 60, unit: 'commands', kind: 'simulation',
  permittedScopes: ['watch.counter'], citationIds: [source.id], stateIdentity: identity.stateIdentity,
};
function makeContext(changes = {}) {
  return buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: [evidence], ...changes });
}
function draft(context, claimChanges = {}, changes = {}) {
  return {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: evidence.id, value: evidence.value, unit: evidence.unit, kind: evidence.kind, scope: 'watch.counter', citationIds: [source.id], ...claimChanges }],
    ...changes,
  };
}

test('a matching claim is rendered from the actual evidence and source citation', () => {
  const context = makeContext();
  const result = checkExplanationClaims({ context, draft: draft(context) });
  assert.equal(result.accepted, true);
  assert.match(result.renderedText, /60 commands/);
  assert.match(result.renderedText, /grand-seiko-quartz/);
  assert.equal(result.claims[0].evidenceId, evidence.id);
  assert.equal(result.contextId, identity.contextId);
});

test('independent real mechanism output can be bound to a component description', () => {
  const time = { numerator: 60, denominator: 1 };
  const output = mechanismSnapshot({}, {
    time, operatingTime: { mechanical: time, quartz: time },
    displayTime: { mechanical: time, quartz: time, software: time },
    cycles: { mechanicalBeats: { numerator: 480, denominator: 1 }, quartzCycles: { numerator: 1_966_080, denominator: 1 } },
    counters: { mechanicalBeats: 480, quartzCycles: 1_966_080, motorCommands: 60 },
    energy: { mainspring: true, battery: true },
  });
  const description = describeWatchComponent({ models: output }, 'quartz.rotor');
  assert.equal(description.value, 60);
  const rotorSource = { ...description.source, title: 'Grand Seiko 9F source', identity: 'watch-sources-v1' };
  const ctx = buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [rotorSource], evidence: [{
    id: description.id, value: description.value, unit: description.unit, kind: description.valueStatus,
    permittedScopes: ['watch.counter'], citationIds: [rotorSource.id], stateIdentity: identity.stateIdentity,
  }] });
  assert.equal(checkExplanationClaims({ context: ctx, draft: {
    contextId: ctx.contextId, stateIdentity: ctx.stateIdentity, modelIdentity: ctx.modelIdentity,
    claims: [{ evidenceId: description.id, value: 60, unit: 'commands', kind: 'simulation', scope: 'watch.counter', citationIds: [rotorSource.id] }],
  } }).accepted, true);
});

test('energy and timing role values must bind to the declared component and watch state', () => {
  const stateSource = { id: 'watch-state', url: null, title: 'Retained watch run', scope: 'watch model state', identity: identity.stateIdentity };
  const batteryEvidence = { id: 'quartz.battery', value: true, unit: 'boolean', kind: 'simulation', permittedScopes: ['watch.energyRole'], citationIds: ['watch-state'], stateIdentity: identity.stateIdentity };
  const context = buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: [batteryEvidence] });
  const accepted = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: batteryEvidence.id, value: true, unit: 'boolean', kind: 'simulation', scope: 'watch.energyRole', citationIds: ['watch-state'] }],
  } });
  assert.equal(accepted.accepted, true);
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: [{ ...batteryEvidence, value: 'battery measured at 1.5 V' }] }), /watch.energyRole value must match its declared component type/);
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: [{ ...batteryEvidence, id: 'quartz.crystal' }] }), /does not identify a curated energy component/);
});

test('declared counter-proxy, phase-enum, and divider-stage component values keep their real units', () => {
  const time = { numerator: 60, denominator: 1 };
  const output = mechanismSnapshot({}, {
    time, operatingTime: { mechanical: time, quartz: time }, displayTime: { mechanical: time, quartz: time, software: time },
    cycles: { mechanicalBeats: { numerator: 480, denominator: 1 }, quartzCycles: { numerator: 1_966_080, denominator: 1 } },
    counters: { mechanicalBeats: 480, quartzCycles: 1_966_080, motorCommands: 60 }, energy: { mainspring: true, battery: true },
  });
  const state = { models: output };
  const rotor = describeWatchComponent(state, 'quartz.rotor');
  const escapement = describeWatchComponent(state, 'mechanical.palletFork');
  const divider = describeWatchComponent(state, 'quartz.divider');
  assert.equal(rotor.value, 60);
  assert.equal(escapement.value, 'lock');
  assert.equal(divider.value[14].outputCount, 60);
  const stateSource = { id: 'watch-state', url: null, title: 'Retained watch run', scope: 'watch model state', identity: identity.stateIdentity };
  const entries = [rotor, escapement, divider].map(component => ({
    id: component.id, value: component.value, unit: component.unit, kind: component.valueStatus,
    permittedScopes: [component.role === 'energy' ? 'watch.energyRole' : 'watch.timingRole'],
    citationIds: ['watch-state'],
  }));
  const context = buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: entries });
  const claims = entries.map(entry => ({ evidenceId: entry.id, value: entry.value, unit: entry.unit, kind: entry.kind, scope: entry.permittedScopes[0], citationIds: ['watch-state'] }));
  assert.equal(checkExplanationClaims({ context, draft: { contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity, claims } }).accepted, true);

  for (const [phaseNumerator, denominator, expectedPhase] of [[1, 32, 'lock'], [5, 64, 'release'], [7, 64, 'impulse']]) {
    const phaseTime = { numerator: phaseNumerator, denominator };
    const beatTotal = { numerator: 8 * phaseNumerator, denominator };
    const phaseOutput = mechanismSnapshot({}, {
      time: phaseTime, operatingTime: { mechanical: phaseTime, quartz: phaseTime },
      displayTime: { mechanical: { numerator: 0, denominator: 1 }, quartz: { numerator: 0, denominator: 1 }, software: phaseTime },
      cycles: { mechanicalBeats: beatTotal, quartzCycles: { numerator: 0, denominator: 1 } },
      counters: { mechanicalBeats: 0, quartzCycles: 0, motorCommands: 0 }, energy: { mainspring: true, battery: true },
    });
    const phaseDescription = describeWatchComponent({ models: phaseOutput }, 'mechanical.palletFork');
    assert.equal(phaseDescription.value, expectedPhase);
    const phaseContext = buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: [{
      id: phaseDescription.id, value: phaseDescription.value, unit: phaseDescription.unit, kind: phaseDescription.valueStatus,
      permittedScopes: ['watch.timingRole'], citationIds: ['watch-state'],
    }] });
    const checked = checkExplanationClaims({ context: phaseContext, draft: {
      contextId: phaseContext.contextId, stateIdentity: phaseContext.stateIdentity, modelIdentity: phaseContext.modelIdentity,
      claims: [{ evidenceId: phaseDescription.id, value: expectedPhase, unit: 'phase', kind: 'simulation', scope: 'watch.timingRole', citationIds: ['watch-state'] }],
    } });
    assert.equal(checked.accepted, true);
  }
});

test('workbench watch question contexts pass typed grounding for actual retained run data', () => {
  const state = watchStateAt({}, { numerator: 60, denominator: 1 });
  for (const questionId of ['selected-component', 'energy-path', 'timing-path', 'current-vs-nominal-rate', 'divider', 'gear-ratio', 'tick-boundary', 'view-invariance', 'physical-accuracy']) {
    const componentId = questionId === 'selected-component' ? 'mechanical.palletFork' : undefined;
    const questionState = questionId === 'tick-boundary' ? applyWatchAction(state, { type: 'step', event: 'mechanicalBeat' }) : state;
    const answer = explainWatch({ state: questionState, questionId, ...(componentId ? { componentId } : {}) });
    if (questionId === 'physical-accuracy') {
      assert.equal(answer.supported, false);
      continue;
    }
    assert.equal(answer.checkedClaims.accepted, true, `${questionId}: ${JSON.stringify(answer.checkedClaims.errors)}`);
  }
});

test('unknown IDs, values, units, scopes and citations fail with specific reasons', () => {
  const context = makeContext();
  const probes = [
    [{ evidenceId: 'quartz.unknown' }, 'unknown-evidence'],
    [{ value: 61 }, 'wrong-value'],
    [{ unit: 'hertz' }, 'wrong-unit'],
    [{ scope: 'watch.universalQuartzFrequency' }, 'wrong-scope'],
    [{ citationIds: ['grand-seiko-mechanical'] }, 'irrelevant-citation'],
  ];
  for (const [change, code] of probes) {
    const result = checkExplanationClaims({ context, draft: draft(context, change) });
    assert.equal(result.accepted, false);
    assert.equal(result.errors[0].code, code);
    assert.equal(result.renderedText, '');
  }
});

test('stale identities and contexts fail closed', () => {
  const context = makeContext();
  assert.equal(checkExplanationClaims({ context, draft: draft(context, {}, { stateIdentity: 'watch-state:old' }) }).errors[0].code, 'stale-state');
  assert.equal(checkExplanationClaims({ context, draft: draft(context, {}, { modelIdentity: 'ml-model:old' }) }).errors[0].code, 'stale-model');
  const altered = structuredClone(context);
  altered.evidence[0].value = 61;
  const staleClaim = checkExplanationClaims({ context: altered, draft: draft(context) });
  assert.equal(staleClaim.errors[0].code, 'wrong-value');
});

test('cyclic, deeply nested, and oversized caller contexts and drafts are bounded before serialization', () => {
  const context = makeContext();
  const validDraft = draft(context);
  const cycle = structuredClone(context);
  cycle.evidence[0].value = cycle;
  const cyclicResult = checkExplanationClaims({ context: cycle, draft: validDraft });
  assert.equal(cyclicResult.accepted, false);
  assert.equal(cyclicResult.errors[0].code, 'invalid-context');
  assert.match(cyclicResult.errors[0].message, /cycles/);

  let deep = 'leaf';
  for (let index = 0; index < groundingLimits.maxDepth + 2; index += 1) deep = { child: deep };
  const deepContext = structuredClone(context);
  deepContext.evidence[0].value = deep;
  const deepResult = checkExplanationClaims({ context: deepContext, draft: validDraft });
  assert.equal(deepResult.errors[0].code, 'invalid-context');
  assert.match(deepResult.errors[0].message, /maximum JSON depth/);

  const oversizedDraft = draft(context, { value: 'y'.repeat(groundingLimits.maxTextCharacters + 1) });
  const oversizedResult = checkExplanationClaims({ context, draft: oversizedDraft });
  assert.equal(oversizedResult.accepted, false);
  assert.equal(oversizedResult.errors[0].code, 'invalid-draft');

  const huge = { ...evidence, value: Array.from({ length: 300 }, () => 'z'.repeat(groundingLimits.maxTextCharacters)) };
  assert.throws(() => makeContext({ evidence: [huge] }), /exceeds 1000000 bytes/);
  const numericHeavy = Array.from({ length: 20 }, () => Array(6_000).fill(1));
  assert.throws(() => makeContext({ evidence: [{ ...evidence, value: numericHeavy }] }), /exceeds 1000000 bytes|maximum JSON node count/);
});

test('provider prose cannot be verified by attaching a valid claims array', () => {
  const context = makeContext();
  const injected = draft(context, {}, { text: 'Every quartz watch uses exactly 32,768 Hz and one pulse per second.' });
  const result = checkExplanationClaims({ context, draft: injected });
  assert.equal(result.accepted, false);
  assert.equal(result.errors[0].code, 'invalid-draft');
  assert.equal(result.renderedText, '');
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: [{ ...evidence, permittedScopes: ['watch.universalQuartzFrequency'] }] }), /unsupported scope/);
});

test('curated mechanism text must match its exact primary-source note', () => {
  const fact = {
    id: 'quartz-frequency-caveat', value: watchSource.limits, unit: 'scope limitation', kind: 'fact',
    permittedScopes: ['source.mechanismFact'], citationIds: [watchSource.id],
  };
  const context = makeContext({ sourceKind: 'curated-source', evidence: [fact] });
  const result = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: fact.id, value: fact.value, unit: fact.unit, kind: fact.kind, scope: 'source.mechanismFact', citationIds: [watchSource.id] }],
  } });
  assert.equal(result.accepted, true);
  assert.throws(() => makeContext({ sourceKind: 'curated-source', evidence: [{ ...fact, value: 'Every quartz watch uses exactly 32,768 Hz and pulses once per second.' }] }), /exactly match its cited curated/);
  assert.throws(() => makeContext({ evidence: [{ ...evidence, id: 'false-universal', value: 'Every quartz watch uses exactly 32,768 Hz and pulses once per second.' }] }), /watch.counter value/);
  assert.throws(() => buildEvidenceContext({
    ...identity, sourceKind: 'model-derived',
    sources: [{ id: 'fitted-model', url: null, title: 'Retained fitted ML artifact', scope: 'model arithmetic', identity: identity.modelIdentity }],
    evidence: [{ id: 'forged-prediction', value: 'The physical watch is accurate in every temperature.', unit: 'seconds', kind: 'derived', permittedScopes: ['model.prediction'], citationIds: ['fitted-model'] }],
  }), /recognized numeric prediction shape/);
});

test('JSON object key order does not change typed claim value equality', () => {
  const orderedEvidence = { ...evidence, value: { numerator: 2, denominator: 1 }, unit: 'rational seconds' };
  const context = makeContext({ evidence: [orderedEvidence] });
  const result = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: orderedEvidence.id, value: { denominator: 1, numerator: 2 }, unit: orderedEvidence.unit, kind: orderedEvidence.kind, scope: 'watch.counter', citationIds: [source.id] }],
  } });
  assert.equal(result.accepted, true);
});

test('caller-declared physical provenance and unsupported measurement claims are rejected', () => {
  const context = makeContext({ sourceKind: 'physical-measured' });
  const result = checkExplanationClaims({ context, draft: draft(context) });
  assert.equal(result.accepted, false);
  assert.equal(result.errors[0].code, 'unverified-physical-provenance');
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'browser-observed', sources: [source], evidence: [{
    ...evidence, kind: 'measurement', permittedScopes: ['watch.currentRate'],
  }] }), /cannot label a model or watch value as a physical measurement/);
});

test('observed evidence is explicitly labeled as browser-observed and stays distinct from physical measurement', () => {
  const stateSource = { id: 'watch-state', url: null, title: 'Browser-captured run state', scope: 'browser-observed state', identity: identity.stateIdentity };
  const item = { id: 'quartz.secondHand', value: 12.5, unit: 'degrees', kind: 'observed', permittedScopes: ['watch.displayAngle'], citationIds: ['watch-state'], stateIdentity: identity.stateIdentity };
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [stateSource], evidence: [item] }), /requires sourceKind browser-observed/);
  const context = buildEvidenceContext({ ...identity, sourceKind: 'browser-observed', sources: [stateSource], evidence: [item] });
  const result = checkExplanationClaims({ context, draft: {
    contextId: context.contextId, stateIdentity: context.stateIdentity, modelIdentity: context.modelIdentity,
    claims: [{ evidenceId: item.id, value: item.value, unit: item.unit, kind: item.kind, scope: 'watch.displayAngle', citationIds: ['watch-state'] }],
  } });
  assert.equal(result.accepted, true);
  assert.match(result.renderedText, /12\.5 degrees/);
  assert.equal(checkExplanationClaims({ context: makeContext({ sourceKind: 'physical-measured' }), draft: draft(makeContext({ sourceKind: 'physical-measured' })) }).accepted, false);
});

test('context construction enforces scope, citation, byte, depth and count bounds', () => {
  assert.equal(groundingLimits.maxClaims, 64);
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: [{ ...evidence, citationIds: ['fake'] }] }), /unknown source/);
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: Array.from({ length: groundingLimits.maxEvidence + 1 }, (_, index) => ({ ...evidence, id: `e${index}` })) }), /1 to 256/);
  let nested = 'too deep';
  for (let index = 0; index < groundingLimits.maxDepth + 2; index += 1) nested = { child: nested };
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: [{ ...evidence, value: nested }] }), /maximum JSON depth/);
  const large = { ...evidence, value: 'x'.repeat(groundingLimits.maxContextBytes + 1) };
  assert.throws(() => buildEvidenceContext({ ...identity, sourceKind: 'synthetic-watch', sources: [source], evidence: [large] }), /exceeds 4096 characters/);
});
