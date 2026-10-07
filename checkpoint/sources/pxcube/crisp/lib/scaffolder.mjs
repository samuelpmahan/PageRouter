import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BUILD_SCRIPT = `import { mkdirSync, cpSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
cpSync('src', 'dist', { recursive: true });
console.log('built');
`;

function indexSkeleton(title, mounts) {
  const reads = mounts.length > 0
    ? mounts.map((m) => `<!-- reads ${m}.px.* -->`).join('\n')
    : '<!-- no mounts declared -->';
  return `<!doctype html>
<html><body>
<h1>${title}</h1>
${reads}
</body></html>
`;
}

// Generate a fresh experience folder with the canonical layout crisp knows how
// to compile. Called on `neat add` (via crisp as the go-between) so the folder
// crisp later builds is one crisp itself authored: no layout discovery, no
// guessing. Refuses to touch a directory that already has content.
export async function scaffoldApp(dir, { title = 'Untitled', mounts = [], source = null } = {}) {
  let existing = [];
  try {
    const { readdir } = await import('node:fs/promises');
    existing = await readdir(dir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing.length > 0) {
    throw new Error(`scaffold: refusing to overwrite non-empty directory ${dir}`);
  }
  const manifest = {
    title,
    version: '0.0.1',
    description: '',
    mounts,
    entry: 'src/index.html',
    build: 'node build.mjs',
    outDir: 'dist',
    sandbox: ['allow-scripts'],
  };
  if (source) manifest.source = source; // tidy registry pointer, e.g. "exp/hello"
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'experience.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(dir, 'src', 'index.html'), indexSkeleton(title, mounts));
  await writeFile(join(dir, 'build.mjs'), BUILD_SCRIPT);
  return {
    dir,
    files: ['experience.json', 'src/index.html', 'build.mjs'],
    manifest,
  };
}
