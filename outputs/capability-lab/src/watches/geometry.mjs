import { applyTransform, transform2D } from '../linalg/basics.mjs';

const VIEW_BOX = Object.freeze({ x: 0, y: 0, width: 1000, height: 500 });
const WATCH_LAYOUTS = [
  {
    id: 'mechanical', title: 'Mechanical', center: [166.67, 250],
    energyPath: [
      ['mechanical.crown', 'mechanical.barrel'], ['mechanical.barrel', 'mechanical.mainspring'],
      ['mechanical.mainspring', 'mechanical.goingTrain'], ['mechanical.goingTrain', 'mechanical.escapeWheel'],
      ['mechanical.escapeWheel', 'mechanical.palletFork'], ['mechanical.palletFork', 'mechanical.balanceWheel'],
      ['mechanical.goingTrain', 'mechanical.secondHand'], ['mechanical.goingTrain', 'mechanical.minuteHand'],
      ['mechanical.goingTrain', 'mechanical.hourHand'],
    ],
    timingPath: [
      ['mechanical.hairspring', 'mechanical.balanceWheel'], ['mechanical.balanceWheel', 'mechanical.palletFork'],
      ['mechanical.palletFork', 'mechanical.escapeWheel'], ['mechanical.escapeWheel', 'mechanical.goingTrain'],
      ['mechanical.goingTrain', 'mechanical.secondHand'], ['mechanical.goingTrain', 'mechanical.minuteHand'],
      ['mechanical.goingTrain', 'mechanical.hourHand'],
    ],
    parts: [
      part('mechanical.support', 'supportPlate', [0,0], [0,0], polygon([[-116,-155],[78,-155],[116,-112],[116,148],[-84,148],[-116,112]]), [125,-112], [[86,-72],[125,-112]]),
      part('mechanical.crown', 'crown', [97,-108], [44,-32], polygonCircle(11,10), [28,-23], [[8,0],[28,-23]]),
      part('mechanical.barrel', 'barrel', [-54,-93], [-38,-38], polygonCircle(31,28), [42,-26], [[23,-2],[42,-26]], 0, 31),
      part('mechanical.mainspring', 'coil', [-54,-93], [-48,-54], spiral(4,25,3,40), [40,25], [[16,12],[40,25]]),
      part('mechanical.goingTrain', 'gear', [-6,-24], [-8,43], gear(35,12), [48,-36], [[26,-8],[48,-36]], 0, 35, 'mechanicalGoingTrain'),
      part('mechanical.escapeWheel', 'escapeWheel', [62,-14], [42,-32], gear(25,12), [29,-28], [[21,-10],[29,-28]], 0, 25, 'mechanicalEscapeWheel'),
      part('mechanical.palletFork', 'palletFork', [50,-55], [48,-4], [[-25,-8],[-13,-14],[0,-5],[19,-32],[25,-28],[10,-1],[25,28],[19,32],[0,5],[-13,14],[-25,8],[-19,0]], [40,-32], [[22,-10],[40,-32]]),
      part('mechanical.balanceWheel', 'balance', [-31,43], [-44,34], polygonCircle(38,32), [52,24], [[30,4],[52,24]], 0, 38, 'mechanicalBalanceWheel'),
      part('mechanical.hairspring', 'hairspring', [-31,43], [-60,38], spiral(3,28,2.7,48), [48,32], [[16,10],[48,32]], 0, undefined, 'mechanicalBalanceWheel', 28),
      hand('mechanical.secondHand', 'second', [0,112], [0,28], 72, 2),
      hand('mechanical.minuteHand', 'minute', [0,112], [0,-20], 57, 4),
      hand('mechanical.hourHand', 'hour', [0,112], [31,0], 39, 6),
    ],
  },
  {
    id: 'quartz', title: 'Quartz', center: [500, 250],
    energyPath: [
      ['quartz.battery','quartz.oscillator'], ['quartz.battery','quartz.motorDriver'],
      ['quartz.motorDriver','quartz.coil'], ['quartz.coil','quartz.rotor'],
      ['quartz.rotor','quartz.gears'], ['quartz.gears','quartz.secondHand'],
      ['quartz.gears','quartz.minuteHand'], ['quartz.gears','quartz.hourHand'],
    ],
    timingPath: [
      ['quartz.crystal','quartz.oscillator'], ['quartz.oscillator','quartz.divider'],
      ['quartz.divider','quartz.motorDriver'], ['quartz.motorDriver','quartz.coil'],
      ['quartz.coil','quartz.rotor'], ['quartz.rotor','quartz.gears'],
      ['quartz.gears','quartz.secondHand'], ['quartz.gears','quartz.minuteHand'],
      ['quartz.gears','quartz.hourHand'],
    ],
    parts: [
      part('quartz.battery', 'battery', [-88,-112], [-44,-38], [[-20,-32],[14,-32],[20,-24],[20,26],[-20,26]], [-34,0], [[-20,0],[-34,0]]),
      part('quartz.crystal', 'crystal', [-30,-118], [-20,-55], polygon([[-24,0],[-12,-20],[12,-20],[24,0],[12,20],[-12,20]]), [35,-22], [[20,-5],[35,-22]]),
      part('quartz.oscillator', 'oscillator', [42,-110], [26,-54], rectangle(54,42), [39,-36], [[27,-18],[39,-36]]),
      part('quartz.divider', 'divider', [50,-43], [40,-2], rectangle(62,42), [42,-36], [[30,-14],[42,-36]]),
      part('quartz.motorDriver', 'motorDriver', [50,22], [49,33], rectangle(62,42), [43,-35], [[30,-12],[43,-35]]),
      part('quartz.coil', 'coil', [102,40], [55,58], spiral(3,18,2.5,36), [28,29], [[12,14],[28,29]]),
      part('quartz.rotor', 'rotor', [56,80], [20,58], gear(22,8), [37,17], [[18,6],[37,17]], 0, 22, 'quartzRotor'),
      part('quartz.gears', 'gear', [-12,64], [-32,40], gear(31,10), [42,21], [[26,7],[42,21]], 0, 31, 'quartzGoingTrain'),
      hand('quartz.secondHand', 'second', [0,128], [0,32], 70, 2),
      hand('quartz.minuteHand', 'minute', [0,128], [0,-22], 55, 4),
      hand('quartz.hourHand', 'hour', [0,128], [34,0], 38, 6),
    ],
  },
  {
    id: 'software', title: 'Software', center: [833.33, 250],
    energyPath: [],
    timingPath: [
      ['software.logicalTime','software.scheduler'], ['software.scheduler','software.updateCounter'],
      ['software.updateCounter','software.secondHand'], ['software.updateCounter','software.minuteHand'],
      ['software.updateCounter','software.hourHand'], ['software.secondHand','software.renderer'],
      ['software.minuteHand','software.renderer'], ['software.hourHand','software.renderer'],
    ],
    parts: [
      part('software.logicalTime', 'logicalClock', [-82,-95], [-37,-29], polygonCircle(27,24), [-38,-34], [[-21,-14],[-38,-34]], 0, 27),
      part('software.scheduler', 'scheduler', [2,-108], [0,-44], rectangle(72,48), [45,-36], [[36,-18],[45,-36]]),
      part('software.updateCounter', 'counter', [62,-28], [42,-4], rectangle(82,54), [48,-39], [[40,-16],[48,-39]]),
      part('software.renderer', 'renderer', [0,42], [0,37], rectangle(134,86), [86,-42], [[67,-28],[86,-42]]),
      hand('software.secondHand', 'second', [0,42], [0,34], 58, 2),
      hand('software.minuteHand', 'minute', [0,42], [0,-20], 46, 4),
      hand('software.hourHand', 'hour', [0,42], [33,0], 31, 6),
    ],
  },
];

