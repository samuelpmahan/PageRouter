package ringgate

// BruteForce is the definition of every reading: PLUS over every assignment that makes the gate true, of TIMES over its
// literals' weights. It enumerates all 2^n assignments, so it only runs on small instances.
func BruteForce(c *Circuit, s Semiring, w Weights) float64 {
	n := len(c.Names)
	if n > 24 {
		panic("brute force over more than 24 variables")
	}
	x := make([]bool, n)
	total := s.Zero
	for m := 0; m < 1<<n; m++ {
		for v := range x {
			x[v] = m>>v&1 == 1
		}
		if !c.Eval(x) {
			continue
		}
		p := s.One
		for v := range x {
			if x[v] {
				p = s.Times(p, w[v][1])
			} else {
				p = s.Times(p, w[v][0])
			}
		}
		total = s.Plus(total, p)
	}
	return total
}

// CountingOracle computes the same PLUS over models for RingGate(n, q) without its circuit: split on the fit variable, then
// group the a's (or c's) by how many are true, a dynamic program over counts. It is exact for any commutative semiring and
// shares no code with the selection network or the decision diagram, so it can check the 72-sample gate where enumerating
// 2^145 assignments cannot.
func CountingOracle(n int, q float64, s Semiring, w Weights) float64 {
	need := n - int(float64(n)*q)
	tail := func(first int) float64 {
		dp := []float64{s.One}
		for i := 0; i < n; i++ {
			v := first + i
			next := make([]float64, len(dp)+1)
			for j := range next {
				next[j] = s.Zero
			}
			for j, x := range dp {
				next[j] = s.Plus(next[j], s.Times(x, w[v][0]))
				next[j+1] = s.Plus(next[j+1], s.Times(x, w[v][1]))
			}
			dp = next
		}
		t := s.Zero
		for j := need; j <= n; j++ {
			t = s.Plus(t, dp[j])
		}
		return t
	}
	// The branch that reads the a's leaves every c free, and the other way round: each free variable contributes
	// w(x) PLUS w(NOT x), which is 1 for probability and Boolean but not for tropical.
	free := func(first int) float64 {
		f := s.One
		for i := 0; i < n; i++ {
			f = s.Times(f, s.Plus(w[first+i][0], w[first+i][1]))
		}
		return f
	}
	return s.Plus(s.Times(w[0][1], s.Times(tail(1), free(1+n))), s.Times(w[0][0], s.Times(tail(1+n), free(1))))
}
