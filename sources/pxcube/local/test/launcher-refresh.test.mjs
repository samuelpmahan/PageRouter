import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('launcher/shell.mjs','utf8');
test('build refresh updates the service worker before bounded reload fallback',()=>{assert.match(source,/getRegistration\(\)/);assert.match(source,/registration\.update\(\)/);assert.match(source,/controllerchange/);assert.match(source,/setTimeout\(reload,1800\)/);assert.match(source,/dataset\.refreshing/);});
