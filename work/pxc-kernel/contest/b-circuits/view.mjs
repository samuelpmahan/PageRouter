// Domain pictures for contest B. Every number and every wire is read from a recorded trace or run output.
// Nothing here recomputes logic: if a trace is wired differently from the expected topology, the picture says so in red.

import { intOf } from './index.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const LIT = '#e0a100';
const OFF = '#b7bdb9';
const INK = '#1b1d1c';
const BAD = '#c0302a';

/**
 * The hardware behind a trace that was recorded with the cache on: a copy in which every cache hit is replaced by the node it was
 * served from (world.node(cachedFrom.run, cachedFrom.call)), recursively, keeping the hit's own id and tick. v0.3 makes this possible
 * without cache:false and without replay; it needs the world that recorded the run.
 */
export function inflate(world, node) {
  if (node.cached && node.cachedFrom) {
    const original = world.node(node.cachedFrom.run, node.cachedFrom.call);
    return { ...inflate(world, original), id: node.id, tick: node.tick, in: node.in, cached: false, was: { cachedFrom: node.cachedFrom } };
  }
  return { ...node, calls: node.calls.map((c) => inflate(world, c)) };
}

/** Count every node of a trace, including cached ones. */
export function countNodes(node) {
  return 1 + node.calls.reduce((s, c) => s + countNodes(c), 0);
}

/** Count nodes of one contract, recursively. */
export function countContract(node, contract) {
  return (node.contract === contract ? 1 : 0) + node.calls.reduce((s, c) => s + countContract(c, contract), 0);
}

function lamp(x, y, value, { r = 15, label = '', labelDy = -24 } = {}) {
  const on = value === 1;
  return `<g class="lamp ${on ? 'on' : 'off'}" data-value="${value}">
  <circle cx="${x}" cy="${y}" r="${r}" fill="${on ? LIT : '#fff'}" stroke="${on ? '#8a6200' : '#8b948f'}" stroke-width="2"/>
  <text x="${x}" y="${y + 5}" text-anchor="middle" class="lamp-n" fill="${on ? INK : '#7d8782'}">${value}</text>
  ${label ? `<text x="${x}" y="${y + labelDy}" text-anchor="middle" class="lab">${esc(label)}</text>` : ''}
</g>`;
}

function wire(x1, y1, x2, y2, value, extra = '') {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${value === 1 ? LIT : OFF}" stroke-width="${value === 1 ? 5 : 3}" stroke-linecap="round" ${extra}/>`;
}

const STYLE = `<style>
  .title{font:700 16px system-ui,sans-serif;fill:${INK}}
  .sub{font:12.5px system-ui,sans-serif;fill:#55605c}
  .lab{font:600 12px ui-monospace,monospace;fill:#33403b}
  .lamp-n{font:700 14px ui-monospace,monospace}
  .box{fill:#eef3f7;stroke:#7f8d96;stroke-width:2}
  .boxt{font:700 13px ui-monospace,monospace;fill:${INK}}
  .boxm{font:12px ui-monospace,monospace;fill:#33403b}
  .boxs{font:11px ui-monospace,monospace;fill:#55605c}
  .big{font:700 15px ui-monospace,monospace;fill:${INK}}
  .bad{font:700 12px ui-monospace,monospace;fill:${BAD}}
</style>`;

const NAMES = { a: 'a', b: 'b', cin: 'cin' };

function describeFrom(from, faNodes) {
  if (!from) return '?';
  if (from.kind === 'run') return `run ${from.run}`;
  if (from.kind === 'at') {
    const base = describeFrom(from.of, faNodes);
    return `${base}[${from.path.join(',')}]`;
  }
  if (from.kind === 'input') return from.call === 1 || from.call === 0 ? `in.${from.port}` : `#${from.call}.${from.port}`;
  if (from.kind === 'call') {
    const i = faNodes.findIndex((n) => n.id === from.call);
    return i >= 0 ? `FA${i}.${from.port}` : `#${from.call}.${from.port}`;
  }
  return from.kind;
}

