// Contest B: digital logic. Bits are Parts (the integers 0 and 1). NAND is the only logic primitive.
// Everything above gate.nand is a composition (data) or an implementation that only calls lower contracts.
// Round 2 (kernel v0.2): sequential logic uses kind:'tick' + world.drive, bit gathers use ctx.gather / {gather},
// per-bit call sites are named with slots, and the adder carries a kind:'check' audit. See FRICTION.md.
// Round 3 (kernel v0.3): slots are declared in `uses`; counter.run folds with ctx.drive; conditional steps (`when`/`first`) and
// ctx.when give two behavioural multiplexers and a clock-gated counter; the 8-bit adder joins its halves with {concat};
// timing models and fault behaviour are implementation examples. See FRICTION.md.
// Round 4 (kernel v0.4): conditions are relations ({ eq: ['$in.select', 1] }), so the bit.test helper contract is gone; the nibble
// copies of the ripple adder are gone (path fills 'adder.ripple4#hi/adder.full#bit2'); counter.run collects its states with
// ctx.drive; a lazy `first` lets the clock-gated counter return one gather.
// Round 6 (kernel v0.6): the trajectory examples carry names; the five trace scans that counted fault sites are `receipt.fillReach`;
// the busy gated tick records its inherited runs, so busy and idle leave the same five rows.
// Round 5 (kernel v0.5): the latch trajectories are `each` + `trajectory` examples on the two implementations, so `prove` checks them;
// the branch mux derives takeA with { else: ['takeB'] } instead of typing the complement; the gated counter writes its guard once
// (the flops inherit inc's skip).

const bit = { type: 'integer', minimum: 0, maximum: 1 };
const bits4 = { type: 'array', minItems: 4, maxItems: 4, items: bit };
const WIDTH = 4;

// ---- encoding helpers: the I/O boundary between JS integers and little-endian bit arrays.
// These are NOT part of the circuit; tests and renders use them to state expectations and to read results.
export const bitsOf = (n, width = WIDTH) => Array.from({ length: width }, (_, i) => Math.floor(n / 2 ** i) % 2);
export const intOf = (bits) => bits.reduce((sum, b, i) => sum + b * 2 ** i, 0);

