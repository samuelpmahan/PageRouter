package ringgate

import (
	"math"
	"math/rand"
)

type ReadingRow struct {
	Semiring                string
	Trials                  int
	Before, Split, Smoothed int     // trials matching brute force
	WorstBefore             float64 // largest relative error before splitting
	ExampleBefore           float64
	ExampleTruth            float64
}

type SmallResult struct {
	N, Need, Vars       int
	Analysis            Analysis
	AnalysisIndependent Analysis // same network, fit certain: a_i straight in
	BDDNodes, BDDSkips  int
	Rows                []ReadingRow
	Circuit             []Node
	Root                int
	Names               []string
	Flagged             map[int][]int
	NondeterministicOrs []int
}

// SmallInstance is the gate at n ring samples, small enough to enumerate every assignment.
func SmallInstance(n int, q float64, trials int, seed int64) SmallResult {
	c := RingGate(n, q)
	order := GateOrder(n)
	a := Analyze(c, order)
	ind := RingGateIndependent(n, q)
	ai := Analyze(ind, GateOrder(n)[:n+1])
	d, of := Compile(c, order)
	root := of[c.Root]
	nodes, skips := d.Count(root)
	res := SmallResult{N: n, Need: n - int(float64(n)*q), Vars: len(c.Names), Analysis: a, AnalysisIndependent: ai, BDDNodes: nodes, BDDSkips: skips,
		Circuit: c.Nodes, Root: c.Root, Names: c.Names, Flagged: a.Flagged}
	for _, i := range c.Reachable() {
		nd := c.Nodes[i]
		if nd.Kind == KOr && d.Apply(opAnd, of[nd.A], of[nd.B]) != 0 {
			res.NondeterministicOrs = append(res.NondeterministicOrs, i)
		}
	}
	r := rand.New(rand.NewSource(seed))
	for _, s := range []Semiring{Boolean, Probability, Tropical} {
		row := ReadingRow{Semiring: s.Name, Trials: trials}
		for t := 0; t < trials; t++ {
			w := randomWeights(r, s, len(c.Names))
			truth := BruteForce(c, s, w)
			before := EvalCircuit(c, s, w)
			if closeTo(before, truth) {
				row.Before++
			} else {
				e := relErr(before, truth)
				if e > row.WorstBefore {
					row.WorstBefore, row.ExampleBefore, row.ExampleTruth = e, before, truth
				}
			}
			if closeTo(EvalBDD(d, root, order, s, w, false), truth) {
				row.Split++
			}
			if closeTo(EvalBDD(d, root, order, s, w, true), truth) {
				row.Smoothed++
			}
		}
		res.Rows = append(res.Rows, row)
	}
	return res
}

func relErr(a, b float64) float64 {
	if math.IsInf(a, 0) || math.IsInf(b, 0) {
		if a == b {
			return 0
		}
		return math.Inf(1)
	}
	return math.Abs(a-b) / math.Max(1e-12, math.Abs(b))
}

// RingGateIndependent is the same selection network with the fit taken as certain (b_i = a_i): does the network alone break
// decomposability?
func RingGateIndependent(n int, q float64) *Circuit {
	names := []string{"fit"}
	for i := 0; i < n; i++ {
		names = append(names, "a")
	}
	c := NewCircuit(names)
	b := make([]int, n)
	for i := range b {
		b[i] = c.Lit(1+i, false)
	}
	c.Root = c.Select(b, int(float64(n)*q))
	return c
}

// SmallInstanceIndependent runs the readings on the network alone, with the fit certain (its variable unused and neutral).
func SmallInstanceIndependent(n int, q float64, trials int, seed int64) SmallResult {
	c := RingGateIndependent(n, q)
	order := GateOrder(n)[:n+1]
	d, of := Compile(c, order)
	root := of[c.Root]
	nodes, skips := d.Count(root)
	res := SmallResult{N: n, Need: n - int(float64(n)*q), Vars: len(c.Names), Analysis: Analyze(c, order), BDDNodes: nodes, BDDSkips: skips}
	r := rand.New(rand.NewSource(seed))
	for _, s := range []Semiring{Boolean, Probability, Tropical} {
		row := ReadingRow{Semiring: s.Name, Trials: trials}
		for t := 0; t < trials; t++ {
			w := randomWeights(r, s, len(c.Names))
			w[0] = [2]float64{s.One, s.One}
			if s.Name == Probability.Name {
				w[0] = [2]float64{0.5, 0.5}
			}
			truth := BruteForce(c, s, w)
			before := EvalCircuit(c, s, w)
			if closeTo(before, truth) {
				row.Before++
			} else if e := relErr(before, truth); e > row.WorstBefore {
				row.WorstBefore, row.ExampleBefore, row.ExampleTruth = e, before, truth
			}
			if closeTo(EvalBDD(d, root, order, s, w, false), truth) {
				row.Split++
			}
			if closeTo(EvalBDD(d, root, order, s, w, true), truth) {
				row.Smoothed++
			}
		}
		res.Rows = append(res.Rows, row)
	}
	return res
}

func randomWeights(r *rand.Rand, s Semiring, nv int) Weights {
	p := make([]float64, nv)
	for v := range p {
		p[v] = 0.02 + 0.96*r.Float64()
		if s.Name == Boolean.Name { // evidence: a third of leaves known false, a third known true, a third unknown
			p[v] = []float64{0, 1, 0.5}[r.Intn(3)]
		}
	}
	return ProbWeights(s, p)
}

func closeTo(a, b float64) bool {
	if math.IsInf(a, -1) && math.IsInf(b, -1) {
		return true
	}
	return math.Abs(a-b) <= 1e-9*math.Max(1, math.Abs(b))
}
