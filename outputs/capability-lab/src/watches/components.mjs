// Source-linked, state-bound component descriptions for the generic mechanical and quartz models.
// Geometry is intentionally absent: the geometry layer places these stable IDs.

const sources = [
  {
    id: 'grand-seiko-mechanical',
    url: 'https://www.grand-seiko.com/uk-en/collections/movement/mechanical',
    supports: 'A wound mainspring supplies motive force; the escapement uses the balance, pallet fork, and escape wheel to regulate gear motion; the balance carries a hairspring; the gear train drives the hands.',
    limits: 'The page describes Grand Seiko 9S movements, whose construction varies by caliber. The 4 Hz teaching rate appears for specific listed calibers, not every mechanical watch. Schematic geometry, state counters, and ideal timing here are not a specific 9S movement.'
  },
  {
    id: 'seiko-quartz-education',
    url: 'https://www.seiko.co.jp/csr/toki-iku/tokiq-nazotoki/',
    supports: 'Seiko describes a typical quartz watch using a battery, a quartz reference near 32,768 oscillations per second, electronic division to a one-second signal, a step motor, and gears.',
    limits: 'The Japanese educational page says 32,768 Hz is typical and explicitly notes exceptions. It is a general explanation, not a specification for every quartz watch.'
  },
  {
    id: 'grand-seiko-quartz',
    url: 'https://www.grand-seiko.com/us-en/collections/movement/quartz',
    supports: 'Grand Seiko describes the 9F battery, quartz oscillator, integrated circuit, step motor, gears, and hands; its 9F twin-pulse motor sends two second-hand steps per second.',
    limits: 'This describes the specific Grand Seiko 9F movement. The generic model uses one motor command per second; it does not claim the 9F pulse pattern or universal quartz motor behavior.'
  },
  {
    id: 'gear-ratio-reference',
    url: 'https://khkgears.net/pdf/internal-tech.pdf',
    supports: 'KHK gives gear ratio magnitude in terms of tooth counts and rotational speeds and distinguishes rotation directions for internal gear arrangements.',
    limits: 'This is general gear-design information, not a watch-specific tooth count or validation of a particular watch train. The schematic labels do not assert a real watch gear geometry.'
  },
  {
    id: 'mdn-animation-frame',
    url: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame',
    supports: 'requestAnimationFrame schedules rendering callbacks, normally follows display refresh, and is paused in most hidden tabs.',
    limits: 'Callback timing is a browser scheduling observation, not a logical software-watch tick. This component model does not count callbacks or claim callback timing accuracy.'
  },
  {
    id: 'fixed-timestep-author',
    url: 'https://gafferongames.com/post/fix_your_timestep/',
    supports: 'A fixed logical update is kept separate from render cadence; elapsed time can be accumulated to decide when updates are due.',
    limits: 'This source motivates the teaching separation only. It does not specify this app’s runtime policy or prove physical watch timing.'
  }
];

