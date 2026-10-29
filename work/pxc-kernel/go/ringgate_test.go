package pxc

import (
	"fmt"
	"math/rand"
	"testing"
)

// ringGate is the ring gate's shape at a size brute force can check: n samples, each b_i = (fit AND a_i) OR (NOT fit AND c_i),
// and the gate holds when at least need of them do. The threshold is built as a monotone dynamic program,
// atLeast(i, k) = (b_i AND atLeast(i+1, k-1)) OR atLeast(i+1, k), which reuses every b_i many times.
func ringGate(n, need int) *Circuit {
	names := []string{"fit"}
	for i := 0; i < n; i++ {
		names = append(names, fmt.Sprintf("a%d", i))
	}
	for i := 0; i < n; i++ {
		names = append(names, fmt.Sprintf("c%d", i))
	}
	b := NewBuilder(names)
	fit, notFit := b.Literal(0, false), b.Literal(0, true)
	samples := make([]int, n)
	for i := range samples {
		samples[i] = b.Or(b.And(fit, b.Literal(1+i, false)), b.And(notFit, b.Literal(1+n+i, false)))
	}
	memo := map[[2]int]int{}
	var atLeast func(i, k int) int
	atLeast = func(i, k int) int {
		if k <= 0 {
			return 1
		}
		if n-i < k {
			return 0
		}
		key := [2]int{i, k}
		if r, ok := memo[key]; ok {
			return r
		}
		r := b.Or(b.And(samples[i], atLeast(i+1, k-1)), atLeast(i+1, k))
		memo[key] = r
		return r
	}
	return b.Finish(atLeast(0, need))
}

func TestRingGateShapeBeforeAndAfterCompile(t *testing.T) {
	c := ringGate(8, 6)
	before := Check(c)
	if before.Decomposable() || before.Deterministic() {
		t.Fatalf("the uncompiled gate should fail both guarantees: %s", before)
	}
	out, d, err := Compiled(c)
	if err != nil {
		t.Fatal(err)
	}
	ands, ors := c.Size()
	cands, cors := out.Size()
	t.Logf("before: %s (%d gates); after: %d decisions, %d gates", before, ands+ors, d.Size(), cands+cors)
	rng := rand.New(rand.NewSource(13))
	for trial := 0; trial < 20; trial++ {
		p := randomProbabilities(rng, len(c.Variables))
		for _, r := range Readings {
			w := r.WeighAll(p)
			want := BruteForce(c, r, w)
			got, err := Evaluate(out, r, w)
			if err != nil || !closeTo(got, want) {
				t.Fatalf("%s: compiled %v (err %v), brute force %v", r.Name, got, err, want)
			}
		}
	}
}
