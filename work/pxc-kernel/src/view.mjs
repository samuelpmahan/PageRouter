// Views are projections: a trace becomes an SVG without any extra state.
// Each call is a box: header (#id contract, implementation, slot, flags) and one row per port.
// Each input row is joined to where its value came from:
//   blue bracket (left gutter)  output of an earlier sibling call
//   green curve                 the caller's own input
//   dashed                      reached through a path (ctx.at); the path is printed at the arrow
//   labelled gather[i]          one piece of a value built with ctx.gather
//   orange tag "literal"        literal;  red tag "computed": computed inside an implementation
//   purple tag "← run k"        a Ref that came from another run (cross-run edge)
// Box header colours: hatched = cached, green = check accepted, red = check rejected or error.
// v0.3: ◇ decision rows (amber edge from the output that decided; a false decision on a composition step = skipped),
//       @k tick tags on nodes a drive created, ghost boxes for a cached call's original subtree (expand option),
//       gather/concat pieces grouped per source when there are many, verdicts carried by a cache hit.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Cut prose (no JSON quoting) to max characters. */
const clip = (text, max) => (text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text);

function short(value, max) {
  if (value === undefined) return '?';
  const text = JSON.stringify(value, (k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(6)) : v));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Flatten a `from` into drawable sources: [{ base, dashed, label }] where base is a call/input/run/literal/computed from.
 * Labels read target ← source: gather paths name where a piece sits in this value, at paths name where it was cut
 * from its source (innermost cut first): gather[log][0]←[log][0]. A test's operands are sources labelled op[i].
 */
function sources(from, dashed = false, target = [], cut = [], prefix = '') {
  if (!from) return [];
  if (from.kind === 'at') return sources(from.of, true, target, [...from.path.map(String), ...cut], prefix);
  if (from.kind === 'gather') {
    if (!cut.length) return from.pieces.flatMap((p) => sources(p.from, dashed, [...target, ...p.path.map(String)], cut, prefix));
    // An at into a gathered value selects only the pieces on its path (v0.5): no false wall of every piece.
    const pre = (a, b) => a.length <= b.length && a.every((x, i) => String(x) === String(b[i]));
    const hits = from.pieces.flatMap((p) => {
      const pp = p.path.map(String);
      if (pre(pp, cut)) return sources(p.from, dashed, target, cut.slice(pp.length), `${prefix}${pp.map((x) => `[${x}]`).join('')}`);
      if (pre(cut, pp)) return sources(p.from, dashed, [...target, ...pp.slice(cut.length)], [], prefix);
      return [];
    });
    if (hits.length) return hits;
  }
  if (from.kind === 'test') return from.args.flatMap((a, i) => sources(a, dashed, target, cut, `${prefix}${from.op}[${i}]`));
  const br = (xs) => xs.map((x) => `[${x}]`).join('');
  const label = `${prefix}${target.length ? `gather${br(target)}` : ''}${target.length && cut.length ? '←' : ''}${br(cut)}`;
  return [{ base: from, dashed, label }];
}

/**
 * A test's provenance as an expression: gt(#3.penalty=0.5, 0). valueOf(from) may supply an operand's value (shown when short).
 * else(flip: lt($in.x=-4, 0)) names each step and what decided it.
 */
function describeFrom(f, valueOf = () => undefined) {
  if (!f) return '?';
  const withValue = (text) => {
    const v = valueOf(f);
    if (v === undefined) return text;
    const j = JSON.stringify(v);
    return j.length <= 14 ? `${text}=${j}` : text;
  };
  if (f.kind === 'call') return withValue(`#${f.call}.${f.port}`);
  if (f.kind === 'input') return withValue(`$in.${f.port}`);
  if (f.kind === 'literal') return 'value' in f ? JSON.stringify(f.value) : 'literal';
  if (f.kind === 'test' && f.op === 'else') return `else(${f.steps.join(', ')})`; // the causes are drawn as edges, not reprinted (v0.6)
  if (f.kind === 'test') return `${f.op}(${f.args.map((a) => describeFrom(a, valueOf)).join(', ')})`;
  if (f.kind === 'at') return withValue(`${describeFrom(f.of)}[${f.path.join('.')}]`);
  if (f.kind === 'run') return `run ${f.run} ${describeFrom(f.from)}`;
  return f.kind;
}

