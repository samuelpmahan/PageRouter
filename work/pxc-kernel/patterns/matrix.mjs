// Test matrix: run one thing over every combination of two (or three) axes, check every cell, and draw the grid.
// Extracted from two matrices written by hand first: e-game's tournament (policy × policy, seeds folded into a cell)
// and the 4-bit adder (a × b, once for the real adder and once with a fault).
//
//   matrix({
//     title,
//     rows:   { name, values, label? },          label(value) -> header text (default String)
//     cols:   { name, values, label? },
//     panels: { name, values, label? },          optional third axis: one grid per value, side by side
//     run(at) -> { value, runs: [runId] },       at = { [rows.name]: v, [cols.name]: v, [panels.name]: v }
//     show(value, at) -> text | { html },        what the cell displays (it shows the data it checked); { html } for a picture
//     checks: { name: (value, at, get) -> boolean },  a cell is red when any check is false;
//                                                get(change) is a neighbour's value, for checks like "error grows with penalty"
//     shows: 'text',                             what a cell's text means (printed above the grid)
//     expect?(at) -> true | false | undefined,   prediction, written before running, of which cells pass (default: all);
//                                                a cell that disagrees is a surprise; undefined makes no prediction for that cell
//   })
//   -> { cells: [{ at, value, runs, failed: [check names], ok }], failures, surprises, html }
//
// Every cell keeps the runs it came from (Sam's rule: a Part points at every piece of data it references, and shows it).
// The grid has fixed cell sizes, so it can also be shot as a flip book one row at a time without anything moving.
const MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function matrix({ title, rows, cols, panels = { name: '_', values: [null] }, run, show = (v) => String(v), shows = '', checks = {}, expect = () => true }) {
  const lab = (axis, v) => esc((axis.label ?? String)(v));
  const cells = [];
  for (const p of panels.values) for (const r of rows.values) for (const c of cols.values) {
    const at = { [rows.name]: r, [cols.name]: c, ...(panels.name === '_' ? {} : { [panels.name]: p }) };
    const { value, runs = [] } = run(at);
    cells.push({ at, value, runs, shown: show(value, at) });
  }
  // Checks run after every cell has its value, so a check may compare a cell with a neighbour:
  // get({ penalty: 2 }) is the value of the cell that differs from this one only in penalty (undefined off the grid).
  const key = (at) => JSON.stringify(Object.keys(at).sort().map((k) => [k, at[k]]));
  const byKey = new Map(cells.map((x) => [key(x.at), x]));
  for (const cell of cells) {
    const get = (change) => byKey.get(key({ ...cell.at, ...change }))?.value;
    cell.failed = Object.entries(checks).filter(([, holds]) => !holds(cell.value, cell.at, get)).map(([name]) => name);
    cell.ok = cell.failed.length === 0;
    cell.expected = expect(cell.at); // true, false, or undefined (no prediction for this cell)
  }
  const failures = cells.filter((x) => !x.ok);
  const surprises = cells.filter((x) => x.expected !== undefined && x.ok !== x.expected);
  return { cells, failures, surprises, html: draw({ title, rows, cols, panels, cells, lab, checks, shows }), upToRow: (k) => draw({ title, rows, cols, panels, cells, lab, checks, shows, upTo: k }) };
}

function draw({ title, rows, cols, panels, cells, lab, checks, shows, upTo = Infinity }) {
  const one = (p) => {
    const mine = cells.filter((x) => panels.name === '_' || x.at[panels.name] === p);
    const bad = mine.filter((x) => !x.ok).length;
    const body = rows.values.map((r, i) => `<tr><th>${lab(rows, r)}</th>${mine.filter((x) => x.at[rows.name] === r).map((x) => i > upTo ? '<td class="empty"></td>'
      : `<td class="${x.ok ? 'ok' : 'bad'}${x.expected !== undefined && x.expected !== x.ok ? ' surprise' : ''}" title="${esc(`runs ${x.runs.join(', ')}${x.failed.length ? ` · failed: ${x.failed.join(', ')}` : ''}`)}">${typeof x.shown === 'object' && x.shown ? x.shown.html : esc(x.shown)}${x.failed.map((n) => ` ${MARK[Object.keys(checks).indexOf(n)]}`).join('')}</td>`).join('')}</tr>`).join('');
    return `<div class="panel">${panels.name === '_' ? '' : `<div class="ph">${esc(panels.name)} = ${lab(panels, p)}</div>`}
      <table><tr><th class="corner">${esc(rows.name)} ↓ ${esc(cols.name)} →</th>${cols.values.map((c) => `<th>${lab(cols, c)}</th>`).join('')}</tr>${body}</table>
      <div class="sum ${bad ? 'bad-t' : 'ok-t'}">${upTo === Infinity ? `${bad} of ${mine.length} cells fail${Object.keys(checks).length > 1 && bad ? ` (${Object.keys(checks).map((n, i) => `${MARK[i]} ${mine.filter((x) => x.failed.includes(n)).length}`).join(', ')})` : ''}` : ''}</div></div>`;
  };
  return `<div class="mx"><style>
    .mx{font:12px 'DejaVu Sans Mono',monospace;padding:10px;color:#1b1d1c}.mx .t{font-weight:bold;margin-bottom:4px}.mx .k{color:#55605c;margin-bottom:8px}
    .mx .panels{display:flex;gap:24px;align-items:flex-start}.mx .ph{font-weight:bold;margin-bottom:4px}
    .mx table{border-collapse:collapse}.mx td,.mx th{min-width:28px;height:20px;padding:0 4px;text-align:center;border:1px solid #fff;white-space:nowrap}
    .mx th{font-weight:bold}.mx th.corner{color:#55605c;font-weight:normal;text-align:left}
    .mx td.ok{background:#e7f4ec;color:#1e6b3f}.mx td.bad{background:#f7d9d6;color:#9a2a22}.mx td.surprise{outline:3px solid #d62828;outline-offset:-3px}
    .mx .sum{margin-top:4px;height:16px}.mx .ok-t{color:#1e6b3f}.mx .bad-t{color:#9a2a22}</style>
    <div class="t">${esc(title)}</div><div class="k">${shows ? `each cell: ${esc(shows)}<br>` : ''}checks: ${esc(Object.keys(checks).map((n, i) => `${MARK[i]} ${n}`).join('  ') || 'none')}<br>green passes every check · red fails the checks it is marked with · a thick red border means the result was not what was predicted</div>
    <div class="panels">${panels.values.map(one).join('')}</div></div>`;
}
