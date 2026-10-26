const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch();
const out = {};
for (const [name, w, h] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
  for (const tab of ['jmilly', 'bodanza']) {
    const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
    const errs = [];
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
    p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
    p.on('requestfailed', (r) => errs.push('reqfail ' + r.url()));
    await p.goto(`http://localhost:8765/index.html#${tab}`);
    await p.waitForFunction(() => window.__ready === true);
    await p.waitForTimeout(300);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth, h: document.documentElement.scrollHeight, text: document.body.innerText, offerTop: Math.round(document.querySelector('.offer')?.getBoundingClientRect().top ?? -1), offerBottom: Math.round(document.querySelector('.offer')?.getBoundingClientRect().bottom ?? -1), howTop: Math.round(document.querySelector('#how').getBoundingClientRect().top), lastRowsBottom: Math.round(document.querySelector('.s-rows')?.getBoundingClientRect().bottom ?? -1) }));
    out[`${name}-${tab}`] = { errs, scrollW: m.sw, clientW: m.cw, bodyW: m.bw, height: m.h, viewerHours: /viewer-hours/i.test(m.text), notPeople: m.text.includes('not people, sales or revenue'), banner: m.text.includes('have not reviewed, endorsed or agreed'), badWords: (m.text.match(/\bvs\b|\bQ[1-4]\b|Unreleased|name withheld|Calc\b/gi) || []), clicksNear: /not people, sales or revenue/.test(m.text), offerTop: m.offerTop, offerBottom: m.offerBottom, howTop: m.howTop, rowsBottom: m.lastRowsBottom };
    if (tab === 'jmilly') await p.screenshot({ path: `shots/round2-${name}.png` });
    await p.screenshot({ path: `shots/round2-${name}-${tab}-full.png`, fullPage: true });
  }
}
console.log(JSON.stringify(out, null, 1));
await b.close();
