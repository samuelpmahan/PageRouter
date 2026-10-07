"""Demand-driven resolution of declarative Parts at a requested tick."""

from common import BaseModel, Observation, apply_rule, dependencies


class Model(BaseModel):
    """Resolve only the dependency graph needed by a question."""

    def seek(self, address, tick=0):
        return self._resolve(address, tick, [])

    def _resolve(self, address, tick, active):
        known = self.leaf(address, tick)
        if known is not None:
            return known

        key = (address, tick)
        if key in active:
            loop = active[active.index(key):] + [key]
            path = " -> ".join(f"{name}@{time}" for name, time in loop)
            return Observation("conflict", reason=f"combinational cycle: {path}")

        calc = self.circuit.producers[address]
        active.append(key)
        try:
            # ponytail: Python recursion bounds graph depth; an explicit stack can lift it.
            required = dependencies(calc, tick)
            observations = [self._resolve(name, time, active)
                            for name, time in required]
            for status in ("conflict", "pending"):
                for (name, time), observed in zip(required, observations):
                    if observed.status == status:
                        return Observation(status, reason=(
                            f"{calc.address}@{tick} needs {name}@{time}: "
                            f"{observed.reason}"))

            values = tuple(observed.value for observed in observations)
            if calc.rule == "delay":
                value = calc.initial if tick == 0 else values[0]
            else:
                value = apply_rule(calc.rule, values)
            return self.remember(address, tick, value, calc)
        except (ValueError, TypeError) as error:
            return Observation("conflict", reason=f"{calc.address}@{tick}: {error}")
        finally:
            active.pop()
