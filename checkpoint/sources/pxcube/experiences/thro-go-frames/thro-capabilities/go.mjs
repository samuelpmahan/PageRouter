// thro-go capabilities, registered in the same registry and shape as thro.ratio / thro.positionHistogram.
// They do their arithmetic only through declared dependencies (statistics.* and thro.ratio), via ctx.call.
const numArray = { type: 'array', items: { type: 'number' } };

export const capabilities = [
  {
    id: 'thro.attentionSeconds',
    title: 'Attention-seconds on screen',
    description: 'views x sum of retention over every whole second inside the given on-screen intervals; the sums go through thro.ratio (statistics.sum).',
    kind: 'composed',
    dependsOn: ['thro.ratio'],
    inputSchema: {
      type: 'object',
      properties: { retention: numArray, intervals: { type: 'array', items: { type: 'array', items: { type: 'number' } } }, views: { type: 'number', minimum: 0 } },
      required: ['retention', 'intervals', 'views'], additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { value: { type: 'number' }, seconds: { type: 'integer', minimum: 0 }, retentionSum: { type: 'number' } }, required: ['value', 'seconds', 'retentionSum'], additionalProperties: false },
    examples: [{ input: { retention: [1, 0.5, 0.5, 0.25], intervals: [[1, 3]], views: 100 }, expected: { value: 100, seconds: 2, retentionSum: 1 } }],
    run: (input, ctx) => {
      const flat = [];
      for (const [a, b] of input.intervals) {
        const lo = Math.max(0, Math.ceil(a)), hi = Math.min(input.retention.length, Math.floor(b));
        for (let s = lo; s < hi; s++) flat.push(input.retention[s]);
      }
      const value = ctx.call('thro.ratio', { numerator: flat, denominator: [1], scale: input.views }).value;
      const retentionSum = ctx.call('thro.ratio', { numerator: flat, denominator: [1], scale: 1 }).value;
      return { value, seconds: flat.length, retentionSum };
    },
    formula: 'views * sum(retention[s] for each whole second s in the intervals)',
    caveats: 'Intervals must already be disjoint (merge overlaps first) or seconds are double counted. Retention is the fraction of viewers still watching at that second; views is the current view count. This is viewers x seconds on screen, an exposure measure, not people or sales.',
  },
  {
    id: 'thro.retentionDip',
    title: 'Retention change across a placement',
    description: 'Compares the mean retention inside a placement window with the mean of the seconds just around it, through statistics.mean.',
    kind: 'composed',
    dependsOn: ['statistics.mean'],
    inputSchema: {
      type: 'object',
      properties: { window: { ...numArray, minItems: 1 }, surround: { ...numArray, minItems: 1 }, threshold: { type: 'number', minimum: 0 } },
      required: ['window', 'surround', 'threshold'], additionalProperties: false,
    },
    outputSchema: { type: 'object', properties: { windowMean: { type: 'number' }, surroundMean: { type: 'number' }, drop: { type: 'number' }, dipped: { type: 'boolean' } }, required: ['windowMean', 'surroundMean', 'drop', 'dipped'], additionalProperties: false },
    examples: [{ input: { window: [0.5, 0.5], surround: [0.75, 0.75], threshold: 0.05 }, expected: { windowMean: 0.5, surroundMean: 0.75, drop: 0.25, dipped: true } }],
    run: (input, ctx) => {
      const windowMean = ctx.call('statistics.mean', { values: input.window }).value;
      const surroundMean = ctx.call('statistics.mean', { values: input.surround }).value;
      const drop = surroundMean - windowMean;
      return { windowMean, surroundMean, drop, dipped: drop > input.threshold };
    },
    formula: 'drop = mean(surround) - mean(window); dipped when drop > threshold',
    caveats: 'The surround is the few seconds before and after the placement, so a gentle natural decline across the video does not read as a dip. Correlation with a card, not proof the card caused it.',
  },
];
