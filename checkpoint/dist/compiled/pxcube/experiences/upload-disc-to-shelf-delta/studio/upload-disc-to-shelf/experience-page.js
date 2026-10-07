import { mountUpload } from './upload-ui.js';
import { createDiscView } from './disc-view.js';
import { mountDevTools } from './devtools.mjs';
import { mountShelf } from './shelf-ui.js';
import { inspectExperience } from './experience-fixtures.js';
import { mountSandboxCase } from './sandbox-ui.js';
import { printable } from './devtools-data.mjs';
import { Part } from '../part-first-kernel/src/pxc.mjs';
                                                   

// One document per mounted instance. The caller owns context creation and lifetime.
// No context, DOM access or app boot occurs merely by importing this module.
export async function mountExperiencePage(experience                                     , { sandbox = null, testRun = false }                                                             = {}) {
const $ = (id        ) => document.getElementById(id) ;
const input = (id        ) => $(id)                    ;
Object.assign(window, { discStudio: experience });
const persistenceNotice = document.createElement('p'); persistenceNotice.id = 'persistence-status'; persistenceNotice.setAttribute('role', 'status');
document.querySelector('main') .prepend(persistenceNotice);
const showPersistence = () => { persistenceNotice.textContent = experience.persistenceStatus; };
showPersistence();
$('status').textContent = experience.persistenceStatus;
document.addEventListener('click', () => setTimeout(showPersistence, 0));
document.addEventListener('submit', () => setTimeout(showPersistence, 0));
const devtools = mountDevTools(experience.pxc, { label: sandbox === 'shelf' ? 'ExploreShelf · sandbox' : sandbox === 'upload' ? 'UploadDiscToShelf · sandbox' : 'UploadDiscToShelf' });
const root = document.querySelector('main') ;
if (sandbox === 'upload') root.querySelector('.shelf-section') .remove();
if (sandbox === 'shelf') for (const selector of ['.intro', '.workspace', '.seed-review']) root.querySelector(selector) .remove();
const shelf = sandbox === 'upload' ? null : mountShelf(experience, createDiscView(experience), address => devtools.open(address), { root, onAddDisc: sandbox ? undefined : () => input('seed').focus() });
if (sandbox !== 'shelf') await mountUpload({ root, experience, onSaved: () => shelf?.refresh(), ...(testRun ? { random: () => 0 } : {}) });
let bridge                                             = null;
if (sandbox && testRun) {
  bridge = mountSandboxCase(sandbox, experience, address => devtools.open(address));
  Object.assign(window, { experienceSandbox: bridge });
  const start = inspectExperience(experience);
  experience.pxc.set('ds.px.sandbox.start', new Part(start));
  const panel = document.createElement('details'); panel.id = 'sandbox-inspection';
  const summary = document.createElement('summary'); summary.textContent = 'Inspect this Experience · starting / ending PxC';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Capture ending PxC';
  const inspectStart = document.createElement('button'); inspectStart.type = 'button'; inspectStart.textContent = 'Inspect starting Part'; inspectStart.onclick = () => devtools.open('ds.px.sandbox.start');
  const result = document.createElement('pre'); result.id = 'sandbox-result'; result.textContent = printable({ starting: start });
  let captures = 0;
  button.onclick = () => { const ending = inspectExperience(experience), address = `ds.px.sandbox.end.${++captures}`; experience.pxc.set(address, new Part(ending)); result.textContent = printable({ starting: start, ending, endingAddress: address }); };
  panel.append(summary, inspectStart, button, result); root.prepend(panel);
} else if (!sandbox) {
  const link = document.createElement('a'); link.textContent = 'Experiences'; link.href = './experiences.html';
  document.querySelector('nav[aria-label="Workspace"]') .append(link);
}

return { experience, pxc: experience.pxc, devtools, sandbox: bridge };
}