const defs = [
  component('mechanical.crown', 'mechanical', 'Crown and winding input', 'control', 'illustrative', 'illustrative', 'grand-seiko-mechanical', null,
    'No winding action or stored-energy amount is simulated; energy is controlled by the explicit teaching-model energy toggle.', 'not modeled'),
  component('mechanical.barrel', 'mechanical', 'Barrel', 'energy', 'illustrative', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.energy.available',
    'The current boolean says whether the modeled mainspring energy path is available; it is not a reserve measurement.', 'boolean'),
  component('mechanical.mainspring', 'mechanical', 'Mainspring', 'energy', 'fact', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.energy.available',
    'Reads the modeled energy-enabled state. Stored torque, energy, and power reserve are not simulated.', 'boolean'),
  component('mechanical.goingTrain', 'mechanical', 'Going and hand gear train', 'energy', 'fact', 'derived', 'grand-seiko-mechanical', 'models.mechanical.gearTrain',
    'Reads derived hand turns, teaching gear-pair ratios, and hand angles for the configured elapsed display time. Tooth counts are teaching choices, not a named watch train.', 'turns and degrees'),
  component('mechanical.escapeWheel', 'mechanical', 'Escape wheel', 'timing', 'fact', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.escapement.eventIndex',
    'The model records its controlled escapement event index; the index does not simulate tooth contact geometry.', 'events'),
  component('mechanical.palletFork', 'mechanical', 'Pallet fork', 'timing', 'fact', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.escapement.phase',
    'Reads the discrete modeled escapement phase (lock, release, or impulse); it is an ideal teaching sequence.', 'phase'),
  component('mechanical.balanceWheel', 'mechanical', 'Balance wheel', 'timing', 'fact', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.oscillator.cycles',
    'Counts modeled full balance oscillations. A full oscillation contains two escapement beats.', 'cycles'),
  component('mechanical.hairspring', 'mechanical', 'Hairspring', 'timing', 'fact', 'simulation', 'grand-seiko-mechanical', 'models.mechanical.oscillator.phase',
    'Reads the same ideal oscillator phase used by the balance model; it does not model spring shape, torque, or material behavior.', 'phase'),
  component('mechanical.support', 'mechanical', 'Plate, bridges, pivots, and jewels', 'support', 'illustrative', 'illustrative', 'grand-seiko-mechanical', null,
    'Support geometry is illustrative and has no dynamic state in this teaching model.', 'not modeled'),
  hand('mechanical.secondHand', 'mechanical', 'Second hand', 'second', 'grand-seiko-mechanical'),
  hand('mechanical.minuteHand', 'mechanical', 'Minute hand', 'minute', 'grand-seiko-mechanical'),
  hand('mechanical.hourHand', 'mechanical', 'Hour hand', 'hour', 'grand-seiko-mechanical'),

  component('quartz.battery', 'quartz', 'Battery', 'energy', 'fact', 'simulation', 'grand-seiko-quartz', 'models.quartz.energy.available',
    'The boolean records whether the modeled quartz energy path is enabled; it is not voltage, charge, or battery life.', 'boolean'),
  component('quartz.crystal', 'quartz', 'Quartz resonator', 'timing', 'fact', 'simulation', 'seiko-quartz-education', 'models.quartz.oscillator.cycles',
    'Reads the exact modeled reference-cycle counter. The 32,768 Hz setting is a generic teaching parameter, not a universal watch specification.', 'cycles'),
  component('quartz.oscillator', 'quartz', 'Oscillator circuit', 'timing', 'fact', 'simulation', 'grand-seiko-quartz', 'models.quartz.oscillator.phase',
    'Reads the modeled oscillator phase; this is not an electrical waveform or circuit-level simulation.', 'phase'),
  component('quartz.divider', 'quartz', 'Frequency divider', 'timing', 'fact', 'simulation', 'seiko-quartz-education', 'models.quartz.dividerStages',
    'Each listed stage divides by two; the standard example uses fifteen stages from 32,768 Hz to 1 Hz.', 'stage counts'),
  component('quartz.motorDriver', 'quartz', 'Motor driver', 'control', 'fact', 'simulation', 'grand-seiko-quartz', 'models.quartz.counts.motorCommands',
    'Counts generic one-per-second motor commands. A command is not a universal electrical pulse pattern.', 'commands'),
  component('quartz.coil', 'quartz', 'Coil and stator', 'energy', 'illustrative', 'simulation', 'grand-seiko-quartz', 'models.quartz.counts.motorCommands',
    'The schematic separates a generic motor drive from its count; coil current and magnetic fields are not simulated.', 'commands'),
  component('quartz.rotor', 'quartz', 'Step-motor rotor', 'energy', 'fact', 'simulation', 'grand-seiko-quartz', 'models.quartz.counts.motorCommands',
    'Shows the motor-command count as a teaching proxy; it does not claim a universal rotor angle or pulse-to-step ratio.', 'commands'),
  component('quartz.gears', 'quartz', 'Reduction and display gears', 'energy', 'fact', 'derived', 'grand-seiko-quartz', 'models.quartz.gearTrain',
    'Reads derived hand turns, teaching gear-pair ratios, and hand angles for the configured elapsed display time. The chosen teeth are not specific to a real watch.', 'turns and degrees'),
  hand('quartz.secondHand', 'quartz', 'Second hand', 'second', 'grand-seiko-quartz'),
  hand('quartz.minuteHand', 'quartz', 'Minute hand', 'minute', 'grand-seiko-quartz'),
  hand('quartz.hourHand', 'quartz', 'Hour hand', 'hour', 'grand-seiko-quartz'),

  component('software.logicalTime', 'software', 'Simulation time accumulator', 'timing', 'derived', 'simulation', 'fixed-timestep-author', 'models.software.operatingTime',
    'Read the software model’s accumulated logical time; this is separate from host elapsed time and requestAnimationFrame cadence.', 'rational seconds'),
  component('software.scheduler', 'software', 'Browser render scheduler', 'control', 'fact', 'illustrative', 'mdn-animation-frame', null,
    'No callback count is modeled. Render callbacks schedule observation only and are not authoritative logical ticks.', 'not modeled'),
  component('software.updateCounter', 'software', 'Logical update counter', 'timing', 'derived', 'simulation', 'fixed-timestep-author', 'models.software.counts.updates',
    'Count of software state updates; it advances under the declared simulation policy, not once per rendered frame.', 'updates'),
  component('software.renderer', 'software', 'Renderer', 'display', 'fact', 'illustrative', 'mdn-animation-frame', null,
    'The renderer observes logical model state. Rendering and hidden-tab callback suspension do not add simulation ticks.', 'not modeled'),
  hand('software.secondHand', 'software', 'Second hand', 'second', 'fixed-timestep-author'),
  hand('software.minuteHand', 'software', 'Minute hand', 'minute', 'fixed-timestep-author'),
  hand('software.hourHand', 'software', 'Hour hand', 'hour', 'fixed-timestep-author')
];

