// Conservation laws over every gesture (engineering notebook page 2; gestures.mjs: each gesture a PxC run, timed by the kernel). Runs the notebook's gauge on
// thro in a throwaway frame and requires: (1) begun = painted + superseded + unchanged + failed, nothing open, nothing open past
// 3 s, and the gauge's superseded and unchanged gestures booked as such; (2) every gesture's time ledger closes; (3) every painted
// gesture put its final pixels on screen exactly once, with no duplicate repaint; and the real localStorage is never written.
// Usage: node thro-conservation-browser.mjs URL (the site root).
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const base = new URL(process.argv[2] ?? 'http://localhost:8766/');
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const failures = [], notes = [];
for (const [width, height] of [[1280, 900], [390, 844]]) {
  const p = await (await browser.newContext({ viewport: { width, height } })).newPage(), errors = [];
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(new URL('notebook-conservation.html?run', base).href, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__conservation?.done, null, { timeout: 180000 });
  const r = await p.evaluate(() => window.__conservation), b = r.books;
  const open = b.begun - b.painted - b.superseded - b.unchanged - b.failed;
  const fail = m => failures.push(`${width}: ${m}`);
  if (b.begun !== 9 || open !== 0 || b.staleAfter3s) fail(`books do not balance: ${JSON.stringify(b)}`);
  if (b.superseded < 1 || b.unchanged < 1) fail(`the fast double tap and the drag back should book superseded and unchanged: ${JSON.stringify(b)}`);
  for (const g of r.gestures) {
    if (!g.ledger || Math.abs(g.ledger.balance) > 0.01) fail(`${g.label}: time ledger does not close (${g.ledger?.balance})`);
    if (g.outcome === 'painted' && !(g.paintLaw?.ofFinal === 1 && g.paintLaw.duplicates === 0)) fail(`${g.label}: final pixels painted ${JSON.stringify(g.paintLaw)}`);
  }
  const keys = await p.evaluate(() => Object.keys(localStorage));
  if (keys.length) fail(`the real localStorage was written: ${keys.join(', ')}`);
  if (errors.length) fail(`page errors: ${errors.join(' | ')}`);
  notes.push(`${width}: ${JSON.stringify(b)}; ${r.gestures.map(g => `${g.label} ${g.outcome} ${Math.round(g.end)} ms`).join(', ')}`);
}
await browser.close();
console.log(notes.join('\n'));
console.log(failures.length ? `FAIL\n${failures.join('\n')}` : 'PASS: every gesture is booked and balanced, every ledger closes, final pixels are painted once, and saved work is untouched');
process.exit(failures.length ? 1 : 0);
