import { Part } from '../services/pxc.mjs';

// Views of the actual store, not a second registry. Borrowed values stay borrowed.
const identities = new WeakMap();
let nextIdentity = 0;
export function objectId(value) {
  if (value === null || !['object', 'function'].includes(typeof value)) return null;
  if (!identities.has(value)) identities.set(value, ++nextIdentity);
  return `object#${identities.get(value)}`;
}
export function objectModel(value) {
  try {
    return { id: objectId(value), prototype: Object.getPrototypeOf(value),
      extensible: Object.isExtensible(value), frozen: Object.isFrozen(value),
      properties: Reflect.ownKeys(value).map(key => ({ key, ...Object.getOwnPropertyDescriptor(value, key) })) };
  } catch (error) { return { id: objectId(value), error: String(error), properties: [] }; }
}
export function printable(value) {
  const seen = new WeakSet();
  let budget = 2000;
  function visit(item, depth = 0) {
    if (--budget < 0 || depth > 8) return '[display limit]';
    if (typeof item === 'function') return `[Calculation ${objectId(item)}]`;
    if (typeof item === 'bigint') return `${item}n`;
    if (typeof item === 'symbol' || typeof item === 'undefined') return String(item);
    if (typeof item === 'string' && item.startsWith('data:image/')) return `[image material: ${item.length} characters]`;
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return `[repeated/circular reference ${objectId(item)}]`;
    seen.add(item);
    try {
      if (item instanceof Map) return { Map: [...Map.prototype.entries.call(item)].slice(0, 150).map(([k,v]) => [visit(k,depth+1),visit(v,depth+1)]) };
      if (item instanceof Set) return { Set: [...Set.prototype.values.call(item)].slice(0,150).map(x=>visit(x,depth+1)) };
      return Object.fromEntries(Reflect.ownKeys(item).slice(0,150).map(key => {
        const d = Object.getOwnPropertyDescriptor(item,key);
        return [String(key), 'value' in d ? visit(d.value,depth+1) : '[accessor — not evaluated]'];
      }));
    } catch (error) { return `[inspection failed: ${String(error)}]`; }
  }
  return JSON.stringify(visit(value), null, 2) ?? String(value);
}

export async function runCalculation(pxc, calculation, bindings) {
  if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) throw Error('Inputs must be a named object.');
  const inputs = Object.fromEntries(Object.entries(bindings).map(([name, binding]) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) throw Error(`Input ${name}: use {"ref":"address"} or {"value":...}.`);
    const keys = Object.keys(binding);
    if (keys.length !== 1 || !['ref','value'].includes(keys[0])) throw Error(`Input ${name}: supply exactly ref or value.`);
    return [name, keys[0] === 'ref' ? pxc.get(binding.ref) : new Part(binding.value)];
  }));
  return runObserved(pxc, calculation, inputs);
}
export async function runObserved(pxc, calculation, inputs) {
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([a])=>a));
  while (occupied.has(`devtools.run.${serial}.started`)) serial++;
  const base = `devtools.run.${serial}`, into = base + '.result';
  const startedAt = Date.now();
  pxc.set(base + '.started', new Part({ state:'running', into, startedAt, calculation, inputs }));
  try {
    const output = await pxc.compose({ into, calculation, inputs });
    pxc.set(base + '.finished', new Part({ state:'produced', into, elapsedMs:Date.now()-startedAt }));
    return { into, output };
  } catch (error) {
    pxc.set(base + '.finished', new Part({ state:'failed', into, elapsedMs:Date.now()-startedAt, error:String(error) }));
    throw error;
  }
}
export function runMember(pxc, receiver, member, args = [], kind = 'method') {
  if (typeof member !== 'function' || !Array.isArray(args)) throw Error('Select a callable member and supply a JSON argument array.');
  // Retains the actual receiver and callable as contributors; no source eval.
  const invoke = new Part(({ receiver, member, args }) => Reflect.apply(member, receiver, args));
  return runObserved(pxc, invoke, { receiver:new Part(receiver), member:new Part(member), args:new Part(kind === 'getter' ? [] : args) });
}

export function createObjectPlayground(pxc) {
  const symbol = Symbol('example metadata');
  class Counter {
    constructor() { this.count = 2; this.getterCalls = 0; }
    get doubled() { this.getterCalls++; return this.count * 2; }
    increment(amount = 1) { this.count += amount; return this.count; }
    async later(amount = 1) { return this.increment(amount); }
    fail() { throw new Error('Deliberate playground failure'); }
  }
  const counter = new Counter();
  Object.defineProperty(counter, 'hiddenNote', { value:'Non-enumerable property', enumerable:false });
  counter[symbol] = 'Symbol-keyed material';
  counter.self = counter;
  counter.map = new Map([['same counter', counter]]);
  return createScratch(pxc, counter);
}

