// Contest F: simulated coding agents working through a frontier of tasks.
// Finishing a task can reveal new tasks; a fixed integration capacity N applies backpressure.
//
// Kernel v0.6 shape. agents.tick is a contract of kind 'tick' (a composition); world.drive runs it once per tick, and
// agents.simulate folds the same tick inside one call with ctx.drive, collecting each tick's events with `collect`. The clock is read with
// ctx.tick() (agents.clock), a cache dependency. Slots are declared (`uses: ['contract#slot']`, composition step `slot`) and can be filled
// by path ('agents.allocate#shadow/agents.scoreMatrix#scores'; a path fill must land, v0.5). The demand gate is a conditional composition:
// `lit` when config.gate is 'literal', `res` `when: { else: ['lit'] }` (the complement is derived, not typed), result `{ one }`. The audit
// step `regret` has no guard of its own: it reads `shadow`, so it inherits shadow's skip (and, v0.6, records its inherited run). The integrator and the commit record named
// decisions with ctx.when. The hand-derived tiny timeline is a `trajectory` example on agents.tick (v0.5), checked tick by tick by prove.
// The constraint verdicts (agents.evaluate, agents.capacity, agents.regret) are contracts of kind 'check'.

const int = { type: 'integer' };
const str = { type: 'string' };
const STREAMS = ['A', 'B', 'C'];
const stream = { type: 'string', enum: STREAMS };
const kind = { type: 'string', enum: ['strong', 'helper', 'orchestrator'] };
const maybeStr = { oneOf: [str, { type: 'null' }] };
const maybeInt = { oneOf: [int, { type: 'null' }] };

const agentView = { type: 'object', required: ['id', 'kind', 'stream'], properties: { id: str, kind, stream } };
const taskView = { type: 'object', required: ['id', 'stream', 'cost'], properties: { id: str, stream, cost: { type: 'integer', minimum: 1 } } };
const agentFull = { type: 'object', required: ['id', 'kind', 'stream', 'task'], properties: { id: str, kind, stream, task: maybeStr } };
const taskFull = { type: 'object', required: ['id', 'stream', 'cost', 'reveals', 'status', 'agent', 'remaining', 'startedAt', 'finishedAt', 'integratedAt'],
  properties: { id: str, stream, cost: { type: 'integer', minimum: 1 }, reveals: { type: 'array', items: str },
    status: { type: 'string', enum: ['hidden', 'ready', 'running', 'done', 'integrated'] },
    agent: maybeStr, remaining: int, startedAt: maybeInt, finishedAt: maybeInt, integratedAt: maybeInt } };
const stateS = { type: 'object', required: ['tasks', 'agents', 'integrator'],
  properties: { tasks: { type: 'array', items: taskFull }, agents: { type: 'array', items: agentFull },
    integrator: { type: 'object', required: ['task', 'remaining'], properties: { task: maybeStr, remaining: int } } } };
const configS = { type: 'object', required: ['frontier', 'gate', 'integrationTicks', 'maxOrchestratorsBusy', 'audit'],
  properties: { frontier: { type: 'integer', minimum: 1 }, gate: { type: 'string', enum: ['reserve', 'literal'] },
    integrationTicks: { type: 'integer', minimum: 1 }, maxOrchestratorsBusy: int, audit: { type: 'boolean' } } };
const constraintsS = { type: 'object', required: ['maxStarts', 'maxOrchestratorsBusy', 'orchestratorsBusy'],
  properties: { maxStarts: int, maxOrchestratorsBusy: int, orchestratorsBusy: int } };
const assignmentS = { type: 'object', required: ['task', 'agent', 'score'], properties: { task: str, agent: str, score: int } };
const eventS = { type: 'object', required: ['t', 'kind'], properties: { t: int, kind: str } };
const countsS = { type: 'object', required: ['hidden', 'ready', 'running', 'done', 'integrated', 'total'],
  properties: { hidden: int, ready: int, running: int, done: int, integrated: int, total: int } };
const idle = { type: 'array', items: agentView };
const ready = { type: 'array', items: taskView };
const events = { type: 'array', items: eventS };
const tickNo = { type: 'integer', minimum: -1 };
const scoreCell = { oneOf: [{ type: 'number' }, { type: 'null' }] };

// ---- pair scoring (integer on purpose, so examples can be derived by hand)
//   1000 base (any assignment beats none) - 300 for an orchestrator (lending one out is the cost)
//   + 100 stream affinity + 10 strong + cost (longer tasks win ties when maxStarts bites)
export const WEIGHTS = Object.freeze({ base: 1000, orchestrator: -300, affinity: 100, strong: 10 });

// ---- scenario data (inputs, not computation)
export const task = (id, stream, cost, reveals = [], status = 'ready', extra = {}) => ({
  id, stream, cost, reveals, status, agent: null, remaining: 0, startedAt: null, finishedAt: null, integratedAt: null, ...extra,
});
export const agent = (id, kind, stream, taskId = null) => ({ id, kind, stream, task: taskId });
export const config = (frontier, extra = {}) => ({ frontier, gate: 'reserve', integrationTicks: 2, maxOrchestratorsBusy: 2, audit: false, ...extra });

/** 3 streams, 8 visible tasks (+ 8 hidden revealed by completions), 10 agents: 3 strong, 4 helpers, 3 orchestrators. */
export function initialState() {
  const tasks = [
    task('a1', 'A', 3, ['a4', 'c4']), task('a2', 'A', 2), task('a3', 'A', 4, ['b4']),
    task('b1', 'B', 3, ['b5']), task('b2', 'B', 2), task('b3', 'B', 3),
    task('c1', 'C', 3, ['a5']), task('c2', 'C', 5, ['c5', 'b6']),
    task('a4', 'A', 2, [], 'hidden'), task('c4', 'C', 3, [], 'hidden'), task('b4', 'B', 4, ['a6'], 'hidden'),
    task('b5', 'B', 2, [], 'hidden'), task('a5', 'A', 3, [], 'hidden'), task('c5', 'C', 2, [], 'hidden'),
    task('b6', 'B', 3, [], 'hidden'), task('a6', 'A', 2, [], 'hidden'),
  ].sort((x, y) => (x.id < y.id ? -1 : 1));
  const agents = [
    agent('sA', 'strong', 'A'), agent('sB', 'strong', 'B'), agent('sC', 'strong', 'C'),
    agent('h1', 'helper', 'A'), agent('h2', 'helper', 'B'), agent('h3', 'helper', 'C'), agent('h4', 'helper', 'A'),
    agent('o1', 'orchestrator', 'A'), agent('o2', 'orchestrator', 'B'), agent('o3', 'orchestrator', 'C'),
  ].sort((x, y) => (x.id < y.id ? -1 : 1));
  return { tasks, agents, integrator: { task: null, remaining: 0 } };
}

