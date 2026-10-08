# Watch transport

`src/watches/transport.mjs` provides a browser-safe, pure ES module for advancing the watch models on one shared clock. “Pure” means each call returns a new frozen state and does not change its input. It models event counts and timing; it does not simulate physical contact forces or claim real-world accuracy.

## Public API

```js
createWatchRun(config = {})
applyWatchAction(state, action)
replayWatchRun(config = {}, actions = [])
normalizeRational(value)
addRational(left, right)
subtractRational(left, right)
multiplyRational(left, right)
divideRational(left, right)
compareRational(left, right)
floorRational(value)
canonicalWatchJson(value)
expandCounterRange(range, limit = 512)
expandCounterWindow(range, { offset, count, limit = 512 })
```

The standalone transport `replayWatchRun` returns the final state. The workbench wrapper adds canonical strings around that result for comparison. A rational is either a safe integer or `{ numerator, denominator }` with safe-integer fields and a nonzero denominator. Helpers accept signed rationals; durations and state quantities cannot be negative. Results are reduced to lowest terms with a positive denominator.

`createWatchRun` accepts initial `mechanicalHz`, `quartzHz`, and `softwareHz` (each a positive safe integer or rational), `dividerStages` from 0 through 30, optional `energy: { mainspring, battery }`, and optional `limits: { maxActions, maxBytes, maxExpandEvents }`. Defaults are rates 4, 32,768, and 256 Hz; 15 divider stages; both energy sources enabled; and limits of 2,000 actions, 1 MiB of history, and 512 expanded events. Initial rates must be positive. Later rate actions allow zero to represent a stopped oscillator.

Each state contains these transport fields:

- `time`: common elapsed logical time as a rational.
- `config`: initial, normalized rates, divider, energy, and limits.
- `rates`: current rates under `mechanicalHz`, `quartzHz`, and `softwareHz`.
- `operatingTime`: elapsed time each mechanism was powered; software advances independently of watch energy toggles.
- `cycles`: exact accumulated rational cycles, including fractional phase.
- `counters`: safe-integer `mechanicalBeats`, `quartzCycles`, `motorCommands`, and `softwareUpdates`.
- `displayTime`: visible time derived from the event counters and the initial nominal rates.
- `paused`, `visibilityHidden`, `energy`, `models.software`, and `softwareTransport`.
- `history`: ordered actions, compact event ranges, retained UTF-8 byte count, limits, and reset-session number.

The workbench adds `models.mechanical` and `models.quartz` snapshots around this base state.

## Time, rate, and power rules

All models share one exact elapsed time. Counts use a zero-phase convention: the counter is `floor(total accumulated cycles)`, so a cycle exactly at the action boundary is included. At the defaults, 60 seconds yields 480 mechanical beats, 1,966,080 quartz cycles, 60 motor commands, and 15,360 software updates. Mechanical beats run at twice the full-oscillation rate. Quartz motor commands run at `quartzHz / 2^dividerStages`.

`step` advances to the next integer-cycle boundary of its selected event using the current rate and any preserved fractional phase. Every other model advances by that exact same duration. For example, stepping one quartz cycle and then one mechanical beat ends at exactly 1/8 second; at that boundary the other models have reached 4,096 quartz cycles and 32 software updates. A rate change changes the time until later events but does not erase fractional phase.

Visible gearing stays tied to the initial nominal design. Mechanical display time is `mechanicalBeats / (2 * config.mechanicalHz)`, quartz display time is `motorCommands / (config.quartzHz / 2^dividerStages)`, and software display time is `softwareUpdates / config.softwareHz`. Thus a rate fault creates drift against common elapsed time instead of silently changing the gear ratio. Pausing or a hidden page blocks autoplay advances; manual advance and selected-event steps still work. Turning off the mainspring stops mechanical cycles and operating time; turning off the battery stops quartz cycles and motor commands. Common time and software updates continue.

Reset restores time, rates, energy, phases, counters, and visibility to the initial configuration, and sets `paused: true`. It increments the session while retaining the ordered action and event record. Replaying the retained actions from the same initial config reconstructs the complete state.

## Bounded event history

Each event range is inclusive and has this form:

```js
{
  event: 'mechanicalBeat' | 'quartzCycle' | 'motorCommand' | 'softwareUpdate',
  model: 'mechanical' | 'quartz' | 'software',
  start: 1,
  end: 128,
  timeStart: { numerator: 1, denominator: 32768 },
  timeEnd: { numerator: 1, denominator: 256 },
  session: 1,
  sequence: 1
}
```

`timeStart` and `timeEnd` are the exact first and last event boundaries. Each advance or selected step forms its own constant-rate/power segment. Rate and energy actions set the conditions for later event ranges. This keeps high-rate quartz cycles compact without losing exact event times.

`expandCounterRange(range, limit)` expands a complete small range and throws if it exceeds the limit. `expandCounterWindow(range, { offset, count, limit })` expands a bounded slice using a zero-based `offset`; returned event indexes remain one-based. It returns `{ events, offset, count, total, clippedBefore, clippedAfter }`, so an inspector can show when the visible slice omits earlier or later events. Both helpers reject requested expansions larger than their limit; window expansion may inspect a bounded slice of a larger retained range. The hard limit is 512 events. Callers can pass `config.limits.maxExpandEvents` as `limit` to use a lower per-run cap.

History byte count is the UTF-8 size of canonical `{ actions, events }`, excluding the rest of the state envelope. Even an empty history payload uses 26 bytes, so a smaller `maxBytes` is invalid. Configurable history caps cannot exceed 20,000 actions or 16 MiB. Reaching either retained-history limit throws `WatchTransportError` with a specific code. The reducer returns no partial state and drops no evidence.

## Exactness and limits

Internal arithmetic uses `BigInt` so common rational operations do not round. Browser-facing state stays ordinary JSON: every rational numerator, denominator, and integer counter must fit JavaScript’s safe-integer range. A computation that cannot be represented that way fails explicitly instead of emitting an approximate count. The public canonical serializer rejects undefined values, non-finite numbers, sparse arrays, cycles, accessors, and other non-JSON values; these values would otherwise be omitted or changed by JSON serialization.

`operatingTime` describes how long a model was powered, `time` is shared logical time, `cycles` preserve fractional phase, counters represent completed events, and `displayTime` represents nominal visible gearing. Keeping these separate is necessary to explain interruptions and rate faults without reconstructing one quantity from another.
