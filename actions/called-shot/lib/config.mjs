// called-shots.json at the repository root: how to build, and which output to check.
import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'called-shots.json';
export const CONFIG_SCHEMA = 'called-shots-config@1';

export function defaults(fields) {
  return {
    schema: CONFIG_SCHEMA,
    workingDirectory: '.',
    defaultSourceRoot: '.',
    calledDir: 'called-shots',
    predicates: null,
    // When true, the call records in calledDir are not source changes, so a
    // shot need not list its own shot file and log line.
    excludeCalledDir: false,
    ...fields,
  };
}

export function loadConfig(repo, file = CONFIG_FILE) {
  const full = path.resolve(repo, file);
  if (!fs.existsSync(full)) throw Error(`${file} not found in ${repo}; run: called-shots init --build "<command>" --output <dir>`);
  const config = defaults(JSON.parse(fs.readFileSync(full, 'utf8')));
  if (config.schema !== CONFIG_SCHEMA) throw Error(`${file}: schema must be ${CONFIG_SCHEMA}`);
  for (const key of ['build', 'output']) if (typeof config[key] !== 'string' || !config[key]) throw Error(`${file}: "${key}" is required`);
  for (const key of ['workingDirectory', 'defaultSourceRoot', 'calledDir', 'output', 'predicates']) {
    const value = config[key];
    if (value != null && (path.isAbsolute(value) || value.split(/[\\/]/).includes('..'))) throw Error(`${file}: "${key}" must stay inside the repository`);
  }
  return config;
}
