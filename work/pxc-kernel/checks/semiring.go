package ringgate

import "math"

// Semiring: one circuit, many readings (algebraic model counting, Kimmig, Van den Broeck and De Raedt 2017). Values are float64
// for all three; the Boolean reading uses 0 and 1.
type Semiring struct {
	Name        string
	Zero, One   float64
	Plus, Times func(a, b float64) float64
	// Neutral reports whether w(x) PLUS w(NOT x) = One for these weights; when it holds, skipped variables need no smoothing.
}

var (
	Boolean = Semiring{"Boolean (or, and)", 0, 1,
		func(a, b float64) float64 { return math.Max(a, b) },
		func(a, b float64) float64 { return math.Min(a, b) }}
	Probability = Semiring{"probability (+, ×)", 0, 1,
		func(a, b float64) float64 { return a + b },
		func(a, b float64) float64 { return a * b }}
	Tropical = Semiring{"tropical (max, +)", math.Inf(-1), 0,
		func(a, b float64) float64 { return math.Max(a, b) },
		func(a, b float64) float64 { return a + b }}
)

// Weights[v] = {w(NOT v), w(v)}.
type Weights [][2]float64

// ProbWeights turns P(v) into weights for each reading: Boolean says which literals are possible (P strictly between 0 and 1
// leaves both), probability uses P and 1 - P, tropical uses their logarithms, so its answer is the log-probability of the
// single most probable world in which the gate fires.
func ProbWeights(s Semiring, p []float64) Weights {
	w := make(Weights, len(p))
	for v, pv := range p {
		switch s.Name {
		case Boolean.Name:
			w[v] = [2]float64{b2f(pv < 1), b2f(pv > 0)}
		case Probability.Name:
			w[v] = [2]float64{1 - pv, pv}
		case Tropical.Name:
			w[v] = [2]float64{math.Log(1 - pv), math.Log(pv)}
		}
	}
	return w
}

func b2f(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

// EvalCircuit reads the circuit node by node in a semiring: leaf -> its weight, AND -> Times, OR -> Plus. This is the reading
// the first draft claimed is correct for every semiring "by construction".
func EvalCircuit(c *Circuit, s Semiring, w Weights) float64 {
	val := make([]float64, len(c.Nodes))
	for i, n := range c.Nodes {
		switch n.Kind {
		case KFalse:
			val[i] = s.Zero
		case KTrue:
			val[i] = s.One
		case KLeaf:
			if n.Neg {
				val[i] = w[n.Var][0]
			} else {
				val[i] = w[n.Var][1]
			}
		case KAnd:
			val[i] = s.Times(val[n.A], val[n.B])
		case KOr:
			val[i] = s.Plus(val[n.A], val[n.B])
		}
	}
	return val[c.Root]
}

// EvalBDD reads the compiled decision diagram: each split x contributes w(x) TIMES high PLUS w(NOT x) TIMES low. With smooth,
// every variable an edge skips multiplies in (w(x) PLUS w(NOT x)), so every model mentions every variable.
func EvalBDD(d *BDD, root int, order []int, s Semiring, w Weights, smooth bool) float64 {
	gap := func(from, to int) float64 { // levels from+1 .. to-1 are skipped
		g := s.One
		if !smooth {
			return g
		}
		for l := from + 1; l < to; l++ {
			v := order[l]
			g = s.Times(g, s.Plus(w[v][0], w[v][1]))
		}
		return g
	}
	memo := map[int]float64{}
	var val func(int) float64
	val = func(i int) float64 {
		if i == 0 {
			return s.Zero
		}
		if i == 1 {
			return s.One
		}
		if r, ok := memo[i]; ok {
			return r
		}
		l, v := d.Var[i], order[d.Var[i]]
		lo := s.Times(gap(l, d.Var[d.Lo[i]]), val(d.Lo[i]))
		hi := s.Times(gap(l, d.Var[d.Hi[i]]), val(d.Hi[i]))
		r := s.Plus(s.Times(w[v][0], lo), s.Times(w[v][1], hi))
		memo[i] = r
		return r
	}
	return s.Times(gap(-1, d.Var[root]), val(root))
}