export function register(world) {
  const C = (def) => world.contract(def);
  const I = (def) => world.implement(def);
  const gate1 = { in: { a: bit }, out: { q: bit } };
  const gate2 = { in: { a: bit, b: bit }, out: { q: bit } };

  // ---------------------------------------------------------------- the only primitive
  C({ id: 'gate.nand', ...gate2,
    description: 'q = NOT (a AND b). The only logic primitive in this world.',
    examples: [
      { in: { a: 0, b: 0 }, out: { q: 1 } },
      { in: { a: 0, b: 1 }, out: { q: 1 } },
      { in: { a: 1, b: 0 }, out: { q: 1 } },
      { in: { a: 1, b: 1 }, out: { q: 0 } },
    ] });
  I({ id: 'gate.nand/js', implements: 'gate.nand', run: ({ a, b }) => ({ q: a.value === 1 && b.value === 1 ? 0 : 1 }) });

  // ---------------------------------------------------------------- gates composed from NAND
  C({ id: 'gate.not', ...gate1, description: 'q = NAND(a, a)',
    examples: [{ in: { a: 0 }, out: { q: 1 } }, { in: { a: 1 }, out: { q: 0 } }] });
  world.compose({ id: 'gate.not/nand', implements: 'gate.not',
    steps: [{ name: 'n', call: 'gate.nand', bind: { a: '$in.a', b: '$in.a' } }],
    returns: { q: 'n.q' } });

  C({ id: 'gate.and', ...gate2, description: 'q = NOT(NAND(a, b))',
    examples: [
      { in: { a: 0, b: 0 }, out: { q: 0 } }, { in: { a: 0, b: 1 }, out: { q: 0 } },
      { in: { a: 1, b: 0 }, out: { q: 0 } }, { in: { a: 1, b: 1 }, out: { q: 1 } },
    ] });
  world.compose({ id: 'gate.and/nand-not', implements: 'gate.and',
    steps: [
      { name: 'n', call: 'gate.nand', bind: { a: '$in.a', b: '$in.b' } },
      { name: 'inv', call: 'gate.not', bind: { a: 'n.q' } },
    ],
    returns: { q: 'inv.q' } });

  C({ id: 'gate.or', ...gate2, description: 'q = NAND(NOT a, NOT b)  (De Morgan)',
    examples: [
      { in: { a: 0, b: 0 }, out: { q: 0 } }, { in: { a: 0, b: 1 }, out: { q: 1 } },
      { in: { a: 1, b: 0 }, out: { q: 1 } }, { in: { a: 1, b: 1 }, out: { q: 1 } },
    ] });
  world.compose({ id: 'gate.or/de-morgan', implements: 'gate.or',
    steps: [
      { name: 'na', call: 'gate.not', bind: { a: '$in.a' } },
      { name: 'nb', call: 'gate.not', bind: { a: '$in.b' } },
      { name: 'r', call: 'gate.nand', bind: { a: 'na.q', b: 'nb.q' } },
    ],
    returns: { q: 'r.q' } });

  C({ id: 'gate.xor', ...gate2, description: 'The classic four-NAND exclusive or: n1=NAND(a,b); n2=NAND(a,n1); n3=NAND(b,n1); q=NAND(n2,n3)',
    examples: [
      { in: { a: 0, b: 0 }, out: { q: 0 } }, { in: { a: 0, b: 1 }, out: { q: 1 } },
      { in: { a: 1, b: 0 }, out: { q: 1 } }, { in: { a: 1, b: 1 }, out: { q: 0 } },
    ] });
  world.compose({ id: 'gate.xor/four-nand', implements: 'gate.xor',
    steps: [
      { name: 'n1', call: 'gate.nand', bind: { a: '$in.a', b: '$in.b' } },
      { name: 'n2', call: 'gate.nand', bind: { a: '$in.a', b: 'n1.q' } },
      { name: 'n3', call: 'gate.nand', bind: { a: '$in.b', b: 'n1.q' } },
      { name: 'n4', call: 'gate.nand', bind: { a: 'n2.q', b: 'n3.q' } },
    ],
    returns: { q: 'n4.q' } });

  // select b when select=1, else a. Expected rows derived from that sentence, listed (a, b, select).
  C({ id: 'gate.mux', in: { a: bit, b: bit, select: bit }, out: { q: bit },
    description: 'q = b when select=1, else a. NAND form: NAND(NAND(a, NOT select), NAND(b, select))',
    examples: [
      { in: { a: 0, b: 0, select: 0 }, out: { q: 0 } }, { in: { a: 0, b: 1, select: 0 }, out: { q: 0 } },
      { in: { a: 1, b: 0, select: 0 }, out: { q: 1 } }, { in: { a: 1, b: 1, select: 0 }, out: { q: 1 } },
      { in: { a: 0, b: 0, select: 1 }, out: { q: 0 } }, { in: { a: 0, b: 1, select: 1 }, out: { q: 1 } },
      { in: { a: 1, b: 0, select: 1 }, out: { q: 0 } }, { in: { a: 1, b: 1, select: 1 }, out: { q: 1 } },
    ] });
  world.compose({ id: 'gate.mux/nand', implements: 'gate.mux',
    steps: [
      { name: 'ns', call: 'gate.not', bind: { a: '$in.select' } },
      { name: 'x', call: 'gate.nand', bind: { a: '$in.a', b: 'ns.q' } },
      { name: 'y', call: 'gate.nand', bind: { a: '$in.b', b: '$in.select' } },
      { name: 'r', call: 'gate.nand', bind: { a: 'x.q', b: 'y.q' } },
    ],
    returns: { q: 'r.q' } });

  // ---- the multiplexer written as a decision instead of as gates (round 3), with conditions as relations (round 4).
  C({ id: 'gate.buf', ...gate1, description: 'q = a, as two inverters in series: NOT(NOT a)',
    examples: [{ in: { a: 0 }, out: { q: 0 } }, { in: { a: 1 }, out: { q: 1 } }] });
  world.compose({ id: 'gate.buf/two-nots', implements: 'gate.buf',
    steps: [
      { name: 'n1', call: 'gate.not', bind: { a: '$in.a' } },
      { name: 'n2', call: 'gate.not', bind: { a: 'n1.q' } },
    ],
    returns: { q: 'n2.q' } });

  // Behavioural mux, as data. Both buffers are declared; the one that is not selected is skipped, so it leaves no node in the trace.
  // Exactly one is live for a bit, so the result is `one` of them (AMBIGUOUS_BRANCH if both were). The conditions read the wire
  // directly: { eq: ['$in.select', 1] }. A real multiplexer cannot skip anything (the unselected AND gate still exists and still
  // switches). This is a model of selection, not a circuit: 2 NANDs where the gate version has 4.
  world.compose({ id: 'gate.mux/branch', implements: 'gate.mux',
    steps: [
      { name: 'takeB', call: 'gate.buf', when: { eq: ['$in.select', 1] }, bind: { a: '$in.b' } },
      { name: 'takeA', call: 'gate.buf', when: { else: ['takeB'] }, bind: { a: '$in.a' } },
    ],
    returns: { q: { one: ['takeB.q', 'takeA.q'] } } });
  // The same model written imperatively: ctx.when takes the relation and names both branches.
  I({ id: 'gate.mux/ctx-when', implements: 'gate.mux', uses: ['gate.buf'],
    run: ({ a, b, select }, ctx) => (ctx.when({ eq: [select, 1] }, 'select = 1?', { true: 'takeB', false: 'takeA' })
      ? { q: ctx.call('gate.buf', { a: b }).q } : { q: ctx.call('gate.buf', { a }).q }) });
  world.select('gate.mux', 'gate.mux/nand');

  // ---------------------------------------------------------------- adders
  C({ id: 'adder.half', in: { a: bit, b: bit }, out: { sum: bit, carry: bit },
    description: 'sum = a XOR b, carry = a AND b',
    examples: [
      { in: { a: 0, b: 0 }, out: { sum: 0, carry: 0 } }, { in: { a: 0, b: 1 }, out: { sum: 1, carry: 0 } },
      { in: { a: 1, b: 0 }, out: { sum: 1, carry: 0 } }, { in: { a: 1, b: 1 }, out: { sum: 0, carry: 1 } },
    ] });
  world.compose({ id: 'adder.half/xor-and', implements: 'adder.half',
    steps: [
      { name: 'x', call: 'gate.xor', bind: { a: '$in.a', b: '$in.b' } },
      { name: 'c', call: 'gate.and', bind: { a: '$in.a', b: '$in.b' } },
    ],
    returns: { sum: 'x.q', carry: 'c.q' } });

  // a + b + cin = sum + 2*carry; rows derived by counting the ones among (a, b, cin).
  C({ id: 'adder.full', in: { a: bit, b: bit, cin: bit }, out: { sum: bit, carry: bit },
    description: 'Two half adders and an OR for the carries',
    examples: [
      { in: { a: 0, b: 0, cin: 0 }, out: { sum: 0, carry: 0 } }, { in: { a: 0, b: 0, cin: 1 }, out: { sum: 1, carry: 0 } },
      { in: { a: 0, b: 1, cin: 0 }, out: { sum: 1, carry: 0 } }, { in: { a: 0, b: 1, cin: 1 }, out: { sum: 0, carry: 1 } },
      { in: { a: 1, b: 0, cin: 0 }, out: { sum: 1, carry: 0 } }, { in: { a: 1, b: 0, cin: 1 }, out: { sum: 0, carry: 1 } },
      { in: { a: 1, b: 1, cin: 0 }, out: { sum: 0, carry: 1 } }, { in: { a: 1, b: 1, cin: 1 }, out: { sum: 1, carry: 1 } },
    ] });
  world.compose({ id: 'adder.full/two-half', implements: 'adder.full',
    steps: [
      { name: 'h1', call: 'adder.half', bind: { a: '$in.a', b: '$in.b' } },
      { name: 'h2', call: 'adder.half', bind: { a: 'h1.sum', b: '$in.cin' } },
      { name: 'o', call: 'gate.or', bind: { a: 'h1.carry', b: 'h2.carry' } },
    ],
    returns: { sum: 'h2.sum', carry: 'o.q' } });

  // Examples (a, b little-endian, cin -> sum, cout), each worked as ordinary addition:
  //   11 + 6 + 0 = 17 = 16 + 1      9 + 7 + 0 = 16 = 16 + 0      15 + 0 + 1 = 16      5 + 3 + 1 = 9      0 + 0 + 0 = 0
  C({ id: 'adder.ripple4', in: { a: bits4, b: bits4, cin: bit }, out: { sum: bits4, cout: bit },
    description: '4-bit ripple-carry adder, little-endian; bit i enters full adder i through ctx.at, the carry rides from adder i to adder i+1',
    examples: [
      { in: { a: [1, 1, 0, 1], b: [0, 1, 1, 0], cin: 0 }, out: { sum: [1, 0, 0, 0], cout: 1 } },
      { in: { a: [1, 0, 0, 1], b: [1, 1, 1, 0], cin: 0 }, out: { sum: [0, 0, 0, 0], cout: 1 } },
      { in: { a: [1, 1, 1, 1], b: [0, 0, 0, 0], cin: 1 }, out: { sum: [0, 0, 0, 0], cout: 1 } },
      { in: { a: [1, 0, 1, 0], b: [1, 1, 0, 0], cin: 1 }, out: { sum: [1, 0, 0, 1], cout: 0 } },
      { in: { a: [0, 0, 0, 0], b: [0, 0, 0, 0], cin: 0 }, out: { sum: [0, 0, 0, 0], cout: 0 } },
    ] });

  // Composed: steps are generated by plain JS at registration, then the result is ordinary data (checked at assembly).
  // Each full adder is a named call site (slot bit0..bit3) so a fill can target one bit: 'adder.full#bit2'.
  // The composition declares the slots through its steps' `slot`; the loop declares them in `uses` (v0.3), so a typo in a fill key
  // is BAD_FILL and the loop may call no slot except these four.
  const rippleSteps = Array.from({ length: WIDTH }, (_, i) => ({
    name: `fa${i}`, call: 'adder.full', slot: `bit${i}`,
    bind: { a: { at: ['$in.a', i] }, b: { at: ['$in.b', i] }, cin: i === 0 ? '$in.cin' : `fa${i - 1}.carry` },
  }));
  world.compose({ id: 'adder.ripple4/composed', implements: 'adder.ripple4',
    steps: rippleSteps,
    returns: { sum: { gather: rippleSteps.map((s) => `${s.name}.sum`) }, cout: `fa${WIDTH - 1}.carry` } });

  // Imperative twin: same wiring, same slots; the sum array is built with ctx.gather so its provenance is kept.
  I({ id: 'adder.ripple4/loop', implements: 'adder.ripple4', uses: Array.from({ length: WIDTH }, (_, i) => `adder.full#bit${i}`),
    run: ({ a, b, cin }, ctx) => {
      let carry = cin; const sums = [];
      for (let i = 0; i < WIDTH; i += 1) {
        const fa = ctx.call('adder.full', { a: ctx.at(a, i), b: ctx.at(b, i), cin: carry }, { slot: `bit${i}` });
        sums.push(fa.sum);
        carry = fa.carry;
      }
      return { sum: ctx.gather(sums), cout: carry };
    } });
  world.select('adder.ripple4', 'adder.ripple4/composed');

  // ---- round 3: eight bits from two nibbles. The sum is the CONCAT of the nibble sums, the carry rides from the low nibble into the high one.
  // A composition cannot slice an array, so each nibble's input is gathered from four `at` pieces (see FRICTION: no slice).
  const bits8 = { type: 'array', minItems: 8, maxItems: 8, items: bit };
  const nibble = (port, from) => ({ gather: [0, 1, 2, 3].map((i) => ({ at: [`$in.${port}`, from + i] })) });
  C({ id: 'adder.ripple8', in: { a: bits8, b: bits8, cin: bit }, out: { sum: bits8, cout: bit },
    description: '8-bit adder, little-endian: two adder.ripple4 calls (slots lo, hi); the low carry-out is the high carry-in; sum = concat(lo.sum, hi.sum)',
    examples: [
      { in: { a: bitsOf(100, 8), b: bitsOf(155, 8), cin: 0 }, out: { sum: bitsOf(255, 8), cout: 0 } }, // 100 + 155 = 255
      { in: { a: bitsOf(255, 8), b: bitsOf(0, 8), cin: 1 }, out: { sum: bitsOf(0, 8), cout: 1 } }, // 255 + 0 + 1 = 256 = 0 + 256
      { in: { a: bitsOf(200, 8), b: bitsOf(100, 8), cin: 0 }, out: { sum: bitsOf(44, 8), cout: 1 } }, // 300 = 44 + 256
      { in: { a: bitsOf(15, 8), b: bitsOf(1, 8), cin: 0 }, out: { sum: bitsOf(16, 8), cout: 0 } }, // the carry crosses the nibble boundary
    ] });
  world.compose({ id: 'adder.ripple8/two-nibbles', implements: 'adder.ripple8',
    steps: [
      { name: 'lo', call: 'adder.ripple4', slot: 'lo', bind: { a: nibble('a', 0), b: nibble('b', 0), cin: '$in.cin' } },
      { name: 'hi', call: 'adder.ripple4', slot: 'hi', bind: { a: nibble('a', 4), b: nibble('b', 4), cin: 'lo.cout' } },
    ],
    returns: { sum: { concat: ['lo.sum', 'hi.sum'] }, cout: 'hi.cout' } });
  // Round 4: one full adder of one nibble is addressed by its chain: fill 'adder.ripple4#hi/adder.full#bit2'.

  // ---------------------------------------------------------------- sequential: kind 'tick'
  // A tick contract has a `state` port on both sides; world.drive feeds each tick's state Ref into the next tick.
  // The stored bit is now the contract's state, not a parameter the caller has to know to thread.
  //   next = clk ? d : state       a MUX whose "a" input is the previous state (one tick of memory)
  C({ id: 'ff.dff', kind: 'tick', in: { d: bit, state: bit, clk: bit }, out: { state: bit },
    description: 'Edge-sampling D flip-flop, one tick per call. clk=1: a clock edge occurs this tick and the stored bit takes d. clk=0: it keeps the stored bit (state). The output port is called `state` because the tick kind requires that name.',
    examples: [
      { in: { d: 0, state: 0, clk: 0 }, out: { state: 0 } }, { in: { d: 1, state: 0, clk: 0 }, out: { state: 0 } },
      { in: { d: 0, state: 1, clk: 0 }, out: { state: 1 } }, { in: { d: 1, state: 1, clk: 0 }, out: { state: 1 } },
      { in: { d: 0, state: 0, clk: 1 }, out: { state: 0 } }, { in: { d: 1, state: 0, clk: 1 }, out: { state: 1 } },
      { in: { d: 0, state: 1, clk: 1 }, out: { state: 0 } }, { in: { d: 1, state: 1, clk: 1 }, out: { state: 1 } },
    ] });
  world.compose({ id: 'ff.dff/mux', implements: 'ff.dff',
    steps: [{ name: 'm', call: 'gate.mux', bind: { a: '$in.state', b: '$in.d', select: '$in.clk' } }],
    returns: { state: 'm.q' } });

  // One tick of the counter: next state = flops sampling (state + 1). The +1 is the ripple adder with b = 0001 and cin = 0;
  // its carry-out is simply not consumed, which is where wraparound at 16 comes from.
  const stepBits = bits4;
  C({ id: 'counter.tick', kind: 'tick', in: { state: stepBits, clk: bit }, out: { state: stepBits },
    description: 'One clock tick of a 4-bit up counter. d = state + 1 (adder, carry-out dropped); each bit has its own D flip-flop (slot bit0..bit3).',
    examples: [
      { in: { state: [1, 1, 1, 0], clk: 1 }, out: { state: [0, 0, 0, 1] } }, // 7 -> 8
      { in: { state: [1, 1, 1, 1], clk: 1 }, out: { state: [0, 0, 0, 0] } }, // 15 -> 0 (wrap)
      { in: { state: [0, 0, 0, 0], clk: 1 }, out: { state: [1, 0, 0, 0] } }, // 0 -> 1
      { in: { state: [1, 0, 1, 0], clk: 0 }, out: { state: [1, 0, 1, 0] } }, // 5, no edge: hold
    ] });
  world.compose({ id: 'counter.tick/dff-adder', implements: 'counter.tick',
    steps: [
      { name: 'inc', call: 'adder.ripple4', bind: { a: '$in.state', b: { literal: [1, 0, 0, 0] }, cin: { literal: 0 } } },
      ...[0, 1, 2, 3].map((i) => ({ name: `ff${i}`, call: 'ff.dff', slot: `bit${i}`, bind: { d: { at: ['inc.sum', i] }, state: { at: ['$in.state', i] }, clk: '$in.clk' } })),
    ],
    returns: { state: { gather: ['ff0.state', 'ff1.state', 'ff2.state', 'ff3.state'] } } });

  // Clock gating as a decision (round 3), with the condition read straight off the wire (round 4): { eq: ['$in.clk', 1] }.
  // With clk = 0 nothing is added and no flop is called: the state passes through. Round 5: only `inc` carries the condition; the
  // flops read inc's outputs, so a skipped `inc` skips them (inherited skips) and the guard is written once, not five times.
  // `first` takes the flops' gather if they ran, else the old state. A gather with a skipped piece is itself skipped (v0.4).
  const clkHigh = { eq: ['$in.clk', 1] };
  world.compose({ id: 'counter.tick/gated', implements: 'counter.tick',
    steps: [
      { name: 'inc', call: 'adder.ripple4', when: clkHigh, bind: { a: '$in.state', b: { literal: [1, 0, 0, 0] }, cin: { literal: 0 } } },
      ...[0, 1, 2, 3].map((i) => ({ name: `ff${i}`, call: 'ff.dff', slot: `bit${i}`, bind: { d: { at: ['inc.sum', i] }, state: { at: ['$in.state', i] }, clk: '$in.clk' } })),
    ],
    returns: { state: { first: [{ gather: ['ff0.state', 'ff1.state', 'ff2.state', 'ff3.state'] }, '$in.state'] } } });
  world.select('counter.tick', 'counter.tick/dff-adder');

  // ---------------------------------------------------------------- latches: feedback, as far as ticks can express it
  // A real SR latch is two NANDs reading each other inside one instant. Assembly rejects that. A tick contract can carry
  // the two outputs as state and read them one tick later (a gate delay of one tick). Two timing models, one contract:
  //   lockstep:  both gates read the OTHER gate's previous output
  //   staggered: the second gate reads the first gate's NEW output (a DAG inside the tick)
  // Active-low inputs: s_n = 0 sets (q = 1), r_n = 0 resets (q = 0), both 1 holds.
  const pair = { type: 'array', minItems: 2, maxItems: 2, items: bit };
  C({ id: 'latch.sr', kind: 'tick', in: { state: pair, s_n: bit, r_n: bit }, out: { state: pair },
    description: 'NAND SR latch, state = [q, qn], one gate delay per tick. Only holding is specified by the contract; how Set and Reset settle depends on the timing model (see the two implementations).',
    examples: [
      { in: { state: [0, 1], s_n: 1, r_n: 1 }, out: { state: [0, 1] } }, // holding a reset latch
      { in: { state: [1, 0], s_n: 1, r_n: 1 }, out: { state: [1, 0] } }, // holding a set latch
    ] });
  // Round 3: what distinguishes the two timing models is stated where it belongs, on each implementation (hand-derived):
  //   lockstep, from reset [0,1], Set (s_n = 0), one tick: q = NAND(0, qn=1) = 1, qn = NAND(1, q=0) = 1  -> [1,1]; two ticks -> [1,0]
  //   lockstep, from [1,1], Hold: both gates see 1 -> [0,0]; one more Hold tick: both see 0 -> [1,1] (period two)
  //   staggered, from reset [0,1], Set, one tick: q = NAND(0, 1) = 1, qn = NAND(1, q'=1) = 0 -> [1,0]
  //   staggered, from set [1,0], Reset (r_n = 0): tick 1 q = NAND(1, qn=0) = 1, qn = NAND(0, 1) = 1 -> [1,1]; tick 2 q = NAND(1, 1) = 0, qn = 1 -> [0,1]
  // Round 5: the whole trajectory is an example on the implementation, `each` giving (s_n, r_n) per tick and `trajectory` the expected
  // [q, qn] per tick, so `prove` checks all seven ticks and a miss reports the tick. Schedule: hold, SET, hold, hold, RESET, hold, hold.
  const SCHEDULE = [[1, 1], [0, 1], [1, 1], [1, 1], [1, 0], [1, 1], [1, 1]];
  const LATCH_TRAJECTORY = (name, states) => ({ name, in: { state: [0, 1], s_n: 1, r_n: 1 }, each: SCHEDULE.map(([s_n, r_n]) => ({ s_n, r_n })), trajectory: states.map((state) => ({ state })) });
  const LOCKSTEP_STATES = [[0, 1], [1, 1], [0, 0], [1, 1], [0, 1], [0, 1], [0, 1]]; // n2 = NAND(r_n, q_prev)
  const STAGGERED_STATES = [[0, 1], [1, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 1]]; // n2 = NAND(r_n, n1)
  world.compose({ id: 'latch.sr/lockstep', implements: 'latch.sr',
    examples: [
      { in: { state: [0, 1], s_n: 0, r_n: 1 }, ticks: 1, out: { state: [1, 1] } },
      { in: { state: [0, 1], s_n: 0, r_n: 1 }, ticks: 2, out: { state: [1, 0] } },
      { in: { state: [1, 1], s_n: 1, r_n: 1 }, ticks: 1, out: { state: [0, 0] } },
      { in: { state: [1, 1], s_n: 1, r_n: 1 }, ticks: 2, out: { state: [1, 1] } },
      LATCH_TRAJECTORY('hold, SET, hold, hold, RESET, hold, hold: after SET the outputs chase each other', LOCKSTEP_STATES),
    ],
    steps: [
      { name: 'g1', call: 'gate.nand', slot: 'q', bind: { a: '$in.s_n', b: { at: ['$in.state', 1] } } },
      { name: 'g2', call: 'gate.nand', slot: 'qn', bind: { a: '$in.r_n', b: { at: ['$in.state', 0] } } },
    ],
    returns: { state: { gather: ['g1.q', 'g2.q'] } } });
  world.compose({ id: 'latch.sr/staggered', implements: 'latch.sr',
    examples: [
      { in: { state: [0, 1], s_n: 0, r_n: 1 }, ticks: 1, out: { state: [1, 0] } },
      { in: { state: [1, 0], s_n: 1, r_n: 0 }, ticks: 1, out: { state: [1, 1] } },
      { in: { state: [1, 0], s_n: 1, r_n: 0 }, ticks: 2, out: { state: [0, 1] } },
      LATCH_TRAJECTORY('hold, SET, hold, hold, RESET, hold, hold: the bit is stored, RESET passes through [1,1]', STAGGERED_STATES),
    ],
    steps: [
      { name: 'g1', call: 'gate.nand', slot: 'q', bind: { a: '$in.s_n', b: { at: ['$in.state', 1] } } },
      { name: 'g2', call: 'gate.nand', slot: 'qn', bind: { a: '$in.r_n', b: 'g1.q' } },
    ],
    returns: { state: { gather: ['g1.q', 'g2.q'] } } });
  world.select('latch.sr', 'latch.sr/staggered');

  // Time unrolled into space: a composition can only fix the tick count when it is assembled.
  C({ id: 'counter.advance4', in: { state: stepBits }, out: { state: stepBits },
    description: 'Exactly four clock ticks, declared as four chained counter.tick calls (slots t0..t3; a composition cannot loop over a variable count).',
    examples: [
      { in: { state: [1, 1, 0, 1] }, out: { state: [1, 1, 1, 1] } }, // 11 + 4 = 15
      { in: { state: [0, 1, 1, 1] }, out: { state: [0, 1, 0, 0] } }, // 14 + 4 = 18 = 2 mod 16
    ] });
  world.compose({ id: 'counter.advance4/unrolled', implements: 'counter.advance4',
    steps: [0, 1, 2, 3].map((i) => ({ name: `t${i}`, call: 'counter.tick', slot: `t${i}`, bind: { state: i === 0 ? '$in.state' : `t${i - 1}.state`, clk: { literal: 1 } } })),
    returns: { state: 't3.state' } });

  // Run over N ticks inside one kernel run, with ctx.drive (v0.3). Round 4: `collect` returns the per-tick states as one Ref whose
  // elements point at their tick's call, and zero ticks returns the input state, so neither the closure nor the special case is needed.
  C({ id: 'counter.run', in: { initial: stepBits, ticks: { type: 'integer', minimum: 0, maximum: 255 } },
    out: { final: stepBits, states: { type: 'array', minItems: 1, items: stepBits } },
    description: 'Apply counter.tick with a clock edge `ticks` times. states[t] is the state after t ticks (states[0] = initial).',
    examples: [
      { in: { initial: [0, 0, 0, 0], ticks: 3 }, out: { final: [1, 1, 0, 0], states: [[0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [1, 1, 0, 0]] } },
      { in: { initial: [0, 0, 0, 0], ticks: 0 }, out: { final: [0, 0, 0, 0], states: [[0, 0, 0, 0]] } },
      { in: { initial: [0, 0, 0, 0], ticks: 16 }, out: { final: [0, 0, 0, 0], states: Array.from({ length: 17 }, (_, t) => bitsOf(t % 16)) } },
      { in: { initial: [0, 1, 1, 1], ticks: 3 }, out: { final: [1, 0, 0, 0], states: [[0, 1, 1, 1], [1, 1, 1, 1], [0, 0, 0, 0], [1, 0, 0, 0]] } },
    ] });
  I({ id: 'counter.run/drive', implements: 'counter.run', uses: ['counter.tick'],
    run: ({ initial, ticks }, ctx) => {
      const d = ctx.drive('counter.tick', { state: initial, clk: ctx.literal(1) }, { ticks: ticks.value, collect: ['state'] });
      return { final: d.state, states: ctx.concat([initial], d.collected.state) };
    } });
}

/**
 * The counter as a drive: one kernel run per tick, tick k's state input is tick k-1's state Ref.
 * `clock(k)` gives the clk level for tick k, counted from startTick (default: an edge every tick). Returns world.drive's result.
 */
export function driveCounter(world, ticks, { initial = [0, 0, 0, 0], clock = () => 1, cache, fill, startTick = 0 } = {}) {
  // `initial` may be a Ref from an earlier drive; with startTick the clock and the receipts continue from that tick (v0.4)
  return world.drive('counter.tick', { state: initial, clk: clock(startTick) }, { ticks, cache, fill, startTick, each: (k) => ({ clk: clock(k) }) });
}

/** Drive one D flip-flop with a (d, clk) schedule: schedule[k] = [d, clk] for tick k. */
export function driveFlop(world, schedule, initial = 0) {
  return world.drive('ff.dff', { state: initial, d: schedule[0][0], clk: schedule[0][1] }, { ticks: schedule.length, each: (k) => ({ d: schedule[k][0], clk: schedule[k][1] }) });
}

/** Drive the SR latch with a (s_n, r_n) schedule. `impl` picks the timing model through fill. */
export function driveLatch(world, schedule, { initial = [0, 1], impl } = {}) {
  return world.drive('latch.sr', { state: initial, s_n: schedule[0][0], r_n: schedule[0][1] },
    { ticks: schedule.length, each: (k) => ({ s_n: schedule[k][0], r_n: schedule[k][1] }), fill: impl ? { 'latch.sr': impl } : undefined });
}

// ---------------------------------------------------------------- audit: a check contract over the adder
// The oracle is ordinary integer addition, on purpose: it is the independent definition the circuit is judged against.
export function registerAudit(world) {
  world.contract({ id: 'check.adderSum', kind: 'check', in: { a: bits4, b: bits4, cin: bit, sum: bits4, cout: bit },
    out: { accepted: { type: 'boolean' }, reason: { type: 'string' } },
    description: 'Accepts when a + b + cin (integers) equals cout * 16 + sum (integers).',
    examples: [
      { in: { a: [1, 1, 0, 1], b: [0, 1, 1, 0], cin: 0, sum: [1, 0, 0, 0], cout: 1 }, out: { accepted: true, reason: '11 + 6 + 0 = 17; circuit gives 17' } },
      { in: { a: [1, 1, 0, 1], b: [0, 1, 1, 0], cin: 0, sum: [0, 0, 0, 0], cout: 0 }, out: { accepted: false, reason: '11 + 6 + 0 = 17; circuit gives 0' } },
    ] });
  world.implement({ id: 'check.adderSum/integers', implements: 'check.adderSum', run: ({ a, b, cin, sum, cout }) => {
    const total = intOf(a.value) + intOf(b.value) + cin.value;
    const got = intOf(sum.value) + 16 * cout.value;
    return { accepted: total === got, reason: `${intOf(a.value)} + ${intOf(b.value)} + ${cin.value} = ${total}; circuit gives ${got}` };
  } });
  // Round 3: the verdict is no longer re-exported as ordinary output ports. v0.3 exempts check steps from the unused-output lint,
  // so the audit step can stand alone and its verdict is read from receipt.verdicts (or, for a caller above, drawn in the trace).
  world.contract({ id: 'adder.audited', in: { a: bits4, b: bits4, cin: bit }, out: { sum: bits4, cout: bit },
    description: 'adder.ripple4 followed by check.adderSum on its own output; the verdict is on receipt.verdicts, not an output port',
    examples: [{ in: { a: [1, 1, 0, 1], b: [0, 1, 1, 0], cin: 0 }, out: { sum: [1, 0, 0, 0], cout: 1 } }] });
  world.compose({ id: 'adder.audited/ripple', implements: 'adder.audited',
    steps: [
      { name: 'add', call: 'adder.ripple4', bind: { a: '$in.a', b: '$in.b', cin: '$in.cin' } },
      { name: 'audit', call: 'check.adderSum', bind: { a: '$in.a', b: '$in.b', cin: '$in.cin', sum: 'add.sum', cout: 'add.cout' } },
    ],
    returns: { sum: 'add.sum', cout: 'add.cout' } });
}

// ---------------------------------------------------------------- fault injection (fixtures; not part of the circuit)
// A full adder whose carry output is stuck at 0. Registered separately so `register` stays fault-free and proofs of the
// real world stay green. Aim it at one bit with fill: { 'adder.full#bit2': ... } (every ripple adder) or at one chain: 'adder.ripple4#hi/adder.full#bit2'.
export function registerFaults(world) {
  world.select('adder.full', 'adder.full/two-half');
  // Its own examples say what THIS implementation does (carry always 0); the contract's examples are the ones it fails.
  world.compose({ id: 'adder.full/carry-stuck-0', implements: 'adder.full',
    examples: [
      { in: { a: 1, b: 1, cin: 1 }, out: { sum: 1, carry: 0 } }, // 1+1+1 = 3 would give carry 1
      { in: { a: 1, b: 0, cin: 0 }, out: { sum: 1, carry: 0 } },
    ],
    steps: [
      { name: 'h1', call: 'adder.half', bind: { a: '$in.a', b: '$in.b' } },
      { name: 'h2', call: 'adder.half', bind: { a: 'h1.sum', b: '$in.cin' } },
      { name: 'o', call: 'gate.or', bind: { a: 'h1.carry', b: 'h2.carry' } },
      { name: 'zero', call: 'gate.and', bind: { a: 'o.q', b: { literal: 0 } } },
    ],
    returns: { sum: 'h2.sum', carry: 'zero.q' } });
}
