import {hashImportClosure,sha256Hex} from './import-closure.mjs';
export function atlasImplementationIdentity(root) {
  const roots=['exp/atlas/atlas-session.mjs','exp/atlas/cross-language.mjs'];
  const files = hashImportClosure(root, roots, {
    outsideOrLinked: 'Atlas dependency must stay within source',
    dynamicImport: 'Undeclared Atlas dynamic dependency',
    externalImport: 'Atlas external dependency requires explicit policy',
  });
  const record = {schema:'atlas-implementation-closure@1', roots, files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))};
  return {...record, digest:sha256Hex(JSON.stringify(record))};
}
