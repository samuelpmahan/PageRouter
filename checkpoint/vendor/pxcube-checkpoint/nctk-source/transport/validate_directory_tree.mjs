#!/usr/bin/env node
import { resolve } from 'node:path';
import { validateDirectoryTree } from '../policies/tidy.mjs';
const root = resolve(process.argv[2] ?? '.');
const result = await validateDirectoryTree(root);
console.log(`Tidy validated ${result.manifests.size} managed directory addresses`);
