// The production layout of thro.pages.dev. Copies dist/ to the folder given; the editor moves to editor.html (its wordmark link
// follows it) and every other page keeps its path.
// With FRONT_DIR (attempts/thro-front/site, built by its run.sh), the disc search is the front page (Sam, 30 Oct: "a search bar
// and a feed of videos underneath it") and the survey stays at /ask. Without it, the ask page is the front page, as before
// (Sam, 24 Oct 19:18: "make this thro.pages.dev as the main and only page; other things are still there").
// Usage: node production-layout.mjs OUT_DIR [FRONT_DIR]
import fs from 'node:fs';
const [out, front] = process.argv.slice(2);
if (!out) throw Error('Usage: node production-layout.mjs OUT_DIR [FRONT_DIR]');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(new URL('./dist/', import.meta.url), out, { recursive: true });
for (const stale of ['_worker.js', 'ask-results.html']) fs.rmSync(`${out}/${stale}`, { force: true });
const editor = fs.readFileSync(`${out}/index.html`, 'utf8').replaceAll('href="./index.html"', 'href="./editor.html"');
fs.writeFileSync(`${out}/editor.html`, editor);
if (front) {
  const files = ['index.html', 'front.css', 'front.mjs', 'feed.json'];
  for (const f of files) if (!fs.existsSync(`${front}/${f}`)) throw Error(`${front}/${f} is missing; run attempts/thro-front/run.sh build first`);
  for (const f of files.slice(1)) if (fs.existsSync(`${out}/${f}`)) throw Error(`${out}/${f} already exists in dist/; the front page would overwrite it`);
  for (const f of files) fs.copyFileSync(`${front}/${f}`, `${out}/${f}`);
  console.log(`${out}: index.html is the disc search; the survey is ask.html; the editor is editor.html`);
} else {
  fs.copyFileSync(`${out}/ask.html`, `${out}/index.html`);
  console.log(`${out}: index.html is the ask page; the editor is editor.html`);
}
