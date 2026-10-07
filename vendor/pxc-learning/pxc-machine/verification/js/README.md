# Independent JavaScript runtime verification

The JavaScript runtime independently compiles and executes the machine's serialized primitive declarations. The recorded run passed **26 cases, 1,221 states, 4,329,398 complete bit comparisons**, and **4,323,404 actual Calculation evaluations**, with zero correctness loss. Calculations include primitive FG validators; these counts are software work, not a hardware clock or transistor count.

The result and source hashes are in [`verification.json`](verification.json). Nine focused unit checks are recorded in [`unit-checks.txt`](unit-checks.txt).

## Independence and compilation

[`runtime.mjs`](runtime.mjs) imports no Python execution helpers and contains no integer CPU interpreter. It implements NAND, wire, ideal clocked delay, and three corresponding validators. The implementer did not inspect either the Python bit evaluator or the Python instruction evaluator. Python source bytes are hashed only to identify the compared revision.

Compilation starts with the requested Part addresses. It follows each producer's `inputAddresses`, then the validator Calculations declared by every reached FG. It includes temporal source Parts in the required closure. For execution order, a delay's source belongs to the previous state; its initial value belongs to the current state. A separate Kahn queue sorts the resulting graph: a Calculation becomes ready when its current-state dependencies have completed.

The compiler checks that every numeric alias agrees with its corresponding address, rejects duplicate identities/producers and invalid references, and compares its independently derived closure with the reported plan. It checks the supplied order's membership but never schedules from that order. One passing fixture deliberately reverses the Python order. Partial plans retain unused addresses as `null` slots; every reached value must still have a producer, constant, or declared input.

Execution reads only external input observations from the fixture. Python output bits and bus values are comparison evidence; they do not feed the JavaScript computation. NAND validation reads the declared literal table while the NAND primitive uses its own bit operation. The named failure hook retains failed verdicts for inspection.

## Recorded cases

| Cases | States | Coverage |
|---|---:|---|
| NAND, wire, two delay initial states, reversed-order NAND | 22 | Every NAND row, both wire values, both delay initial bits and all four transitions. |
| Three CPU demos | 45 | Countdown, arithmetic, and input/output. |
| 16 generated CPU programs | 144 | Seeds 20261004–20261019; explicit program bytes, initial state, and inputs retained. |
| Lane A selected full adder | 8 | Every input row of the composed circuit. |
| Lane B stopwatch/display | 1,002 | Every state t(0) through t(1001), with one logical millisecond per tick. |

Every case compares complete value arrays, bus projections, FG counts/verdict bits, required Calculation membership, execution evidence, and current-state dependency order. Both histories must match the requested horizon and each state must carry its expected tick number. Small gate/delay cases and the full-adder requirement also have literal expected behavior. The seven loss categories are recorded separately; every weight is 1 and the required sum is 0.

Four malformed declarations are rejected: reversed input aliases, a duplicate value address, a missing declared validator, and an omitted required bit.

Review exposed two missing evidence checks: an incorrect recorded tick could pass, and two empty histories could agree despite a nonempty requested horizon. Adversarial tests now catch both. Their observed pre-fix failures are retained in [`timestamp-check-red.json`](timestamp-check-red.json) and [`horizon-check-red.json`](horizon-check-red.json). [`partial-plan-red.txt`](partial-plan-red.txt) preserves the failing test that led to correct handling of unused addresses in partial plans.

Two altered JavaScript source files execute in isolated child processes. The wrong NAND produces **8 differing bits and 4 differing FG failure counts**; stale delay capture produces **4 differing bits and 2 differing FG failure counts**. These positive losses demonstrate detection. They are retained under [`mutants/`](mutants/) and do not add fault switches to the normal runtime.

## Evidence format

[`traces/`](traces/) contains one gzip-compressed JSON-lines file per case, approximately 48.4 MB total for this run. The first line holds declarations, explicit stimuli, the independent plan, configuration, and runtime source hash. Every following line holds one complete JavaScript state and its Python comparison state.

The JavaScript state includes every value, buses, FG results, the actual evaluated indices, `pxcLog` rows `[calculationIndex, producedBit]`, and independently recorded `seekLog` rows `[calculationIndex, 0]`. Here `0` means newly evaluated; the JavaScript runtime does not reuse prior results. Python compact fixtures retain every value, FG summary, bus, and actual evaluated/reused index; they omit Python's redundant per-operation log rows. Small fixtures retain those Python logs too.

[`python_bridge.py`](python_bridge.py) calls public declaration builders and `run_net`. It supports persistent JSON-lines requests; `--list` describes the available fixture families. [`verify.mjs`](verify.mjs) compares the results, writes the complete evidence, records mutations, and checks source hashes before and after the run.

## Reproduce

From the shared workspace root, using the existing Node runtime:

```sh
work/lyceum-js/node-v24.21.0-linux-x64/bin/node outputs/pxc-machine/verification/js/test_runtime.mjs
python3 -B outputs/pxc-machine/verification/js/python_bridge.py --self-test
work/lyceum-js/node-v24.21.0-linux-x64/bin/node outputs/pxc-machine/verification/js/verify.mjs
```

The last command rewrites this directory's verification receipt, mutant copies, and traces. No installation, server, browser, publication, or checkpoint edit is needed.

## Limits

This establishes agreement between independently implemented primitive runtimes for the recorded declarations and inputs. The runtimes share the circuit declarations, so an incorrect circuit design can agree in both. CPU instruction-level correctness remains covered by the separate machine oracle; this run samples CPU programs rather than exhausting them.

The implementation accepts the serialized NAND/wire/delay plan format, with buses at most 52 bits wide for exact JavaScript numeric projection. It does not verify arbitrary Python or JavaScript. The clock is ideal: physical propagation, metastability, power, oscillator error, and hardware timing are outside the experiment.

The receipt reports measured software times per case. The measurements cover different surrounding work: JavaScript excludes transport, comparison, and compression. They are not a controlled speedup benchmark or a hardware timing claim.
