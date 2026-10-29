package ringgate

import (
	"math"

	"pxc"
)

// ToKernel copies a ring gate circuit into the Go kernel's circuit type, gate for gate.
func ToKernel(c *Circuit) *pxc.Circuit {
	b := pxc.NewBuilder(c.Names)
	id := make([]int, len(c.Nodes))
	for i, n := range c.Nodes {
		switch n.Kind {
		case KFalse:
			id[i] = b.Constant(false)
		case KTrue:
			id[i] = b.Constant(true)
		case KLeaf:
			id[i] = b.Literal(n.Var, n.Neg)
		case KAnd:
			id[i] = b.And(id[n.A], id[n.B])
		case KOr:
			id[i] = b.Or(id[n.A], id[n.B])
		}
	}
	return b.Finish(id[c.Root])
}

// KernelRow is the kernel's compile step on one ring of one photo: the circuit before and after, what the guarantees found,
// and each reading against the counting oracle.
type KernelRow struct {
	Photo, Ring string
	N           int
	// Before compile.
	Ands, Ors, OverlappingAnds, UncertifiedOrs, UnsmoothOrs int
	Refused                                                 string // what Evaluate said about the uncompiled circuit
	// After compile.
	Decisions, CompiledAnds, CompiledOrs int
	// The same diagram written without smoothing gates, which is enough for the probability reading.
	UnsmoothedAnds, UnsmoothedOrs                    int
	CompiledCertified                                bool // decomposable, deterministic and smooth
	ProbabilityBefore, Probability, ProbabilityExact float64
	// Most likely firing world, as a cost (−log probability), from the kernel's CheapestWorld reading.
	CostBefore, Cost, CostExact float64
}

// KernelInstance runs the kernel's compile step on one ring.
func KernelInstance(name, which string, ringAt, ringBig []*float64, T float64) KernelRow {
	a, c := presentPairs(ringAt, ringBig)
	n := len(a)
	pr, _, _ := leafProbabilities(a, c, T)
	g := ToKernel(RingGate(n, 0.25))
	row := KernelRow{Photo: name, Ring: which, N: n}
	before := pxc.Check(g)
	row.Ands, row.Ors = before.Ands, before.Ors
	row.OverlappingAnds, row.UncertifiedOrs, row.UnsmoothOrs = len(before.OverlappingAnds), len(before.UncertifiedOrs), len(before.UnsmoothOrs)
	wp, wc := pxc.Probability.WeighAll(pr), pxc.CheapestWorld.WeighAll(pr)
	if _, err := pxc.Evaluate(g, pxc.Probability, wp); err != nil {
		row.Refused = err.Error()
	}
	row.ProbabilityBefore = pxc.EvaluateAsWritten(g, pxc.Probability, wp)
	row.CostBefore = pxc.EvaluateAsWritten(g, pxc.CheapestWorld, wc)
	out, d, err := pxc.Compiled(g)
	if err != nil {
		panic(err)
	}
	after := pxc.Check(out)
	row.CompiledCertified = after.Decomposable() && after.Deterministic() && after.Smooth()
	row.Decisions = d.Size()
	row.CompiledAnds, row.CompiledOrs = out.Size()
	row.UnsmoothedAnds, row.UnsmoothedOrs = d.Circuit(false).Size()
	if row.Probability, err = pxc.Evaluate(out, pxc.Probability, wp); err != nil {
		panic(err)
	}
	if row.Cost, err = pxc.Evaluate(out, pxc.CheapestWorld, wc); err != nil {
		panic(err)
	}
	row.ProbabilityExact = CountingOracle(n, 0.25, Probability, ProbWeights(Probability, pr))
	row.CostExact = -CountingOracle(n, 0.25, Tropical, ProbWeights(Tropical, pr))
	return row
}

// relClose compares two kernel answers to the oracle's, relative to the oracle's size.
func relClose(a, b float64) bool {
	if a == b {
		return true
	}
	return math.Abs(a-b) <= 1e-9*math.Max(math.Abs(b), 1e-300)
}
