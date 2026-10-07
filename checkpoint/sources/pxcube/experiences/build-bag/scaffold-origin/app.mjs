const $ = id => document.getElementById(id);
const valueText = value => JSON.stringify(value, null, 2);
let config, owner, active;
const element = (tag, text, className) => {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
};
function showValue(item, target, output = false) {
  const card = element('section', '', 'value-card');
  card.append(element('h3', item.label), element('p', item.for, 'hint'));
  const address = `${active.name}.${item.address}`;
  card.dataset.address = address;
  if (output) {
    card.append(element('span', 'Not produced · planned', 'planned'));
  } else {
    const value = active.resolve(address);
    // A small generic value lens; the named source remains visible in details.
    if (Array.isArray(value)) {
      const list = element('ul', '', 'values');
      for (const row of value) list.append(element('li', typeof row === 'object' && row !== null ? Object.values(row).join(' · ') : String(row)));
      card.append(list);
    } else card.append(element('pre', valueText(value)));
  }
  const details = element('details', ''); details.append(element('summary', 'Source address'), element('code', address)); card.append(details);
  target.append(card);
}
function render() {
  $('mounts').replaceChildren(...owner.list().map(run => {
    const option = element('option', run.kind === 'interactive' ? 'Interactive workspace' : `Test ${run.iteration}`);
    option.value = run.name; return option;
  }));
  $('mounts').value = active.name; $('mount-name').textContent = active.name;
  $('inputs').replaceChildren(); $('outputs').replaceChildren();
  for (const item of config.scaffold.inputs) showValue(item, $('inputs'));
  for (const item of config.scaffold.outputs) showValue(item, $('outputs'), true);
  if (config.scaffold.draft) {
    const { address, field } = config.scaffold.draft;
    $('draft-name').value = active.resolve(`${active.name}.${address}`)[field];
  }
  $('inspection').textContent = valueText(active.inspect());
}
function action(fn, message) {
  try { fn(); render(); $('status').textContent = message; }
  catch (error) { $('status').textContent = `Stopped: ${error.message}`; }
}
try {
  const response = await fetch('./config.json');
  if (!response.ok) throw Error(`Manifest could not load (${response.status})`);
  config = await response.json();
  document.title = config.title;
  $('title').textContent = config.title; $('workspace-title').textContent = config.title;
  $('description').textContent = config.description;
  $('steps').replaceChildren(...config.scaffold.steps.map(step => element('li', step)));
  const draft = config.scaffold.draft;
  if (draft) { $('draft-form').hidden = false; $('draft-label').textContent = draft.label; }
  // The shell owns the PxC boards; this frame reaches its owner directly off
  // the parent page. Outside the launcher there is no shell, so this fails
  // loudly instead of hanging.
  const shell = window.parent?.pxc;
  if (!shell?.ownerFor) throw Error('Open this Experience from the launcher');
  owner = shell.ownerFor(`pxcube.scaffold.v1:${config.id}`, config.id, config.seedIdentity);
  active = owner.openInteractive(config.id, config.scaffold.world);
  $('interactive').onclick = () => action(() => { active = owner.openInteractive(config.id, config.scaffold.world); }, 'Interactive draft restored.');
  $('new-test').onclick = () => action(() => { active = owner.createTestRun(config.id, config.scaffold.world); }, 'New test sandbox starts from the seed. Earlier sandboxes remain.');
  $('mounts').onchange = () => action(() => { active = owner.handle($('mounts').value); }, 'Saved sandbox opened.');
  $('draft-form').onsubmit = event => {
    event.preventDefault();
    action(() => {
      const previous = active.resolve(`${active.name}.${draft.address}`);
      active.writeScratch(draft.address, { ...previous, [draft.field]: $('draft-name').value });
    }, 'Draft saved in this sandbox.');
  };
  // Read-only inspection of the same owner used by the visible controls.
  window.pxCubeScaffold = Object.freeze({ inspect: () => owner.inspect(), current: () => active.inspect(), resolve: address => active.resolve(address) });
  render(); $('status').textContent = 'Scaffold ready. Planned steps have not run.';
} catch (error) {
  $('status').textContent = `Stopped: ${error.message}`;
  for (const input of document.querySelectorAll('button,input,select')) input.disabled = true;
}
