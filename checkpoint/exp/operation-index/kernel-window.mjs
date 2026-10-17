function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function stableExternalIdentity(from) {
  // Port names and run labels are used only to detect repeated references; the key stores an ordinal alias.
  const identity = {};
  for (const key of ['kind', 'call', 'port', 'run', 'from', 'path', 'of', 'args', 'pieces']) {
    if (from?.[key] !== undefined) identity[key] = from[key];
  }
  return canonical(identity);
}

function collectLeaves(from, chain = [], initialKind = null, out = []) {
  if (!from || typeof from !== 'object') return out;
  const kind = from.kind ?? 'unknown';
  const rootKind = initialKind ?? kind;
  if (kind === 'at') {
    collectLeaves(from.of, [...chain, { kind: 'at', path: Array.isArray(from.path) ? stableRefData(from.path) : [] }], rootKind, out);
  } else if (kind === 'gather') {
    for (const [index, piece] of (from.pieces ?? []).entries()) {
      collectLeaves(piece.from, [...chain, { kind: 'gather', index, path: stableRefData(piece.path ?? []) }], rootKind, out);
    }
  } else if (kind === 'test') {
    for (const [index, arg] of (from.args ?? []).entries()) {
      collectLeaves(arg, [...chain, { kind: 'test', index, ...(from.op === undefined ? {} : { op: from.op }) }], rootKind, out);
    }
  } else {
    out.push({ rootKind, leafKind: kind, chain, reference: from });
  }
  return out;
}

function stableRefData(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableRefData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableRefData(value[key])]));
  return null;
}

/** Normalize an ordered sibling window from a PxC trace, using only exact Ref provenance. */
export function normalizeKernelWindow(win) {
  const rawNodes = Array.isArray(win) ? win : Array.isArray(win?.calls) ? win.calls : [];
  const nodes = rawNodes.filter((node) => node && typeof node === 'object' && !Array.isArray(node) && node.id !== undefined);
  const operations = nodes.map((node, index) => ({
    id: `kernel-op-${index + 1}`,
    nativeId: node?.id ?? null,
    kind: node?.kind ?? 'unknown',
    status: node?.error ? 'failed' : node?.cached ? 'cached' : 'succeeded',
    contract: node?.contract ?? null,
    implementation: node?.impl ?? null,
    slot: node?.slot ?? null,
    inputCount: Object.keys(node?.in ?? {}).length,
    outputCount: Object.keys(node?.out ?? {}).length,
    inputWiringStatus: 'exact-provenance',
    inputWiring: [],
    outputWiring: [],
    decisions: [],
    ...(node?.error ? { error: stableRefData(node.error) } : {}),
  }));
  const byCall = new Map(nodes.map((node, index) => [node?.id, index]));
  const outputPortIndexes = nodes.map((node) => new Map(Object.keys(node?.out ?? {}).map((port, index) => [port, index])));
  const externalAliases = new Map();
  let nextAlias = 0;
  const edges = [];

  function normalizeLeaves(from, targetIndex, direction, portIndex, emitEdges = true) {
    return collectLeaves(from).map((leaf) => {
      const ref = leaf.reference;
      const sourceIndex = leaf.leafKind === 'call' ? byCall.get(ref.call) : undefined;
      const isInternal = Number.isSafeInteger(sourceIndex);
      const shareable = ['call', 'input', 'external', 'run'].includes(leaf.leafKind);
      const sourceIdentity = shareable ? `${leaf.leafKind}:${stableExternalIdentity(ref)}` : `unknown:${nextAlias++}`;
      let alias = null;
      if (!isInternal) {
        if (!externalAliases.has(sourceIdentity)) externalAliases.set(sourceIdentity, nextAlias++);
        alias = externalAliases.get(sourceIdentity);
      }
      const descriptor = {
        kind: leaf.rootKind === 'input' ? 'external' : leaf.rootKind,
        leafKind: leaf.leafKind,
        via: leaf.chain,
        ...(leaf.leafKind === 'literal' && Object.hasOwn(ref, 'value') ? { literalValue: stableRefData(ref.value) } : {}),
        ...(isInternal ? { fromOperation: sourceIndex, fromOutputIndex: outputPortIndexes[sourceIndex].get(ref.port) ?? null } : { externalAlias: alias }),
      };
      if (isInternal) {
        if (emitEdges && direction !== 'decision') {
          edges.push({
            from: operations[sourceIndex].id,
            to: operations[targetIndex].id,
            kind: descriptor.kind,
            ...(direction === 'input' ? { inputIndex: portIndex } : { outputIndex: portIndex }),
            fromOutputIndex: descriptor.fromOutputIndex,
            via: descriptor.via,
          });
        }
      } else if (emitEdges && direction !== 'decision') {
        edges.push({
          from: null,
          to: operations[targetIndex].id,
          kind: descriptor.kind,
          ...(direction === 'input' ? { inputIndex: portIndex } : { outputIndex: portIndex }),
          sourceKind: leaf.leafKind,
          externalAlias: alias,
          via: descriptor.via,
          ...(descriptor.literalValue === undefined ? {} : { literalValue: descriptor.literalValue }),
        });
      }
      return descriptor;
    });
  }

  nodes.forEach((node, operationIndex) => {
    Object.values(node?.in ?? {}).forEach((ref, inputIndex) => {
      operations[operationIndex].inputWiring.push(normalizeLeaves(ref?.from, operationIndex, 'input', inputIndex));
    });
    Object.values(node?.out ?? {}).forEach((ref, outputIndex) => {
      operations[operationIndex].outputWiring.push(normalizeLeaves(ref?.from, operationIndex, 'output', outputIndex));
    });
    for (const [decisionIndex, decision] of (node?.decisions ?? []).entries()) {
      operations[operationIndex].decisions.push({
        decisionIndex,
        ...(Object.hasOwn(decision, 'value') ? { value: stableRefData(decision.value) } : {}),
        ranPresent: Object.hasOwn(decision, 'ran'),
        skippedPresent: Object.hasOwn(decision, 'skipped'),
        from: normalizeLeaves(decision.from, operationIndex, 'decision', decisionIndex, false),
      });
    }
  });
  const failed = operations.some((operation) => operation.status === 'failed');
  return {
    status: failed ? 'failed' : operations.length ? 'succeeded' : 'unknown',
    operations,
    edges,
    evidence: {
      kind: 'pxc-kernel-window',
      window: stableRefData(rawNodes),
      warning: 'Native call ids, port names and external reference details are retained only as evidence; structural keys use call order, port ordinals and shared external aliases. Cross-run references remain in this receipt and are not inferred from hashes or values.',
      semantics: 'No explicit operation semantics were supplied; candidate keys are structural-only.',
    },
  };
}
