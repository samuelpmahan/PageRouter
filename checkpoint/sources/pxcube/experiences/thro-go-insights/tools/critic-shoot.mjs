const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const out = {};
for (const [name, vp] of [['desktop', {width:1440,height:900}], ['phone', {width:390,height:844}]]) {
  for (const h of ['jmilly','bodanza']) {
    const p = await b.newPage({ viewport: vp, deviceScaleFactor: 1 });
    const errs=[]; p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push(String(e)));
    await p.goto('http://localhost:8765/index.html#'+h); await p.waitForFunction(()=>window.__ready);
    await p.waitForTimeout(300);
    await p.screenshot({ path: `shots/critic-${name}-${h}-fold.png` });
    await p.screenshot({ path: `shots/critic-${name}-${h}-full.png`, fullPage: true });
    const m = await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,sh:document.documentElement.scrollHeight,
      viewerHours:/viewer-hours|viewer hours/i.test(document.body.innerText), clicks:[...document.body.innerText.matchAll(/click/gi)].length,
      text:document.body.innerText,
      overflowEls:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.right>document.documentElement.clientWidth+1&&getComputedStyle(e).position!=='fixed'}).slice(0,8).map(e=>e.tagName+'.'+e.className+' '+Math.round(e.getBoundingClientRect().right))}));
    out[name+h]={...m,text:undefined,errs}; if(name==='desktop') (await import('node:fs')).writeFileSync(`tools/critic-text-${h}.txt`,m.text);
    await p.close();
  }
}
console.log(JSON.stringify(out,null,1)); await b.close();
