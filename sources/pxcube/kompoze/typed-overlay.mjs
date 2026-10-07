// Resolve a Tidy-typed Experience after its base has been resolved. The type
// provider owns identity; Kompoze may compose its fields but cannot retype it.
export function resolveTypedOverlay({ supplied, base, baseId, patches, mergePatch }) {
  const identity = { id: supplied.manifest.id, version: supplied.manifest.version };
  const source = { path: supplied.source, type: supplied.type, digest: supplied.digest };
  let resolved = base
    ? mergePatch(stripResolutionMetadata(base), supplied.manifest)
    : { ...supplied.manifest };
  for (const patch of patches) {
    if (['id', 'version', 'tidy', 'manifestSource', 'composition'].some((key) => Object.hasOwn(patch, key))) {
      throw Error('manifest: typed patches cannot change id, version, tidy, manifestSource, or composition');
    }
    resolved = mergePatch(resolved, patch);
  }
  if (resolved.id !== identity.id || resolved.version !== identity.version) {
    throw Error('manifest: typed overlay identity differs from Tidy type');
  }
  resolved.manifestSource = source;
  if (base) {
    resolved.composition = {
      base: baseId,
      patches,
      baseManifestSource: base.manifestSource ?? null,
      resolvedType: supplied.type,
      resolvedVersion: identity.version,
    };
  }
  return resolved;
}

function stripResolutionMetadata({ composition: _composition, manifestSource: _source, ...fields }) {
  return fields;
}
