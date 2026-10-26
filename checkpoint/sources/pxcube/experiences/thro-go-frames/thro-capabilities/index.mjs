// thro-go capabilities: registered composed capabilities, same descriptor shape as vendor/capability-lab/src/statistics/*.mjs
// (id, kind, dependsOn, inputSchema, outputSchema, examples, run, formula, caveats). They are registered in the same registry as the
// statistics.* capabilities and do their arithmetic only by calling statistics.* capabilities through ctx.call.
// The catalog is exported to thro-capabilities/catalog.json by tools/export-catalog.mjs.
const numArray = { type: 'array', items: { type: 'number' } };
const value = { type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false };

export const capabilities = [
  {
    id: 'thro.ratio',
    title: 'Scaled ratio of two sums',
    description: 'scale x sum(numerator) / sum(denominator); both sums are taken with statistics.sum.',
    kind: 'composed',
    dependsOn: ['statistics.sum'],
    inputSchema: { type: 'object', properties: { numerator: numArray, denominator: { ...numArray, minItems: 1 }, scale: { type: 'number' } }, required: ['numerator', 'denominator', 'scale'], additionalProperties: false },
    outputSchema: value,
    examples: [{ input: { numerator: [1, 1], denominator: [10, 10], scale: 100 }, expected: { value: 10 } }],
    run: (input, ctx) => {
      const n = ctx.call('statistics.sum', { values: input.numerator }).value;
      const d = ctx.call('statistics.sum', { values: input.denominator }).value;
      if (d === 0) throw new RangeError('denominator sums to zero');
      return { value: (input.scale * n) / d };
    },
    formula: 'scale * sum(numerator) / sum(denominator)',
    caveats: 'Shares use scale 100; appearances per ten minutes of runtime use scale 600 with runtime in seconds. A ratio of pooled sums, not a mean of per-item ratios.',
  },
  {
    id: 'thro.positionHistogram',
    title: 'Where in the runtime events start',
    description: 'Histogram of start_seconds / duration_seconds over equal-width bins on [0,1], through statistics.histogram.',
    kind: 'composed',
    dependsOn: ['statistics.histogram'],
    inputSchema: { type: 'object', properties: { starts: numArray, durations: numArray, bins: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['starts', 'durations', 'bins'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { bins: { type: 'array', items: { type: 'object', properties: { x0: { type: 'number' }, x1: { type: 'number' }, count: { type: 'integer', minimum: 0 } }, required: ['x0', 'x1', 'count'] } } }, required: ['bins'], additionalProperties: false },
    examples: [{ input: { starts: [0, 50], durations: [100, 100], bins: 2 }, expected: { bins: [{ x0: 0, x1: 0.5, count: 1 }, { x0: 0.5, x1: 1, count: 1 }] } }],
    run: (input, ctx) => {
      const values = input.starts.map((s, i) => Math.min(1, s / input.durations[i]));
      const edges = Array.from({ length: input.bins + 1 }, (_, i) => i / input.bins);
      return ctx.call('statistics.histogram', { values, edges });
    },
    formula: 'fraction = min(1, start / duration); statistics.histogram over equal-width edges',
    caveats: 'starts and durations are matched by index.',
  },
];
