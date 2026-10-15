// Deep-freeze helpers. The copies in exp/compression, exp/atlas and
// exp/cooperative fell into three behavior classes under deep-freeze 0.0.1's
// own test and a differential battery; each class is one function here, with
// the body of the copies it replaces.
//
// All three freeze only what Object.values reaches: own enumerable
// string-keyed values that are objects. Functions, symbol keys, non-enumerable
// properties, prototypes and Map or Set entries are left alone, and primitives,
// null and undefined come back unchanged. deep-freeze 0.0.1 differs on each of
// those points; the call sites pass only JSON-shaped data.
//
// freezeTree: children first, then the node. A node that is already frozen is
// returned without being visited, so a frozen root is not descended. A cycle
// of unfrozen nodes recurses until the stack overflows.
// freezeTreeParentFirst: the node first, then its children. Frozen nodes are
// skipped the same way, so a cycle ends where it meets the node it froze.
// freeze: children first, then the node, with no frozen check. It descends into
// frozen nodes too, and any cycle overflows the stack.

function freezeTree(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function freezeTreeParentFirst(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeTreeParentFirst(child);
  return value;
}

function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

export {freezeTree, freezeTreeParentFirst, freeze};
