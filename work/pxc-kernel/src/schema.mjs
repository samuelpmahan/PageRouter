// A deliberately small JSON-schema subset (the same keywords Capability Lab allows).
import { fail } from './canonical.mjs';

const TYPES = new Set(['object', 'array', 'number', 'integer', 'string', 'boolean', 'null', 'any']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'items', 'minItems', 'maxItems',
  'minimum', 'maximum', 'enum', 'additionalProperties', 'description', 'oneOf']);

export function checkSchema(schema, path = 'schema') {
  if (!schema || typeof schema !== 'object') fail(`${path} must be an object`, 'BAD_SCHEMA');
  // Keys starting with x- are annotations: carried with the schema, ignored by validation (v0.4; a place for uses to accumulate).
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key) && !key.startsWith('x-')) fail(`${path} uses unsupported keyword ${key} (annotations must start with x-)`, 'BAD_SCHEMA');
  if (schema.oneOf) {
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) fail(`${path}.oneOf needs two or more schemas`, 'BAD_SCHEMA');
    schema.oneOf.forEach((s, i) => checkSchema(s, `${path}.oneOf[${i}]`));
    return;
  }
  if (!TYPES.has(schema.type)) fail(`${path}.type must be one of ${[...TYPES].join(', ')}`, 'BAD_SCHEMA');
  if (schema.properties) for (const [k, s] of Object.entries(schema.properties)) checkSchema(s, `${path}.properties.${k}`);
  if (schema.items) checkSchema(schema.items, `${path}.items`);
}

function typeOk(value, type) {
  switch (type) {
    case 'any': return true;
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    default: return typeof value === type;
  }
}

/** Returns a list of problems; empty means valid. */
export function validate(value, schema, path = '$') {
  if (!schema) return [];
  if (schema.oneOf) {
    const fits = schema.oneOf.filter((s) => validate(value, s, path).length === 0).length;
    return fits === 1 ? [] : [`${path} matches ${fits} of ${schema.oneOf.length} oneOf branches (needs exactly 1)`];
  }
  if (!typeOk(value, schema.type)) return [`${path} expected ${schema.type}`];
  const problems = [];
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) problems.push(`${path} not in enum`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path} < ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path} > ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => problems.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (schema.type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) problems.push(`${path}.${key} is required`);
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties?.[key]) problems.push(...validate(v, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}.${key} is not allowed`);
    }
  }
  return problems;
}

/** Shallow port compatibility used by assembly-time lint. */
export function compatible(source, target) {
  if (!source || !target) return true;
  if (target.type === 'any' || source.type === 'any') return true;
  // Every branch the source can produce must fit some branch of the target.
  // (Checking target first rejected forwarding oneOf[number,null] into the same oneOf: contest D, F-8.)
  if (source.oneOf) return source.oneOf.every((s) => compatible(s, target));
  if (target.oneOf) return target.oneOf.some((t) => compatible(source, t));
  if (source.type === target.type) return source.type !== 'array' || compatible(source.items, target.items);
  return source.type === 'integer' && target.type === 'number';
}
