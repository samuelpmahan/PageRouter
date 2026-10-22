import { moldCatalogVersion, packedMoldIndex, moldRuntimeAvailable, moldRuntimeError,                 } from './mold-runtime-index.js?v=28ac2b39fab85255';

                                  
                                                                 
export const catalogVersion = moldCatalogVersion;
export const catalogSourceSha256 = packedMoldIndex.sourceCatalogSha256;
export { moldRuntimeAvailable, moldRuntimeError };

/** Search the compiled mold-name trie, with manufacturer-first filtering. */
export function searchMolds(query        , limit = 12)               {
  return packedMoldIndex.search(query, limit);
}

/** Read one packed record by its durable catalog ID; this does not create a PxC Part. */
export function moldRecord(id        )                    {
  return packedMoldIndex.recordForId(id);
}

/** Card renderers keep their existing async contract without loading catalog.ts. */
export async function getMoldDetails(id        )                             {
  return moldRecord(id);
}
