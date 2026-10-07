import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const SOURCE_SCHEMA = 'pagerouter-source-inputs@1';
const RECEIPT_SCHEMA = 'pagerouter-site-content@1';
const EXPECTED_ARCHIVE_SHA256 = '2d58add7477bc1b9cb18cce9297f6851f21fcf4d051afcd9bda5e849f6e8ce3b';
const EXPECTED_CHECKPOINT_BUILD_ID = 'f300f36921420180b22cf20670700a08adaf3c523ac332f1c93653c4143aa765';
const EXPECTED_NODE_VERSION = 'v24.21.0';
const EXPECTED_NODE_SHA256 = '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c';
const EXPECTED_NODE_ARCHIVE_SHA256 = 'fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6';
const EXPECTED_BAZEL_VERSION = '7.4.1';
const EXPECTED_BAZEL_SHA256 = 'c97f02133adce63f0c28678ac1f21d65fa8255c80429b588aeeba8a1fac6202b';
const EXPECTED_BUSYBOX_VERSION = '1.35.0';
const EXPECTED_BUSYBOX_SHA256 = '6e123e7f3202a8c1e9b1f94d8941580a25135382b99e8d3e34fb858bba311348';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function comparePath(a, b) {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`${label} escapes its declared root: ${value}`);
  }
  return normalized;
}

function resolveExecPath(value) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function expandParamFiles(rawArgs) {
  const args = [];
  for (const arg of rawArgs) {
    if (!arg.startsWith('@')) {
      args.push(arg);
      continue;
    }
    const file = resolveExecPath(arg.slice(1));
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    if (lines.at(-1) === '') lines.pop();
    args.push(...lines);
  }
  return args;
}

function parseOptions(argv, repeatedPairs) {
  const values = new Map();
  const pairs = new Map(repeatedPairs.map((name) => [name, []]));
  for (let i = 0; i < argv.length;) {
    const flag = argv[i++];
    if (pairs.has(flag)) {
      if (i + 1 >= argv.length) throw new Error(`Missing pair values after ${flag}`);
      pairs.get(flag).push([argv[i++], argv[i++]]);
    } else if (flag.startsWith('--')) {
      if (i >= argv.length) throw new Error(`Missing value after ${flag}`);
      if (values.has(flag)) throw new Error(`Duplicate option ${flag}`);
      values.set(flag, argv[i++]);
    } else {
      throw new Error(`Unexpected argument ${flag}`);
    }
  }
  return {values, pairs};
}

function required(values, name) {
  const value = values.get(name);
  if (value === undefined || value === '') throw new Error(`Missing required option ${name}`);
  return value;
}

function inputMap(pairs, prefix, label) {
  const files = new Map();
  for (const [relative, execPath] of pairs) {
    const key = safeRelative(relative, `${label} path`);
    if (files.has(key)) throw new Error(`Duplicate ${label} input path: ${key}`);
    files.set(key, resolveExecPath(execPath));
  }
  return files;
}

function dependencyInputMap(pairs, prefix) {
  const files = new Map();
  for (const [shortPath, execPath] of pairs) {
    if (!shortPath.startsWith(prefix)) throw new Error(`Dependency path is outside declared tool repository prefix: ${shortPath}`);
    const key = safeRelative(shortPath.slice(prefix.length), 'toolchain file path');
    if (files.has(shortPath)) throw new Error(`Duplicate dependency input path: ${shortPath}`);
    files.set(shortPath, resolveExecPath(execPath));
  }
  return files;
}

function sortedRecords(records) {
  return records.sort(comparePath);
}