// ------------------------------------------------------------------ examples helpers (hand-built)
// Tiny world used by the state-level examples. Derived by hand in EXPLAIN.md ("tiny world").
const tinyCfg = config(2, { integrationTicks: 1 });
const tinyAgents = (sA, h1) => [agent('h1', 'helper', 'B', h1), agent('sA', 'strong', 'A', sA)];
const tinyS0 = { agents: tinyAgents(null, null), integrator: { task: null, remaining: 0 },
  tasks: [task('t1', 'A', 2, ['t3']), task('t2', 'B', 1), task('t3', 'A', 1, [], 'hidden')] };
// after tick 0 committed
const tinyS1 = { agents: tinyAgents('t1', 't2'), integrator: { task: null, remaining: 0 },
  tasks: [task('t1', 'A', 2, ['t3'], 'running', { agent: 'sA', remaining: 2, startedAt: 0 }),
    task('t2', 'B', 1, [], 'running', { agent: 'h1', remaining: 1, startedAt: 0 }), task('t3', 'A', 1, [], 'hidden')] };
// after tick 1 (t2 finished at 1 and is being integrated)
const tinyS2 = { agents: tinyAgents('t1', null), integrator: { task: 't2', remaining: 1 },
  tasks: [task('t1', 'A', 2, ['t3'], 'running', { agent: 'sA', remaining: 1, startedAt: 0 }),
    task('t2', 'B', 1, [], 'done', { agent: 'h1', remaining: 0, startedAt: 0, finishedAt: 1 }), task('t3', 'A', 1, [], 'hidden')] };
// tick 2 after advance: t1 done at 2, t3 revealed, t2 integrated at 2
const tinyS2adv = { agents: tinyAgents(null, null), integrator: { task: null, remaining: 0 },
  tasks: [task('t1', 'A', 2, ['t3'], 'done', { agent: 'sA', remaining: 0, startedAt: 0, finishedAt: 2 }),
    task('t2', 'B', 1, [], 'integrated', { agent: 'h1', remaining: 0, startedAt: 0, finishedAt: 1, integratedAt: 2 }), task('t3', 'A', 1)] };
const tinyS2int = { ...tinyS2adv, integrator: { task: 't1', remaining: 1 } };
const tinyS3 = { agents: tinyAgents('t3', null), integrator: { task: 't1', remaining: 1 },
  tasks: [task('t1', 'A', 2, ['t3'], 'done', { agent: 'sA', remaining: 0, startedAt: 0, finishedAt: 2 }),
    task('t2', 'B', 1, [], 'integrated', { agent: 'h1', remaining: 0, startedAt: 0, finishedAt: 1, integratedAt: 2 }),
    task('t3', 'A', 1, [], 'running', { agent: 'sA', remaining: 1, startedAt: 2 })] };
const tinyFinal = { agents: tinyAgents(null, null), integrator: { task: null, remaining: 0 },
  tasks: [task('t1', 'A', 2, ['t3'], 'integrated', { agent: 'sA', remaining: 0, startedAt: 0, finishedAt: 2, integratedAt: 3 }),
    task('t2', 'B', 1, [], 'integrated', { agent: 'h1', remaining: 0, startedAt: 0, finishedAt: 1, integratedAt: 2 }),
    task('t3', 'A', 1, [], 'integrated', { agent: 'sA', remaining: 0, startedAt: 2, finishedAt: 3, integratedAt: 4 })] };
const cnt = (hidden, ready, running, done, integrated, total = 3) => ({ hidden, ready, running, done, integrated, total });
const tinyEvents = [
  { t: 0, kind: 'assign', task: 't1', agent: 'sA', score: 1112 }, { t: 0, kind: 'assign', task: 't2', agent: 'h1', score: 1101 },
  { t: 1, kind: 'complete', task: 't2', agent: 'h1' }, { t: 1, kind: 'integrateStart', task: 't2' },
  { t: 2, kind: 'complete', task: 't1', agent: 'sA' }, { t: 2, kind: 'reveal', task: 't3', by: 't1' }, { t: 2, kind: 'integrated', task: 't2' },
  { t: 2, kind: 'integrateStart', task: 't1' }, { t: 2, kind: 'assign', task: 't3', agent: 'sA', score: 1111 },
  { t: 3, kind: 'complete', task: 't3', agent: 'sA' }, { t: 3, kind: 'integrated', task: 't1' }, { t: 3, kind: 'integrateStart', task: 't3' },
  { t: 4, kind: 'integrated', task: 't3' },
];

const A = (id, k, s) => ({ id, kind: k, stream: s });
const T = (id, s, cost) => ({ id, stream: s, cost });
const cons = (maxStarts, busy = 0, cap = 2) => ({ maxStarts, maxOrchestratorsBusy: cap, orchestratorsBusy: busy });
// The contested input: by hand, greedy takes the longest task t1 first and gives it hB (1005), leaving oA for t2 (704) = 1709;
// the optimum is t1 -> oA (1000-300+100+5 = 805) and t2 -> hB (1000+100+4 = 1104) = 1909.
export const contested = { idle: [A('hB', 'helper', 'B'), A('oA', 'orchestrator', 'A')], ready: [T('t1', 'A', 5), T('t2', 'B', 4)], constraints: cons(2) };