const ALL_IDS = new Set(WATCH_LAYOUTS.flatMap((watch) => watch.parts.map((item) => item.id)));

/** Build a pure, illustrative view from a full watch run state. `explode` is in [0,1]. */
export function watchGeometry(state, explode = 0, selected = null) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be a full watch run object');
  if (typeof explode !== 'number' || !Number.isFinite(explode) || explode < 0 || explode > 1) {
    throw new RangeError('explode must be a finite number from 0 to 1');
  }
  if (selected !== null && (typeof selected !== 'string' || !ALL_IDS.has(selected))) {
    throw new RangeError(`unknown watch component selection: ${String(selected)}`);
  }
  const models = state.models ?? state.run?.models;
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new TypeError('state.models must contain mechanical, quartz, and software model snapshots');
  const hands = Object.fromEntries(WATCH_LAYOUTS.map((watch) => [watch.id, readHandAngles(models[watch.id], watch.id)]));
  const internalMotions = readInternalMotions(models);
  const watches = WATCH_LAYOUTS.map((watch) => {
    const parts = watch.parts.map((definition) => placePart(definition, watch, explode, selected, hands[watch.id], internalMotions[definition.motionKey]));
    const coordinates = parts.flatMap((item) => [item.center, ...item.points, ...item.strokes.flat(), item.label.anchor, ...item.label.leader]);
    const bounds = boundsOf(coordinates);
    return {
      id: watch.id,
      title: watch.title,
      center: [...watch.center],
      bounds,
      energyPath: watch.energyPath.map(([from, to]) => ({ from, to })),
      timingPath: watch.timingPath.map(([from, to]) => ({ from, to })),
      parts,
    };
  });
  return { schema: 'watch-geometry.v1', illustrative: true, viewBox: { ...VIEW_BOX }, watches };
}