function component(id, model, name, role, roleStatus, valueStatus, sourceId, statePath, formula, unit) {
  return { id, model, name, role, roleStatus, valueStatus, sourceId, statePath, formula, unit };
}

function hand(id, model, name, handName, sourceId) {
  return component(id, model, name, 'display', 'fact', 'derived', sourceId,
    `models.${model}.handAnglesDegrees.${handName}`,
    `Angle = 360 × (nominal display time / hand period) modulo 360; second period 60 s, minute period 3,600 s, hour period 43,200 s. Later oscillator-rate changes alter when visible events occur and cause modeled drift.`, 'degrees');
}

/** Return fresh copies of stable IDs and metadata for the geometry/UI layer. */
export function componentDefinitions() {
  return defs.map(definition => ({ ...definition }));
}

/** Return fresh copies of source notes; claims stay separate from simulated current values. */
export function componentSources() {
  return sources.map(source => ({ ...source }));
}

/** Bind one component label to a full watch-run state and its source record. */
export function describeWatchComponent(state, id) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) throw new TypeError('state must be an object');
  const definition = defs.find(item => item.id === id);
  if (!definition) throw new RangeError(`unknown watch component: ${id}`);
  const source = sources.find(item => item.id === definition.sourceId);
  let value;
  if (definition.statePath) value = readPath(state, definition.statePath);
  else value = definition.valueStatus === 'illustrative' ? 'not modeled' : undefined;
  if (value === undefined) throw new TypeError(`${definition.id} has no value at ${definition.statePath ?? 'its documented illustrative value'}`);
  return { ...definition, source: { ...source }, value: cloneValue(value) };
}

function readPath(state, path) {
  const keys = path.split('.');
  // Callers may pass the full run, a wrapper with `run`, or bare mechanism output.
  const root = state.run && typeof state.run === 'object' ? state.run : state;
  const candidates = [[root, keys]];
  if (root.models && typeof root.models === 'object') candidates.push([root.models, keys.slice(1)]);
  else if (root.mechanical || root.quartz || root.software) candidates.push([{ models: root }, keys]);
  for (const [candidate, lookup] of candidates) {
    let current = candidate;
    for (const key of lookup) current = current?.[key];
    if (current !== undefined) return current;
  }
  throw new TypeError(`watch state is missing ${path}`);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}
