package ringgate

import "math"

// Real-photo instance: the gate on one ring of one photo, every sample's event given a probability from the re-encode noise.
type RealRow struct {
	Photo, Ring                                string
	N, Need                                    int
	P25                                        float64
	Decision                                   bool
	Ands, Ors, FlaggedAnds                     int
	NondeterministicOr                         int
	BDDNodes, BDDSkips                         int
	ProbBefore, ProbAfter, ProbTrue            float64
	TropBefore, TropSplit, TropAfter, TropTrue float64
	BoolBefore, BoolAfter, BoolTrue            float64
	Unknown                                    int // samples within 3 noise units of T (left free in the Boolean reading)
}

const (
	Sigma = 2.0 // colour-distance noise of one sample under re-encoding (harness/noise.py)
	PFit  = 0.9 // assumed: the rim fit is where it says 9 times in 10, otherwise 1.5% larger (Argon's G4 tolerance)
)

func phi(z float64) float64 { return 0.5 * math.Erfc(-z/math.Sqrt2) }

// RealInstance builds leaf probabilities from the samples at rho (fit where it says) and rho x 1.015 (fit 1.5% larger).
func RealInstance(name, which string, ringAt, ringBig []*float64, T float64, full bool) RealRow {
	a, c := presentPairs(ringAt, ringBig)
	n := len(a)
	g := RingGate(n, 0.25)
	row := RealRow{Photo: name, Ring: which, N: n, Need: n - int(float64(n)*0.25), P25: RingQuantile(ringAt, 0.25)}
	row.Decision = row.P25 >= T
	pr, pb, unknown := leafProbabilities(a, c, T)
	row.Unknown = unknown
	order := GateOrder(n)
	if full {
		an := Analyze(g, order)
		row.Ands, row.Ors, row.FlaggedAnds, row.NondeterministicOr = an.Ands, an.Ors, an.FlaggedAnds, an.NondeterministicOr
	}
	d, of := Compile(g, order)
	root := of[g.Root]
	row.BDDNodes, row.BDDSkips = d.Count(root)
	wp, wt, wb := ProbWeights(Probability, pr), ProbWeights(Tropical, pr), ProbWeights(Boolean, pb)
	row.ProbBefore, row.ProbAfter, row.ProbTrue = EvalCircuit(g, Probability, wp), EvalBDD(d, root, order, Probability, wp, true), CountingOracle(n, 0.25, Probability, wp)
	row.TropBefore, row.TropSplit, row.TropAfter, row.TropTrue = EvalCircuit(g, Tropical, wt), EvalBDD(d, root, order, Tropical, wt, false), EvalBDD(d, root, order, Tropical, wt, true), CountingOracle(n, 0.25, Tropical, wt)
	row.BoolBefore, row.BoolAfter, row.BoolTrue = EvalCircuit(g, Boolean, wb), EvalBDD(d, root, order, Boolean, wb, true), CountingOracle(n, 0.25, Boolean, wb)
	return row
}

// presentPairs keeps the samples that land on the image in both rings (ringBig is the ring the 1.5% larger fit would read).
func presentPairs(ringAt, ringBig []*float64) (a, c []float64) {
	for i := range ringAt {
		if ringAt[i] != nil && ringBig[i] != nil {
			a = append(a, *ringAt[i])
			c = append(c, *ringBig[i])
		}
	}
	return a, c
}

// leafProbabilities gives every leaf of RingGate(len(a), q) its chance of being true: the fit is right with PFit, and a sample
// is not background with Φ((d − T) / σ). pb is the Boolean evidence: a sample more than 3σ from T is fixed, the rest are left
// free (0.5), and unknown counts those.
func leafProbabilities(a, c []float64, T float64) (pr, pb []float64, unknown int) {
	n := len(a)
	clamp := func(p float64) float64 { return math.Min(1-1e-6, math.Max(1e-6, p)) }
	pr = make([]float64, 2*n+1)
	pb = make([]float64, 2*n+1)
	pr[0], pb[0] = PFit, 0.5
	for i := 0; i < n; i++ {
		for k, d := range []float64{a[i], c[i]} {
			v := 1 + i + k*n
			pr[v] = clamp(phi((d - T) / Sigma))
			switch {
			case d-T > 3*Sigma:
				pb[v] = 1
			case T-d > 3*Sigma:
				pb[v] = 0
			default:
				pb[v] = 0.5
				if k == 0 {
					unknown++
				}
			}
		}
	}
	return pr, pb, unknown
}