function readHandAngles(model, modelId) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TypeError(`state.models.${modelId} is required`);
  const angles = model.handAnglesDegrees;
  if (!angles || typeof angles !== 'object') throw new TypeError(`state.models.${modelId}.handAnglesDegrees is required`);
  const result = {};
  for (const name of ['second', 'minute', 'hour']) {
    const value = angles[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`state.models.${modelId}.handAnglesDegrees.${name} must be finite`);
    result[name] = value * Math.PI / 180;
  }
  return result;
}

function readInternalMotions(models) {
  const mechanical = requireModel(models.mechanical, 'mechanical');
  const quartz = requireModel(models.quartz, 'quartz');
  const oscillatorPhase = rationalUnitFraction(mechanical.oscillator?.phase, 'models.mechanical.oscillator.phase');
  const beats = nonnegativeCounter(mechanical.counts?.beats, 'models.mechanical.counts.beats');
  const motorCommands = nonnegativeCounter(quartz.counts?.motorCommands, 'models.quartz.counts.motorCommands');
  const mechanicalSecondTurns = rationalUnitFraction(mechanical.gearTrain?.handTurns?.second, 'models.mechanical.gearTrain.handTurns.second');
  const quartzSecondTurns = rationalUnitFraction(quartz.gearTrain?.handTurns?.second, 'models.quartz.gearTrain.handTurns.second');
  const phase = Number(oscillatorPhase.numerator) / Number(oscillatorPhase.denominator);
  const balanceAngle = (25 * Math.PI / 180) * Math.cos(2 * Math.PI * phase);
  const beatAngle = (beats % 12) * (2 * Math.PI / 12);
  const rotorAngle = (motorCommands % 2) * Math.PI;
  const gearAngle = (turns) => 2 * Math.PI * Number(turns.numerator) / Number(turns.denominator);
  const source = (statePath, formula) => ({ statePath, formula, status: 'illustrative' });
  return {
    mechanicalBalanceWheel: { rotation: balanceAngle, motionSource: source('models.mechanical.oscillator.phase', '25 degrees × cos(2π × oscillator phase)') },
    mechanicalEscapeWheel: { rotation: beatAngle, motionSource: source('models.mechanical.counts.beats', 'one twelfth turn per retained beat (12-tooth schematic)') },
    mechanicalGoingTrain: { rotation: gearAngle(mechanicalSecondTurns), motionSource: source('models.mechanical.gearTrain.handTurns.second', 'nominal second-shaft turns from the teaching gear train') },
    quartzRotor: { rotation: rotorAngle, motionSource: source('models.quartz.counts.motorCommands', 'one half turn per retained motor command') },
    quartzGoingTrain: { rotation: gearAngle(quartzSecondTurns), motionSource: source('models.quartz.gearTrain.handTurns.second', 'nominal second-shaft turns from the teaching gear train') },
  };
}