// Shared plain-text operation: collection and searchable fields are explicit.
export function find({ collection, query = '', fields }) {
  const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return collection.filter(row => {
    const text = fields(row).join(' ').toLocaleLowerCase();
    return tokens.every(token => text.includes(token));
  });
}
export function inventory(pxc) {
  return pxc.entries().map(([address, part]) => ({
    address, part, namespace: address.split('.').slice(0, -1).join('.') || '(root)',
    kind: typeof part.value === 'function' ? 'Calculation' : part.composition ? 'Produced' : 'Supplied',
  }));
}
export function inspectPart(pxc, part) {
  const entries = pxc.entries();
  const addresses = target => entries.filter(([, value]) => value === target).map(([address]) => address);
  const edges = part.composition ? [
    { role: 'Calculation', part: part.composition.calculation, addresses: addresses(part.composition.calculation) },
    ...Object.entries(part.composition.inputs).map(([role, input]) => ({ role, part: input, addresses: addresses(input) })),
  ] : [];
  const consumers = entries.filter(([, candidate]) => candidate.composition &&
    (candidate.composition.calculation === part || Object.values(candidate.composition.inputs).includes(part)))
    .map(([address, candidate]) => ({ address, part: candidate }));
  return { addresses: addresses(part), edges, consumers };
}
export function createScratch(pxc, value) {
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([address]) => address));
  while (occupied.has(`devtools.scratch.${serial}`)) serial++;
  const address = `devtools.scratch.${serial}`;
  pxc.set(address, new Part(value));
  return address;
}
export async function reviseScratch(pxc, source, value) {
  // A fresh result, not a mutation of the inspected Part or application selection.
  const calc = new Part(({ replacement }) => replacement);
  let serial = 1;
  const occupied = new Set(pxc.entries().map(([address]) => address));
  while (occupied.has(`devtools.result.${serial}`)) serial++;
  const address = `devtools.result.${serial}`;
  await pxc.compose({ into: address, calculation: calc, inputs: { original: source, replacement: new Part(value) } });
  return address;
}

// Human labels are projections of retained material, never new Parts or lineage.
export function ownData(value, key) {
  if (!value || !['object','function'].includes(typeof value)) return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
const operationLabels=Object.freeze({
  'SchoolData.getStates':'Load school states','SchoolData.getCounties':'Load counties',
  'SchoolData.getDistricts':'Load school districts','SchoolData.getSchools':'Load schools',
  'Registration.registerTeacher':'Register teacher','Registration.getOwnStatus':'Read registration',
  'Demo.simulateApproval':'Simulate approval','Demo.reset':'Reset demo',
  'Session.login':'Demo login','Session.logout':'Log out','Session.getSession':'Read session',
  'TeacherProfile.createProfile':'Create teacher profile','TeacherProfile.getOwnProfile':'Read own profile',
  'TeacherProfile.openPublicProfile':'View public profile',
  'Style.sample':'Generate six bounded style variants','Style.select':'Select style variant',
  'Style.cssVariables':'Prepare allowed CSS variables','Style.keep':'Keep style values for this tab',
  'Style.restore':'Restore kept style values',
  'hh.style.calculation.sample':'Generate six bounded style variants',
  'hh.style.calculation.select':'Select style variant',
  'hh.style.calculation.css-variables':'Prepare allowed CSS variables',
  'hh.style.calculation.keep':'Keep style values for this tab',
  'hh.style.calculation.restore':'Restore kept style values',
});
export const operationLabel=port=>operationLabels[port]||String(port||'Calculation');
export const outcomeLabel=outcome=>String(outcome||'').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
export function profileInResult(part) {
  const data=ownData(part?.value,'data');
  return ownData(data,'profile')||ownData(ownData(data,'ownProfile'),'profile')||null;
}
export function describeExecution(receipt) {
  const value=receipt.output?.value,port=ownData(value,'port');
  const profile=profileInResult(receipt.output);
  const request=receipt.composition.inputs.request?.value;
  const name=ownData(profile,'displayName')||ownData(ownData(request,'teacher'),'name')||'';
  return {port,operation:operationLabel(port),person:name,outcome:outcomeLabel(ownData(value,'outcome')),
    message:ownData(value,'message')||'',ok:ownData(value,'ok'),address:receipt.into,
    title:[operationLabel(port),name].filter(Boolean).join(' · '),receiptStatus:receipt.status};
}
export function latestMeaningfulReceipt(receipts) {
  return [...receipts].reverse().find(r=>!String(describeExecution(r).port).startsWith('SchoolData.'))||receipts.at(-1)||null;
}
export function recordedProfileReceipt(receipts, profileId) {
  // Match the declared stable identity in an explicit actual result, not value similarity.
  return [...receipts].reverse().find(r=>ownData(profileInResult(r.output),'id')===profileId)||null;
}
