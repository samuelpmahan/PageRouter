// Domain pictures for contest C. Pure projections: they draw numbers they are handed (from real runs).
//  regressionSvg  one-feature case: train points, test points, any number of fitted lines
//  clusterSvg     k-means: points coloured (and shaped) by assigned cluster, centroids as large crosses
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (v) => (Math.abs(v) >= 100 || Number.isInteger(v) ? String(Math.round(v * 100) / 100) : v.toFixed(2));

function frame({ width, height, xs, ys, title, xLabel, yLabel }) {
  const m = { l: 56, r: 330, t: 44, b: 44 };
  const pad = (lo, hi) => { const d = (hi - lo) || 1; return [lo - d * 0.06, hi + d * 0.06]; };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (width - m.l - m.r);
  const Y = (v) => height - m.b - ((v - y0) / (y1 - y0)) * (height - m.t - m.b);
  const ticks = (lo, hi, n = 6) => {
    const raw = (hi - lo) / n; const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw);
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(Math.round(v / step) * step);
    return out;
  };
  const parts = [`<rect width="100%" height="100%" fill="#fbfbf9"/>`, `<text x="14" y="24" class="title">${esc(title)}</text>`];
  for (const v of ticks(x0, x1)) parts.push(`<line x1="${X(v)}" y1="${m.t}" x2="${X(v)}" y2="${height - m.b}" class="grid"/><text x="${X(v)}" y="${height - m.b + 16}" class="tick" text-anchor="middle">${fmt(v)}</text>`);
  for (const v of ticks(y0, y1)) parts.push(`<line x1="${m.l}" y1="${Y(v)}" x2="${width - m.r}" y2="${Y(v)}" class="grid"/><text x="${m.l - 6}" y="${Y(v) + 4}" class="tick" text-anchor="end">${fmt(v)}</text>`);
  parts.push(`<rect x="${m.l}" y="${m.t}" width="${width - m.l - m.r}" height="${height - m.t - m.b}" class="plot"/>`);
  parts.push(`<text x="${(m.l + width - m.r) / 2}" y="${height - 8}" class="axis" text-anchor="middle">${esc(xLabel)}</text>`);
  parts.push(`<text transform="translate(14 ${(m.t + height - m.b) / 2}) rotate(-90)" class="axis" text-anchor="middle">${esc(yLabel)}</text>`);
  return { X, Y, parts, m, legendX: width - m.r + 14 };
}

const STYLE = `<style>
  .title{font:700 15px system-ui,sans-serif;fill:#1b1d1c}
  .tick{font:11px ui-monospace,monospace;fill:#55605c}
  .axis{font:12px system-ui,sans-serif;fill:#1b1d1c}
  .grid{stroke:#e3e7e5;stroke-width:1}
  .plot{fill:none;stroke:#9aa5a1}
  .leg{font:12px system-ui,sans-serif;fill:#1b1d1c}
  .note{font:11px ui-monospace,monospace;fill:#55605c}
  .lbl{font:700 11px ui-monospace,monospace;fill:#1b1d1c}
</style>`;

/**
 * train/test: [{x, y}], lines: [{label, color, dash, points: [{x, y}]}], notes: [string]
 */
