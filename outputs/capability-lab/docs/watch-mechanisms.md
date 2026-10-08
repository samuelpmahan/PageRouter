# Mechanical and quartz teaching models

`src/watches/mechanisms.mjs` is a dependency-free browser-safe adapter. It accepts exact totals from the shared watch transport and returns fresh mechanical and quartz model views. It does not advance time, consume energy, or infer event totals from the current oscillator rate.

## Public functions

- `mechanismSnapshot(config, snapshot)` returns `{ mechanical, quartz }`.
- `externalGearPair({ driverTurns, driverTeeth, drivenTeeth })` returns exact signed turn ratios for one external mesh.
- `teachingHandTrain({ displayTime })` composes four external meshes into a generic second/minute/hour hand train.
- `handAnglesAt({ displayTime })` returns second, minute, and hour angles in degrees modulo 360.

The same operations appear as three synchronous capabilities: `statistics.externalGearPair` is atomic; `statistics.teachingHandTrain` calls that capability for each mesh; and `statistics.mechanismSnapshot` calls the train capability for each watch model. Runtime traces therefore show the actual dependency calls. Descriptor examples use literal expected values independent of the implementation.

## Snapshot input and validation

Every time, operating time, display time, and accrued cycle total is a rational object `{ numerator, denominator }`. Both fields are safe integers; the denominator must be positive. Public results reduce rationals to lowest terms. BigInt is used internally for powers of two and ratio arithmetic, while results remain JSON-safe.

`config` accepts positive `mechanicalHz` and `quartzHz` values as positive safe integers or positive rationals. They are the initial, nominal design rates. `dividerStages` defaults to 15 and accepts an integer from 0 through 30. The default rates are 4 Hz mechanical and 32,768 Hz quartz; these are teaching settings, not universal watch specifications.

`snapshot` requires these fields (the descriptor schema checks the top-level object shape; the function performs the detailed rational, range, boolean, and cross-field checks below):

```js
{
  time: { numerator, denominator },
  operatingTime: { mechanical, quartz },
  displayTime: { mechanical, quartz, software },
  cycles: { mechanicalBeats, quartzCycles },
  counters: { mechanicalBeats, quartzCycles, motorCommands },
  energy: { mainspring, battery },
  rates?: { mechanicalHz, quartzHz }
}
```

All times and cycles are nonnegative rationals. Counters are nonnegative safe integers. Mechanical and quartz cycle counters must equal the floor of their corresponding rational accrued totals. `motorCommands` must equal the terminal divider output, `floor(quartzCycles / 2^dividerStages)`. Divider-stage configuration is limited to 0 through 30; the default is 15. The adapter rejects snapshots whose supplied `displayTime` disagrees with nominal gearing:

- mechanical display seconds = `mechanicalBeats / (2 × nominalMechanicalHz)`;
- quartz display seconds = `motorCommands × 2^dividerStages / nominalQuartzHz`.

This check keeps hand angles continuous against the initial gear design when an oscillator rate changes. Optional `snapshot.rates` are current live rates; zero is allowed to model a stopped oscillator. A live rate of zero leaves an enabled energy source available but makes `timing.available` false. Operating time and accumulated phases are passed through, so an energy interruption retains prior totals. Input objects are read without mutation.

## Model formulas

The mechanical model reports completed beats from `counters.mechanicalBeats`. One full oscillation contains two beats, so `oscillator.cycles = cycles.mechanicalBeats / 2`, and `counts.fullOscillations` is the floor of that rational value. `oscillator.phase` is its fractional part. The default 4 Hz full-oscillation rate produces 8 beats per second.

The escapement state is an explicitly illustrative sequence based on the fraction of a beat: `[0, 1/2)` is `lock`, `[1/2, 3/4)` is `release`, and `[3/4, 1)` is `impulse`. A completed beat returns to `lock`. These windows are chosen for a visible schematic; they do not claim measured contact timing or a specific escapement geometry.

For quartz, each divider stage halves its input. Stage `i` reports `floor(quartzCycles / 2^i)`; `divisor: 2` describes that stage's local factor. Fifteen stages turn the generic 32,768 Hz reference into one generic motor command per second. The quartz crystal supplies a timing reference; the battery supplies the modeled energy path.

Hand turns are derived from nominal `displayTime`:

- second hand: `time / 60` turns;
- minute hand: `time / 3,600` turns;
- hour hand: `time / 43,200` turns.

The generic train exposes each mesh instead of hiding these ratios. An external mesh uses `drivenTurns = -driverTurns × driverTeeth / drivenTeeth`. The illustrative second-to-minute path uses 20:120 followed by 20:200: two direction reversals and a net 1:60 ratio. The minute-to-hour path uses 20:60 followed by 20:80: two reversals and a net 1:12 ratio. The chosen tooth counts are teaching values, not a watch caliber.

Hand angles are finite JavaScript numbers. For sub-degree fractions, exact equality between two algebraically equivalent floating-point calculations is not promised; consumers comparing such values should use a small numeric tolerance.

## Source limits

[Grand Seiko's mechanical movement overview](https://www.grand-seiko.com/uk-en/collections/movement/mechanical) describes a mainspring-powered gear train regulated by an escapement, balance, and hairspring. The page covers specific 9S calibers and notes caliber-dependent construction; 4 Hz appears for particular listed movements and is not a universal mechanical-watch rate.

[Seiko's quartz explanation](https://www.seiko.co.jp/csr/toki-iku/tokiq-nazotoki/) describes a typical 32,768 Hz quartz reference divided to a slower drive signal and notes exceptions. [Grand Seiko's 9F overview](https://www.grand-seiko.com/us-en/collections/movement/quartz) documents a specific quartz implementation whose twin-pulse motor advances the second hand twice per second. This generic model instead uses one motor command per second and does not claim a universal pulse pattern.

[KHK's gear reference](https://khkgears.net/pdf/internal-tech.pdf) supports the general relationship between tooth counts and gear ratio. It does not supply the teaching model's tooth counts or validate a particular watch train. Schematic parts and the lock/release/impulse phase windows are simulation or illustrative geometry, not measured physical dynamics.

## Independent checks

The owned tests use hand-computed 60-second and 24-hour totals, exact 1/8-second and 1/32,768-second boundaries, signed 20:40 mesh fixtures, complete hand-ratio fixtures, a 20:120 → 20:200 and 20:60 → 20:80 composed train, energy-off retained totals, current-rate faults including zero, malformed rational/counter rejection, and input non-mutation. Runtime examples are also executed through `createRegistry` to verify synchronous dependency traces.
