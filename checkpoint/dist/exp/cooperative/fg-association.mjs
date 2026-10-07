// A read-only projection of the native AnnotationFG graph onto actual PxC Part addresses.
// No Calculation is invoked here; callers can use the result as a preflight plan.

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export function deriveFGAssociations({fg, output, addresses = {}, inputAddresses = {}, pxc} = {}) {
  if (fg?.kind !== 'composed' || !fg.internalGraph || typeof output !== 'string') {
    throw new TypeError('Expected a composed AnnotationFG and an exposed output port.');
  }
  const graph = fg.internalGraph;
  const exposed = graph.externalOutputs.find((port) => port.port === output);
  if (!exposed?.source) throw new TypeError(`FG output ${output} has no child source.`);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const used = new Set();
  const visiting = new Set();
  const order = [];
  const requiredInputs = new Map();

  function visit(id) {
    if (used.has(id)) return;
    if (visiting.has(id)) throw new TypeError(`Cycle in FG dependency closure at ${id}.`);
    const node = byId.get(id);
    if (!node) throw new TypeError(`FG output references unknown child ${id}.`);
    visiting.add(id);
    for (const port of node.fg.consumes) {
      const wires = graph.bindings.filter((edge) => edge.to.node === id && edge.to.port === port.name);
      const inputs = graph.externalInputs.filter((entry) => entry.target?.node === id && entry.target.port === port.name);
      if (wires.length + inputs.length !== 1) {
        throw new TypeError(`Unbound or multiply bound FG input ${id}.${port.name}.`);
      }
      if (wires.length) visit(wires[0].from.node);
      else requiredInputs.set(inputs[0].port, inputs[0]);
    }
    visiting.delete(id);
    used.add(id);
    order.push(id);
  }
  visit(exposed.source.node);

  const nodes = order.map((id) => {
    const node = byId.get(id);
    const address = addresses[id] ?? node.calculation ?? node.sourceAddress;
    if (typeof address !== 'string' || !address) throw new TypeError(`Missing Part address for FG child ${id}.`);
    const role = node.sourceAddress ? 'source' : node.calculation ? 'calculation' : node.fg.consumes.length ? 'calculation' : 'source';
    if (pxc) {
      const part = pxc.get(address);
      if (role === 'calculation' && typeof part.value !== 'function') throw new TypeError(`Calculation Part for ${id} at ${address} is not a function.`);
      if (role === 'source' && typeof part.value === 'function') throw new TypeError(`Source Part for ${id} at ${address} is a function.`);
    }
    return {id, fgId: node.fg.id, role, address, consumes: node.fg.consumes, emits: node.fg.emits,
      guarantees: node.fg.guarantees};
  });
  const edges = graph.bindings.filter((edge) => used.has(edge.from.node) && used.has(edge.to.node))
    .map((edge) => ({from: edge.from, to: edge.to, type: edge.type, ...(edge.tags ? {tags: edge.tags} : {})}));
  const inputs = [...requiredInputs.values()].map((input) => {
    const address = inputAddresses[input.port];
    if (pxc && (typeof address !== 'string' || !address)) throw new TypeError(`Missing input Part address for FG port ${input.port}.`);
    if (pxc) pxc.get(address);
    return {port: input.port, type: input.type, target: input.target,
      ...(input.tags ? {tags: input.tags} : {}), ...(address ? {address} : {})};
  });
  return freeze({fgId: fg.id,
    output: {port: exposed.port, type: exposed.type, source: exposed.source,
      ...(exposed.tags ? {tags: exposed.tags} : {})},
    nodes, edges, inputs,
    closure: {nodeIds: [...order], partAddresses: nodes.map((node) => node.address),
      inputPorts: inputs.map((input) => input.port)}});
}
