package ringgate

// Decomposability: every AND node's children must read disjoint uncertain leaves. Determinism: every OR node's children must
// never be true together. Both are checked here on the circuit as compiled.
type Analysis struct {
	Ands, Ors, Leaves  int
	FlaggedAnds        int // children share at least one leaf
	FlaggedByFitOnly   int // the only shared leaf is the fit variable
	FlaggedBySamples   int // children share at least one ring-sample leaf (a wire of the network reused)
	NondeterministicOr int // children can be true together
	Flagged            map[int][]int
}

func Analyze(c *Circuit, order []int) Analysis {
	vs := c.Vars()
	d, of := Compile(c, order)
	a := Analysis{Flagged: map[int][]int{}}
	for _, i := range c.Reachable() {
		n := c.Nodes[i]
		switch n.Kind {
		case KLeaf:
			a.Leaves++
		case KAnd:
			a.Ands++
			shared := vs[n.A].meet(vs[n.B]).Members()
			if len(shared) > 0 {
				a.FlaggedAnds++
				a.Flagged[i] = shared
				if len(shared) == 1 && shared[0] == 0 {
					a.FlaggedByFitOnly++
				} else {
					a.FlaggedBySamples++
				}
			}
		case KOr:
			a.Ors++
			if d.Apply(opAnd, of[n.A], of[n.B]) != 0 {
				a.NondeterministicOr++
			}
		}
	}
	return a
}

// GateOrder splits on the fit first (the leaf every sample shares), then the a's, then the c's.
func GateOrder(n int) []int {
	o := make([]int, 2*n+1)
	for i := range o {
		o[i] = i
	}
	return o
}
