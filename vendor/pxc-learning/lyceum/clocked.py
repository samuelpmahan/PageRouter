"""Hypothesis: seek observes a complete logical clock snapshot."""

from common import BaseModel, Observation, apply_rule, dependencies


class Model(BaseModel):
    """Resolve whole ticks; registers only read the preceding tick."""

    def __init__(self, circuit, stimuli):
        super().__init__(circuit, stimuli)
        self._completed_through = -1
        self._blocked = {}

    def seek(self, address, tick=0):
        observation = self.leaf(address, tick)
        if observation is not None and observation.status == "conflict":
            return observation
        for cycle in range(self._completed_through + 1, tick + 1):
            self._evaluate_tick(cycle)
            self._completed_through = cycle
        observation = self.leaf(address, tick)
        if observation is not None:
            return observation
        return self._blocked.get(
            (address, tick), Observation("pending", reason="Unresolved snapshot")
        )

    def _evaluate_tick(self, tick):
        staged = {}
        failures = {}
        executed = {}
        for address in sorted(self.circuit.values):
            observation = self.leaf(address, tick)
            if observation is not None and observation.status == "ready":
                staged[address] = observation.value
            elif observation is not None and observation.status == "conflict":
                failures[address] = observation

        remaining = {
            output: calc
            for output, calc in self.circuit.producers.items()
            if output not in staged
        }
        # ponytail: repeated scans suit small circuits; a work queue scales better.
        while remaining:
            ready = {}
            failed = {}
            for output, calc in remaining.items():
                undeclared = next(
                    (address for address in calc.inputs if address not in self.circuit.values),
                    None,
                )
                if undeclared is not None:
                    failed[output] = Observation(
                        "conflict", reason=f"unknown value Part: {undeclared}"
                    )
                    continue
                if calc.rule == "delay" and tick == 0:
                    if calc.initial is not None:
                        ready[output] = calc.initial
                    continue

                values = []
                for dependency, source_tick in dependencies(calc, tick):
                    source = staged if source_tick == tick else self.cache
                    key = dependency if source_tick == tick else (dependency, source_tick)
                    if key in source:
                        values.append(source[key])
                        continue
                    failure = (
                        failures.get(dependency)
                        if source_tick == tick
                        else self._blocked.get((dependency, source_tick))
                    )
                    if failure is not None and failure.status == "conflict":
                        failed[output] = Observation(
                            "conflict", reason=f"Dependency {dependency}: {failure.reason}"
                        )
                    break
                else:
                    try:
                        ready[output] = (
                            values[0]
                            if calc.rule == "delay"
                            else apply_rule(calc.rule, tuple(values))
                        )
                    except (TypeError, ValueError, IndexError) as error:
                        failed[output] = Observation("conflict", reason=str(error))

            if not ready and not failed:
                break
            # A wave reads only the previous wave's snapshot. Publish together.
            staged.update(ready)
            failures.update(failed)
            for output in ready:
                executed[output] = remaining.pop(output)
            for output in failed:
                remaining.pop(output)

        # Registers and combinational results become externally visible together.
        for output, calc in executed.items():
            self.remember(output, tick, staged[output], calc)
        for output in remaining:
            failures[output] = Observation(
                "pending", reason="Missing input/initial state or combinational cycle"
            )
        self._blocked.update({(address, tick): result for address, result in failures.items()})
