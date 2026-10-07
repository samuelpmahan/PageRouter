import { inventory, inspectPart, printable, find, createScratch, reviseScratch, objectId, objectModel, runCalculation, runMember, createObjectPlayground, ownData, operationLabel, outcomeLabel, describeExecution, latestMeaningfulReceipt, recordedProfileReceipt } from './devtools-data.mjs';
import {mountStylePlayground} from '../style-playground.mjs';

export function mountDevTools(pxc, { label = 'UploadDiscToShelf', readOnly = false, app = document.querySelector('main'), getContext = () => null, stylePlayground = null, storage = globalThis.sessionStorage } = {}) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./devtools.css', import.meta.url).href; document.head.append(stylesheet);
  const nav = document.createElement('nav'); nav.className = 'pxdt-nav'; nav.setAttribute('aria-label', 'Workspace');
  const panel = document.createElement('section'); panel.className = 'pxdt'; panel.hidden = true;
  // Static template only. All material, addresses and code below are textContent.
  panel.innerHTML = `<div class="pxdt-heading"><div><h1>PxC DevTools</h1><p>Live Parts. Actual links. No schema homework.</p></div><button data-action="refresh">Refresh live store</button></div>
    <p class="pxdt-notice">Actual PxC of this mounted Experience. The host selects persistence or disposable state. Values are borrowed, not historical snapshots. Scratch results do not change application selections.</p>
    <p data-view="loaded-status" class="pxdt-loaded-status"></p>
    <div class="pxdt-grid"><section class="pxdt-browser" aria-label="Teachers and recent activity"><h2>Teachers · loaded state</h2><div data-view="teachers"></div><h2>Recent activity · this page</h2><p data-view="history-note" class="pxdt-history-note"></p><div data-view="receipts"></div></section><section class="pxdt-detail" aria-label="Part inspector"><h2 data-view="title" tabindex="-1">Select a teacher or action</h2><div data-view="detail"></div></section></div>
    <details class="pxdt-style"><summary>Styles · bounded Calculations only</summary><div data-view="style-playground"></div></details>
    <details class="pxdt-advanced"><summary>All Parts and filters</summary><div class="pxdt-toolbar"><label>Find Parts<input data-field="query" placeholder="Optional: address, field, value…"></label><label>Address prefix<select data-field="prefix"><option value="">All addresses</option></select></label><label>Kind<select data-field="kind"><option value="">All kinds</option><option>Supplied</option><option>Produced</option><option>Calculation</option></select></label></div><p data-view="stats" role="status"></p><div data-view="list"></div><button data-action="more">Show 100 more</button></details>
    <details data-devtools-mutation><summary>Scratchpad · JSON material, no arbitrary JavaScript</summary><p>Create a supplied Part or derive a new result from the selected Part. Existing Parts remain untouched. This is experimentation, not a disc update.</p><label>JSON material<textarea data-field="json" rows="7">{ "hello": "PxC" }</textarea></label><button data-action="create">Create scratch Part</button> <button data-action="revise">Derive scratch result from selection</button><p data-view="scratch-status" role="status"></p></details>`;
  const $ = selector => panel.querySelector(selector);
  const button = (text, act) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = act; return b; };
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = value; return el; };
  let selected = null, selectedLabel = '', limit = 100, returnFocus = null, selectedContext = null;
  panel.setAttribute('aria-label', 'PxC DevTools');
  panel.setAttribute('tabindex', '-1');
  if (readOnly) {
    panel.querySelector('[data-devtools-mutation]').remove();
    panel.querySelector('.pxdt-notice').textContent = 'Read-only · browsing runs no calls. Loaded teachers survive this tab’s reload; recorded activity starts fresh on each page load.';
  }
  function show(open) {
    panel.hidden = !open;
    nav.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === (open ? 1 : 0))));
    if (open) { refresh(true); panel.focus({preventScroll:true}); }
    else { const target=returnFocus?.isConnected?returnFocus:returnFocus?.id?document.getElementById(returnFocus.id):null; target?.focus({preventScroll:true}); }
  }
  nav.append(button(label, () => show(false)), button('PxC DevTools', eventOpen));
  app.before(nav); app.after(panel);
  function eventOpen() { returnFocus = document.activeElement; show(true); }
  if (!readOnly) panel.querySelector('.pxdt-heading').append(button('Create object playground',()=>{
    const address=createObjectPlayground(pxc); refresh(); select(pxc.get(address),address);
  }));
  if (!readOnly) panel.querySelector('.pxdt-notice').append(' Object browsing does not call ordinary getters or toJSON. Proxy reflection traps may still execute. Live calls are opt-in and can have effects. The object playground is a labeled test fixture, not a disc.');
  function revealDetail(reveal=true) {
    const detail=$('.pxdt-detail');detail.scrollTop=0;
    if(reveal) { if(innerWidth<760) detail.scrollIntoView({block:'start'}); $('[data-view="title"]').focus({preventScroll:true}); }
  }
  function select(part, label, reveal=true) { selected=part; selectedContext=null; selectedLabel=label; renderDetail(); revealDetail(reveal); renderLoadedState();renderReceipts(); }
  function selectTeacher(profile) { selected=null;selectedContext=profile;selectedLabel=profile.displayName;renderDetail();revealDetail();renderLoadedState();renderReceipts(); }
  function appendLinks(part,host) {
    const info=inspectPart(pxc,part);const group=document.createElement('div');group.className='pxdt-links';
    group.append(text('h3','Producer and inputs · actual links'));
    if(!info.edges.length) group.append(text('p','Supplied material: no producing calculation.'));
    for(const edge of info.edges) {
      const address=edge.addresses[0];const title=edge.role==='Calculation'?'Producer: '+operationLabel(address?.replace(/^hh\.service\./,'')):'Input: '+edge.role;
      const b=button(title,()=>select(edge.part,title));b.dataset.linkRole=edge.role;b.append(text('small',edge.addresses.join(', ')||'Inline Part'));group.append(b);
    }
    host.append(group);return info;
  }
  function renderLoadedState() {
    const context=getContext();if(selectedContext)selectedContext=(context?.publicProfiles||[]).find(p=>p.id===selectedContext.id)||null;const teachers=$('[data-view="teachers"]');teachers.replaceChildren();
    if(!context){$('[data-view="loaded-status"]').textContent='No loaded teacher state supplied.';teachers.append(text('p','No teachers loaded.'));return;}
    $('[data-view="loaded-status"]').textContent=context.currentTeacherName?`${context.currentTeacherName} · Registration: ${context.registration} · Session: ${context.session}`:'No demo teacher registered yet. Seed profiles are available below.';
    if(context.currentTeacherName&&!context.hasCurrentProfile) teachers.append(text('p','No public profile created for the selected teacher yet.'));
    for(const profile of context.publicProfiles||[]) {
      const b=button(profile.displayName,()=>selectTeacher(profile));b.className='pxdt-teacher-row';b.dataset.profileId=profile.id;b.setAttribute('aria-current',String(selectedContext?.id===profile.id));b.append(text('small',profile.seeded?'Seed profile':'This tab’s profile'));teachers.append(b);
    }
    if(!teachers.childNodes.length)teachers.append(text('p','No public profiles loaded.'));
  }
  function invocation(title, execute, initial) {
    const box = document.createElement('details'); box.className = 'pxdt-invoke';
    box.append(text('summary', title), text('p', 'Runs live code with the actual receiver/inputs. May mutate data or perform external effects. Not sandboxed, reversible, or cancellable.'));
    const label = text('label', 'Arguments / input bindings (JSON)');
    const editor = document.createElement('textarea'); editor.rows = 4; editor.value = initial; label.append(editor);
    const agree = document.createElement('input'); agree.type = 'checkbox'; agree.style.width = 'auto';
    const consent = text('label', ' Allow this live invocation'); consent.prepend(agree);
    const status = text('p', 'Not run'); status.setAttribute('role','status');
    const run = button('Run and inspect result', async () => {
      if (!agree.checked) { status.textContent = 'Enable live invocation first.'; return; }
      run.disabled = true; agree.checked = false; status.textContent = 'Running…';
      try {
        if (editor.value.length > 200000) throw Error('Input limit: 200,000 characters.');
        const pending = execute(JSON.parse(editor.value));
        renderList();
        const result = await pending;
        status.textContent = 'Produced ' + result.into;
        refresh(); select(result.output, result.into);
      } catch (error) { status.textContent = 'Failed: ' + String(error); renderList(); renderReceipts(); }
      finally { run.disabled = false; }
    });
    box.append(label, consent, run, status); return box;
  }
  function material(value, depth = 0, ancestors = new Set(), receiver = value) {
    if (typeof value === 'string') {
      const node = document.createElement('span');
      const target = pxc.entries().find(([address]) => address === value);
      if (target) node.append(button('↗ ' + value, () => select(target[1], value)), text('small', 'address-valued string'));
      else if (/^data:image\/(png|jpeg|webp|svg\\+xml)[;,]/.test(value)) {
        const img = document.createElement('img'); img.src = value; img.alt = 'Retained image material'; img.className = 'pxdt-image';
        node.append(img, text('small', value.length + ' characters; image bytes hidden'));
      } else node.textContent = value;
      return node;
    }
    if (value === null || !['object','function'].includes(typeof value)) return text('pre', printable(value));
    const wrap = document.createElement('div'), model = objectModel(value);
    wrap.append(text('p', model.id + ' · ' + (typeof value === 'function' ? 'function' : 'object') + (model.frozen ? ' · frozen' : '') + (model.extensible ? ' · extensible' : ' · non-extensible')));
    if (model.error) { wrap.append(text('p', model.error)); return wrap; }
    if (ancestors.has(value)) { wrap.append(text('small','Same object as an ancestor (cycle); identity preserved.')); return wrap; }
    const next = new Set(ancestors); next.add(value);
    const bindings = pxc.entries().filter(([,part])=>part === value || part.value === value);
    for (const [address, part] of bindings) wrap.append(button('Bound object → ' + address, ()=>select(part,address)));
    if (typeof value === 'function') {
      try { wrap.append(text('pre',Function.prototype.toString.call(value))); } catch (e) { wrap.append(text('pre',String(e))); }
    }
    const lazy = (label, build) => {
      const row = document.createElement('details'); row.append(text('summary', label));
      row.addEventListener('toggle', () => { if (row.open && row.childNodes.length === 1) {
        try { row.append(build()); } catch(e) { row.append(text('pre','Inspection failed: '+String(e))); }
      } }); return row;
    };
    let offset = 0;
    const rows = document.createElement('div');
    const more = button('Show next 100 properties', appendProperties);
    function appendProperties() {
      for (const d of model.properties.slice(offset,offset+100)) {
        const label = String(d.key) + ' · ' + ('value' in d ? typeof d.value : 'accessor') +
          (d.enumerable ? '' : ' · non-enumerable') + (d.configurable ? '' : ' · non-configurable') +
          ('writable' in d ? (d.writable ? ' · writable' : ' · read-only') : '');
        rows.append(lazy(label, () => {
          const content = document.createElement('div');
          if ('value' in d) {
            content.append(material(d.value,depth+1,next));
            if (!readOnly && typeof d.value === 'function') content.append(invocation('Call method on ' + objectId(receiver), args=>runMember(pxc,receiver,d.value,args), '[]'));
          } else {
            if (d.get) {
              content.append(text('pre',Function.prototype.toString.call(d.get)));
              if (!readOnly) content.append(invocation('Evaluate getter on ' + objectId(receiver), ()=>runMember(pxc,receiver,d.get,[],'getter'), '[]'));
            }
            if (d.set) {
              content.append(text('pre',Function.prototype.toString.call(d.set)));
              if (!readOnly) content.append(invocation('Invoke setter on ' + objectId(receiver), args=>{
                if (!Array.isArray(args) || args.length !== 1) throw Error('Setter requires exactly one argument.');
                return runMember(pxc,receiver,d.set,args);
              }, '[null]'));
            }
          }
          return content;
        }));
      }
      offset += 100; more.hidden = offset >= model.properties.length;
    }
    wrap.append(text('small',model.properties.length + ' own properties, including symbols and non-enumerables. Accessors not evaluated.'),rows,more);
    appendProperties();
    if (value instanceof Map) wrap.append(lazy('[[Map entries]]',()=>material([...Map.prototype.entries.call(value)],depth+1,next)));
    if (value instanceof Set) wrap.append(lazy('[[Set values]]',()=>material([...Set.prototype.values.call(value)],depth+1,next)));
    wrap.append(lazy('[[Prototype]] ' + (model.prototype === null ? 'null' : objectId(model.prototype)),()=>material(model.prototype,depth+1,next,receiver)));
    return wrap;
  }
  function renderDetail() {
    const host=$('[data-view="detail"]');host.replaceChildren();
    if(selectedContext) {
      $('[data-view="title"]').textContent=selectedContext.displayName;
      host.append(text('p','Loaded profile state · not execution history'),text('pre',printable(selectedContext)));
      const recorded=recordedProfileReceipt(pxc.receipts(),selectedContext.id);
      if(recorded) {
        const info=describeExecution(recorded);host.append(text('h3','Recorded call for this profile'),text('p',`${info.operation} · ${info.outcome}`));
        host.append(text('p','These links belong to that retained call; the loaded snapshot has no producing receipt.'));
        host.append(button('Open recorded result',()=>select(recorded.output,info.title)));
        appendLinks(recorded.output,host);
      } else host.append(text('p','No call for this profile is retained on this page. Earlier execution history is unavailable after reload; the loaded profile remains inspectable.'));
      return;
    }
    if(!selected){$('[data-view="title"]').textContent='Select a teacher or action';host.append(text('p','Choose a teacher above to inspect loaded state, or choose a recorded action.'));return;}
    const value=selected.value;const port=ownData(value,'port');
    const receipt=pxc.receipts().find(r=>r.output===selected);
    const info=receipt?describeExecution(receipt):null;
    $('[data-view="title"]').textContent=info?.title||selectedLabel;
    if(typeof port==='string'&&port.startsWith('Style.')) {
      host.append(text('p',`${operationLabel(port)} · ${outcomeLabel(ownData(value,'outcome'))}`));
      host.append(text('p','Bounded style-only Calculation. It did not invoke an HH service or change teacher state.'));
      const data=text('pre',printable(value));data.className='pxdt-result-data';host.append(data);
    } else if(port) {
      host.append(text('p',`${outcomeLabel(ownData(value,'outcome'))} · ${ownData(value,'ok')===true?'Request succeeded':'Request rejected or failed'}`));
      if(ownData(value,'message'))host.append(text('p',ownData(value,'message')));
      const data=text('pre',printable(ownData(value,'data')));data.className='pxdt-result-data';host.append(data);
      host.append(text('small',`Calculation receipt: ${receipt?.status||'not retained'}. This is separate from the request outcome above.`));
    } else if(typeof value==='function') {
      host.append(text('p','Actual service Calculation. Its provider closure and internal state are excluded.'));
      host.append(text('pre',Function.prototype.toString.call(value)));
    } else {const data=text('pre',printable(value));data.className='pxdt-result-data';host.append(data);}
    const partInfo=appendLinks(selected,host);
    host.append(text('h3','Used by · retained compositions'));
    if(!partInfo.consumers.length)host.append(text('p','No retained direct consumers.'));
    for(const use of partInfo.consumers) {
      const r=pxc.receipts().find(r=>r.output===use.part);host.append(button(r?describeExecution(r).title:use.address,()=>select(use.part,r?describeExecution(r).title:use.address)));
    }
    const raw=document.createElement('details');raw.className='pxdt-object-details';raw.append(text('summary','Object properties and raw Part metadata'),material(value));
    const wrapper=document.createElement('details');wrapper.append(text('summary','Inspect the Part wrapper itself'));wrapper.addEventListener('toggle',()=>{if(wrapper.open&&wrapper.childNodes.length===1)wrapper.append(material(selected));});raw.append(wrapper);host.append(raw);
    if(!readOnly&&typeof value==='function')host.append(invocation('Run selected Calculation through PxC',bindings=>runCalculation(pxc,selected,bindings),'{}'));
  }
  function renderList() {
    const all = inventory(pxc), prefix = $('[data-field="prefix"]').value, kind = $('[data-field="kind"]').value;
    const rows = find({ collection: all.filter(row => (!prefix || row.address.startsWith(prefix + '.')) && (!kind || row.kind === kind)), query: $('[data-field="query"]').value, fields: row => [row.address, printable(row.part.value)] });
    $('[data-view="stats"]').textContent = `${all.length} live bindings · ${rows.length} matches · ${pxc.receipts().length} execution receipts`;
    $('[data-view="list"]').replaceChildren(...rows.slice(0, limit).map(row => {
      const execution=pxc.receipts().find(r=>r.output===row.part);const label=execution?describeExecution(execution).title:row.address.startsWith('hh.service.')?'Function · '+operationLabel(row.address.replace(/^hh\.service\./,'')):row.kind;
      const b = button(label, () => select(row.part, label)); b.append(text('small',row.address)); b.className = 'pxdt-row'; return b;
    }));
    if (!rows.length) $('[data-view="list"]').append(text('p', 'No matching Parts. Clear a filter or try different text.'));
    $('[data-action="more"]').hidden = rows.length <= limit;
  }
  function refresh(selectLatest=false) {
    const prefix = $('[data-field="prefix"]'), previous = prefix.value;
    const prefixes = new Set(inventory(pxc).flatMap(row => {
      const bits = row.address.split('.'); return bits.slice(0, -1).map((_, i) => bits.slice(0, i + 1).join('.'));
    }));
    prefix.replaceChildren(new Option('All addresses', ''), ...[...prefixes].sort().map(p => new Option(p, p))); prefix.value = previous;
    if(selectLatest) {const latest=latestMeaningfulReceipt(pxc.receipts());selected=latest?.output||null;selectedContext=null;selectedLabel=latest?describeExecution(latest).title:'';}
    renderLoadedState();renderList();renderDetail();renderReceipts();revealDetail(false);
  }
  function renderReceipts() {
    const all=pxc.receipts();const query=$('[data-field="query"]').value;
    const receipts=find({collection:all,query,fields:r=>{const info=describeExecution(r);return[info.title,info.outcome,info.message,info.address];}});
    $('[data-view="history-note"]').textContent=all.some(r=>!String(describeExecution(r).port).startsWith('SchoolData.'))?'Actual calls recorded on this page, latest first.':'Only startup/lookups recorded on this page. No teacher action history is retained here yet.';
    $('[data-view="receipts"]').replaceChildren(...receipts.slice(-100).reverse().map(receipt=>{
      const info=describeExecution(receipt);const row=button(info.title,()=>select(receipt.output,info.title));row.className='pxdt-activity-row';row.dataset.resultId=receipt.into;row.setAttribute('aria-current',String(selected===receipt.output));row.append(text('small',info.outcome));return row;
    }));
    if(!receipts.length)$('[data-view="receipts"]').append(text('p',query?'No matching activity. Clear the optional filter.':'No calls recorded since page load.'));
  }
  $('[data-action="refresh"]').onclick = () => refresh();
  for (const field of ['query', 'prefix', 'kind']) $('[data-field="' + field + '"]').addEventListener('input', () => { limit = 100; renderList();renderReceipts(); });
  $('[data-action="more"]').onclick = () => { limit += 100; renderList(); };
  async function scratch(revise) {
    const status = $('[data-view="scratch-status"]');
    try {
      const raw = $('[data-field="json"]').value; if (raw.length > 200000) throw Error('Scratch input limit: 200,000 characters.');
      const value = JSON.parse(raw); if (revise && !selected) throw Error('Select a Part first.');
      const address = revise ? await reviseScratch(pxc, selected, value) : createScratch(pxc, value);
      status.textContent = `Retained ${address}. Application selections unchanged.`; refresh(); select(pxc.get(address), address);
    } catch (error) { status.textContent = `Not created: ${String(error)}`; }
  }
  if (!readOnly) $('[data-action="create"]').onclick = () => scratch(false);
  if (!readOnly) $('[data-action="revise"]').onclick = () => scratch(true);
  if (stylePlayground) mountStylePlayground($('[data-view="style-playground"]'), {
    playground: stylePlayground, target: app, storage,
    onInspect(address) {
      try { refresh(); select(pxc.get(address), address); }
      catch (error) { const view=$('[data-view="style-playground"] [role="status"]');if(view)view.textContent=`Part not visible yet: ${String(error)}`; }
    },
  });
  show(false);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); show(false); } });
  return { close() { show(false); }, open(address, trigger) { returnFocus = trigger || document.activeElement; show(true); if (address) select(pxc.get(address), address); }, refresh };
}