export function register(world) {
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);

  // ================================================================= scoring (shared by allocators and the checker)
  C({ id: 'agents.scoreMatrix', description: 'scores[i][j]: value of putting ready[i] on idle[j]; null when a strong agent would leave its own stream',
    in: { idle, ready }, out: { scores: { type: 'array', items: { type: 'array', items: scoreCell } } },
    examples: [
      // helper on its own stream: 1000+100+0+3 = 1103 ; orchestrator off stream: 1000-300+0+3 = 703 ; strong off stream: null
      { in: { idle: [A('h1', 'helper', 'A'), A('o3', 'orchestrator', 'C'), A('sB', 'strong', 'B')], ready: [T('t1', 'A', 3)] }, out: { scores: [[1103, 703, null]] } },
      // strong on own stream: 1000+100+10+5 = 1115
      { in: { idle: [A('sB', 'strong', 'B')], ready: [T('t1', 'B', 5), T('t2', 'C', 1)] }, out: { scores: [[1115], [null]] } },
    ] });
  I({ id: 'agents.scoreMatrix/weights', implements: 'agents.scoreMatrix', run: ({ idle: ag, ready: tk }) => ({
    scores: tk.value.map((t) => ag.value.map((a) => {
      if (a.kind === 'strong' && a.stream !== t.stream) return null;
      return WEIGHTS.base + (a.kind === 'orchestrator' ? WEIGHTS.orchestrator : 0) + (a.stream === t.stream ? WEIGHTS.affinity : 0)
        + (a.kind === 'strong' ? WEIGHTS.strong : 0) + t.cost;
    })),
  }) });

  world.select('agents.scoreMatrix', 'agents.scoreMatrix/weights');   // so that a second scorer (a test, an experiment) does not make every caller AMBIGUOUS

  // ================================================================= the allocation slot (tiny Rebalancer problem)
  const allocIn = { idle, ready, constraints: constraintsS };
  const allocOut = { assignments: { type: 'array', items: assignmentS }, score: int };
  C({ id: 'agents.allocate', description: 'objects = ready tasks, containers = idle agents; hard constraints in `constraints` + one task per agent + strong agents on own stream; maximise total score',
    in: allocIn, out: allocOut,
    examples: [
      // sA 1000+100+10+3 = 1113 beats h1 1000+100+0+3 = 1103 beats o1 1000-300+100+3 = 803
      { in: { idle: [A('h1', 'helper', 'A'), A('o1', 'orchestrator', 'A'), A('sA', 'strong', 'A')], ready: [T('t1', 'A', 3)], constraints: cons(5) },
        out: { assignments: [{ task: 't1', agent: 'sA', score: 1113 }], score: 1113 } },
      // affinity beats helper-ness: h2 on B = 1000+100+0+2 = 1102 vs h1 = 1002
      { in: { idle: [A('h1', 'helper', 'A'), A('h2', 'helper', 'B')], ready: [T('t', 'B', 2)], constraints: cons(5) },
        out: { assignments: [{ task: 't', agent: 'h2', score: 1102 }], score: 1102 } },
      // helper beats an orchestrator even when only the orchestrator has affinity: h1 = 1000+0+0+2 = 1002 vs o1 = 1000-300+100+2 = 802
      { in: { idle: [A('h1', 'helper', 'A'), A('o1', 'orchestrator', 'B')], ready: [T('t', 'B', 2)], constraints: cons(5) },
        out: { assignments: [{ task: 't', agent: 'h1', score: 1002 }], score: 1002 } },
      // three orchestrators, cap 2: o1-t1 = 803, o2-t2 = 802 taken, t3 (801) left out
      { in: { idle: [A('o1', 'orchestrator', 'A'), A('o2', 'orchestrator', 'B'), A('o3', 'orchestrator', 'C')], ready: [T('t1', 'A', 3), T('t2', 'B', 2), T('t3', 'C', 1)], constraints: cons(9) },
        out: { assignments: [{ task: 't1', agent: 'o1', score: 803 }, { task: 't2', agent: 'o2', score: 802 }], score: 1605 } },
      // cap already used up: no orchestrator may be lent
      { in: { idle: [A('o1', 'orchestrator', 'A')], ready: [T('t1', 'A', 3)], constraints: cons(9, 2) }, out: { assignments: [], score: 0 } },
      // a strong agent never leaves its stream
      { in: { idle: [A('sB', 'strong', 'B')], ready: [T('tA', 'A', 3)], constraints: cons(9) }, out: { assignments: [], score: 0 } },
      // maxStarts 1 (demand): h2-t2 = 1000+100+0+4 = 1104 beats h1-t1 = 1000+100+0+1 = 1101
      { in: { idle: [A('h1', 'helper', 'A'), A('h2', 'helper', 'B')], ready: [T('t1', 'A', 1), T('t2', 'B', 4)], constraints: cons(1) },
        out: { assignments: [{ task: 't2', agent: 'h2', score: 1104 }], score: 1104 } },
      // maxStarts 0: nothing starts
      { in: { idle: [A('h1', 'helper', 'A')], ready: [T('t1', 'A', 1)], constraints: cons(0) }, out: { assignments: [], score: 0 } },
    ] });

  I({ id: 'agents.allocate/greedy', implements: 'agents.allocate', uses: ['agents.scoreMatrix#scores'],
    description: 'tasks by cost descending (then id); each takes the best-scoring free agent it may use',
    // v0.3 implementation examples: the answer that only this implementation gives (the contract examples cannot hold it, exact would fail)
    examples: [{ in: contested, out: { assignments: [{ task: 't1', agent: 'hB', score: 1005 }, { task: 't2', agent: 'oA', score: 704 }], score: 1709 } }],
    run: ({ idle: ag, ready: tk, constraints }, ctx) => {
      const m = ctx.call('agents.scoreMatrix', { idle: ag, ready: tk }, { slot: 'scores' }).scores.value;
      const order = tk.value.map((t, i) => ({ t, i })).sort((x, y) => y.t.cost - x.t.cost || (x.t.id < y.t.id ? -1 : 1));
      const taken = new Set(); const out = []; let orch = constraints.value.orchestratorsBusy;
      for (const { t, i } of order) {
        if (out.length >= constraints.value.maxStarts) break;
        let best = -1;
        ag.value.forEach((a, j) => {
          if (taken.has(j) || m[i][j] === null) return;
          if (a.kind === 'orchestrator' && orch >= constraints.value.maxOrchestratorsBusy) return;
          if (best < 0 || m[i][j] > m[i][best]) best = j;
        });
        if (best < 0) continue;
        taken.add(best); if (ag.value[best].kind === 'orchestrator') orch += 1;
        out.push({ task: t.id, agent: ag.value[best].id, score: m[i][best] });
      }
      out.sort((x, y) => (x.task < y.task ? -1 : 1));
      return { assignments: out, score: out.reduce((s, a) => s + a.score, 0) };
    } });

  I({ id: 'agents.allocate/exact-dp', implements: 'agents.allocate', uses: ['agents.scoreMatrix#scores'],
    description: 'exact optimum: dynamic programme over the set of used agents (<= 16 idle agents), tasks in the same cost order',
    examples: [{ in: contested, out: { assignments: [{ task: 't1', agent: 'oA', score: 805 }, { task: 't2', agent: 'hB', score: 1104 }], score: 1909 } }],
    run: ({ idle: ag, ready: tk, constraints }, ctx) => {
      const n = ag.value.length;
      if (n > 16) throw new Error(`exact-dp: ${n} idle agents is not a small case`);
      const m = ctx.call('agents.scoreMatrix', { idle: ag, ready: tk }, { slot: 'scores' }).scores.value;
      const order = tk.value.map((t, i) => ({ t, i })).sort((x, y) => y.t.cost - x.t.cost || (x.t.id < y.t.id ? -1 : 1));
      const size = 1 << n; const { maxStarts, maxOrchestratorsBusy, orchestratorsBusy } = constraints.value;
      const orchMask = ag.value.reduce((s, a, j) => (a.kind === 'orchestrator' ? s | (1 << j) : s), 0);
      const pop = (x) => { let c = 0; for (let y = x; y; y &= y - 1) c += 1; return c; };
      let dp = new Array(size).fill(null); dp[0] = { score: 0, via: null };
      const steps = [];
      for (const { i } of order) {
        const next = dp.map((cell) => (cell ? { score: cell.score, via: null, from: null } : null));
        for (let mask = 0; mask < size; mask += 1) {
          if (!dp[mask] || pop(mask) >= maxStarts) continue;
          for (let j = 0; j < n; j += 1) {
            if (mask & (1 << j) || m[i][j] === null) continue;
            const m2 = mask | (1 << j);
            if (orchestratorsBusy + pop(m2 & orchMask) > maxOrchestratorsBusy) continue;
            const s = dp[mask].score + m[i][j];
            if (!next[m2] || s > next[m2].score) next[m2] = { score: s, via: { i, j }, from: mask };
          }
        }
        steps.push(next); dp = next;
      }
      let bestMask = 0;
      for (let mask = 0; mask < size; mask += 1) if (dp[mask] && dp[mask].score > dp[bestMask].score) bestMask = mask;
      const out = []; let mask = bestMask;
      for (let k = steps.length - 1; k >= 0; k -= 1) {
        const cell = steps[k][mask];
        if (cell.via) { out.push({ task: tk.value[cell.via.i].id, agent: ag.value[cell.via.j].id, score: m[cell.via.i][cell.via.j] }); mask = cell.from; }
      }
      out.sort((x, y) => (x.task < y.task ? -1 : 1));
      return { assignments: out, score: dp[bestMask].score };
    } });
  world.select('agents.allocate', 'agents.allocate/greedy');
  // v0.3 select(contract, impl, slot): the shadow seat of the audit tick is exact-dp unless a fill says otherwise
  world.select('agents.allocate', 'agents.allocate/exact-dp', 'shadow');

  // ================================================================= independent checkers (kind: 'check')
  C({ id: 'agents.evaluate', kind: 'check', description: 'is this assignment set feasible? accepted + reason + the sorted violation list and total score',
    in: { ...allocIn, assignments: { type: 'array', items: assignmentS } }, out: { accepted: { type: 'boolean' }, reason: str, violations: { type: 'array', items: str }, score: int },
    examples: [
      { in: { idle: [A('h1', 'helper', 'A'), A('sA', 'strong', 'A')], ready: [T('t1', 'A', 3), T('t2', 'A', 1)], constraints: cons(5),
          assignments: [{ task: 't1', agent: 'sA', score: 1113 }, { task: 't2', agent: 'h1', score: 1101 }] },
        out: { accepted: true, reason: 'feasible', violations: [], score: 2214 } },
      // scores: (t1,h1)=1103 (t2,h1)=1001 (t3,o1)=802 (t2,o2)=801, (t1,sB) infeasible. sB on an A task, h1 used twice, t1 used twice, 3 starts with maxStarts 2, two orchestrators with cap 1
      { in: { idle: [A('h1', 'helper', 'A'), A('o1', 'orchestrator', 'A'), A('o2', 'orchestrator', 'B'), A('sB', 'strong', 'B')],
          ready: [T('t1', 'A', 3), T('t2', 'B', 1), T('t3', 'A', 2)], constraints: cons(2, 0, 1),
          assignments: [{ task: 't1', agent: 'sB', score: 0 }, { task: 't1', agent: 'h1', score: 0 }, { task: 't2', agent: 'h1', score: 0 },
            { task: 't3', agent: 'o1', score: 0 }, { task: 't2', agent: 'o2', score: 0 }] },
        out: { accepted: false, reason: 'agent h1 used twice; maxStarts 2 exceeded by 5; orchestrator cap 1 exceeded (busy 0 + 2); strongOwnStream t1 on sB; task t1 used twice; task t2 used twice',
          violations: ['agent h1 used twice', 'maxStarts 2 exceeded by 5', 'orchestrator cap 1 exceeded (busy 0 + 2)', 'strongOwnStream t1 on sB', 'task t1 used twice', 'task t2 used twice'],
          score: 1103 + 1001 + 802 + 801 } },
      { in: { idle: [A('h1', 'helper', 'A')], ready: [T('t1', 'A', 3)], constraints: cons(5), assignments: [{ task: 'zz', agent: 'h1', score: 0 }, { task: 't1', agent: 'ghost', score: 0 }] },
        out: { accepted: false, reason: 'unknown agent ghost; unknown task zz', violations: ['unknown agent ghost', 'unknown task zz'], score: 0 } },
    ] });
  I({ id: 'agents.evaluate/rules', implements: 'agents.evaluate', uses: ['agents.scoreMatrix#scores'], run: ({ idle: ag, ready: tk, constraints, assignments }, ctx) => {
    const m = ctx.call('agents.scoreMatrix', { idle: ag, ready: tk }, { slot: 'scores' }).scores.value;
    const v = new Set(); let score = 0; let orch = 0;
    const seenA = new Set(); const seenT = new Set();
    for (const a of assignments.value) {
      const j = ag.value.findIndex((x) => x.id === a.agent); const i = tk.value.findIndex((x) => x.id === a.task);
      if (j < 0) v.add(`unknown agent ${a.agent}`);
      if (i < 0) v.add(`unknown task ${a.task}`);
      if (seenA.has(a.agent)) v.add(`agent ${a.agent} used twice`);
      if (seenT.has(a.task)) v.add(`task ${a.task} used twice`);
      seenA.add(a.agent); seenT.add(a.task);
      if (i < 0 || j < 0) continue;
      if (m[i][j] === null) v.add(`strongOwnStream ${a.task} on ${a.agent}`); else score += m[i][j];
      if (ag.value[j].kind === 'orchestrator') orch += 1;
    }
    const c = constraints.value;
    if (assignments.value.length > c.maxStarts) v.add(`maxStarts ${c.maxStarts} exceeded by ${assignments.value.length}`);
    if (c.orchestratorsBusy + orch > c.maxOrchestratorsBusy) v.add(`orchestrator cap ${c.maxOrchestratorsBusy} exceeded (busy ${c.orchestratorsBusy} + ${orch})`);
    const list = [...v].sort();
    return { accepted: list.length === 0, reason: list.length ? list.join('; ') : 'feasible', violations: list, score };
  } });

  // ================================================================= the frontier rule (demand)
  C({ id: 'agents.measure', description: 'status counts of a state; done = completed but not yet integrated; finished when every task is integrated',
    in: { state: stateS }, out: { counts: countsS, finished: { type: 'boolean' } },
    examples: [{ in: { state: tinyS2 }, out: { counts: cnt(1, 0, 1, 1, 0), finished: false } },
      { in: { state: tinyFinal }, out: { counts: cnt(0, 0, 0, 0, 3), finished: true } }] });
  I({ id: 'agents.measure/count', implements: 'agents.measure', run: ({ state }) => {
    const c = { hidden: 0, ready: 0, running: 0, done: 0, integrated: 0, total: state.value.tasks.length };
    for (const t of state.value.tasks) c[t.status] += 1;
    return { counts: c, finished: c.integrated === c.total };
  } });

  C({ id: 'agents.demand', description: 'request(n): how many tasks may start now. reserve = N - (done + running); literal = all ready tasks while done < N',
    in: { counts: countsS, config: configS }, out: { limit: int },
    examples: [
      { in: { counts: cnt(2, 4, 1, 1, 0, 8), config: config(3) }, out: { limit: 1 } },                    // 3 - 1 - 1
      { in: { counts: cnt(2, 4, 1, 1, 0, 8), config: config(3, { gate: 'literal' }) }, out: { limit: 4 } }, // done 1 < 3: every ready task
      { in: { counts: cnt(2, 4, 0, 3, 0, 9), config: config(3, { gate: 'literal' }) }, out: { limit: 0 } }, // done 3 >= 3: blocked
      { in: { counts: cnt(0, 2, 2, 2, 0, 6), config: config(3) }, out: { limit: 0 } },                    // 3 - 2 - 2 clamps at 0
    ] });
  // The monolithic implementation: the gate is an untraced ternary inside one function.
  I({ id: 'agents.demand/credits', implements: 'agents.demand', run: ({ counts, config: cfg }) => {
    const c = counts.value; const n = cfg.value.frontier;
    return { limit: cfg.value.gate === 'literal' ? (c.done >= n ? 0 : c.ready) : Math.max(0, n - c.done - c.running) };
  } });
  // The branching implementation (v0.4): the conditions are tests over the config, so no predicate contract is needed.
  C({ id: 'agents.demandReserve', description: 'credits: N minus (done + running), never below 0',
    in: { counts: countsS, config: configS }, out: { limit: int },
    examples: [{ in: { counts: cnt(2, 4, 1, 1, 0, 8), config: config(3) }, out: { limit: 1 } }, { in: { counts: cnt(0, 2, 2, 2, 0, 6), config: config(3) }, out: { limit: 0 } }] });
  I({ id: 'agents.demandReserve/credits', implements: 'agents.demandReserve', run: ({ counts, config: cfg }) => ({ limit: Math.max(0, cfg.value.frontier - counts.value.done - counts.value.running) }) });
  C({ id: 'agents.demandLiteral', description: 'literal: every ready task while done < N, nothing once done >= N',
    in: { counts: countsS, config: configS }, out: { limit: int },
    examples: [{ in: { counts: cnt(2, 4, 1, 1, 0, 8), config: config(3, { gate: 'literal' }) }, out: { limit: 4 } }, { in: { counts: cnt(2, 4, 0, 3, 0, 9), config: config(3, { gate: 'literal' }) }, out: { limit: 0 } }] });
  I({ id: 'agents.demandLiteral/done', implements: 'agents.demandLiteral', run: ({ counts, config: cfg }) => ({ limit: counts.value.done >= cfg.value.frontier ? 0 : counts.value.ready }) });
  world.compose({ id: 'agents.demand/gated', implements: 'agents.demand',
    steps: [
      { name: 'lit', call: 'agents.demandLiteral', when: { eq: [{ at: ['$in.config', 'gate'] }, { literal: 'literal' }] }, bind: { counts: '$in.counts', config: '$in.config' } },
      { name: 'res', call: 'agents.demandReserve', when: { else: ['lit'] }, bind: { counts: '$in.counts', config: '$in.config' } },
    ],
    returns: { limit: { one: ['lit.limit', 'res.limit'] } } });
  world.select('agents.demand', 'agents.demand/gated');

  C({ id: 'agents.frontier', description: 'the allocation problem as a value: idle agents, ready tasks, constraints (maxStarts is the demand)',
    in: { state: stateS, limit: int, config: configS }, out: { idle, ready, constraints: constraintsS },
    examples: [{ in: { state: tinyS2adv, limit: 1, config: tinyCfg },
      out: { idle: [A('h1', 'helper', 'B'), A('sA', 'strong', 'A')], ready: [T('t3', 'A', 1)], constraints: cons(1) } },
      { in: { state: tinyS3, limit: 0, config: tinyCfg }, out: { idle: [A('h1', 'helper', 'B')], ready: [], constraints: cons(0) } }] });
  I({ id: 'agents.frontier/view', implements: 'agents.frontier', run: ({ state, limit, config: cfg }) => ({
    idle: state.value.agents.filter((a) => a.task === null).map(({ id, kind: k, stream: s }) => ({ id, kind: k, stream: s })),
    ready: state.value.tasks.filter((t) => t.status === 'ready').map(({ id, stream: s, cost }) => ({ id, stream: s, cost })),
    constraints: { maxStarts: limit.value, maxOrchestratorsBusy: cfg.value.maxOrchestratorsBusy,
      orchestratorsBusy: state.value.agents.filter((a) => a.kind === 'orchestrator' && a.task !== null).length },
  }) });
  C({ id: 'agents.capacity', kind: 'check', description: 'frontier invariant: the backlog of completed-but-unintegrated tasks never exceeds the integration capacity N',
    in: { counts: countsS, config: configS }, out: { accepted: { type: 'boolean' }, reason: str },
    examples: [
      { in: { counts: cnt(2, 4, 1, 2, 0, 9), config: config(3) }, out: { accepted: true, reason: 'done 2 <= N 3' } },
      { in: { counts: cnt(0, 0, 0, 3, 0, 9), config: config(3) }, out: { accepted: true, reason: 'done 3 <= N 3' } },
      { in: { counts: cnt(0, 0, 0, 4, 0, 9), config: config(3) }, out: { accepted: false, reason: 'done 4 > N 3' } },
    ] });
  I({ id: 'agents.capacity/backlog', implements: 'agents.capacity', run: ({ counts, config: cfg }) => {
    const d = counts.value.done; const n = cfg.value.frontier;
    return { accepted: d <= n, reason: `done ${d} ${d <= n ? '<=' : '>'} N ${n}` };
  } });

  // ================================================================= time: the clock and the three state transitions of one tick
  C({ id: 'agents.clock', description: 'the current tick of the enclosing drive (-1 outside a drive)', in: {}, out: { tick: tickNo },
    examples: [{ name: 'tick 0', in: {}, tick: 0, out: { tick: 0 } }, { name: 'tick 7', in: {}, tick: 7, out: { tick: 7 } }] });   // v0.5: examples at a tick, no invented sentinel
  // v0.3: reading ctx.tick() makes the tick a cache dependency of this call, so no pure:false is needed (it was FRICTION 11)
  I({ id: 'agents.clock/ctx', implements: 'agents.clock', run: (_, ctx) => ({ tick: ctx.tick() ?? -1 }) });

  C({ id: 'agents.advance', description: 'time passes at tick t: running tasks lose one tick; finished ones free their agent and reveal tasks; the integrator loses one tick',
    in: { state: stateS, t: tickNo }, out: { state: stateS, events },
    examples: [
      { in: { state: tinyS1, t: 1 }, out: { state: {
          ...tinyS1, agents: tinyAgents('t1', null),
          tasks: [task('t1', 'A', 2, ['t3'], 'running', { agent: 'sA', remaining: 1, startedAt: 0 }),
            task('t2', 'B', 1, [], 'done', { agent: 'h1', remaining: 0, startedAt: 0, finishedAt: 1 }), task('t3', 'A', 1, [], 'hidden')] },
        events: [{ t: 1, kind: 'complete', task: 't2', agent: 'h1' }] } },
      { in: { state: tinyS2, t: 2 }, out: { state: tinyS2adv,
        events: [{ t: 2, kind: 'complete', task: 't1', agent: 'sA' }, { t: 2, kind: 'reveal', task: 't3', by: 't1' }, { t: 2, kind: 'integrated', task: 't2' }] } },
    ] });
  I({ id: 'agents.advance/step', implements: 'agents.advance', run: ({ state, t }) => {
    const s = structuredClone(state.value); const now = t.value; const ev = [];
    for (const k of s.tasks) {
      if (k.status !== 'running') continue;
      k.remaining -= 1;
      if (k.remaining > 0) continue;
      k.status = 'done'; k.finishedAt = now;
      s.agents.find((a) => a.id === k.agent).task = null;
      ev.push({ t: now, kind: 'complete', task: k.id, agent: k.agent });
      for (const r of k.reveals) { s.tasks.find((x) => x.id === r).status = 'ready'; ev.push({ t: now, kind: 'reveal', task: r, by: k.id }); }
    }
    if (s.integrator.task) {
      s.integrator.remaining -= 1;
      if (s.integrator.remaining <= 0) {
        const k = s.tasks.find((x) => x.id === s.integrator.task);
        k.status = 'integrated'; k.integratedAt = now; ev.push({ t: now, kind: 'integrated', task: k.id });
        s.integrator = { task: null, remaining: 0 };
      }
    }
    return { state: s, events: ev };
  } });

  C({ id: 'agents.integrate', description: 'an idle integrator takes the oldest completed task (FIFO by finish time, then id) and works on it for integrationTicks',
    in: { state: stateS, config: configS, t: tickNo }, out: { state: stateS, events },
    examples: [
      { in: { state: tinyS2adv, config: tinyCfg, t: 2 }, out: { state: tinyS2int, events: [{ t: 2, kind: 'integrateStart', task: 't1' }] } },
      { in: { state: tinyS2, config: tinyCfg, t: 2 }, out: { state: tinyS2, events: [] } },   // integrator busy: nothing changes
      { in: { state: tinyS1, config: tinyCfg, t: 1 }, out: { state: tinyS1, events: [] } },   // nothing completed
    ] });
  I({ id: 'agents.integrate/fifo', implements: 'agents.integrate', run: ({ state, config: cfg, t }, ctx) => {
    const s = structuredClone(state.value);
    // v0.4: a test over a Ref, so the decision names the state it read (round 3: `computed`, FRICTION 22)
    if (ctx.when({ ne: [ctx.at(state, 'integrator', 'task'), null] }, 'integrator busy', { true: 'busy', false: 'free' })) return { state: s, events: [] };
    const next = s.tasks.filter((k) => k.status === 'done').sort((x, y) => x.finishedAt - y.finishedAt || (x.id < y.id ? -1 : 1))[0];
    // not a relation over Refs I hold (it is the result of a filter and a sort), so this one stays a computed boolean
    if (!ctx.when(next !== undefined, 'a completed task waits', { true: 'take oldest', false: 'nothing waits' })) return { state: s, events: [] };
    s.integrator = { task: next.id, remaining: cfg.value.integrationTicks };
    return { state: s, events: [{ t: t.value, kind: 'integrateStart', task: next.id }] };
  } });

  C({ id: 'agents.commit', description: 'start the assigned tasks at tick t; refuses (ctx.fault ASSIGNMENT_REJECTED) when the checker rejected the assignments',
    in: { state: stateS, assignments: { type: 'array', items: assignmentS }, accepted: { type: 'boolean' }, reason: str, t: tickNo }, out: { state: stateS, events },
    examples: [
      { in: { state: tinyS0, assignments: [{ task: 't1', agent: 'sA', score: 1112 }, { task: 't2', agent: 'h1', score: 1101 }], accepted: true, reason: 'feasible', t: 0 },
        out: { state: tinyS1, events: [{ t: 0, kind: 'assign', task: 't1', agent: 'sA', score: 1112 }, { t: 0, kind: 'assign', task: 't2', agent: 'h1', score: 1101 }] } },
      { in: { state: tinyS1, assignments: [], accepted: true, reason: 'feasible', t: 1 }, out: { state: tinyS1, events: [] } },
    ] });
  I({ id: 'agents.commit/start', implements: 'agents.commit', run: ({ state, assignments, accepted, reason, t }, ctx) => {
    // the decision keeps the provenance of the check's `accepted` output; the fault names its code (v0.3)
    if (!ctx.when(accepted, 'assignments accepted', { true: 'start', false: 'refuse' })) ctx.fault(`commit refused: ${reason.value}`, 'ASSIGNMENT_REJECTED');
    const s = structuredClone(state.value); const now = t.value; const ev = [];
    for (const a of assignments.value) {
      const k = s.tasks.find((x) => x.id === a.task); const g = s.agents.find((x) => x.id === a.agent);
      k.status = 'running'; k.agent = g.id; k.remaining = k.cost; k.startedAt = now; g.task = k.id;
      ev.push({ t: now, kind: 'assign', task: k.id, agent: g.id, score: a.score });
    }
    return { state: s, events: ev };
  } });

  // ================================================================= the audit seat: how much does the primary allocator lose to the shadow?
  C({ id: 'agents.regret', kind: 'check', description: 'the primary allocation must score what the shadow allocation scores; rejects when the primary lost',
    in: { primary: int, shadow: int }, out: { accepted: { type: 'boolean' }, reason: str },
    examples: [
      { in: { primary: 1909, shadow: 1909 }, out: { accepted: true, reason: 'primary 1909 matches shadow 1909' } },
      { in: { primary: 1709, shadow: 1909 }, out: { accepted: false, reason: 'primary 1709 loses 200 to shadow 1909' } },
    ] });
  I({ id: 'agents.regret/gap', implements: 'agents.regret', run: ({ primary, shadow }) => {
    const gap = shadow.value - primary.value;
    return { accepted: gap <= 0, reason: gap <= 0 ? `primary ${primary.value} matches shadow ${shadow.value}` : `primary ${primary.value} loses ${gap} to shadow ${shadow.value}` };
  } });

  // ================================================================= one tick, declared as data (kind: 'tick')
  const tickIn = { state: stateS, config: configS };
  const tickOut = { state: stateS, events, counts: countsS, finished: { type: 'boolean' } };
  C({ id: 'agents.tick', kind: 'tick', description: 'one tick of the workflow: clock, advance, integrate, measure, demand, frontier, allocate (primary seat; shadow seat when audit), check, commit, measure, capacity check',
    in: tickIn, out: tickOut,
    examples: [
      // a finished world is a fixed point: nothing advances, integrates or starts, so no event (and no clock reading) can appear
      { name: 'a finished world is a fixed point', in: { state: tinyFinal, config: tinyCfg }, out: { state: tinyFinal, counts: cnt(0, 0, 0, 0, 3), finished: true, events: [] } },
      // `ticks`: drive the hand-derived tiny world for 5 ticks (0..4); the last tick's events are one (the whole 13-event log is the simulate example)
      { name: 'the tiny world, five ticks (final tick)', in: { state: tinyS0, config: tinyCfg }, ticks: 5,
        out: { state: tinyFinal, counts: cnt(0, 0, 0, 0, 3), finished: true, events: [{ t: 4, kind: 'integrated', task: 't3' }] } },
      // v0.5 `trajectory`: outputs per tick, each tick checked. The same timeline, by hand, tick by tick: counts are after the tick
      { name: 'the tiny world, tick by tick', in: { state: tinyS0, config: tinyCfg }, ticks: 5, trajectory: [
        { events: tinyEvents.filter((e) => e.t === 0), counts: cnt(1, 0, 2, 0, 0), finished: false },
        { events: tinyEvents.filter((e) => e.t === 1), counts: cnt(1, 0, 1, 1, 0), finished: false },
        { events: tinyEvents.filter((e) => e.t === 2), counts: cnt(0, 0, 1, 1, 1), finished: false },
        { events: tinyEvents.filter((e) => e.t === 3), counts: cnt(0, 0, 0, 1, 2), finished: false },
        { events: tinyEvents.filter((e) => e.t === 4), counts: cnt(0, 0, 0, 0, 3), finished: true }] },
    ] });
  const audit = { at: ['$in.config', 'audit'] };
  world.compose({ id: 'agents.tick/pipeline', implements: 'agents.tick',
    steps: [
      { name: 'now', call: 'agents.clock', bind: {} },
      { name: 'adv', call: 'agents.advance', bind: { state: '$in.state', t: 'now.tick' } },
      { name: 'integ', call: 'agents.integrate', bind: { state: 'adv.state', config: '$in.config', t: 'now.tick' } },
      { name: 'before', slot: 'before', call: 'agents.measure', bind: { state: 'integ.state' } },
      { name: 'demand', call: 'agents.demand', bind: { counts: 'before.counts', config: '$in.config' } },
      { name: 'view', call: 'agents.frontier', bind: { state: 'integ.state', limit: 'demand.limit', config: '$in.config' } },
      { name: 'alloc', slot: 'primary', call: 'agents.allocate', bind: { idle: 'view.idle', ready: 'view.ready', constraints: 'view.constraints' } },
      { name: 'shadow', slot: 'shadow', call: 'agents.allocate', when: audit, bind: { idle: 'view.idle', ready: 'view.ready', constraints: 'view.constraints' } },
      { name: 'regret', call: 'agents.regret', bind: { primary: 'alloc.score', shadow: 'shadow.score' } },   // no guard of its own: it reads shadow, so it inherits shadow's skip (v0.5)
      { name: 'check', call: 'agents.evaluate', bind: { idle: 'view.idle', ready: 'view.ready', constraints: 'view.constraints', assignments: 'alloc.assignments' } },
      { name: 'commit', call: 'agents.commit', bind: { state: 'integ.state', assignments: 'alloc.assignments', accepted: 'check.accepted', reason: 'check.reason', t: 'now.tick' } },
      { name: 'after', slot: 'after', call: 'agents.measure', bind: { state: 'commit.state' } },
      { name: 'cap', call: 'agents.capacity', bind: { counts: 'after.counts', config: '$in.config' } },
    ],
    returns: {
      state: 'commit.state',
      events: { concat: ['adv.events', 'integ.events', 'commit.events'] },
      counts: 'after.counts', finished: 'after.finished' } });

  // ================================================================= the whole run in ONE call (ctx.drive with collect)
  C({ id: 'agents.simulate', description: 'fold agents.tick inside this call until every task is integrated; each tick is a child node tagged @k; the events of all ticks are collected',
    in: { state: stateS, config: configS }, out: { state: stateS, ticks: int, counts: countsS, events },
    examples: [{ name: 'the tiny world in one call', in: { state: tinyS0, config: tinyCfg }, out: { state: tinyFinal, ticks: 5, counts: cnt(0, 0, 0, 0, 3), events: tinyEvents } }] });
  I({ id: 'agents.simulate/drive', implements: 'agents.simulate', uses: ['agents.tick'], run: ({ state, config: cfg }, ctx) => {
    const d = ctx.drive('agents.tick', { state, config: cfg }, { until: (o) => o.finished, maxTicks: MAX_TICKS, collect: ['events'] });
    if (!d.finished.value) ctx.fault(`not finished after ${MAX_TICKS} ticks`, 'NOT_FINISHED');
    // collect gives one Ref (an array of each tick's events, every element pointing at its tick's call); concat flattens it keeping that path
    const perTick = d.collected.events;
    return { state: d.state, ticks: d.ticks, counts: d.counts, events: ctx.concat(...perTick.value.map((_, k) => ctx.at(perTick, k))) };
  } });
}

