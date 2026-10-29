package pxc

import (
	"fmt"
	"math"
)

// Reading is one way to read a circuit over worlds: a commutative semiring plus how a variable's chance of being true becomes
// the weights of its two literals. A world's weight is the product (Times) of its literals' weights; a reading's answer is
// the sum (Plus) over the worlds where the circuit holds. That is algebraic model counting (Kimmig, Van den Broeck and De Raedt,
// 2017), and on a decomposable, deterministic circuit it can be computed gate by gate instead of world by world.
//
// These are questions about worlds. The kernel's provenance.evaluate answers questions about derivations (how many ways, the
// cheapest way, which inputs), and those are right on the polynomial as recorded, with no compile step.
type Reading struct {
	Name        string
	Zero, One   float64
	Plus, Times func(a, b float64) float64
	// Weigh turns P(variable is true) into {weight of NOT x, weight of x}.
	Weigh func(p float64) [2]float64
}

var (
	// Possible: can the circuit hold at all, given which literals are still possible (a probability of exactly 0 or 1 rules
	// one out).
	Possible = Reading{"possible (or, and)", 0, 1, math.Max, math.Min,
		func(p float64) [2]float64 { return [2]float64{boolWeight(p < 1), boolWeight(p > 0)} }}
	// Probability: the chance the circuit holds when variables are independent.
	Probability = Reading{"probability (+, ×)", 0, 1,
		func(a, b float64) float64 { return a + b }, func(a, b float64) float64 { return a * b },
		func(p float64) [2]float64 { return [2]float64{1 - p, p} }}
	// MostLikelyWorld: the probability of the single most likely world in which the circuit holds (the Lab's viterbi).
	MostLikelyWorld = Reading{"most likely world (max, ×)", 0, 1, math.Max,
		func(a, b float64) float64 { return a * b },
		func(p float64) [2]float64 { return [2]float64{1 - p, p} }}
	// CheapestWorld: the least cost of a world in which the circuit holds, a literal costing −log of its probability (the
	// Lab's tropical, min and +). It is the most likely world again, on a log scale that does not underflow.
	CheapestWorld = Reading{"cheapest world (min, +)", math.Inf(1), 0, math.Min,
		func(a, b float64) float64 { return a + b },
		func(p float64) [2]float64 { return [2]float64{-math.Log(1 - p), -math.Log(p)} }}
	// WorldCount: how many worlds the circuit holds in, among those the evidence allows (the Lab's counting).
	WorldCount = Reading{"world count (+, ×)", 0, 1,
		func(a, b float64) float64 { return a + b }, func(a, b float64) float64 { return a * b },
		func(p float64) [2]float64 { return [2]float64{boolWeight(p < 1), boolWeight(p > 0)} }}

	Readings = []Reading{Possible, Probability, MostLikelyWorld, CheapestWorld, WorldCount}
)

func boolWeight(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// Weights[v] = {weight of NOT v, weight of v}.
type Weights [][2]float64

// WeighAll turns one probability per variable into literal weights for a reading.
func (r Reading) WeighAll(p []float64) Weights {
	w := make(Weights, len(p))
	for v, pv := range p {
		w[v] = r.Weigh(pv)
	}
	return w
}

// needsSmoothing reports whether some variable's two literal weights do not add up to One, so a variable an OR branch skips
// would be miscounted. Probability never needs it (p + (1 − p) = 1); world counts and most likely worlds do.
func (r Reading) needsSmoothing(w Weights) bool {
	for _, x := range w {
		s := r.Plus(x[0], x[1])
		if s != r.One && math.Abs(s-r.One) > 1e-12*math.Max(1, math.Abs(r.One)) {
			return true
		}
	}
	return false
}

// Evaluate reads a circuit in one reading, gate by gate, after checking the FunctionalGuarantees the reading needs. It refuses
// (with a *GuaranteeError) a circuit that is not decomposable and deterministic, or not smooth when the weights need it.
func Evaluate(c *Circuit, r Reading, w Weights) (float64, error) {
	if len(w) != len(c.Variables) {
		return 0, fmt.Errorf("pxc: %d weights for %d variables", len(w), len(c.Variables))
	}
	a := Check(c)
	var needs []string
	if !a.Decomposable() || !a.Deterministic() {
		needs = append(needs, "decomposable", "deterministic")
	}
	if r.needsSmoothing(w) && !a.Smooth() {
		needs = append(needs, "smooth")
	}
	if len(needs) > 0 {
		return 0, &GuaranteeError{Reading: r.Name, Audit: a, Needs: needs}
	}
	return EvaluateAsWritten(c, r, w), nil
}

// EvaluateAsWritten reads a circuit gate by gate with no checks: AND is Times, OR is Plus, a literal is its weight. On a
// circuit that fails the guarantees the answer can be wrong, which is what the checks exist to catch; it is exported so the
// wrong answer can be shown next to the right one.
func EvaluateAsWritten(c *Circuit, r Reading, w Weights) float64 {
	val := make([]float64, c.Root+1)
	for i := 0; i <= c.Root; i++ {
		n := c.Nodes[i]
		switch n.Kind {
		case False:
			val[i] = r.Zero
		case True:
			val[i] = r.One
		case Literal:
			if n.Negated {
				val[i] = w[n.Variable][0]
			} else {
				val[i] = w[n.Variable][1]
			}
		case And:
			val[i] = r.Times(val[n.Children[0]], val[n.Children[1]])
		case Or:
			val[i] = r.Plus(val[n.Children[0]], val[n.Children[1]])
		}
	}
	return val[c.Root]
}

// BruteForce is the definition, world by world: Plus over the worlds where the circuit holds of Times over the world's literal
// weights. It is the test oracle, and only practical up to about 22 variables.
func BruteForce(c *Circuit, r Reading, w Weights) float64 {
	n := len(c.Variables)
	if n > 24 {
		panic("pxc: BruteForce is for at most 24 variables")
	}
	total := r.Zero
	world := make([]bool, n)
	for m := uint64(0); m < 1<<n; m++ {
		weight := r.One
		for v := 0; v < n; v++ {
			world[v] = m&(1<<v) != 0
			if world[v] {
				weight = r.Times(weight, w[v][1])
			} else {
				weight = r.Times(weight, w[v][0])
			}
		}
		if c.Holds(world) {
			total = r.Plus(total, weight)
		}
	}
	return total
}

// Compiled is the compile step as the kernel runs it: compile, write the smoothed circuit, and check it. It returns an error
// only if the compiled circuit fails a guarantee, which would be a bug in Compile.
func Compiled(c *Circuit) (*Circuit, *DecisionDiagram, error) {
	d := Compile(c, nil)
	out := d.Circuit(true)
	if a := Check(out); !a.Decomposable() || !a.Deterministic() || !a.Smooth() {
		return nil, d, &GuaranteeError{Reading: "compiled", Audit: a, Needs: []string{"decomposable", "deterministic", "smooth"}}
	}
	return out, d, nil
}
