// Stable serialisation of the generated world: one line per Case and per instance, so the file diffs and compares byte for byte.
export function serializeWorld(world) {
  const lines = ['{', `"schema": ${JSON.stringify(world.schema)},`, `"seed": ${world.seed},`, `"caseCount": ${world.caseCount},`, '"cases": ['];
  world.cases.forEach((c, i) => lines.push(JSON.stringify(c) + (i < world.cases.length - 1 ? ',' : '')));
  lines.push('],', '"instances": [');
  world.instances.forEach((inst, i) => lines.push(JSON.stringify(inst) + (i < world.instances.length - 1 ? ',' : '')));
  lines.push(']', '}', '');
  return lines.join('\n');
}
