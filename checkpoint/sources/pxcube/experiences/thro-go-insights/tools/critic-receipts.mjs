const { chromium } = await import('/opt/npm-tools/node_modules/playwright/index.mjs');
const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1440,height:900}});
await p.goto('http://localhost:8765/index.html#jmilly'); await p.waitForFunction(()=>window.__ready);
const ns = await p.$$('.n'); console.log('numbers',ns.length);
for (const i of [0,1,3,6,9,12,20,26,33,40]) { if(!ns[i])continue; const t=await ns[i].innerText(); await ns[i].hover(); console.log(i,JSON.stringify(t),'=>',(await p.innerText('#how')).replace(/\n/g,' | ').slice(0,330)); }
// non-underlined numbers
const plain = await p.evaluate(()=>{const o=[];document.querySelectorAll('.stat .v,.big,.kv span,.note,.rel,.sub,.l').forEach(e=>{const clone=e.cloneNode(true);clone.querySelectorAll('.n').forEach(n=>n.remove());const m=clone.textContent.match(/[\d][\d,.]*/g);if(m)o.push(e.className+': '+m.join(' ')+' <- '+clone.textContent.slice(0,90))});return o});
console.log(plain.join('\n'));
// phone fold + tap
const q = await b.newPage({viewport:{width:390,height:844}}); await q.goto('http://localhost:8765/index.html#bodanza'); await q.waitForFunction(()=>window.__ready);
await q.screenshot({path:'shots/critic-phone-bodanza-fold.png'});
const how = await q.evaluate(()=>{const h=document.querySelector('#how').getBoundingClientRect();return h.height});console.log('phone how height',how);
await q.evaluate(()=>document.querySelector('.n').click()); await q.screenshot({path:'shots/critic-phone-bodanza-tap.png'});
console.log('howH after tap',await q.evaluate(()=>document.querySelector('#how').getBoundingClientRect().height));
const tbl = await q.evaluate(()=>{const e=document.querySelector('.pitch-scroll');return [e.clientWidth,e.scrollWidth]});console.log('pitch scroll',tbl);
await b.close();
