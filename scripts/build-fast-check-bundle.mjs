import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const vendor = path.join(root, 'vendor/hh/src/vendor');
const fastCheckVersion = '4.10.2';
const sourceCommit = 'c77afa8277a67250d798c52e61343b8ed5fd268b';
const bundleName = `fast-check-${fastCheckVersion}.bundle.mjs`;
const metadataName = `fast-check-${fastCheckVersion}.meta.mjs`;
const provenanceName = `fast-check-${fastCheckVersion}.provenance.json`;
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const locked = (name, expectedVersion) => {
  const record = lock.packages[`node_modules/${name}`];
  if (!record || record.version !== expectedVersion || !record.resolved?.startsWith('https://registry.npmjs.org/') || !record.integrity) {
    throw new Error(`The official registry lock for ${name}@${expectedVersion} is missing or inconsistent.`);
  }
  return record;
};
const fastCheck = locked('fast-check', fastCheckVersion);
const pureRand = locked('pure-rand', '8.4.2');
const esbuild = locked('esbuild', '0.28.2');
if (rootPackage.devDependencies?.['fast-check'] !== fastCheckVersion || rootPackage.devDependencies?.esbuild !== '0.28.2') {
  throw new Error('package.json must pin fast-check and esbuild exactly before bundling.');
}
const fastCheckPackage = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/fast-check/package.json'), 'utf8'));
const pureRandPackage = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/pure-rand/package.json'), 'utf8'));
const esbuildPackage = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/esbuild/package.json'), 'utf8'));
if (fastCheckPackage.version !== fastCheckVersion || fastCheckPackage.license !== 'MIT' ||
    pureRandPackage.version !== pureRand.version || pureRandPackage.license !== 'MIT' ||
    esbuildPackage.version !== esbuild.version) throw new Error('Installed package metadata does not match package-lock.json.');

fs.mkdirSync(vendor, {recursive: true});
const bundlePath = path.join(vendor, bundleName);
const entry = fileURLToPath(import.meta.resolve('fast-check'));
const result = await build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundlePath,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  treeShaking: true,
  legalComments: 'inline',
  charset: 'utf8',
  sourcemap: false,
  metafile: true,
  logLevel: 'silent',
});
const outputMeta = Object.values(result.metafile.outputs).find((output) => output.entryPoint && output.entryPoint.endsWith('fast-check.js'));
if (!outputMeta || outputMeta.imports.length) throw new Error('The local browser bundle contains unresolved external imports.');
const bytes = fs.readFileSync(bundlePath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const styleSources = Object.fromEntries([
  'vendor/hh/services/style-playground.mjs',
  'vendor/hh/src/style-playground.mjs',
  'vendor/hh/src/styles.css',
  'vendor/hh/src/pxc-devtools/devtools.mjs',
  'vendor/hh/src/pxc-devtools/devtools.css',
  'vendor/hh/src/app.mjs',
].sort().map((relative) => {
  const source = fs.readFileSync(path.join(root, relative));
  return [relative, createHash('sha256').update(source).digest('hex')];
}));
const stylePin = `sha256:${createHash('sha256').update(JSON.stringify(styleSources)).digest('hex')}`;
const metadata = {name: 'fast-check', version: fastCheckVersion, pin: `sha256:${sha256}`, sourceCommit, stylePin};
fs.writeFileSync(path.join(vendor, metadataName), `export default Object.freeze(${JSON.stringify(metadata)});\n`);
const provenance = {
  schema: 'hh-self-hosted-dependency@1',
  package: {name: 'fast-check', version: fastCheckVersion, registry: 'https://registry.npmjs.org/',
    resolved: fastCheck.resolved, integrity: fastCheck.integrity, sourceCommit, license: fastCheckPackage.license},
  dependencies: [{name: 'pure-rand', version: pureRand.version, resolved: pureRand.resolved,
    integrity: pureRand.integrity, license: pureRandPackage.license}],
  bundle: {file: bundleName, format: 'browser-esm', bytes: bytes.byteLength, sha256,
    importIntegrity: metadata.pin, externalImports: outputMeta.imports},
  styleImplementation: {pin: stylePin, files: styleSources},
  buildTool: {name: 'esbuild', version: esbuild.version, resolved: esbuild.resolved,
    integrity: esbuild.integrity},
};
fs.writeFileSync(path.join(vendor, provenanceName), `${JSON.stringify(provenance, null, 2)}\n`);
fs.copyFileSync(path.join(root, 'node_modules/fast-check/LICENSE'), path.join(vendor, `fast-check-${fastCheckVersion}.LICENSE.txt`));
fs.copyFileSync(path.join(root, 'node_modules/pure-rand/LICENSE'), path.join(vendor, `pure-rand-${pureRand.version}.LICENSE.txt`));
console.log(JSON.stringify({bundle: bundlePath, bytes: bytes.byteLength, pin: metadata.pin,
  dependencies: provenance.dependencies.map(({name, version}) => `${name}@${version}`)}, null, 2));