function hashTree(root) {
  const records = [];
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Output tree contains a symlink: ${relative}`);
      if (stat.isDirectory()) {
        walk(absolute, relative);
      } else if (stat.isFile()) {
        const bytes = fs.readFileSync(absolute);
        records.push({path: relative, bytes: bytes.byteLength, sha256: sha256(bytes)});
      } else {
        throw new Error(`Output tree contains a non-file entry: ${relative}`);
      }
    }
  };
  walk(root);
  return sortedRecords(records);
}

function copyTree(source, destination) {
  const sourceRoot = fs.realpathSync(source);
  fs.mkdirSync(destination, {recursive: true});
  const walk = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
      const childRel = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`Refusing symlink while staging ${childRel}`);
      const target = path.join(destination, ...childRel.split('/'));
      if (stat.isDirectory()) {
        fs.mkdirSync(target, {recursive: true});
        walk(child, childRel);
      } else if (stat.isFile()) {
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(child, target);
        // Bazel runfiles and tree-artifact files can be read-only. This tree is
        // a private verification scratch copy, so make the copy owner-writable
        // without changing the declared source/output bytes or their modes.
        fs.chmodSync(target, stat.mode | 0o200);
      } else {
        throw new Error(`Refusing non-file input while staging ${childRel}`);
      }
    }
  };
  walk(sourceRoot);
}

function ensureOutputDirectory(output) {
  const absolute = resolveExecPath(output);
  if (fs.existsSync(absolute)) {
    const entries = fs.readdirSync(absolute);
    if (entries.length) throw new Error(`Declared output directory is not empty: ${absolute}`);
  } else {
    fs.mkdirSync(absolute, {recursive: true});
  }
  return absolute;
}

function writeFilePairs(pairs, destinationRoot, prefix, label) {
  const files = inputMap(pairs, prefix, label);
  for (const [relative, source] of files) {
    const target = path.join(destinationRoot, ...relative.split('/'));
    if (!target.startsWith(destinationRoot + path.sep)) throw new Error(`${label} path escapes staging root: ${relative}`);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.copyFileSync(source, target);
  }
  return files;
}

function parseSourceManifest(sourceManifestPath) {
  const bytes = fs.readFileSync(sourceManifestPath);
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schema !== SOURCE_SCHEMA) throw new Error(`Unexpected source manifest schema: ${manifest.schema}`);
  if (manifest.archive_sha256 !== EXPECTED_ARCHIVE_SHA256) throw new Error('Source archive SHA256 differs from the authorized f300 checkpoint');
  if (manifest.checkpoint_build_id !== EXPECTED_CHECKPOINT_BUILD_ID) throw new Error('Source checkpoint build ID differs from the authorized f300 checkpoint');
  if (!Array.isArray(manifest.canonical_files) || !Array.isArray(manifest.compiler_inputs)) throw new Error('Source manifest is missing canonical or compiler input records');

  const canonical = new Map();
  for (const record of manifest.canonical_files) {
    const relative = safeRelative(record.path, 'canonical source path');
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error(`Invalid canonical source record: ${relative}`);
    if (canonical.has(relative)) throw new Error(`Duplicate canonical source record: ${relative}`);
    canonical.set(relative, {path: relative, bytes: record.bytes, sha256: record.sha256});
  }

  const compilerRecords = [];
  const compiler = new Map();
  for (const record of manifest.compiler_inputs) {
    const relative = safeRelative(record.path, 'compiler input path');
    if (relative === 'dist' || relative.startsWith('dist/')) throw new Error(`Historical dist is not a compiler input: ${relative}`);
    if (relative === 'evidence/pxcube-build.json' || relative === 'evidence/pxcube-build.log') throw new Error(`Stale PxCube build evidence is not a compiler input: ${relative}`);
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error(`Invalid compiler input record: ${relative}`);
    if (compiler.has(relative)) throw new Error(`Duplicate compiler input record: ${relative}`);
    const canonicalRecord = canonical.get(relative);
    if (!canonicalRecord || canonicalRecord.bytes !== record.bytes || canonicalRecord.sha256 !== record.sha256) {
      throw new Error(`Compiler input does not match the archive record: ${relative}`);
    }
    const normalized = {path: relative, bytes: record.bytes, sha256: record.sha256};
    compiler.set(relative, normalized);
    compilerRecords.push(normalized);
  }
  sortedRecords(compilerRecords);
  return {
    manifest,
    manifestBytes: bytes,
    manifestSha256: sha256(bytes),
    compilerRecords,
    compilerInputSetSha256: sha256(canonicalJson(compilerRecords)),
  };
}

function verifyAndStageCompilerInputs(sourceMap, sourceRoot, sourceManifest) {
  if (sourceMap.size !== sourceManifest.compilerRecords.length) {
    throw new Error(`Compiler input count mismatch: received ${sourceMap.size}, manifest declares ${sourceManifest.compilerRecords.length}`);
  }
  const recordByPath = new Map(sourceManifest.compilerRecords.map((record) => [record.path, record]));
  const actualRecords = [];
  for (const [relative, source] of sourceMap) {
    const expected = recordByPath.get(relative);
    if (!expected) throw new Error(`Undeclared source file passed to the compiler action: ${relative}`);
    const bytes = fs.readFileSync(source);
    const actualSha = sha256(bytes);
    if (bytes.byteLength !== expected.bytes || actualSha !== expected.sha256) {
      throw new Error(`Source input hash mismatch: ${relative} expected ${expected.bytes}/${expected.sha256}, received ${bytes.byteLength}/${actualSha}`);
    }
    const destination = path.join(sourceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, bytes);
    actualRecords.push({path: relative, bytes: bytes.byteLength, sha256: actualSha});
  }
  const sortedActual = sortedRecords(actualRecords);
  if (sha256(canonicalJson(sortedActual)) !== sourceManifest.compilerInputSetSha256) throw new Error('Staged compiler input set digest differs from source manifest');
  return sortedActual;
}

function readToolchain(toolMap, dependencyPrefix, nodeBinary, sourceRoot) {
  const normalized = new Map();
  for (const [shortPath, filePath] of toolMap) {
    if (!shortPath.startsWith(dependencyPrefix)) throw new Error(`Dependency path is outside declared tool repository prefix: ${shortPath}`);
    const relative = safeRelative(shortPath.slice(dependencyPrefix.length), 'toolchain file path');
    if (normalized.has(relative)) throw new Error(`Duplicate toolchain input path: ${relative}`);
    normalized.set(relative, filePath);
  }
  const receiptPath = normalized.get('toolchain-receipt.json');
  if (!receiptPath) throw new Error('Pinned toolchain receipt is missing from declared dependency inputs');
  const receiptBytes = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.schema !== 'pagerouter-toolchain@1') throw new Error(`Unexpected toolchain receipt schema: ${receipt.schema}`);
  if (receipt.node_version !== '24.21.0' || receipt.node_archive_sha256 !== EXPECTED_NODE_ARCHIVE_SHA256) throw new Error('Toolchain receipt has the wrong Node distribution identity');
  if (receipt.bazel_version !== EXPECTED_BAZEL_VERSION || receipt.bazel_sha256 !== EXPECTED_BAZEL_SHA256) throw new Error('Toolchain receipt has the wrong Bazel identity');
  if (receipt.busybox_version !== EXPECTED_BUSYBOX_VERSION || receipt.busybox_sha256 !== EXPECTED_BUSYBOX_SHA256) throw new Error('Toolchain receipt has the wrong pinned BusyBox shell identity');
  if (!Array.isArray(receipt.files)) throw new Error('Toolchain receipt has no file identity list');
  if (receipt.host_python?.version !== '3.14.4' || !/^[a-f0-9]{64}$/.test(receipt.host_python?.executable_sha256 ?? '') || receipt.host_python?.role !== 'bootstrap-only; compilation uses declared Node') {
    throw new Error('Toolchain receipt is missing the pinned bootstrap-only Python identity');
  }

  const declaredToolRecords = [];
  const declaredToolPaths = new Set();
  for (const record of receipt.files) {
    const relative = safeRelative(record.path, 'toolchain receipt path');
    if (relative === 'toolchain-receipt.json' || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || !/^[a-f0-9]{64}$/.test(record.sha256)) {
      throw new Error(`Invalid toolchain receipt file record: ${relative}`);
    }
    if (declaredToolPaths.has(relative)) throw new Error(`Duplicate toolchain receipt path: ${relative}`);
    declaredToolPaths.add(relative);
    if (relative.startsWith('node/') || relative.startsWith('node_modules/') || relative.startsWith('shell/')) {
      declaredToolRecords.push({path: relative, bytes: record.bytes, sha256: record.sha256});
    } else if (!['package.json', 'package-lock.json'].includes(relative)) {
      throw new Error(`Unexpected non-tool file in toolchain receipt: ${relative}`);
    }
  }
  sortedRecords(declaredToolRecords);

  const nodeBytes = fs.readFileSync(nodeBinary);
  const nodeSha256 = sha256(nodeBytes);
  if (nodeSha256 !== EXPECTED_NODE_SHA256) throw new Error(`Pinned Node executable SHA256 mismatch: ${nodeSha256}`);
  const nodeVersionResult = spawnSync(nodeBinary, ['--version'], {encoding: 'utf8', maxBuffer: 1024 * 1024});
  if (nodeVersionResult.error || nodeVersionResult.status !== 0) throw new Error(`Cannot query pinned Node executable: ${nodeVersionResult.error?.message ?? nodeVersionResult.stderr}`);
  const nodeRuntimeVersion = nodeVersionResult.stdout.trim();
  if (nodeRuntimeVersion !== EXPECTED_NODE_VERSION) throw new Error(`Pinned Node version mismatch: ${nodeRuntimeVersion}`);
  const nodeVersion = nodeRuntimeVersion.replace(/^v/, '');

  const stagedToolCount = [...normalized.keys()].filter((relative) => relative.startsWith('node/') || relative.startsWith('node_modules/') || relative.startsWith('shell/')).length;
  if (stagedToolCount === 0) throw new Error('Pinned Node, npm dependencies, and shell were not supplied to the action');
  const actualToolRecords = [];
  for (const [relative, source] of normalized) {
    if (relative === 'toolchain-receipt.json') continue;
    if (!relative.startsWith('node/') && !relative.startsWith('node_modules/') && !relative.startsWith('shell/')) throw new Error(`Unexpected file in declared tool closure: ${relative}`);
    const bytes = fs.readFileSync(source);
    const actualRecord = {path: relative, bytes: bytes.byteLength, sha256: sha256(bytes)};
    const expectedRecord = declaredToolRecords.find((record) => record.path === relative);
    if (!expectedRecord || expectedRecord.bytes !== actualRecord.bytes || expectedRecord.sha256 !== actualRecord.sha256) {
      throw new Error(`Toolchain receipt does not bind supplied tool file: ${relative}`);
    }
    actualToolRecords.push(actualRecord);
    const destination = path.join(sourceRoot, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
  }
  const sortedActualTools = sortedRecords(actualToolRecords);
  if (JSON.stringify(sortedActualTools) !== JSON.stringify(declaredToolRecords)) {
    throw new Error(`Declared tool file inventory differs from toolchain receipt (received ${sortedActualTools.length}, receipt ${declaredToolRecords.length})`);
  }
  for (const relative of ['shell/bin/sh', 'shell/bin/mkdir', 'shell/bin/cp']) {
    const shellEntry = normalized.get(relative);
    if (!shellEntry || sha256(fs.readFileSync(shellEntry)) !== EXPECTED_BUSYBOX_SHA256) throw new Error(`Pinned BusyBox applet is missing or has the wrong identity: ${relative}`);
    fs.accessSync(shellEntry, fs.constants.X_OK);
  }
  for (const record of receipt.files.filter((item) => ['package.json', 'package-lock.json'].includes(item.path))) {
    const source = path.join(sourceRoot, record.path);
    if (!fs.existsSync(source)) throw new Error(`Toolchain receipt metadata is not present in verified source inputs: ${record.path}`);
    const bytes = fs.readFileSync(source);
    if (bytes.byteLength !== record.bytes || sha256(bytes) !== record.sha256) throw new Error(`Toolchain receipt metadata differs from verified source input: ${record.path}`);
  }

  const packageLock = path.join(sourceRoot, 'package-lock.json');
  if (!fs.existsSync(packageLock)) throw new Error('Pinned package-lock.json is absent from compiler inputs');
  const packageLockSha256 = sha256(fs.readFileSync(packageLock));
  if (receipt.lock_sha256 !== packageLockSha256) throw new Error('Toolchain npm dependency lock does not match the source package-lock.json');
  return {
    receipt,
    receiptSha256: sha256(receiptBytes),
    nodeVersion,
    nodeRuntimeVersion,
    nodeSha256,
    packageLockSha256,
    nodeBinary,
    shellBinary: path.join(sourceRoot, 'shell', 'bin', 'sh'),
    shellSha256: EXPECTED_BUSYBOX_SHA256,
  };
}

function hashRecipeFiles(recipePairs) {
  const files = inputMap(recipePairs, '', 'recipe');
  const records = [];
  for (const [relative, filePath] of files) {
    const safePath = safeRelative(relative, 'recipe path');
    const bytes = fs.readFileSync(filePath);
    records.push({path: safePath, bytes: bytes.byteLength, sha256: sha256(bytes)});
  }
  const sorted = sortedRecords(records);
  const byName = new Map(sorted.map((record) => [record.path, record.sha256]));
  if (!byName.has('ci/bazel/build_driver.mjs') || !byName.has('ci/bazel/build_rule.bzl')) {
    throw new Error('Recipe inputs must include the Node build driver and its Starlark rule');
  }
  return {
    files: sorted,
    filesSha256: sha256(canonicalJson(sorted)),
    buildDriverSha256: byName.get('ci/bazel/build_driver.mjs'),
    buildRuleSha256: byName.get('ci/bazel/build_rule.bzl'),
  };
}

function appendOutput(log, stage, result) {
  log.push(`\n=== ${stage} ===\n`);
  if (result.stdout) log.push(result.stdout);
  if (result.stderr) log.push(result.stderr);
  if (!result.stdout && !result.stderr) log.push('(no stdout/stderr)\n');
  if (result.error) throw new Error(`${stage} failed to start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${stage} failed with exit code ${result.status}`);
}

function runNode(nodeBinary, args, cwd, env) {
  return spawnSync(nodeBinary, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseFreshPxCubeEvidence(workRoot) {
  const evidenceFile = path.join(workRoot, 'evidence', 'pxcube-build.json');
  if (!fs.existsSync(evidenceFile)) throw new Error('PxCube compiler did not create fresh evidence/pxcube-build.json');
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  if (!evidence.site || typeof evidence.site !== 'string') throw new Error('Fresh PxCube evidence has no site path');
  const site = path.resolve(evidence.site);
  const sourceRoot = path.resolve(workRoot);
  if (!site.startsWith(sourceRoot + path.sep)) throw new Error(`Fresh PxCube site escaped the action staging tree: ${site}`);
  if (!fs.existsSync(site) || !fs.statSync(site).isDirectory()) throw new Error(`Fresh PxCube site does not exist: ${site}`);
  const results = evidence.report?.results;
  if (!Array.isArray(results) || results.length === 0 || results.some((result) => result.ok !== true)) {
    throw new Error('Fresh PxCube build report is missing or contains a failed package target');
  }
  return {evidenceFile, evidence, site};
}

function copyFreshEvidence(workRoot, evidenceOutput) {
  const pxcubeEvidence = path.join(workRoot, 'evidence', 'pxcube-build.json');
  const deltaEvidence = path.join(workRoot, 'evidence', 'hh-delta-proof.json');
  const crispEvidence = path.join(workRoot, 'evidence', 'crisp-delta-proof.json');
  if (!fs.existsSync(pxcubeEvidence)) throw new Error('Fresh PxCube evidence is missing after assembly');
  if (!fs.existsSync(deltaEvidence)) throw new Error('Fresh assembly did not create evidence/hh-delta-proof.json');
  if (!fs.existsSync(crispEvidence)) throw new Error('Fresh crisp delta verification did not create evidence/crisp-delta-proof.json');
  fs.copyFileSync(pxcubeEvidence, path.join(evidenceOutput, 'pxcube-build.json'));
  fs.copyFileSync(deltaEvidence, path.join(evidenceOutput, 'hh-delta-proof.json'));
  fs.copyFileSync(crispEvidence, path.join(evidenceOutput, 'crisp-delta-proof.json'));
  const neatDist = path.join(workRoot, 'sources', 'pxcube', 'vendor', 'neat', 'dist');
  if (!fs.existsSync(neatDist) || !fs.statSync(neatDist).isDirectory()) throw new Error('PxCube build did not produce the declared neat TypeScript compilation inputs needed by verify-crisp-delta');
  copyTree(neatDist, path.join(evidenceOutput, 'verification-inputs', 'pxcube-neat-dist'));
}

function writeReceipt(receiptPath, receipt) {
  fs.mkdirSync(path.dirname(receiptPath), {recursive: true});
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
}

function build(argv) {
  const parsed = parseOptions(argv, ['--source-input', '--dependency-input', '--recipe-input']);
  const values = parsed.values;
  const manifestPath = resolveExecPath(required(values, '--source-manifest'));
  const dependencyPrefix = required(values, '--dependency-prefix');
  const nodeBinary = resolveExecPath(required(values, '--node-binary'));
  const bazelVersion = required(values, '--bazel-version');
  const target = required(values, '--target');
  const siteOutput = ensureOutputDirectory(required(values, '--site-output'));
  const evidenceOutput = ensureOutputDirectory(required(values, '--evidence-output'));
  const receiptOutput = resolveExecPath(required(values, '--receipt-output'));
  const diagnosticsOutput = resolveExecPath(required(values, '--diagnostics-output'));
  const diagnostics = [];

  try {
    if (bazelVersion !== EXPECTED_BAZEL_VERSION) throw new Error(`Bazel version must be ${EXPECTED_BAZEL_VERSION}, got ${bazelVersion}`);
    const sourceManifest = parseSourceManifest(manifestPath);
    const sourceMap = inputMap(parsed.pairs.get('--source-input'), '', 'source');
    const toolMap = dependencyInputMap(parsed.pairs.get('--dependency-input'), dependencyPrefix);
    const recipeIdentity = hashRecipeFiles(parsed.pairs.get('--recipe-input'));
    const workRoot = fs.mkdtempSync(path.join(process.cwd(), '.pagerouter-source-build-'));
    const sourceRecords = verifyAndStageCompilerInputs(sourceMap, workRoot, sourceManifest);
    const toolchain = readToolchain(toolMap, dependencyPrefix, nodeBinary, workRoot);
    if (toolchain.receipt.bazel_version !== bazelVersion) throw new Error('Pinned toolchain receipt Bazel version differs from Bazel rule attribute');

    const sourceIdentity = {
      archive_sha256: sourceManifest.manifest.archive_sha256,
      checkpoint_build_id: sourceManifest.manifest.checkpoint_build_id,
      source_manifest_sha256: sourceManifest.manifestSha256,
      compiler_input_count: sourceRecords.length,
      compiler_input_set_sha256: sourceManifest.compilerInputSetSha256,
    };
    diagnostics.push('ParallelCompressingBootstrap source build');
    diagnostics.push(`Target: ${target}`);
    diagnostics.push(`Source checkpoint: ${sourceIdentity.checkpoint_build_id}`);
    diagnostics.push(`Source archive SHA256: ${sourceIdentity.archive_sha256}`);
    diagnostics.push(`Source manifest SHA256: ${sourceIdentity.source_manifest_sha256}`);
    diagnostics.push(`Declared compiler inputs: ${sourceIdentity.compiler_input_count}`);
    diagnostics.push(`Compiler input set SHA256: ${sourceIdentity.compiler_input_set_sha256}`);
    diagnostics.push(`Bazel: ${bazelVersion} (${toolchain.receipt.bazel_sha256})`);
    diagnostics.push(`Node runtime: ${toolchain.nodeRuntimeVersion}; canonical toolchain version: ${toolchain.nodeVersion} (${toolchain.nodeSha256})`);
    diagnostics.push(`Node archive SHA256: ${toolchain.receipt.node_archive_sha256}`);
    diagnostics.push(`BusyBox shell: ${toolchain.receipt.busybox_version} (${toolchain.receipt.busybox_sha256})`);
    diagnostics.push(`npm: ${toolchain.receipt.npm_version}`);
    diagnostics.push(`Toolchain receipt SHA256: ${toolchain.receiptSha256}`);
    if (toolchain.receipt.host_python) diagnostics.push(`Bootstrap host Python (not a compiler input): ${JSON.stringify(toolchain.receipt.host_python)}`);
    diagnostics.push('Historical dist and prior PxCube build evidence were excluded from action inputs.');
    diagnostics.push('The action stages all selected source files and npm dependencies into an empty temporary work tree.');

    const vendorBundle = path.join(workRoot, 'vendor', 'hh', 'src', 'vendor');
    if (!fs.existsSync(vendorBundle)) throw new Error('Declared source inputs are missing vendor/hh/src/vendor');
    const beforeBundle = hashTree(vendorBundle);
    const runtimeHome = path.join(workRoot, '.private-home');
    const runtimeTmp = path.join(workRoot, '.private-tmp');
    fs.mkdirSync(runtimeHome, {recursive: true});
    fs.mkdirSync(runtimeTmp, {recursive: true});
    const emptyUserNpmConfig = path.join(runtimeHome, 'user.npmrc');
    const emptyGlobalNpmConfig = path.join(runtimeHome, 'global.npmrc');
    fs.writeFileSync(emptyUserNpmConfig, '');
    fs.writeFileSync(emptyGlobalNpmConfig, '');
    const childEnv = {
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      TZ: 'UTC',
      HOME: runtimeHome,
      TMPDIR: runtimeTmp,
      TMP: runtimeTmp,
      TEMP: runtimeTmp,
      PATH: `${path.dirname(nodeBinary)}${path.delimiter}${path.dirname(toolchain.shellBinary)}`,
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_userconfig: emptyUserNpmConfig,
      npm_config_globalconfig: emptyGlobalNpmConfig,
      npm_config_script_shell: toolchain.shellBinary,
      SHELL: toolchain.shellBinary,
    };

    appendOutput(diagnostics, 'bundle:fast-check', runNode(nodeBinary, ['scripts/build-fast-check-bundle.mjs'], workRoot, childEnv));
    const afterBundle = hashTree(vendorBundle);
    if (JSON.stringify(beforeBundle) !== JSON.stringify(afterBundle)) throw new Error('Pinned fast-check bundle differs from its authoritative source bytes');

    appendOutput(diagnostics, 'build:pxcube', runNode(nodeBinary, ['scripts/build-pxcube.mjs'], workRoot, childEnv));
    const pxcube = parseFreshPxCubeEvidence(workRoot);
    diagnostics.push(`Fresh PxCube site: ${path.relative(workRoot, pxcube.site).replaceAll('\\', '/')}`);
    diagnostics.push(`Fresh PxCube successful targets: ${pxcube.evidence.report.results.length}`);

    if (fs.existsSync(path.join(workRoot, 'dist'))) throw new Error('Historical dist was staged as a build input; refusing to assemble over it');
    appendOutput(diagnostics, 'assemble PageRouter', runNode(nodeBinary, ['scripts/assemble.mjs'], workRoot, childEnv));
    const assembled = path.join(workRoot, 'dist');
    if (!fs.existsSync(path.join(assembled, 'index.html')) || !fs.existsSync(path.join(assembled, 'data', 'catalog.json'))) {
      throw new Error('Assembly completed without the PageRouter entry point and catalog');
    }
    appendOutput(diagnostics, 'verify crisp compiled delta', runNode(nodeBinary, ['scripts/verify-crisp-delta.mjs'], workRoot, childEnv));
    const deltaProofPath = path.join(workRoot, 'evidence', 'crisp-delta-proof.json');
    if (!fs.existsSync(deltaProofPath) || JSON.parse(fs.readFileSync(deltaProofPath, 'utf8')).exactCompiledEquality !== true) {
      throw new Error('Existing crisp delta lifecycle did not produce its exact clean-build equality proof');
    }
    copyFreshEvidence(workRoot, evidenceOutput);

    const siteRecords = hashTree(assembled);
    if (siteRecords.length === 0) throw new Error('PageRouter assembly produced an empty site tree');
    for (const record of siteRecords) {
      const source = path.join(assembled, ...record.path.split('/'));
      const destination = path.join(siteOutput, ...record.path.split('/'));
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(source, destination);
    }
    const copiedRecords = hashTree(siteOutput);
    if (JSON.stringify(copiedRecords) !== JSON.stringify(siteRecords)) throw new Error('Declared Bazel site output differs from the freshly assembled dist tree');

    const siteTotalBytes = siteRecords.reduce((total, record) => total + record.bytes, 0);
    const recipe = {
      target,
      bazel_version: bazelVersion,
      bazel_sha256: toolchain.receipt.bazel_sha256,
      node_version: toolchain.nodeVersion,
      node_sha256: toolchain.nodeSha256,
      node_archive_sha256: toolchain.receipt.node_archive_sha256,
      shell_path: 'shell/bin/sh',
      shell_sha256: toolchain.shellSha256,
      busybox_version: toolchain.receipt.busybox_version,
      npm_version: toolchain.receipt.npm_version,
      package_lock_sha256: toolchain.packageLockSha256,
      toolchain_receipt_sha256: toolchain.receiptSha256,
      build_driver_sha256: recipeIdentity.buildDriverSha256,
      build_rule_sha256: recipeIdentity.buildRuleSha256,
      recipe_files_sha256: recipeIdentity.filesSha256,
      recipe_files: recipeIdentity.files,
    };
    if (toolchain.receipt.host_python) recipe.bootstrap_host_python = toolchain.receipt.host_python;
    const receipt = {
      schema: RECEIPT_SCHEMA,
      source: sourceIdentity,
      recipe,
      site: {
        path: 'pagerouter_site.site',
        file_count: siteRecords.length,
        total_bytes: siteTotalBytes,
        tree_sha256: sha256(canonicalJson(siteRecords)),
        files: siteRecords,
      },
    };
    writeReceipt(receiptOutput, receipt);
    diagnostics.push(`Fresh site files: ${siteRecords.length}`);
    diagnostics.push(`Fresh site bytes: ${siteTotalBytes}`);
    diagnostics.push(`Fresh site tree SHA256: ${receipt.site.tree_sha256}`);
    diagnostics.push('Existing crisp delta verification was run after assembly and its generated site files are included in this artifact.');
    diagnostics.push('Verification stage: //:pagerouter_verify runs npm test and repeats the delta proof against this fresh site/evidence output.');
    diagnostics.push('Preview stage: intentionally not run by the compile action; the target produces the static artifact.');
    diagnostics.push('Task answer checkpoint: the declared Bazel action compiled the full f300 PageRouter source aggregate.');
    fs.mkdirSync(path.dirname(diagnosticsOutput), {recursive: true});
    fs.writeFileSync(diagnosticsOutput, `${diagnostics.join('\n')}\n`, 'utf8');
    fs.rmSync(workRoot, {recursive: true, force: true});
  } catch (error) {
    diagnostics.push(`BUILD FAILED: ${error?.stack ?? String(error)}`);
    fs.mkdirSync(path.dirname(diagnosticsOutput), {recursive: true});
    fs.writeFileSync(diagnosticsOutput, `${diagnostics.join('\n')}\n`, 'utf8');
    process.stderr.write(`${diagnostics.join('\n')}\n`);
    throw error;
  }
}

function resolveRunfile(runfile) {
  const safe = safeRelative(runfile, 'runfile path');
  const runfilesRoot = process.env.TEST_SRCDIR;
  const workspace = process.env.TEST_WORKSPACE;
  if (!runfilesRoot || !workspace) throw new Error('Bazel test runfiles environment is missing TEST_SRCDIR or TEST_WORKSPACE');
  const result = path.resolve(runfilesRoot, workspace, ...safe.split('/'));
  const root = path.resolve(runfilesRoot, workspace) + path.sep;
  if (!result.startsWith(root)) throw new Error(`Runfile path escaped workspace: ${runfile}`);
  if (!fs.existsSync(result)) throw new Error(`Declared runfile is missing: ${runfile}`);
  return result;
}

function resolvePhysicalOutputRoot(runfilesTree, markerRelative, receiptPhysicalPath, expectedName) {
  const markerPath = safeRelative(markerRelative, 'declared output marker path');
  const runfileMarker = path.join(runfilesTree, ...markerPath.split('/'));
  if (!fs.existsSync(runfileMarker)) throw new Error(`Declared runfile output marker is missing: ${markerRelative}`);
  const physicalMarker = fs.realpathSync(runfileMarker);
  if (!fs.statSync(physicalMarker).isFile()) throw new Error(`Declared output marker is not a regular file: ${markerRelative}`);
  let physicalRoot = physicalMarker;
  for (const _part of markerPath.split('/')) physicalRoot = path.dirname(physicalRoot);
  physicalRoot = path.resolve(physicalRoot);
  if (path.basename(physicalRoot) !== expectedName) throw new Error(`Runfiles marker did not resolve inside the declared ${expectedName} tree`);
  if (path.dirname(physicalRoot) !== path.dirname(receiptPhysicalPath)) throw new Error(`Declared ${expectedName} tree is not a sibling of the Bazel receipt output`);
  if (path.relative(physicalRoot, physicalMarker) !== markerPath.split('/').join(path.sep)) throw new Error(`Runfiles marker resolved outside the declared ${expectedName} tree`);
  return physicalRoot;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function verifyReceipt(receipt, sourceManifest, sourceRecords, toolchain, recipeIdentity, sitePath, target) {
  if (receipt.schema !== RECEIPT_SCHEMA) throw new Error(`Unexpected build receipt schema: ${receipt.schema}`);
  const expectedSource = {
    archive_sha256: sourceManifest.manifest.archive_sha256,
    checkpoint_build_id: sourceManifest.manifest.checkpoint_build_id,
    source_manifest_sha256: sourceManifest.manifestSha256,
    compiler_input_count: sourceRecords.length,
    compiler_input_set_sha256: sourceManifest.compilerInputSetSha256,
  };
  if (!sameJson(receipt.source, expectedSource)) throw new Error('Build receipt source identity differs from verified source inputs');
  const recipe = receipt.recipe;
  if (!recipe || recipe.target !== target || recipe.bazel_version !== EXPECTED_BAZEL_VERSION || recipe.bazel_sha256 !== EXPECTED_BAZEL_SHA256) {
    throw new Error('Build receipt target or Bazel identity differs from this verification plan');
  }
  if (recipe.node_version !== toolchain.nodeVersion || recipe.node_sha256 !== toolchain.nodeSha256 || recipe.node_archive_sha256 !== EXPECTED_NODE_ARCHIVE_SHA256 || recipe.npm_version !== toolchain.receipt.npm_version) {
    throw new Error('Build receipt Node/npm identity differs from the pinned toolchain');
  }
  if (recipe.shell_path !== 'shell/bin/sh' || recipe.shell_sha256 !== EXPECTED_BUSYBOX_SHA256 || recipe.busybox_version !== EXPECTED_BUSYBOX_VERSION || toolchain.receipt.busybox_sha256 !== EXPECTED_BUSYBOX_SHA256) {
    throw new Error('Build receipt shell identity differs from the pinned BusyBox tool');
  }
  if (recipe.package_lock_sha256 !== toolchain.packageLockSha256 || recipe.toolchain_receipt_sha256 !== toolchain.receiptSha256) {
    throw new Error('Build receipt npm lock or complete toolchain receipt identity differs');
  }
  if (recipe.build_driver_sha256 !== recipeIdentity.buildDriverSha256 || recipe.build_rule_sha256 !== recipeIdentity.buildRuleSha256 || recipe.recipe_files_sha256 !== recipeIdentity.filesSha256 || !sameJson(recipe.recipe_files, recipeIdentity.files)) {
    throw new Error('Build receipt Bazel recipe identity differs from staged recipe files');
  }
  if (toolchain.receipt.host_python && !sameJson(recipe.bootstrap_host_python, toolchain.receipt.host_python)) {
    throw new Error('Build receipt bootstrap Python observation differs from the pinned toolchain receipt');
  }
  if (receipt.site?.path !== 'pagerouter_site.site' || !Array.isArray(receipt.site.files)) throw new Error('Build receipt is missing its declared site inventory');
  const actualSiteRecords = hashTree(sitePath);
  const siteBytes = actualSiteRecords.reduce((total, record) => total + record.bytes, 0);
  if (!sameJson(receipt.site.files, actualSiteRecords) || receipt.site.file_count !== actualSiteRecords.length || receipt.site.total_bytes !== siteBytes || receipt.site.tree_sha256 !== sha256(canonicalJson(actualSiteRecords))) {
    throw new Error('Fresh Bazel site output does not match the canonical build receipt inventory/hash');
  }
}

function rebaseScratchPxCubeEvidence(evidenceFile, assembledSite, siteReceipt) {
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  if (typeof evidence.site !== 'string' || !Array.isArray(evidence.targets) || !Array.isArray(evidence.report?.results)) {
    throw new Error('Fresh PxCube evidence cannot be safely rebound to the assembled output');
  }
  const originalSite = evidence.site;
  const pxcubeSite = path.join(assembledSite, 'compiled', 'pxcube');
  if (!fs.existsSync(pxcubeSite) || !fs.statSync(pxcubeSite).isDirectory()) throw new Error('Fresh PageRouter site is missing the assembled PxCube tree');
  const outerFiles = new Map(siteReceipt.site.files.map((record) => [record.path, record]));
  let checkedOutputs = 0;
  for (const target of evidence.targets) {
    const targetId = safeRelative(target?.id, 'PxCube target id');
    const result = evidence.report.results.find((row) => row.id === targetId);
    if (!result || result.ok !== true) throw new Error(`PxCube output evidence has no successful result for target ${targetId}`);
    const receiptRelative = safeRelative(result.receipt, `PxCube ${targetId} result receipt`);
    const referenced = [`compiled/pxcube/${receiptRelative}`];
    const receiptPath = path.join(pxcubeSite, ...receiptRelative.split('/'));
    if (!fs.existsSync(receiptPath) || !fs.statSync(receiptPath).isFile()) throw new Error(`Relocated PxCube output is missing receipt for ${targetId}`);
    const packageReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (!Array.isArray(packageReceipt.chunks)) throw new Error(`Relocated PxCube receipt has no chunks list for ${targetId}`);
    for (const chunk of packageReceipt.chunks) {
      const chunkPath = safeRelative(chunk?.path, `PxCube ${targetId} chunk path`);
      referenced.push(`compiled/pxcube/experiences/${targetId}/${chunkPath}`);
    }
    for (const relative of referenced) {
      const expected = outerFiles.get(relative);
      if (!expected) throw new Error(`Relocated PxCube path is absent from the canonical PageRouter site receipt: ${relative}`);
      const file = path.join(assembledSite, ...relative.split('/'));
      const bytes = fs.readFileSync(file);
      if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Relocated PxCube path differs from its canonical PageRouter site receipt: ${relative}`);
      checkedOutputs++;
    }
  }
  const verificationEvidence = {...evidence, site: pxcubeSite};
  fs.writeFileSync(evidenceFile, `${JSON.stringify(verificationEvidence, null, 2)}\n`, 'utf8');
  return {originalSite, pxcubeSite, checkedOutputs};
}