export function regressionSvg({ title, train, test, lines, xLabel = 'x', yLabel = 'y', notes = [], width = 1100, height = 520 }) {
  const all = [...train, ...test, ...lines.flatMap((l) => l.points)];
  const f = frame({ width, height, xs: all.map((p) => p.x), ys: all.map((p) => p.y), title, xLabel, yLabel });
  const p = f.parts;
  for (const l of lines) {
    p.push(`<polyline points="${l.points.map((q) => `${f.X(q.x).toFixed(1)},${f.Y(q.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${l.color}" stroke-width="2.2" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`);
  }
  for (const q of train) p.push(`<circle cx="${f.X(q.x)}" cy="${f.Y(q.y)}" r="4.5" fill="#2a62c9" stroke="#fff" stroke-width="1"/>`);
  for (const q of test) {
    const cx = f.X(q.x); const cy = f.Y(q.y);
    p.push(`<path d="M${cx},${cy - 6.5} L${cx + 6.5},${cy} L${cx},${cy + 6.5} L${cx - 6.5},${cy} Z" fill="#fff" stroke="#d9731a" stroke-width="2.2"/>`);
  }
  let ly = f.m.t + 8; const lx = f.legendX;
  const row = (draw, text) => { p.push(draw(lx, ly)); p.push(`<text x="${lx + 34}" y="${ly + 4}" class="leg">${esc(text)}</text>`); ly += 22; };
  row((x, y) => `<circle cx="${x + 10}" cy="${y}" r="4.5" fill="#2a62c9"/>`, `train (${train.length})`);
  row((x, y) => `<path d="M${x + 10},${y - 6.5} L${x + 16.5},${y} L${x + 10},${y + 6.5} L${x + 3.5},${y} Z" fill="#fff" stroke="#d9731a" stroke-width="2.2"/>`, `test (${test.length})`);
  for (const l of lines) row((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 24}" y2="${y}" stroke="${l.color}" stroke-width="2.2" ${l.dash ? `stroke-dasharray="${l.dash}"` : ''}/>`, l.label);
  ly += 8;
  for (const n of notes) { p.push(`<text x="${lx}" y="${ly}" class="note">${esc(n)}</text>`); ly += 15; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${STYLE}${p.join('\n')}</svg>`;
}

const CLUSTER = [
  { color: '#2a62c9', shape: (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}"`, name: 'circle' },
  { color: '#d9731a', shape: (x, y, r) => `<path d="M${x},${y - r * 1.25} L${x + r * 1.15},${y + r * 0.8} L${x - r * 1.15},${y + r * 0.8} Z"`, name: 'triangle' },
  { color: '#1f8a4c', shape: (x, y, r) => `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"`, name: 'square' },
];

/** points: [[x,y]], labels: [int], centroids: [[x,y]] */
export function clusterSvg({ title, points, labels, centroids, notes = [], width = 1100, height = 520 }) {
  const f = frame({ width, height, xs: [...points, ...centroids].map((q) => q[0]), ys: [...points, ...centroids].map((q) => q[1]), title, xLabel: 'feature 0', yLabel: 'feature 1' });
  const p = f.parts;
  points.forEach((q, i) => {
    const c = CLUSTER[labels[i] % CLUSTER.length];
    p.push(`${c.shape(f.X(q[0]), f.Y(q[1]), 5)} fill="${c.color}" fill-opacity="0.85" stroke="#fff" stroke-width="1"/>`);
  });
  centroids.forEach((q, ci) => {
    const c = CLUSTER[ci % CLUSTER.length]; const x = f.X(q[0]); const y = f.Y(q[1]);
    p.push(`<path d="M${x - 11},${y - 11} L${x + 11},${y + 11} M${x - 11},${y + 11} L${x + 11},${y - 11}" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`);
    p.push(`<path d="M${x - 11},${y - 11} L${x + 11},${y + 11} M${x - 11},${y + 11} L${x + 11},${y - 11}" stroke="${c.color}" stroke-width="3.4" stroke-linecap="round"/>`);
    const left = x > f.legendX - 190;
    p.push(`<text x="${left ? x - 15 : x + 15}" y="${y + 30}" class="lbl" text-anchor="${left ? 'end' : 'start'}">centroid ${ci} (${fmt(q[0])}, ${fmt(q[1])})</text>`);
  });
  let ly = f.m.t + 8; const lx = f.legendX;
  const counts = centroids.map((_, ci) => labels.filter((l) => l === ci).length);
  centroids.forEach((_, ci) => {
    const c = CLUSTER[ci % CLUSTER.length];
    p.push(`${c.shape(lx + 10, ly, 5)} fill="${c.color}"/>`);
    p.push(`<text x="${lx + 34}" y="${ly + 4}" class="leg">cluster ${ci} (${counts[ci]} points)</text>`); ly += 22;
  });
  p.push(`<path d="M${lx + 2},${ly - 8} l16,16 m-16,0 l16,-16" stroke="#1b1d1c" stroke-width="3.4"/><text x="${lx + 34}" y="${ly + 4}" class="leg">centroid (the model)</text>`); ly += 30;
  for (const n of notes) { p.push(`<text x="${lx}" y="${ly}" class="note">${esc(n)}</text>`); ly += 15; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${STYLE}${p.join('\n')}</svg>`;
}

/**
 * Model lineage: left column = fit calls, right column = apply calls, one arrow per model hand-over labelled with the model hash.
 * Built from lineage.mjs results, which follow edges in real traces (cross-run edges included).
 * fits: [{fit, run?, contract, rowsFrom?}], pairs: [{apply, applyRun?, applyContract, slot, modelHash, fit, fitRun, origin, crossRun}]
 * A fit box shows its run when it differs from the apply's; an arrow that crosses runs is drawn violet and dashed.
 */
export function lineageSvg({ title, fits, pairs, width = 1000 }) {
  const rowH = 74; const bw = 420; const lx = 20; const rx = width - bw - 20;
  const key = (run, fit) => `${run ?? ''}:${fit}`;
  const fitY = new Map(fits.map((f, i) => [key(f.run, f.fit), 48 + i * (rowH + 22)]));
  const height = 48 + Math.max(fits.length, pairs.length) * (rowH + 22) + 20;
  const out = [`<rect width="100%" height="100%" fill="#fbfbf9"/>`, `<text x="14" y="24" class="title">${esc(title)}</text>`];
  const ok = (r) => r.endsWith('.trainRows');
  for (const f of fits) {
    const y = fitY.get(key(f.run, f.fit));
    const col = f.rowsFrom === undefined ? '#9aa5a1' : ok(f.rowsFrom) ? '#1f8a4c' : '#b0302a';
    out.push(`<rect x="${lx}" y="${y}" width="${bw}" height="${rowH}" rx="5" fill="#fff" stroke="${col}" stroke-width="2"/>`);
    out.push(`<text x="${lx + 10}" y="${y + 20}" class="lbl">${f.run != null ? `run ${f.run} ` : ''}${f.fit === '' ? '' : `#${f.fit} `}${esc(f.contract)}</text>`);
    if (f.rowsFrom !== undefined) {
      out.push(`<text x="${lx + 10}" y="${y + 40}" class="note">trained on rows from:</text>`);
      out.push(`<text x="${lx + 10}" y="${y + 58}" class="lbl" style="fill:${col}">${esc(f.rowsFrom)}  ${ok(f.rowsFrom) ? '(train only)' : '(LEAK)'}</text>`);
    } else if (f.note) out.push(`<text x="${lx + 10}" y="${y + 44}" class="note">${esc(f.note)}</text>`);
  }
  pairs.forEach((p, i) => {
    const y = 48 + i * (rowH + 22);
    out.push(`<rect x="${rx}" y="${y}" width="${bw}" height="${rowH}" rx="5" fill="#fff" stroke="#9aa5a1"/>`);
    out.push(`<text x="${rx + 10}" y="${y + 20}" class="lbl">${p.applyRun != null ? `run ${p.applyRun} ` : ''}#${p.apply} ${esc(p.applyContract)}${p.slot ? `#${esc(p.slot)}` : ''}</text>`);
    out.push(`<text x="${rx + 10}" y="${y + 40}" class="note">model ${esc(p.modelHash)}</text>`);
    out.push(`<text x="${rx + 10}" y="${y + 58}" class="note">made by: ${p.fit === null ? `unknown (arrived as ${esc(p.origin)})` : `${p.fitRun != null ? `run ${p.fitRun} ` : ''}#${p.fit} ${esc(p.fitContract)}`}</text>`);
    const fy = p.fit === null ? undefined : fitY.get(key(p.fitRun ?? (p.applyRun ?? fits[0]?.run), p.fit)) ?? fitY.get(key(null, p.fit));
    if (fy !== undefined) {
      const y0 = fy + rowH / 2; const y1 = y + rowH / 2; const col = p.crossRun ? '#7a3fb0' : '#2a62c9';
      out.push(`<path d="M${lx + bw},${y0} C${lx + bw + 120},${y0} ${rx - 120},${y1} ${rx},${y1}" fill="none" stroke="${col}" stroke-width="2" ${p.crossRun ? 'stroke-dasharray="7 4"' : ''}/>`);
      out.push(`<text x="${(lx + bw + rx) / 2}" y="${(y0 + y1) / 2 - 4}" class="note" text-anchor="middle">${esc(p.modelHash.slice(0, 8))}${p.crossRun ? '  run edge' : ''}</text>`);
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${STYLE}${out.join('\n')}</svg>`;
}