/** Merge pieces that come from the same place (same base and port, same dashing) so a 9-piece gather is one edge "×9". */
function grouped(from, limit) {
  const all = sources(from);
  if (all.length <= limit) return all.map((s) => ({ ...s, count: 1 }));
  const m = new Map();
  for (const s of all) {
    const k = `${s.base.kind}|${s.base.call ?? ''}|${s.base.port ?? ''}|${s.base.run ?? ''}|${s.dashed}`;
    if (m.has(k)) m.get(k).count += 1; else m.set(k, { ...s, count: 1 });
  }
  return [...m.values()].map((g) => ({ ...g, label: g.count > 1 ? `${g.label.startsWith('[') || g.dashed ? 'pieces' : 'gather'} ×${g.count}` : g.label }));
}

/**
 * expand(node) -> the original node of a cache hit (e.g. n => world.node(n.cachedFrom.run, n.cachedFrom.call)).
 * Its children are drawn as ghost boxes, scoped to the original run, so the reader sees what the hit stands for.
 * Every row is laid out as lines before placement: tags that do not fit wrap onto indented continuation lines,
 * so nothing is drawn outside its box and edges never cross text.
 */
export function traceToSvg(trace, part, { title = '', colWidth = 360, gap = 54, rowH = 17, gapY = 14, valueChars = 44, maxDepth = Infinity, groupOver = 4, expand = null, charW = 6.95, receipt = null } = {}) {
  const boxes = [];
  const byId = new Map();
  const key = (scope, id) => `${scope}|${id}`;
  const w = colWidth - gap; // the gap between columns holds the edge lanes
  const maxChars = Math.floor((w - 16) / charW);
  const tag = (text, cls) => ({ text, cls });
  const inTags = (from) => grouped(from, groupOver).flatMap((s) => {
    const out = s.label ? [tag(` ${s.label}`, 't-path')] : [];
    if (s.base.kind === 'literal') out.push(tag(' literal', 't-literal'));
    else if (s.base.kind === 'computed') out.push(tag(' computed', 't-computed'));
    else if (s.base.kind === 'run') out.push(tag(` ← run ${s.base.run}${s.base.from?.kind === 'call' ? ` #${s.base.from.call}` : ''}`, 't-run'));
    return out;
  });
  const outTags = (from, tickOf = () => undefined) => grouped(from, groupOver).flatMap((s) => {
    const t = s.base.kind === 'call' ? tickOf(s.base.call) : undefined;
    const label = t !== undefined && s.count === 1 ? `${s.label}←@${t}` : s.label; // a piece from a drive's tick names the tick it came from (v0.6)
    const out = label ? [tag(` ${label}`, 't-path')] : [];
    if (s.base.kind === 'literal') out.push(tag(' literal', 't-literal'));
    else if (s.base.kind === 'run') out.push(tag(` ← run ${s.base.run}${s.base.from?.kind === 'call' ? ` #${s.base.from.call}` : ''}`, 't-run'));
    else if (s.base.kind === 'input') out.push(tag(' passthrough', 't-pass'));
    return out;
  });
  /** Greedy wrap: the head stays on line 1; tags fill the rest of line 1, then indented lines. A label and its kind tag stay together. */
  function wrap(head, tags) {
    // A head longer than the box breaks at spaces onto indented lines of the same class.
    const heads = [];
    let rest = head.text;
    while (rest.length > maxChars) {
      const cut = rest.lastIndexOf(' ', maxChars);
      const at = cut > 4 ? cut : maxChars;
      heads.push(rest.slice(0, at)); rest = `   ${rest.slice(at).trimStart()}`;
    }
    heads.push(rest);
    const lines = heads.map((t) => [tag(t, head.cls)]);
    let used = heads[heads.length - 1].length;
    const units = [];
    for (const t of tags) { if (t.cls === 't-path' || !units.length || units[units.length - 1].closed) units.push({ parts: [t], closed: t.cls !== 't-path' }); else { units[units.length - 1].parts.push(t); units[units.length - 1].closed = true; } }
    // A unit longer than a line (a long test expression, an error message) breaks after commas or spaces.
    const split = (t) => {
      const out = []; let rest = t.text;
      while (rest.length > maxChars - 4) {
        const window = rest.slice(0, maxChars - 4);
        const at = Math.max(window.lastIndexOf(', ') + 2, window.lastIndexOf(' ') + 1);
        const cut = at > 6 ? at : maxChars - 4;
        out.push(tag(rest.slice(0, cut), t.cls)); rest = rest.slice(cut);
      }
      out.push(tag(rest, t.cls));
      return out;
    };
    for (const u of units.splice(0)) {
      const len = u.parts.reduce((a, p) => a + p.text.length, 0);
      if (len > maxChars - 4) u.parts.flatMap(split).forEach((piece) => units.push({ parts: [piece] }));
      else units.push(u);
    }
    for (const u of units) {
      const len = u.parts.reduce((a, p) => a + p.text.length, 0);
      if (used + len > maxChars && used > 4) { lines.push([tag('   ', 'port')]); used = 3; }
      lines[lines.length - 1].push(...u.parts); used += len;
    }
    return lines;
  }
  // With a receipt, the run's fill is printed under the title: each key, its implementation, and whether it landed.
  const reachText = (k) => { const ids = receipt.fillReach?.[k] ?? []; return ids.length ? ` @ ${ids.slice(0, 6).map((i) => `#${i}`).join(' ')}${ids.length > 6 ? ` +${ids.length - 6}` : ''}` : ''; };
  const fillText = receipt?.fill ? Object.entries(receipt.fill).map(([k, v]) => `${k} → ${v}${(receipt.fillConsulted ?? []).includes(k) ? reachText(k) : ' (not consulted)'}`).join('   ') : '';
  let y = (title ? 40 : 14) + (fillText ? 18 : 0);
  (function place(node, depth, scope, ghost) {
    const original = node.cached && expand && node.cachedFrom ? expand(node) : null;
    const kids = original ? original.calls : node.calls;
    const kidScope = original ? `run${node.cachedFrom.run}` : scope;
    const hidden = depth >= maxDepth && kids.length ? kids.reduce((a, c) => a + 1 + countCalls(c), 0) : 0;
    // A cache hit drawn with its original subtree: its own outs keep the hashes, provenance comes from the original.
    const outs = Object.entries(node.out).map(([p, o]) => [p, original ? { ...o, from: original.out[p]?.from ?? o.from } : o]);
    const rows = [];
    const fit = (port, hash) => short(part(hash), Math.min(valueChars, maxChars - port.length - 4));
    for (const [port, inp] of Object.entries(node.in)) rows.push({ id: `in:${port}`, lines: wrap(tag(`▸ ${port} = ${fit(port, inp.hash)}`, 'port'), inTags(inp.from)) });
    const tickOf = (id) => { const stack = [...(original ?? node).calls]; while (stack.length) { const c = stack.pop(); if (c.id === id) return c.tick ?? undefined; } return undefined; };
    for (const [port, out] of outs) rows.push({ id: `out:${port}`, lines: wrap(tag(`◂ ${port} = ${fit(port, out.hash)}`, 'port out'), outTags(out.from, tickOf)) });
    // Operand values for decision expressions: the node's own inputs, or outputs of calls beneath it.
    const findBelow = (n, id) => { for (const c of n.calls) { if (c.id === id) return c; const r = findBelow(c, id); if (r) return r; } return null; };
    const valueOf = (f) => {
      if (f.kind === 'at') { let v = valueOf(f.of); for (const k of f.path) { if (v === null || typeof v !== 'object') return undefined; v = v[k]; } return v; }
      const self = f.kind === 'input' && (f.call === node.id || (node.cached && node.cachedFrom?.call === f.call));
      if (self && node.in[f.port]) return part(node.in[f.port].hash);
      if (f.kind === 'call') { const c = findBelow(original ?? node, f.call); if (c?.out[f.port]) return part(c.out[f.port].hash); }
      return undefined;
    };
    // Identical decisions (same value, same provenance) are one row naming every label: five steps under one when read once.
    const merged = [];
    for (const d of node.decisions ?? []) {
      const k = `${d.value}|${JSON.stringify(d.from)}`;
      const m = merged.find((x) => x.k === k);
      if (m) m.ds.push(d); else merged.push({ k, ds: [d] });
    }
    merged.forEach(({ ds }, i) => {
      const d = ds[0];
      const labels = ds.map((x) => x.label ?? 'when').join(', ');
      const ran = ds.map((x) => x.ran).filter((v) => v !== undefined);
      const skipped = ds.map((x) => x.skipped).filter((v) => v !== undefined);
      const sameAsLabels = (xs) => xs.length && xs.every((v, j) => v === ds[j]?.label);
      let verdict;
      if (ran.length || skipped.length) {
        const parts = [];
        if (ran.length) parts.push(sameAsLabels(ran) && !skipped.length ? 'ran' : `ran ${ran.join(', ')}`);
        if (skipped.length) parts.push(sameAsLabels(skipped) && !ran.length ? 'skipped' : `skipped ${skipped.join(', ')}`);
        verdict = parts.join(', ');
      } else verdict = d.value ? 'taken' : 'not taken';
      rows.push({ id: `dec:${i}`, decision: d, lines: wrap(tag(`◇ ${labels} = ${d.value} → ${verdict}`, d.value ? 'dec' : 'dec no'), [tag(`  read ${describeFrom(d.from, valueOf)}`, 't-path')]) });
    });
    for (const dr of node.drives ?? []) {
      const span = dr.ticks === 0 ? 'none' : dr.ticks === 1 ? `${dr.startTick}` : `${dr.startTick}–${dr.startTick + dr.ticks - 1}`;
      rows.push({ id: `drive:${dr.calls[0] ?? 'none'}`, lines: wrap(tag(`⟳ ${dr.contract}${dr.slot ? `#${dr.slot}` : ''}: ${dr.ticks} tick${dr.ticks === 1 ? '' : 's'}, ${span}`, 'dec'), [tag(` stopped by ${dr.stopped}`, 't-path')]) });
    }
    const cv = node.cached ? (node.verdicts ?? []) : [];
    if (cv.length) {
      const ok = cv.every((v) => v.accepted);
      // One line (or more) per verdict, so verdicts never run together (v0.6).
      const lines = [[tag(`${ok ? '✓' : '✗'} ${cv.length} cached verdict${cv.length > 1 ? 's' : ''}:`, ok ? 'vok' : 'err')]];
      for (const v of cv) {
        const cls = v.accepted ? 'vok' : 'err';
        lines.push(...wrap(tag(`   ${v.accepted ? '✓' : '✗'} ${clip(v.contract, 26)}: ${clip(String(v.reason), 300)}`, cls), []));
      }
      rows.push({ id: 'verdicts', lines });
    }
    if (node.error) rows.push({ id: 'err', lines: wrap(tag(`✗ ${node.error.code}${node.error.via !== undefined ? ` (from #${node.error.via})` : ''}:`, 'err'), [tag(` ${clip(String(node.error.message), 600)}`, 'err')]) });
    if (hidden) rows.push({ id: 'hidden', lines: [[tag(`+ ${hidden} nested calls not drawn`, 'impl')]] });
    // The rung that chose the implementation goes on the implementation line when it fits, otherwise on a row of its own.
    const rung = node.chosenBy?.rung;
    const byText = rung && /fill|slot select/.test(rung) ? `by ${rung === 'slot select' ? 'pin' : rung.replace(' fill', '')} ${node.chosenBy.key}` : '';
    const cachedText = node.cached ? `cached${node.cachedFrom ? ` from run ${node.cachedFrom.run} #${node.cachedFrom.call}` : ''}` : '';
    const implFits = `${node.impl}  · ${[byText, cachedText, node.impure ? 'impure' : ''].filter(Boolean).join(' · ')}`.length <= Math.floor((w - 16) / 6.7);
    if (byText && !implFits) rows.unshift({ id: 'by', lines: [[tag(`⚑ ${byText}`, 'impl')]] });
    const anchor = new Map();
    let line = 2;
    for (const r of rows) { anchor.set(r.id, y + rowH * line + rowH * 0.7); r.first = line; line += r.lines.length; }
    const h = rowH * line + 6;
    const box = { node, x: 14 + depth * colWidth, y, h, rows, anchor, outs, hidden, scope, ghost, originRun: ghost ? scope.slice(3) : null, innerScope: kidScope, byText: implFits ? byText : '' };
    boxes.push(box); byId.set(key(scope, node.id), box);
    if (original) byId.set(key(kidScope, node.cachedFrom.call), box); // inside the ghost scope, this box stands for the original call
    y += h + gapY;
    if (depth < maxDepth) for (const child of kids) place(child, depth + 1, kidScope, ghost || Boolean(original));
  })(trace, 0, 'here', false);
  const find = (box, call) => byId.get(key(box.scope, call));
  const width = Math.max(Math.max(...boxes.map((b) => b.x)) + colWidth + 14, title ? 28 + title.length * 9 : 0, fillText ? 28 + fillText.length * 7.4 : 0);
  const height = y + 10;
  const inRowY = (box, port) => box.anchor.get(`in:${port}`);
  const outRowY = (box, port) => box.anchor.get(`out:${port}`);
  const svg = [];
  if (title) svg.push(`<text x="14" y="24" class="title">${esc(title)}</text>`);
  if (fillText) svg.push(`<text x="14" y="${title ? 44 : 20}" class="fill">fill: ${esc(fillText)}</text>`);
  // Every edge in a gutter gets its own lane (v0.5 audit): edges are collected first, counted per gutter, then
  // spread across the gutter, so a solid and a dashed bracket never share a line.
  const left = []; const right = [];
  for (const box of boxes) {
    for (const [port, inp] of Object.entries(box.node.in)) {
      const ty = inRowY(box, port); const tx = box.x;
      for (const s of grouped(inp.from, groupOver)) {
        const dash = s.dashed ? ' dashed' : '';
        const f = s.base;
        if (f.kind === 'call' && find(box, f.call)) {
          const src = find(box, f.call);
          left.push({ gutter: Math.min(src.x, tx), sx: src.x, sy: outRowY(src, f.port), tx, ty, dash });
        } else if (f.kind === 'input' && find(box, f.call)) {
          const src = find(box, f.call); const sx = src.x + w; const sy = inRowY(src, f.port);
          svg.push(`<path class="e-input${dash}" d="M${sx},${sy} C${sx + 12},${sy} ${tx - 18},${ty} ${tx},${ty}"/><circle class="dot-input" cx="${sx}" cy="${sy}" r="2.6"/><path class="arrow-input" d="M${tx - 6},${ty - 3.5} L${tx},${ty} L${tx - 6},${ty + 3.5}"/>`);
        }
      }
    }
    // Output provenance: a purple bracket from a child's output row to this box's output row.
    for (const [port, out] of box.outs) {
      const ty = outRowY(box, port); const tx = box.x + w;
      for (const s of grouped(out.from, groupOver)) {
        const f = s.base;
        const src = f.kind === 'call' ? byId.get(key(box.innerScope, f.call)) : null;
        if (!src) continue;
        right.push({ kind: 'out', gutter: src.x, sx: src.x + w, sy: outRowY(src, f.port), tx, ty, dash: s.dashed ? ' dashed' : '' });
      }
    }
    // Decisions: an amber edge from each operand to the decision row. A decision carried by a cache hit names call ids
    // of the original run, so it is resolved in the original's scope (when expanded) and never against this run's boxes.
    const n = box.node;
    for (const r of box.rows) {
      if (!r.decision) continue;
      const ty = box.anchor.get(r.id);
      for (const { base: f } of sources(r.decision.from)) {
        let src = null;
        if (n.cached && n.cachedFrom) {
          if (f.kind === 'input' && f.call === n.cachedFrom.call) src = box;
          else if (f.kind === 'call' && box.innerScope !== box.scope) src = byId.get(key(box.innerScope, f.call));
        } else if (f.kind === 'call' || f.kind === 'input') src = find(box, f.call);
        if (!src) continue;
        const sy = f.kind === 'call' ? outRowY(src, f.port) : inRowY(src, f.port);
        if (sy === undefined) continue;
        right.push({ kind: 'dec', gutter: src.x, sx: src.x + w, sy, tx: box.x + w, ty, dash: '' });
      }
    }
  }
  const lanes = (edges) => {
    const count = new Map(); const used = new Map();
    for (const e of edges) count.set(e.gutter, (count.get(e.gutter) ?? 0) + 1);
    return (e) => { const i = used.get(e.gutter) ?? 0; used.set(e.gutter, i + 1); return { i, step: Math.max(1.4, Math.min(5, (gap - 10) / count.get(e.gutter))) }; };
  };
  const leftLane = lanes(left);
  for (const e of left) {
    const { i, step } = leftLane(e);
    const gx = e.gutter - 5 - i * step;
    svg.push(`<path class="e-call${e.dash}" d="M${e.sx},${e.sy} H${gx} V${e.ty} H${e.tx}"/><circle class="dot-call" cx="${e.sx}" cy="${e.sy}" r="2.6"/><path class="arrow-call" d="M${e.tx - 6},${e.ty - 3.5} L${e.tx},${e.ty} L${e.tx - 6},${e.ty + 3.5}"/>`);
  }
  const rightLane = lanes(right);
  for (const e of right) {
    const { i, step } = rightLane(e);
    const gx = e.sx + 5 + i * step;
    if (e.kind === 'out') svg.push(`<path class="e-out${e.dash}" d="M${e.sx},${e.sy} H${gx} V${e.ty} H${e.tx}"/><circle class="dot-out" cx="${e.sx}" cy="${e.sy}" r="2.6"/><path class="arrow-out" d="M${e.tx + 6},${e.ty - 3.5} L${e.tx},${e.ty} L${e.tx + 6},${e.ty + 3.5}"/>`);
    else svg.push(`<path class="e-dec" d="M${e.sx},${e.sy} H${gx} V${e.ty} H${e.tx}"/><circle class="dot-dec" cx="${e.sx}" cy="${e.sy}" r="2.6"/><path class="arrow-dec" d="M${e.tx + 6},${e.ty - 3.5} L${e.tx},${e.ty} L${e.tx + 6},${e.ty + 3.5}"/>`);
  }
  for (const box of boxes) {
    const n = box.node;
    const verdict = n.kind === 'check' && n.out.accepted ? part(n.out.accepted.hash) : null;
    const headCls = n.error ? 'head bad' : verdict === true ? 'head good' : verdict === false ? 'head bad' : n.cached ? 'head cached' : 'head';
    svg.push(`<g data-call="${n.id}"${box.ghost ? ` class="ghost" data-run="${esc(box.originRun)}"` : ''}><rect x="${box.x}" y="${box.y}" width="${w}" height="${box.h}" rx="5" class="box${box.ghost ? ' ghostbox' : ''}"/>`);
    svg.push(`<rect x="${box.x}" y="${box.y}" width="${w}" height="${rowH * 2}" rx="5" class="${headCls}"/>`);
    if (n.cached && headCls !== 'head cached') svg.push(`<rect x="${box.x}" y="${box.y}" width="${w}" height="${rowH * 2}" rx="5" class="head overhatch"/>`); // a cached check keeps its colour and shows the hatch
    const hasTick = n.tick !== undefined && n.tick !== null;
    const kindWord = n.kind && n.kind !== 'calculation' && !(n.kind === 'tick' && hasTick) ? ` ${n.kind}` : '';
    const mark = verdict !== null ? (verdict ? ' ✓' : ' ✗') : '';
    // Header text is cut to the box width (bold 12px and 11px monospace), tags last so the contract name survives.
    const headParts = [[`#${n.id} ${n.contract}${n.slot ? `#${n.slot}` : ''}`, null], [hasTick ? ` @${n.tick}` : '', 't-tick'], [`${kindWord}${mark}`, 'kind'], [box.ghost ? ` (run ${box.originRun})` : '', 't-run']];
    // The tags (tick, kind and verdict mark, origin run) are kept whole; the contract name is what gets cut (v0.5 audit).
    const headMax = Math.floor((w - 16) / 7.4);
    const tailLen = headParts.slice(1).reduce((a, [t]) => a + t.length, 0);
    const headSvg = [];
    headParts.forEach(([text, cls], i) => {
      if (!text) return;
      const room = i === 0 ? Math.max(6, headMax - tailLen) : text.length;
      const t = text.length > room ? `${text.slice(0, room - 1)}…` : text;
      headSvg.push(cls ? `<tspan class="${cls}">${esc(t)}</tspan>` : esc(t));
    });
    svg.push(`<text x="${box.x + 8}" y="${box.y + rowH * 0.85}" class="contract" xml:space="preserve">${headSvg.join('')}</text>`);
    // The precedence rung that chose the implementation, when it was a fill or a slot pin (v0.6).
    const flags = [box.byText, n.cached ? `cached${n.cachedFrom ? ` from run ${n.cachedFrom.run} #${n.cachedFrom.call}` : ''}` : '', n.impure ? 'impure' : ''].filter(Boolean).join(' · ');
    const implMax = Math.floor((w - 16) / 6.7);
    const flagText = flags ? `  · ${flags}` : '';
    svg.push(`<text x="${box.x + 8}" y="${box.y + rowH * 1.75}" class="impl">${esc(clip(n.impl, Math.max(12, implMax - flagText.length)) + flagText)}</text>`); // flags survive; the id is cut
    for (const r of box.rows) {
      r.lines.forEach((ln, i) => {
        const ry = box.y + rowH * (r.first + i) + rowH * 0.75;
        const [head, ...rest] = ln;
        svg.push(`<text x="${box.x + 8}" y="${ry}" class="${head.cls}" xml:space="preserve">${esc(head.text)}${rest.map((t) => `<tspan class="${t.cls}">${esc(t.text)}</tspan>`).join('')}</text>`);
      });
    }
    svg.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<style>
  .title{font:700 16px system-ui,sans-serif;fill:#1b1d1c} .fill{font:12px ui-monospace,monospace;fill:#7a3fb0}
  .box{fill:#fff;stroke:#9aa5a1}
  .head{fill:#e8eef3;stroke:#9aa5a1} .head.cached{fill:url(#hatch)} .head.good{fill:#d6f0de} .head.bad{fill:#f6d5d2} .head.overhatch{fill:url(#hatch);opacity:.45}
  .contract{font:700 12px ui-monospace,monospace;fill:#1b1d1c} .kind{fill:#5b2c8a}
  .impl{font:11px ui-monospace,monospace;fill:#55605c}
  .port{font:11.5px ui-monospace,monospace;fill:#1b1d1c} .port.out{fill:#5b2c8a} text tspan{font-size:inherit}
  .err{font:700 11px ui-monospace,monospace;fill:#b0302a}
  .t-literal{fill:#b4610e;font-weight:700} .t-computed{fill:#b0302a;font-weight:700}
  .t-run{fill:#7a3fb0;font-weight:700} .t-path{fill:#2a62c9} .t-pass{fill:#1f8a4c}
  .e-out{stroke:#8a4fc0} .dot-out{fill:#8a4fc0} .arrow-out{stroke:#8a4fc0;stroke-width:1.6;fill:none}
  path{fill:none;stroke-width:1.6;opacity:.85}
  .e-call{stroke:#2a62c9} .e-input{stroke:#1f8a4c} .dashed{stroke-dasharray:5 4}
  .dot-call{fill:#2a62c9} .dot-input{fill:#1f8a4c}
  .arrow-call{stroke:#2a62c9;stroke-width:1.6;fill:none} .arrow-input{stroke:#1f8a4c;stroke-width:1.6;fill:none}
  .e-dec{stroke:#c98a12;stroke-dasharray:2 3} .dot-dec{fill:#c98a12} .arrow-dec{stroke:#c98a12;stroke-width:1.6;fill:none}
  .dec{font:700 11px ui-monospace,monospace;fill:#9a6a00} .dec.no{fill:#8a8f8d}
  .vok{font:700 11px ui-monospace,monospace;fill:#1f8a4c} .t-tick{fill:#c98a12}
  .ghost{opacity:.62} .ghostbox{stroke-dasharray:4 3}
</style>
<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#e8eef3"/><line x1="0" y1="0" x2="0" y2="6" stroke="#b9c6d0" stroke-width="3"/></pattern></defs>
<rect width="100%" height="100%" fill="#fbfbf9"/>
${svg.join('\n')}
</svg>`;
}

function countCalls(node) {
  return node.calls.reduce((a, c) => a + 1 + countCalls(c), 0);
}

/** A drive (sequence of tick receipts) as a strip: one column per tick, state hash and cross-run link. */
export function driveToSvg(receipts, part, { title = '', describe = (state) => JSON.stringify(state), colW = 132 } = {}) {
  const top = title ? 44 : 16;
  const h = receipts.some((r) => (r.verdicts ?? []).length) ? 146 : 132;
  const width = Math.max(20 + receipts.length * colW, title ? 28 + title.length * 8.6 : 0);
  const cells = receipts.map((r, i) => {
    const x = 14 + i * colW;
    const inFrom = r.trace?.in?.state?.from;
    const linked = inFrom?.kind === 'run' ? `← run ${inFrom.run}` : 'initial';
    const s = part(r.outputs?.state);
    return `<g><rect x="${x}" y="${top}" width="${colW - 14}" height="${h}" rx="6" class="cell"/>
<text x="${x + 8}" y="${top + 18}" class="tick">tick ${r.tick}</text>
<text x="${x + 8}" y="${top + 36}" class="run">run ${r.runId}</text>
<text x="${x + 8}" y="${top + 54}" class="link">${esc(linked)}</text>
<text x="${x + 8}" y="${top + 80}" class="state">${esc(describe(s, r))}</text>
<text x="${x + 8}" y="${top + 100}" class="hash">${esc((r.outputs?.state ?? '').slice(0, 8))}</text>
<text x="${x + 8}" y="${top + 118}" class="hash">${r.trace?.cached ? `cached${r.trace.cachedFrom ? ` ← run ${r.trace.cachedFrom.run}` : ''}` : `${r.calls} calls`}</text>
${(r.verdicts ?? []).length ? `<text x="${x + 8}" y="${top + 134}" class="${r.verdicts.every((v) => v.accepted) ? 'vok' : 'vbad'}">${r.verdicts.filter((v) => v.accepted).length} ✓  ${r.verdicts.filter((v) => !v.accepted).length} ✗</text>` : ''}
${i > 0 ? `<path class="arrow" d="M${x - 14},${top + h / 2} H${x - 2}"/>` : ''}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${top + h + 20}" width="${width}" height="${top + h + 20}">
<style>.title{font:700 16px system-ui,sans-serif;fill:#1b1d1c}.cell{fill:#fff;stroke:#9aa5a1}.tick{font:700 13px ui-monospace,monospace;fill:#1b1d1c}
.run{font:11px ui-monospace,monospace;fill:#55605c}.link{font:700 11px ui-monospace,monospace;fill:#7a3fb0}.state{font:700 15px ui-monospace,monospace;fill:#5b2c8a}
.hash{font:10.5px ui-monospace,monospace;fill:#7b8784}.vok{font:700 11px ui-monospace,monospace;fill:#1f8a4c}.vbad{font:700 11px ui-monospace,monospace;fill:#b0302a}.arrow{stroke:#7a3fb0;stroke-width:2;fill:none}</style>
<rect width="100%" height="100%" fill="#fbfbf9"/>${title ? `<text x="14" y="26" class="title">${esc(title)}</text>` : ''}
${cells}</svg>`;
}

export function traceHtml(sections) {
  return `<!doctype html><meta charset="utf-8"><title>trace</title><body style="margin:0;background:#fbfbf9">${sections.map((s) => `<div style="margin:0 0 24px">${s}</div>`).join('')}</body>`;
}
