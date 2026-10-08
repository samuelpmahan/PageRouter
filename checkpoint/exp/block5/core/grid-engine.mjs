const nouns = new Set(['BABA', 'WALL', 'ROCK', 'FLAG']);
const properties = new Set(['YOU', 'STOP', 'PUSH', 'WIN']);
const directions = {U: [0,-1], D: [0,1], L: [-1,0], R: [1,0]};

export function parseRules(state) {
  const words = new Map();
  for (const o of state.objects.filter(o => o.kind === 'text')) {
    const key = `${o.x},${o.y}`;
    if (!words.has(key)) words.set(key, new Set());
    words.get(key).add(o.word);
  }
  const found = new Set();
  for (const o of state.objects.filter(o => o.kind === 'text' && nouns.has(o.word))) {
    for (const [dx,dy] of [[1,0], [0,1]]) {
      if (!words.get(`${o.x + dx},${o.y + dy}`)?.has('IS')) continue;
      for (const property of words.get(`${o.x + 2*dx},${o.y + 2*dy}`) ?? []) {
        if (properties.has(property)) found.add(`${o.word} IS ${property}`);
      }
    }
  }
  return [...found].sort();
}

function has(object, property, rules) {
  return (object.kind === 'text' && property === 'PUSH') || rules.includes(`${object.kind.toUpperCase()} IS ${property}`);
}

function evaluate(state) {
  const rules = parseRules(state);
  const you = state.objects.filter(o => has(o, 'YOU', rules));
  const win = state.objects.filter(o => has(o, 'WIN', rules));
  return {...state, rules, won: you.some(o => win.some(w => w.x === o.x && w.y === o.y)), lost: you.length === 0};
}

export function step(state, dir) {
  if (!Object.hasOwn(directions, dir)) throw new RangeError(`Invalid direction: ${dir}`);
  const [dx,dy] = directions[dir];
  const next = {width: state.width, height: state.height, objects: state.objects.map(o => ({...o}))};
  const rules = parseRules(state);
  const you = next.objects.filter(o => has(o, 'YOU', rules)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const mover of you) {
    const planned = new Set();
    function plan(o) {
      if (planned.has(o)) return true;
      const x = o.x + dx, y = o.y + dy;
      if (x < 0 || y < 0 || x >= next.width || y >= next.height) return false;
      const occupants = next.objects.filter(other => other !== o && other.x === x && other.y === y);
      if (occupants.some(other => has(other, 'STOP', rules))) return false;
      for (const other of occupants.filter(other => has(other, 'PUSH', rules))) {
        if (!plan(other)) return false;
      }
      planned.add(o);
      return true;
    }
    if (plan(mover)) for (const o of planned) { o.x += dx; o.y += dy; }
  }
  return evaluate(next);
}

export function replay(level, movesString) {
  const states = [evaluate({width: level.width, height: level.height, objects: level.objects.map(o => ({...o}))})];
  for (const dir of movesString) states.push(step(states.at(-1), dir));
  return states;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hash(value) {
  let result = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(canonical(value))) {
    result = Math.imul(result ^ byte, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}