function requireModel(model, name) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new TypeError(`state.models.${name} is required`);
  return model;
}

function nonnegativeCounter(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${path} must be a nonnegative safe integer`);
  return value;
}

function rationalUnitFraction(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${path} must be a nonnegative rational`);
  const { numerator, denominator } = value;
  if (!Number.isSafeInteger(numerator) || numerator < 0 || !Number.isSafeInteger(denominator) || denominator < 1) {
    throw new TypeError(`${path} must be a nonnegative safe rational`);
  }
  const remainder = numerator % denominator;
  return { numerator: remainder, denominator };
}

function placePart(definition, watch, explode, selected, handAngles, motion) {
  const rotation = definition.hand ? handAngles[definition.hand] : motion?.rotation ?? definition.rotation;
  const translation = [
    watch.center[0] + definition.position[0] + explode * definition.separation[0],
    watch.center[1] + definition.position[1] + explode * definition.separation[1],
  ];
  const transform = transform2D(translation, rotation, [1,1]);
  return {
    id: definition.id,
    kind: definition.kind,
    points: definition.points.map((point) => applyTransform(transform, point)),
    strokes: definition.marker ? [definition.marker.map((point) => applyTransform(transform, point))] : [],
    center: applyTransform(transform, [0,0]),
    ...(definition.radius === undefined ? {} : { radius: definition.radius }),
    rotation,
    transform,
    label: {
      anchor: applyTransform(transform, definition.labelAnchor),
      leader: definition.leader.map((point) => applyTransform(transform, point)),
    },
    selected: selected === definition.id,
    ...(motion ? { motionSource: { ...motion.motionSource } } : {}),
  };
}

function boundsOf(points) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x,y] of points) {
    left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function part(id, kind, position, separation, points, labelAnchor, leader, rotation = 0, radius, motionKey, markerLength) {
  const markerRadius = (markerLength ?? radius) === undefined ? null : (markerLength ?? radius) * 0.88;
  return { id, kind, position, separation, points, labelAnchor, leader, rotation, radius, motionKey, marker: motionKey ? [[0,0],[markerRadius,0]] : null };
}

function hand(id, name, position, separation, length, thickness) {
  const definition = part(id, 'hand', position, separation,
    [[-thickness,-2],[-1,-length*0.55],[-1,-length],[0,-length-5],[1,-length],[1,-length*0.55],[thickness,-2]],
    [thickness+22,-length*0.55], [[thickness,-length*0.38],[thickness+22,-length*0.55]], 0);
  definition.hand = name;
  return definition;
}

function polygonCircle(radius, sides) {
  return Array.from({ length: sides }, (_, i) => {
    const angle = 2 * Math.PI * i / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

function gear(radius, teeth) {
  const points = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    for (let step = 0; step < 4; step += 1) {
      const angle = 2 * Math.PI * (tooth + step / 4) / teeth;
      const r = step === 1 || step === 2 ? radius * 1.14 : radius * 0.88;
      points.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }
  return points;
}

function spiral(innerRadius, outerRadius, turns, samples) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const t = i / samples;
    const angle = 2 * Math.PI * turns * t;
    const radius = innerRadius + (outerRadius - innerRadius) * t;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

function polygon(points) { return points.map(([x,y]) => [x,y]); }

function rectangle(width, height) {
  const x = width / 2, y = height / 2;
  return [[-x,-y],[x,-y],[x,y],[-x,y]];
}
