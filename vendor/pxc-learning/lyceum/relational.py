"""Experimental readiness from finite domains, not dependency completion."""

from itertools import product

from common import BaseModel, Observation, apply_rule, dependencies


class Model(BaseModel):
    """Narrow possible values in the requested dependency graph to a fixed point.

    A fixed point means another propagation pass removes no possibilities.
    This is local consistency, not a proof that every cycle is satisfiable.
    """

    def seek(self, address, tick=0):
        observed = self.leaf(address, tick)
        if observed is not None:
            return observed
        domains, calculations = {}, {}

        def collect(key):
            if key in domains:
                return
            observed = self.leaf(*key)
            if observed is not None:
                if observed.status == "conflict":
                    raise ValueError(observed.reason)
                domains[key] = ({observed.value} if observed.status == "ready"
                                else {0, 1})
                return
            calc = self.circuit.producers[key[0]]
            inputs = dependencies(calc, key[1])
            calculations[key] = (calc, inputs)
            # A bundle's tuple shape emerges from its inputs.
            domains[key] = None if calc.rule == "bundle" else {0, 1}
            if calc.rule == "delay" and key[1] == 0:
                domains[key] = {calc.initial}
            for source in inputs:
                collect(source)

        def support(key, calc, inputs):
            if calc.rule == "delay" and key[1] == 0:
                return {key: {calc.initial}}
            if any(domains[source] is None for source in inputs):
                return None
            if calc.rule.startswith("check:"):
                # Guarantees observe fulfilled values; no desired verdict is
                # installed as a constraint that could repair a wrong gate.
                if any(len(domains[source]) != 1 for source in inputs):
                    return None
            sources = tuple(dict.fromkeys(inputs))
            allowed = {source: set() for source in (*sources, key)}
            last_error = "inconsistent relation"
            # ponytail: exhaustive local tables suit small Boolean gates;
            # wide uncertain bundles need a symbolic domain representation.
            for values in product(*(domains[source] for source in sources)):
                assignment = dict(zip(sources, values))
                arguments = tuple(assignment[source] for source in inputs)
                try:
                    result = apply_rule("wire" if calc.rule == "delay"
                                        else calc.rule, arguments)
                except (ValueError, TypeError, IndexError) as error:
                    last_error = str(error)
                    continue
                if key in assignment and assignment[key] != result:
                    continue
                if domains[key] is not None and result not in domains[key]:
                    continue
                assignment[key] = result
                for source, value in assignment.items():
                    allowed[source].add(value)
            if not allowed[key]:
                raise ValueError(f"{calc.address}@{key[1]}: {last_error}")
            return allowed

        try:
            collect((address, tick))
            validators = {key for key, (calc, _) in calculations.items()
                          if calc.rule.startswith("check:")}
            changed = True
            while changed:
                changed = False
                for key, (calc, inputs) in calculations.items():
                    allowed = support(key, calc, inputs)
                    if allowed is None:
                        continue
                    for source, possible in allowed.items():
                        # A verdict is fulfilled only by its own validator.
                        if source in validators and source != key:
                            continue
                        if domains[source] != possible:
                            domains[source] = possible
                            changed = True
        except (ValueError, TypeError, IndexError) as error:
            return Observation("conflict", reason=str(error))

        for key, possible in domains.items():
            if possible is not None and len(possible) == 1:
                calc = calculations[key][0] if key in calculations else None
                result = self.remember(*key, next(iter(possible)), calc=calc)
                if result.status == "conflict":
                    return result
        if (address, tick) in self.cache:
            return Observation("ready", self.cache[address, tick])
        return Observation("pending", reason="multiple possibilities or unresolved shape")