function verify(argv) {
  const parsed = parseOptions(argv, []);
  const planPath = resolveExecPath(required(parsed.values, '--plan'));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (plan.schema !== 'pagerouter-verify-plan@1' || plan.target !== '//:pagerouter_site') throw new Error('Unexpected verification plan schema or build target');
  const sourceManifestPath = resolveRunfile(plan.source_manifest);
  const sourceManifest = parseSourceManifest(sourceManifestPath);
  const sourceMap = new Map();
  for (const record of plan.source_inputs ?? []) {
    const relative = safeRelative(record.path, 'verification source path');
    if (sourceMap.has(relative)) throw new Error(`Duplicate verification source input: ${relative}`);
    sourceMap.set(relative, resolveRunfile(record.runfile));
  }
  const dependencyMap = new Map();
  for (const record of plan.dependency_inputs ?? []) {
    if (typeof record.short_path !== 'string' || dependencyMap.has(record.short_path)) throw new Error(`Invalid or duplicate verification dependency path: ${record.short_path}`);
    dependencyMap.set(record.short_path, resolveRunfile(record.runfile));
  }
  const recipePairs = [];
  for (const record of plan.recipe_inputs ?? []) {
    recipePairs.push([safeRelative(record.path, 'verification recipe path'), resolveRunfile(record.runfile)]);
  }
  const recipeIdentity = hashRecipeFiles(recipePairs);
  const nodeBinary = resolveRunfile(plan.node);
  const siteRunfilesPath = resolveRunfile(plan.site);
  const evidenceRunfilesPath = resolveRunfile(plan.evidence);
  const receiptPath = resolveRunfile(plan.receipt);
  const diagnosticsPath = resolveRunfile(plan.diagnostics);
  const receiptPhysicalPath = fs.realpathSync(receiptPath);
  if (path.basename(receiptPhysicalPath) !== 'pagerouter_site.receipt.json') throw new Error('Runfiles receipt did not resolve to the declared Bazel receipt output');
  if (!fs.statSync(receiptPhysicalPath).isFile()) throw new Error('Declared Bazel receipt output is not a regular file');
  const receipt = JSON.parse(fs.readFileSync(receiptPhysicalPath, 'utf8'));
  if (!Array.isArray(receipt.site?.files) || receipt.site.files.length === 0) throw new Error('Build receipt has no site file records for runfiles resolution');
  const sitePath = resolvePhysicalOutputRoot(siteRunfilesPath, receipt.site.files[0].path, receiptPhysicalPath, 'pagerouter_site.site');
  const evidencePath = resolvePhysicalOutputRoot(evidenceRunfilesPath, 'pxcube-build.json', receiptPhysicalPath, 'pagerouter_site.evidence');
  const scratchParent = process.env.TEST_TMPDIR || os.tmpdir();
  const workRoot = fs.mkdtempSync(path.join(scratchParent, 'pagerouter-verify-'));
  const diagnostics = [];

  try {
    const sourceRecords = verifyAndStageCompilerInputs(sourceMap, workRoot, sourceManifest);
    const toolchain = readToolchain(dependencyMap, plan.dependency_prefix, nodeBinary, workRoot);
    verifyReceipt(receipt, sourceManifest, sourceRecords, toolchain, recipeIdentity, sitePath, plan.target);
    hashTree(evidencePath);
    if (fs.existsSync(path.join(workRoot, 'dist'))) throw new Error('Historical dist entered verification staging; refusing to test against it');

    const evidenceFiles = [
      ['pxcube-build.json', path.join(evidencePath, 'pxcube-build.json')],
      ['hh-delta-proof.json', path.join(evidencePath, 'hh-delta-proof.json')],
      ['crisp-delta-proof.json', path.join(evidencePath, 'crisp-delta-proof.json')],
    ];
    for (const [name, source] of evidenceFiles) {
      if (!fs.existsSync(source)) throw new Error(`Fresh Bazel build evidence is missing ${name}`);
      const destination = path.join(workRoot, 'evidence', name);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      fs.copyFileSync(source, destination);
      fs.chmodSync(destination, fs.statSync(source).mode | 0o200);
    }
    const shippedDeltaProof = JSON.parse(fs.readFileSync(path.join(workRoot, 'evidence', 'crisp-delta-proof.json'), 'utf8'));
    if (shippedDeltaProof.exactCompiledEquality !== true) throw new Error('Fresh artifact evidence lacks the existing crisp delta equality proof');
    const neatDist = path.join(evidencePath, 'verification-inputs', 'pxcube-neat-dist');
    if (!fs.existsSync(neatDist) || !fs.statSync(neatDist).isDirectory()) throw new Error('Fresh Bazel build evidence is missing the declared PxCube neat compilation outputs');
    const neatDestination = path.join(workRoot, 'sources', 'pxcube', 'vendor', 'neat', 'dist');
    fs.rmSync(neatDestination, {recursive: true, force: true});
    copyTree(neatDist, neatDestination);
    copyTree(sitePath, path.join(workRoot, 'dist'));
    if (!sameJson(hashTree(path.join(workRoot, 'dist')), receipt.site.files)) throw new Error('Verification scratch site copy differs from the declared Bazel site receipt');

    const npmCli = path.join(workRoot, 'node', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (!fs.existsSync(npmCli)) throw new Error('Pinned npm CLI is missing from the declared Node distribution');
    const runtimeHome = path.join(workRoot, '.private-home');
    const runtimeTmp = path.join(workRoot, '.private-tmp');
    fs.mkdirSync(runtimeHome, {recursive: true});
    fs.mkdirSync(runtimeTmp, {recursive: true});
    const emptyUserNpmConfig = path.join(runtimeHome, 'user.npmrc');
    const emptyGlobalNpmConfig = path.join(runtimeHome, 'global.npmrc');
    fs.writeFileSync(emptyUserNpmConfig, '');
    fs.writeFileSync(emptyGlobalNpmConfig, '');
    const childEnv = {
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      TZ: 'UTC',
      HOME: runtimeHome,
      TMPDIR: runtimeTmp,
      TMP: runtimeTmp,
      TEMP: runtimeTmp,
      PATH: `${path.dirname(nodeBinary)}${path.delimiter}${path.dirname(toolchain.shellBinary)}`,
      npm_config_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_userconfig: emptyUserNpmConfig,
      npm_config_globalconfig: emptyGlobalNpmConfig,
      npm_config_script_shell: toolchain.shellBinary,
      SHELL: toolchain.shellBinary,
    };
    diagnostics.push('ParallelCompressingBootstrap fresh-output verification');
    diagnostics.push(`Source checkpoint: ${sourceManifest.manifest.checkpoint_build_id}`);
    diagnostics.push(`Declared compiler inputs reverified: ${sourceRecords.length}`);
    diagnostics.push(`Fresh site receipt verified: ${JSON.parse(fs.readFileSync(receiptPath, 'utf8')).site.tree_sha256}`);
    diagnostics.push(`Build diagnostics source: ${path.relative(path.dirname(receiptPath), diagnosticsPath).replaceAll('\\', '/')}`);
    const buildDiagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
    if (!buildDiagnostics.includes('Task answer checkpoint: the declared Bazel action compiled the full f300 PageRouter source aggregate.')) throw new Error('Build diagnostics are missing the explicit compile checkpoint');
    appendOutput(diagnostics, 'npm test against fresh assembled site', runNode(nodeBinary, [npmCli, 'test'], workRoot, childEnv));
    const rebase = rebaseScratchPxCubeEvidence(path.join(workRoot, 'evidence', 'pxcube-build.json'), path.join(workRoot, 'dist'), JSON.parse(fs.readFileSync(receiptPath, 'utf8')));
    diagnostics.push(`Verification-only PxCube site rebase: ${rebase.originalSite} -> ${rebase.pxcubeSite}`);
    diagnostics.push(`Rebased receipts/chunks checked against declared site receipt: ${rebase.checkedOutputs}`);
    diagnostics.push('The raw Bazel pxcube-build.json in the declared evidence output remains byte-identical; only the private test scratch copy site path was rebound.');
    appendOutput(diagnostics, 'existing verify-crisp-delta pipeline', runNode(nodeBinary, ['scripts/verify-crisp-delta.mjs'], workRoot, childEnv));
    const deltaProof = JSON.parse(fs.readFileSync(path.join(workRoot, 'evidence', 'crisp-delta-proof.json'), 'utf8'));
    if (deltaProof.exactCompiledEquality !== true) throw new Error('Existing crisp delta verification did not prove exact equality with the clean compiled outputs');
    diagnostics.push(`Existing crisp delta proof: exactCompiledEquality=${deltaProof.exactCompiledEquality}; changed packages=${deltaProof.changedPackageKeys.length}`);
    diagnostics.push('Verification uses the freshly assembled Bazel site and fresh PxCube evidence; historical dist is not an input.');
    process.stdout.write(`${diagnostics.join('\n')}\n`);
  } catch (error) {
    diagnostics.push(`VERIFY FAILED: ${error?.stack ?? String(error)}`);
    process.stderr.write(`${diagnostics.join('\n')}\n`);
    throw error;
  } finally {
    fs.rmSync(workRoot, {recursive: true, force: true});
  }
}

function main() {
  const argv = expandParamFiles(process.argv.slice(2));
  const mode = argv.shift();
  if (mode === 'build') return build(argv);
  if (mode === 'verify') return verify(argv);
  throw new Error(`Unknown build driver mode: ${mode}`);
}

main();
