// Domain pictures for contest E. Both read only recorded data: a trace (and its Parts) or a tournament table.
//   matchBoardsSvg   the move sequence of one match as a row of small boards, each annotated with
//                    move number, player, and the policy implementation id that chose the move,
//                    all read from the trace nodes of the seat contracts.
//   tournamentGridSvg  rows = X policy, columns = O policy, cells = X wins / draws / X losses.
import { movesOf } from './index.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const COLOR = { X: '#1d5fbf', O: '#b4500a' };
const MARK = { 1: 'X', 2: 'O' };
const CELL = 26;
const PANEL_W = 128;
const PANEL_H = 206;

function markSvg(mark, cx, cy, strong) {
  const r = CELL * 0.3;
  const sw = strong ? 3.2 : 2.4;
  if (mark === 1) {
    return `<path d="M${cx - r},${cy - r} L${cx + r},${cy + r} M${cx + r},${cy - r} L${cx - r},${cy + r}" stroke="${COLOR.X}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${COLOR.O}" stroke-width="${sw}" fill="none"/>`;
}

/** The last game.outcome node of the trace (through cache hits when `expand` is given): final status and winning line. */
function finalOutcome(trace, part, expand) {
  let last = null;
  (function walk(node) {
    if (node.contract === 'game.outcome') last = node;
    const original = node.cached && expand && node.cachedFrom ? expand(node) : null;
    (original ?? node).calls.forEach(walk);
  })(trace);
  return last ? { status: part(last.out.status.hash), line: part(last.out.line.hash), board: part(last.in.board.hash) } : null;
}

/**
 * One row of boards. `rows` is [{ title, trace }]; each row is drawn from trace nodes only:
 * board before the move = the node's `board` input Part, mark = its `player` input Part,
 * cell = its `cell` output Part, label = the node's contract and impl.
 */
export function matchBoardsSvg(rows, part, { title = '', expand = null } = {}) {
  const parts = [];
  let y = 0;
  if (title) { parts.push(`<text x="14" y="24" class="vt">${esc(title)}</text>`); y = 40; }
  let width = 0;
  for (const row of rows) {
    const moves = movesOf(row.trace, part, { expand });
    const outcome = finalOutcome(row.trace, part, expand);
    const rootStatus = row.trace.out.status ? part(row.trace.out.status.hash) : null;
    const rejected = moves.filter((m) => m.verdict && !m.verdict.accepted);
    const checks = moves.filter((m) => m.verdict).length;
    const result = rootStatus === 'draw' ? 'draw' : rootStatus === 'ongoing' ? 'unfinished' : rootStatus ? `${rootStatus} wins` : 'no status in trace';
    const forfeit = rejected.length ? `, by forfeit: ${MARK[rejected[0].player]}'s move ${rejected[0].move} rejected (${rejected[0].verdict.reason})` : '';
    const movesOut = row.trace.out.moves ? part(row.trace.out.moves.hash).map((m) => `${MARK[m.player]}${m.cell}`).join(' ') : null;
    const outLen = row.trace.out.moves ? part(row.trace.out.moves.hash).length : moves.length;
    const viaCache = moves.filter((m) => m.run !== null).length;
    const hollow = outLen > moves.length ? `   (${outLen - moves.length} of ${outLen} moves hidden inside cached calls)`
      : viaCache ? `   (${viaCache} of ${outLen} moves read through cache hits)` : '';
    parts.push(`<text x="14" y="${y + 18}" class="vrow">${esc(row.title)}${esc(hollow)}</text>`);
    parts.push(`<text x="14" y="${y + 35}" class="vsub">${moves.length} policy calls, ${checks} legality checks (${rejected.length} rejected), result: ${esc(result + forfeit)}${movesOut ? `   |   output moves: ${esc(movesOut)}` : ''}</text>`);
    const top = y + 44;
    moves.forEach((m, i) => {
      const px = 14 + i * PANEL_W;
      const bad = m.verdict && !m.verdict.accepted;
      const after = bad ? m.board : m.board.map((v, c) => (c === m.cell ? m.player : v));
      const seat = m.slot ?? '';
      const mark = m.player === 1 ? 'X' : 'O';
      const isLast = i === moves.length - 1;
      parts.push(`<g class="panel" data-move="${m.move}" data-impl="${esc(m.impl)}">`);
      parts.push(`<rect x="${px}" y="${top}" width="${PANEL_W - 8}" height="${PANEL_H - 8}" rx="6" class="pbox"/>`);
      parts.push(`<text x="${px + 8}" y="${top + 17}" class="pmove">move ${m.move}</text>`);
      parts.push(`<text x="${px + PANEL_W - 18}" y="${top + 17}" class="pmark" fill="${COLOR[mark]}" text-anchor="end">${mark}</text>`);
      const bx = px + 8; const by = top + 26;
      after.forEach((v, c) => {
        const cx0 = bx + (c % 3) * CELL; const cy0 = by + Math.floor(c / 3) * CELL;
        const fresh = c === m.cell;
        parts.push(`<rect x="${cx0}" y="${cy0}" width="${CELL}" height="${CELL}" class="${bad && fresh ? 'cellbad' : fresh ? 'cellnew' : 'cell'}"/>`);
        if (v === 0) parts.push(`<text x="${cx0 + 3}" y="${cy0 + 9}" class="cn">${c}</text>`);
        else parts.push(markSvg(v, cx0 + CELL / 2, cy0 + CELL / 2, fresh));
      });
      if (isLast && !bad && outcome && outcome.line.length === 3 && outcome.status === rootStatus) {
        const [a, , z] = outcome.line;
        const ctr = (c) => [bx + (c % 3) * CELL + CELL / 2, by + Math.floor(c / 3) * CELL + CELL / 2];
        const [x1, y1] = ctr(a); const [x2, y2] = ctr(z);
        const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy);
        const ex = (dx / len) * 12; const ey = (dy / len) * 12;
        parts.push(`<line x1="${x1 - ex}" y1="${y1 - ey}" x2="${x2 + ex}" y2="${y2 + ey}" class="win"/>`);
      }
      const ly = by + 3 * CELL + 14;
      const slash = m.impl.indexOf('/');
      parts.push(`<text x="${px + 8}" y="${ly}" class="${bad ? 'pbad' : 'pcell'}">${bad ? `REJECTED cell ${m.cell}` : `plays cell ${m.cell}`}</text>`);
      parts.push(`<text x="${px + 8}" y="${ly + 14}" class="pcon">${esc(m.contract)}#${esc(seat)}</text>`);
      parts.push(`<text x="${px + 8}" y="${ly + 27}" class="pimpl" fill="${COLOR[seat || mark]}">${esc(m.impl.slice(slash))}</text>`);
      parts.push(`<text x="${px + 8}" y="${ly + 40}" class="pcall">call #${m.call}${m.run !== null ? ` (run ${m.run})` : ''}</text>`);
      if (m.cached) parts.push(`<text x="${px + 8}" y="${ly + 53}" class="pcall">cached${m.run !== null ? ` from run ${m.run}` : ''}</text>`);
      if (m.verdict) parts.push(`<text x="${px + 8}" y="${ly + 66}" class="${m.verdict.accepted ? 'pcall' : 'pbad'}">check #${m.verdict.call} ${m.verdict.accepted ? '✓' : '✗ illegal'}</text>`);
      parts.push('</g>');
    });
    width = Math.max(width, 14 + moves.length * PANEL_W + 6, 1150);
    if (moves.length === 0) parts.push(`<text x="14" y="${top + 14}" class="vsub">(no policy.choose node anywhere in this trace: nothing to draw)</text>`);
    y = top + (moves.length === 0 ? 30 : PANEL_H + 12);
  }
  const height = y + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<style>
  .vt{font:700 16px system-ui,sans-serif;fill:#1b1d1c}
  .vrow{font:700 14px system-ui,sans-serif;fill:#1b1d1c}
  .vsub{font:12px system-ui,sans-serif;fill:#55605c}
  .pbox{fill:#fff;stroke:#9aa5a1}
  .pmove{font:700 12px ui-monospace,monospace;fill:#1b1d1c}
  .pmark{font:700 15px ui-monospace,monospace}
  .cell{fill:#fbfbf9;stroke:#9aa5a1;stroke-width:1}
  .cellnew{fill:#fff1b8;stroke:#9aa5a1;stroke-width:1}
  .cellbad{fill:#f6c9c5;stroke:#b0302a;stroke-width:2}
  .pbad{font:700 11px ui-monospace,monospace;fill:#b0302a}
  .cn{font:7px ui-monospace,monospace;fill:#9aa5a1}
  .win{stroke:#1f8a4c;stroke-width:3.5;stroke-linecap:round;opacity:.9}
  .pcell{font:700 11px ui-monospace,monospace;fill:#1b1d1c}
  .pcon{font:10.5px ui-monospace,monospace;fill:#55605c}
  .pimpl{font:700 10.5px ui-monospace,monospace}
  .pcall{font:10px ui-monospace,monospace;fill:#55605c}
</style>
<rect width="100%" height="100%" fill="#fbfbf9"/>
${parts.join('\n')}
</svg>`;
}

/** Rows: X policy. Columns: O policy. Cell: X wins - draws - X losses (O wins), over n matches. */
export function tournamentGridSvg(result, { title = '', emphasize = 'minimax' } = {}) {
  const { table, policies } = result;
  const labelW = 150; const cw = 150; const ch = 78; const top = title ? 96 : 66;
  const width = 14 + labelW + policies.length * cw + 14;
  const height = top + policies.length * ch + 50;
  const parts = [];
  if (title) parts.push(`<text x="14" y="24" class="gt">${esc(title)}</text>`);
  parts.push(`<text x="14" y="${title ? 46 : 18}" class="gs">Rows: policy playing X (moves first). Columns: policy playing O. Each cell: X wins / draws / O wins, then the number of matches n.</text>`);
  parts.push(`<text x="${14 + labelW}" y="${top - 30}" class="gh" fill="${COLOR.O}">O plays →</text>`);
  parts.push(`<text x="14" y="${top - 6}" class="gh" fill="${COLOR.X}">X plays ↓</text>`);
  policies.forEach((o, j) => {
    const x = 14 + labelW + j * cw;
    parts.push(`<text x="${x + cw / 2}" y="${top - 8}" class="gh" text-anchor="middle">${esc(o)}</text>`);
  });
  policies.forEach((x, i) => {
    const y = top + i * ch;
    parts.push(`<text x="${14 + labelW - 10}" y="${y + ch / 2 + 4}" class="gh" text-anchor="end">${esc(x)}</text>`);
    policies.forEach((o, j) => {
      const t = table[x][o];
      const px = 14 + labelW + j * cw;
      const xShare = t.win / t.n; const oShare = t.loss / t.n;
      const fill = xShare > oShare ? `rgba(31,138,76,${0.12 + 0.5 * xShare})` : oShare > xShare ? `rgba(176,48,42,${0.12 + 0.5 * oShare})` : 'rgba(150,160,156,0.22)';
      const hot = x === emphasize || o === emphasize;
      parts.push(`<g class="gcell" data-x="${esc(x)}" data-o="${esc(o)}" data-win="${t.win}" data-draw="${t.draw}" data-loss="${t.loss}">`);
      parts.push(`<rect x="${px}" y="${y}" width="${cw - 6}" height="${ch - 6}" rx="5" fill="${fill}" stroke="${hot ? '#5b2c8a' : '#9aa5a1'}" stroke-width="${hot ? 1.6 : 1}"/>`);
      parts.push(`<text x="${px + (cw - 6) / 2}" y="${y + 32}" class="gv" text-anchor="middle">${t.win} / ${t.draw} / ${t.loss}</text>`);
      parts.push(`<text x="${px + (cw - 6) / 2}" y="${y + 54}" class="gn" text-anchor="middle">n = ${t.n}</text>`);
      parts.push('</g>');
    });
  });
  parts.push(`<text x="14" y="${top + policies.length * ch + 22}" class="gs">Green: X wins more often than O wins. Red: O wins more often. Grey: equal. Purple border: ${esc(emphasize)} plays that seat.</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
<style>
  .gt{font:700 16px system-ui,sans-serif;fill:#1b1d1c}
  .gs{font:12px system-ui,sans-serif;fill:#55605c}
  .gh{font:700 13px ui-monospace,monospace;fill:#1b1d1c}
  .gv{font:700 20px ui-monospace,monospace;fill:#1b1d1c}
  .gn{font:12px ui-monospace,monospace;fill:#55605c}
</style>
<rect width="100%" height="100%" fill="#fbfbf9"/>
${parts.join('\n')}
</svg>`;
}
