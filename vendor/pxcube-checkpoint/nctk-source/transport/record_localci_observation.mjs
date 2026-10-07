#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { recordObservation } from '../policies/neat.mjs';
const [root, receiptPath] = process.argv.slice(2);
if (!root || !receiptPath) throw Error('Usage: node record_localci_observation.mjs ROOT RECEIPT');
const bytes = await readFile(receiptPath), receipt = JSON.parse(bytes);
if (receipt.schema !== 'localci-discstudio-pages-release@1') throw Error('Invalid release receipt');
const sha256 = createHash('sha256').update(bytes).digest('hex');
await recordObservation(resolve(root), receipt.workItem, receipt.namespace,
  { verdict: receipt.verdict, buildId: receipt.buildInfo?.buildId ?? null,
    archiveSha256: receipt.archiveSha256 ?? null, bridgeStatus: receipt.bridge.status },
  [{ sha256, kind: 'release-receipt' },
    ...(receipt.archiveSha256 ? [{ sha256: receipt.archiveSha256, kind: 'pages-artifact' }] : [])]);
