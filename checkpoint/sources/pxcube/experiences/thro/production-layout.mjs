// The production layout of thro.pages.dev (Sam, 24 Oct 19:18: "make this thro.pages.dev as the main and only page; other things
// are still there"). Copies dist/ to the folder given and makes the ask page the front page: index.html is ask.html, and the editor
// moves to editor.html (its wordmark link follows it). Every other page keeps its path. Usage: node production-layout.mjs OUT_DIR
import fs from 'node:fs';
const out = process.argv[2];
if (!out) throw Error('Usage: node production-layout.mjs OUT_DIR');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(new URL('./dist/', import.meta.url), out, { recursive: true });
for (const stale of ['_worker.js', 'ask-results.html']) fs.rmSync(`${out}/${stale}`, { force: true });
const editor = fs.readFileSync(`${out}/index.html`, 'utf8').replaceAll('href="./index.html"', 'href="./editor.html"');
fs.writeFileSync(`${out}/editor.html`, editor);
fs.copyFileSync(`${out}/ask.html`, `${out}/index.html`);
console.log(`${out}: index.html is the ask page; the editor is editor.html`);
