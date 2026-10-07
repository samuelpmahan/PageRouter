import { openExperience } from './persistent-experience.ts';
import { startSandbox } from './experience-fixtures.ts';
import { mountExperiencePage } from './experience-page.ts';
const $ = (id: string) => document.getElementById(id)!;
const requested = new URLSearchParams(location.search).get('sandbox');
const sandbox = requested === 'upload' || requested === 'shelf' ? requested : null;
const lines: string[] = [];
const log = (event: Record<string, unknown>) => {
  const line = JSON.stringify(event);
  console.info(line);
  lines.push(line); $('receipts').textContent = lines.join('\n');
  if (!sandbox) fetch('/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: line }).catch(() => console.warn('Terminal logging unavailable; receipt retained in PxC and console.'));
};
const experience = sandbox ? await startSandbox(sandbox, log) : await openExperience({ getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }, log);
await mountExperiencePage(experience, { sandbox });
