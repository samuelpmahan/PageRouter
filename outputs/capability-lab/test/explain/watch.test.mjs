import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkExplanationClaims,
  explainWatch,
} from '../../src/explain/index.mjs';
import {
  canonicalWatchJson,
  createWatchRun,
  applyWatchAction,
  componentDefinitions,
  describeWatchComponent,
  watchStateAt,
} from '../../src/watches/index.mjs';

const rational = (numerator, denominator = 1) => ({ numerator, denominator });

function claim(context, evidence, scope) {
  return {
    contextId: context.contextId,
    stateIdentity: context.stateIdentity,
    modelIdentity: context.modelIdentity,
    claims: [{
      evidenceId: evidence.id,
      value: evidence.value,
      unit: evidence.unit,
      kind: evidence.kind,
      scope,
      citationIds: evidence.citationIds,
    }],
  };
}

test('watch answers bind the selected component value, role, and source to the current state', () => {
  const state = watchStateAt({}, rational(60));
  const answer = explainWatch({ state, componentId: 'quartz.crystal', questionId: 'selected-component' });
  const selected = describeWatchComponent(state, 'quartz.crystal');

  assert.equal(answer.schema, 'explain.watch.v1');
  assert.equal(answer.supported, true);
  assert.equal(answer.component.id, selected.id);
  assert.deepEqual(answer.component.value, selected.value);
  assert.equal(answer.component.role, 'timing');
  assert.equal(answer.component.valueStatus, 'simulation');
  assert.equal(answer.component.source.url, selected.source.url);
  assert.ok(answer.context.evidence.some(item => item.value === selected.value || JSON.stringify(item.value) === JSON.stringify(selected.value)));
  assert.equal(answer.stateIdentity, answer.context.stateIdentity);
  assert.ok(answer.calculationTrace.calls.some(call => call.id === 'src/watches/mechanisms.mjs#mechanismSnapshot'));

  const evidence = answer.context.evidence.find(item => item.id === 'quartz.crystal');
  assert.ok(evidence);
  const checked = checkExplanationClaims({ context: answer.context, draft: claim(answer.context, evidence, 'watch.timingRole') });
  assert.equal(checked.accepted, true);
  assert.match(checked.renderedText, /modeled timing-role evidence/);
});

test('watch question answers distinguish oscillator ticks, divider output, and the configured rate', () => {
  const initial = createWatchRun();
  const state = applyWatchAction(initial, { type: 'step', event: 'mechanicalBeat' });
  const tick = explainWatch({ state, questionId: 'tick-boundary' });
  assert.equal(tick.supported, true);
  assert.equal(tick.question.event.event, 'mechanicalBeat');
  assert.equal(tick.question.event.model, 'mechanical');
  assert.equal(tick.question.event.sequence, state.history.actions.length,
    'the selected compact range must belong to the latest explicit step action');
  assert.ok(tick.calculationTrace.calls.some(call => call.id === 'src/watches/index.mjs#replayWatchRun' && call.result.matched));
  assert.deepEqual(state.models.mechanical.counts.beats, 1);
  assert.deepEqual(state.models.mechanical.oscillator.cycles, rational(1, 2));
  assert.match(tick.question.explanation, /two escapement beats|half of a full oscillation/i);

  const divider = explainWatch({ state: watchStateAt({}, rational(1)), questionId: 'divider' });
  assert.equal(divider.supported, true);
  assert.equal(divider.question.stageCount, 15);
  assert.equal(divider.question.firstStage.divisor, 2);
  assert.equal(divider.question.firstStage.outputCount, 16_384);
  assert.equal(divider.question.lastStage.outputCount, 1);
  assert.ok(divider.sources.some(source => source.id === 'seiko-quartz-education'));

  const changedRate = applyWatchAction(createWatchRun(), { type: 'rate', model: 'mechanical', hz: 8 });
  const ratesState = applyWatchAction(changedRate, { type: 'advance', duration: rational(1), origin: 'manual' });
  const rates = explainWatch({ state: ratesState, questionId: 'current-vs-nominal-rate' });
  assert.deepEqual(rates.question.mechanical.currentHz, rational(8));
  assert.deepEqual(rates.question.mechanical.nominalHz, rational(4));
  assert.equal(explainWatch({ state: watchStateAt({}, rational(1)), questionId: 'tick-boundary' }).supported, false,
    'an advance range is not selected as an individual tick');
});