// ------------------------------------------------------------------ drivers
const MAX_TICKS = 500;

/** world.drive over agents.tick until every task is integrated. world.drive has no `collect`, so the log is the driver's flat-map of the receipts. */
export function runDrive(world, state, cfg, { fill, cache = true, maxTicks = MAX_TICKS, startTick, allowUnfinished = false, landing } = {}) {
  const d = world.drive('agents.tick', { state, config: cfg }, { fill, cache, maxTicks, startTick, landing, until: (out) => out.finished });
  if (!d.final.finished && !allowUnfinished) throw new Error(`not finished after ${maxTicks} ticks`);
  const out = (r, port) => world.part(r.outputs[port]);
  const tickEvents = d.receipts.map((r) => out(r, 'events'));
  return { ...d, states: d.receipts.map((r) => out(r, 'state')), series: d.receipts.map((r) => out(r, 'counts')), tickEvents, events: tickEvents.flat(),
    verdicts: d.receipts.flatMap((r) => r.verdicts.map((v) => ({ tick: r.tick, ...v }))) };
}

/** The same simulation as ONE run of agents.simulate (ctx.drive inside a call). */
export function runSimulate(world, state, cfg, { fill, cache = true } = {}) {
  const r = world.run('agents.simulate', { state, config: cfg }, { fill, cache });
  return { ...r, events: r.outputs.events, ticks: r.outputs.ticks, final: r.outputs.state };
}