/**
 * The 4-bit ripple adder as a circuit: full adders as boxes (bit 0 on the right, as in a written numeral),
 * every wire drawn lit (1) or unlit (0). `trace` is the root node of an adder.ripple4 run.
 * Wiring is read from the full-adder nodes' input provenance and checked against the expected ripple topology.
 */
export function adderCircuitSvg(trace, part, { title = '' } = {}) {
  const fas = trace.calls.filter((n) => n.contract === 'adder.full');
  const n = fas.length;
  const val = (ref) => part(ref.hash);
  const rootA = val(trace.in.a); const rootB = val(trace.in.b); const cin = val(trace.in.cin);
  const rootSum = val(trace.out.sum); const cout = val(trace.out.cout);
  const bw = 190; const gap = 60; const pitch = bw + gap; const left = 200; const top = 190; const bh = 170;
  const W = left + n * pitch - gap + 160; const H = 640;
  const bx = (i) => left + (n - 1 - i) * pitch;
  const out = [];
  out.push(`<text x="14" y="24" class="title">${esc(title)}</text>`);
  out.push(`<text x="14" y="44" class="sub">Lit amber = 1, unlit grey = 0. Full adders are boxes; bit 0 is on the right. Every value is read from the recorded trace of adder.ripple4.</text>`);
  const problems = [];
  const carries = [cin];
  fas.forEach((fa, i) => {
    const x = bx(i); const a = val(fa.in.a); const b = val(fa.in.b); const c = val(fa.in.cin);
    const sum = val(fa.out.sum); const carry = val(fa.out.carry);
    carries.push(carry);
    // wiring check against the expected topology
    const fa_ = fa.in.a.from; const fb_ = fa.in.b.from; const fc_ = fa.in.cin.from;
    const okA = fa_.kind === 'at' && fa_.path.length === 1 && fa_.path[0] === i && fa_.of.kind === 'input' && fa_.of.port === 'a';
    const okB = fb_.kind === 'at' && fb_.path.length === 1 && fb_.path[0] === i && fb_.of.kind === 'input' && fb_.of.port === 'b';
    const okC = i === 0 ? fc_.kind === 'input' && fc_.port === 'cin' : fc_.kind === 'call' && fc_.call === fas[i - 1].id && fc_.port === 'carry';
    if (!okA) problems.push(`FA${i}.a`); if (!okB) problems.push(`FA${i}.b`); if (!okC) problems.push(`FA${i}.cin`);
    const ax = x + 55; const bxx = x + 135;
    // input lamps and wires
    out.push(wire(ax, 125, ax, top, a, okA ? '' : `stroke-dasharray="4 4"`));
    out.push(wire(bxx, 125, bxx, top, b, okB ? '' : `stroke-dasharray="4 4"`));
    out.push(lamp(ax, 110, rootA[i], { label: `a${i}`, labelDy: -22 }));
    out.push(lamp(bxx, 110, rootB[i], { label: `b${i}`, labelDy: -22 }));
    // box
    out.push(`<g class="fa" data-bit="${i}"><rect x="${x}" y="${top}" width="${bw}" height="${bh}" rx="8" class="box"/>`);
    out.push(`<text x="${x + 10}" y="${top + 22}" class="boxt">FULL ADDER  bit ${i}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 46}" class="boxm">${a} + ${b} + ${c}  =  ${a + b + c}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 66}" class="boxm">sum ${sum}, carry ${carry}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 92}" class="boxs">a   ← ${esc(describeFrom(fa.in.a.from, fas))}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 108}" class="boxs">b   ← ${esc(describeFrom(fa.in.b.from, fas))}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 124}" class="boxs">cin ← ${esc(describeFrom(fa.in.cin.from, fas))}</text>`);
    out.push(`<text x="${x + 10}" y="${top + 142}" class="boxs">#${fa.id} ${fa.slot ? `slot ${esc(fa.slot)}  ` : ''}${esc(fa.impl.split('/').pop())}</text></g>`);
    if (a + b + c !== sum + 2 * carry) out.push(`<rect x="${x - 3}" y="${top - 3}" width="${bw + 6}" height="${bh + 6}" rx="10" fill="none" stroke="${BAD}" stroke-width="3" class="faulty"/><text x="${x + 10}" y="${top + 162}" class="bad">FAULT ${a}+${b}+${c} ≠ ${sum}+2·${carry}</text>`);
    // sum out
    out.push(wire(x + bw / 2, top + bh, x + bw / 2, 440, sum));
    out.push(lamp(x + bw / 2, 455, rootSum[i], { label: `s${i}`, labelDy: 36 }));
    if (rootSum[i] !== sum) problems.push(`sum bit ${i} differs from FA${i}.sum`);
    // carry wire at box mid-height: enters on the right edge, leaves on the left edge
    const cy = top + bh / 2 + 10;
    out.push(wire(x + bw, cy, x + bw + (i === 0 ? 60 : gap), cy, c));
  });
  // carry lamps: c0 at right end, c(i+1) between FA i and FA i+1 (or beyond the leftmost box)
  const cy = top + bh / 2 + 10;
  out.push(lamp(bx(0) + bw + 60, cy, carries[0], { label: 'c0=cin', labelDy: -22 }));
  for (let i = 0; i < n; i += 1) {
    const x = bx(i);
    out.push(wire(x, cy, x - gap, cy, carries[i + 1]));
    out.push(lamp(x - gap / 2, cy, carries[i + 1], { r: 13, label: i === n - 1 ? `c${n}=cout` : `c${i + 1}`, labelDy: -20 }));
  }
  if (cout !== carries[n]) problems.push('cout differs from FA carry');
  const A = intOf(rootA); const B = intOf(rootB); const S = intOf(rootSum) + cout * 2 ** n;
  const bin = (bits) => [...bits].reverse().join('');
  out.push(`<text x="14" y="540" class="big">a = ${bin(rootA)}₂ = ${A}     b = ${bin(rootB)}₂ = ${B}     cin = ${cin}</text>`);
  out.push(`<text x="14" y="566" class="big">sum bits (s3 s2 s1 s0) = ${bin(rootSum)}₂, cout = ${cout}   →   ${cout}${bin(rootSum)}₂ = ${S}</text>`);
  const agree = A + B + cin === S;
  out.push(`<text x="14" y="590" class="${agree ? 'sub' : 'bad'}">integer check: ${A} + ${B} + ${cin} = ${A + B + cin}; the circuit says ${S}${agree ? '  (agree)' : '  (DISAGREE)'}</text>`);
  out.push(problems.length
    ? `<text x="14" y="614" class="bad">WIRING MISMATCH in trace: ${esc(problems.join(', '))}</text>`
    : `<text x="14" y="614" class="sub">Wiring check passed: every a_i, b_i comes from ctx.at(input, [i]); cin of FA0 is the input cin; cin of FA(i+1) is FAi.carry.</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${STYLE}<rect width="100%" height="100%" fill="#fbfbf9"/>${out.join('\n')}</svg>`;
}

/**
 * Counter timeline from world.drive receipts. Column t = state after t ticks (column 0 = the initial state).
 * Rows: tick index and run id (from the receipts), clk level (from receipt.inputValues), whether the kernel answered the tick
 * from its cache and from which run, the four state bits, the decimal value, and a sawtooth.
 */
export function counterTimelineSvg(receipts, part, { title = '' } = {}) {
  const states = [receipts[0].inputValues.state, ...receipts.map((r) => part(r.outputs.state))];
  const T = states.length; const cw = 46; const lx = 190;
  const W = Math.max(lx + T * cw + 30, 1000); const H = 700;
  const vals = states.map(intOf);
  const out = [];
  out.push(`<text x="14" y="24" class="title">${esc(title)}</text>`);
  out.push(`<text x="14" y="44" class="sub">Drawn from the receipts of one world.drive. Column t = state after t clock ticks. Hatched = answered from cache (=rN names the run reused).</text>`);
  out.push(`<text x="14" y="60" class="sub">calls made = trace nodes the kernel executed for the tick (receipt.calls); a dash means none.</text>`);
  const rows = { tick: 80, run: 104, clk: 128, cache: 152, calls: 176, value: 204, bit3: 240, bit2: 276, bit1: 312, bit0: 348 };
  out.push(`<text x="14" y="${rows.tick + 4}" class="lab">tick k</text><text x="14" y="${rows.run + 4}" class="lab">run id</text><text x="14" y="${rows.clk + 4}" class="lab">clk input</text><text x="14" y="${rows.cache + 4}" class="lab">cache</text><text x="14" y="${rows.calls + 4}" class="lab">calls made</text><text x="14" y="${rows.value + 5}" class="lab">value (decimal)</text>`);
  for (let b = 3; b >= 0; b -= 1) out.push(`<text x="14" y="${rows[`bit${b}`] + 5}" class="lab">bit ${b} (2^${b})</text>`);
  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e8eef3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#9fb0bd" stroke-width="3"/></pattern></defs>`);
  states.forEach((s, t) => {
    const cx = lx + t * cw + cw / 2;
    const wrapped = t > 0 && vals[t] < vals[t - 1];
    const r = t > 0 ? receipts[t - 1] : null;
    if (r) {
      const cached = r.trace.cached === true;
      const clk = r.inputValues.clk;
      out.push(`<text x="${cx}" y="${rows.tick + 4}" text-anchor="middle" class="lab">${r.tick}</text>`);
      out.push(`<text x="${cx}" y="${rows.run + 4}" text-anchor="middle" class="boxs">${r.runId}</text>`);
      out.push(`<text x="${cx}" y="${rows.clk + 4}" text-anchor="middle" class="lab" fill="${clk ? INK : BAD}" style="fill:${clk ? INK : BAD}">${clk}</text>`);
      out.push(`<text x="${cx}" y="${rows.calls + 4}" text-anchor="middle" class="boxs" data-calls="${cached ? 0 : r.calls}">${cached ? '–' : r.calls}</text>`);
      out.push(`<g class="callcell" data-tick="${r.tick}" data-cached="${cached}"><rect x="${cx - 19}" y="${rows.cache - 11}" width="38" height="22" rx="4" fill="${cached ? 'url(#hatch)' : '#fff'}" stroke="${cached ? '#2a62c9' : '#9aa5a1'}" stroke-width="${cached ? 2 : 1}"/><text x="${cx}" y="${rows.cache + 4}" text-anchor="middle" class="boxs">${cached ? `=r${r.trace.cachedFrom.run}` : 'new'}</text></g>`);
    } else {
      out.push(`<text x="${cx}" y="${rows.tick + 4}" text-anchor="middle" class="boxs">initial</text>`);
    }
    out.push(`<text x="${cx}" y="${rows.value + 6}" text-anchor="middle" class="big" style="fill:${wrapped ? BAD : INK}">${vals[t]}</text>`);
    for (let b = 3; b >= 0; b -= 1) {
      const on = s[b] === 1; const y = rows[`bit${b}`];
      out.push(`<rect x="${cx - 16}" y="${y - 14}" width="32" height="28" rx="5" fill="${on ? LIT : '#fff'}" stroke="${on ? '#8a6200' : '#aeb6b2'}" stroke-width="1.6" class="${on ? 'cell on' : 'cell off'}" data-tick="${t}" data-bit="${b}"/><text x="${cx}" y="${y + 5}" text-anchor="middle" class="lamp-n" fill="${on ? INK : '#8a948f'}">${s[b]}</text>`);
    }
  });
  const py0 = 660; const unit = 11; const plotTop = py0 - 15 * unit;
  out.push(`<text x="14" y="${plotTop - 14}" class="lab">value vs tick</text>`);
  for (const v of [0, 5, 10, 15]) {
    out.push(`<line x1="${lx}" x2="${lx + T * cw}" y1="${py0 - v * unit}" y2="${py0 - v * unit}" stroke="#dfe4e1"/><text x="${lx - 8}" y="${py0 - v * unit + 4}" text-anchor="end" class="boxs">${v}</text>`);
  }
  const pts = vals.map((v, t) => [lx + t * cw + cw / 2, py0 - v * unit]);
  vals.forEach((v, t) => {
    if (t === 0 || v >= vals[t - 1]) return;
    const x = lx + t * cw;
    out.push(`<line x1="${x}" x2="${x}" y1="${plotTop - 6}" y2="${py0 + 4}" stroke="${BAD}" stroke-dasharray="5 4" stroke-width="1.6"/>`);
    out.push(`<text x="${x + 4}" y="${plotTop - 10}" class="bad">wrap: ${vals[t - 1]} → ${v} at tick ${receipts[t - 1].tick}</text>`);
  });
  out.push(`<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#2a62c9" stroke-width="2"/>`);
  pts.forEach(([x, y], t) => out.push(`<circle cx="${x}" cy="${y}" r="3.5" fill="${t > 0 && vals[t] < vals[t - 1] ? BAD : '#2a62c9'}"/>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${STYLE}<rect width="100%" height="100%" fill="#fbfbf9"/>${out.join('\n')}</svg>`;
}

/**
 * Latch strip from drive receipts: for each tick, the two inputs, the state pair [q, qn] as lamps, and a marker where the
 * latch is in the forbidden-looking state q = qn. Everything is read from receipts.
 */
export function latchStripSvg(receipts, part, { title = '', labels = [] } = {}) {
  const cw = 70; const lx = 120; const T = receipts.length + 1;
  const W = lx + T * cw + 20; const H = 250;
  const out = [`<text x="14" y="24" class="title">${esc(title)}</text>`];
  const rows = { tick: 60, s: 86, r: 110, q: 160, qn: 200 };
  out.push(`<text x="14" y="${rows.tick + 4}" class="lab">tick k</text><text x="14" y="${rows.s + 4}" class="lab">s_n (0 = set)</text><text x="14" y="${rows.r + 4}" class="lab">r_n (0 = reset)</text><text x="14" y="${rows.q + 4}" class="lab">q</text><text x="14" y="${rows.qn + 4}" class="lab">qn</text>`);
  for (let t = 0; t < T; t += 1) {
    const cx = lx + t * cw + cw / 2;
    const st = t === 0 ? receipts[0].inputValues.state : part(receipts[t - 1].outputs.state);
    const r = t > 0 ? receipts[t - 1] : null;
    if (r) {
      out.push(`<text x="${cx}" y="${rows.tick + 4}" text-anchor="middle" class="lab">${r.tick}</text>`);
      out.push(`<text x="${cx}" y="${rows.s + 4}" text-anchor="middle" class="boxm" style="fill:${r.inputValues.s_n === 0 ? BAD : INK}">${r.inputValues.s_n}</text>`);
      out.push(`<text x="${cx}" y="${rows.r + 4}" text-anchor="middle" class="boxm" style="fill:${r.inputValues.r_n === 0 ? BAD : INK}">${r.inputValues.r_n}</text>`);
    } else out.push(`<text x="${cx}" y="${rows.tick + 4}" text-anchor="middle" class="boxs">initial</text>`);
    out.push(lamp(cx, rows.q, st[0], { r: 14 }), lamp(cx, rows.qn, st[1], { r: 14 }));
    if (st[0] === st[1]) out.push(`<rect x="${cx - 22}" y="${rows.q - 24}" width="44" height="${rows.qn - rows.q + 48}" rx="6" fill="none" stroke="${BAD}" stroke-width="2" stroke-dasharray="5 4" class="equal"/>`);
  }
  out.push(`<text x="14" y="${H - 14}" class="sub">${esc(labels.join('   '))}  Red dashed box: q = qn (both outputs equal, not a valid stored bit).</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${STYLE}<rect width="100%" height="100%" fill="#fbfbf9"/>${out.join('\n')}</svg>`;
}