test('watch evidence rejects altered retained state before hashing or describing it', () => {
  const original = watchStateAt({}, rational(1));
  const forgedStates = [
    ['top-level counter', state => { state.counters.quartzCycles += 1; }],
    ['nested mechanism count', state => { state.models.quartz.counts.referenceCycles += 1; }],
    ['negative current rate', state => { state.rates.mechanicalHz = -1; }],
    ['retained range end', state => { state.history.events[0].end += 1; }],
    ['history byte receipt', state => { state.history.bytes = 0; }],
    ['unrecognized state field', state => { state.untrusted = 'x'.repeat(1_048_577); }],
  ];
  for (const [label, alter] of forgedStates) {
    const forged = structuredClone(original);
    alter(forged);
    assert.throws(() => explainWatch({ state: forged, questionId: 'divider' }), /unknown watch state field|exceeds|replay|invalid|must be/i, label);
  }

  const staleDraft = claim(explainWatch({ state: original, questionId: 'divider' }).context,
    explainWatch({ state: original, questionId: 'divider' }).context.evidence[0], 'watch.counter');
  const altered = structuredClone(original);
  altered.counters.quartzCycles += 1;
  const rejected = checkExplanationClaims({
    context: explainWatch({ state: original, questionId: 'divider' }).context,
    draft: staleDraft,
    current: { state: altered, questionId: 'divider' },
  });
  assert.equal(rejected.accepted, false);
  assert.match(JSON.stringify(rejected.errors), /could not be regenerated|replay|state/i);
});

test('deep watch state is rejected by bounded traversal before canonical hashing', () => {
  const state = structuredClone(createWatchRun());
  let cursor = state.models.software;
  for (let depth = 0; depth < 70; depth += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.throws(() => explainWatch({ state, questionId: 'divider' }), /maximum JSON depth 64/i);
});

test('view-invariance records real geometry calls and leaves canonical watch state unchanged', () => {
  const state = watchStateAt({}, rational(5));
  const before = canonicalWatchJson(state);
  const answer = explainWatch({ state, componentId: 'mechanical.escapeWheel', questionId: 'view-invariance' });
  assert.equal(answer.supported, true);
  assert.equal(answer.question.stateUnchanged, true);
  assert.equal(answer.question.beforeIdentity, answer.question.afterIdentity);
  assert.notEqual(answer.question.assembledGeometryIdentity, answer.question.explodedGeometryIdentity);
  assert.ok(answer.calculationTrace.calls.filter(call => call.id === 'src/watches/geometry.mjs#watchGeometry').length >= 2);
  assert.equal(canonicalWatchJson(state), before);
});

test('selected-component retrieval remains typed for every canonical component ID', () => {
  const state = watchStateAt({}, rational(3));
  const ids = componentDefinitions().map(item => item.id);
  assert.ok(ids.length >= 30);
  for (const componentId of ids) {
    const answer = explainWatch({ state, componentId, questionId: 'selected-component' });
    assert.equal(answer.component.id, componentId);
    assert.equal(answer.supported, true);
    assert.ok(answer.context.evidence.length > 0, `${componentId} must retain a source note or typed state value`);
  }
});

test('claim checking rejects stale identity, altered values, wrong units, irrelevant citations, and arbitrary prose', () => {
  const answer = explainWatch({ state: watchStateAt({}, rational(1)), componentId: 'mechanical.secondHand', questionId: 'selected-component' });
  const evidence = answer.context.evidence.find(item => item.permittedScopes.includes('watch.displayAngle'));
  assert.ok(evidence);
  const valid = claim(answer.context, evidence, 'watch.displayAngle');
  assert.equal(checkExplanationClaims({ context: answer.context, draft: valid }).accepted, true);

  const wrongValue = structuredClone(valid);
  wrongValue.claims[0].value += 1;
  assert.match(JSON.stringify(checkExplanationClaims({ context: answer.context, draft: wrongValue }).errors), /wrong-value|does not match/i);

  const wrongUnit = structuredClone(valid);
  wrongUnit.claims[0].unit = 'seconds';
  assert.match(JSON.stringify(checkExplanationClaims({ context: answer.context, draft: wrongUnit }).errors), /wrong-unit|unit/i);

  const wrongCitation = structuredClone(valid);
  wrongCitation.claims[0].citationIds = ['seiko-quartz-education'];
  assert.match(JSON.stringify(checkExplanationClaims({ context: answer.context, draft: wrongCitation }).errors), /citation|source/i);

  const stale = structuredClone(valid);
  stale.stateIdentity = 'watch-state:old';
  assert.match(JSON.stringify(checkExplanationClaims({ context: answer.context, draft: stale }).errors), /stale-state/i);

  const prose = structuredClone(valid);
  prose.freeformText = 'This physical watch is accurate to one second per year.';
  assert.equal(checkExplanationClaims({ context: answer.context, draft: prose }).accepted, false);
});

test('unsupported physical-accuracy and unknown questions return explicit limits without making a measurement claim', () => {
  const state = watchStateAt({}, rational(60));
  for (const questionId of ['physical-accuracy', 'temperature-drift', 'universal-quartz-frequency']) {
    const answer = explainWatch({ state, questionId });
    assert.equal(answer.supported, false);
    assert.ok(answer.limitation.length > 0);
    assert.equal(answer.evidence.some(item => item.kind === 'measurement'), false);
  }
});
