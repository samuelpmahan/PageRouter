package ringgate

import (
	"math"
	"math/rand"
	"testing"
)

// The comparator network really sorts: every 0/1 input (zero-one principle) for small n, random reals for n = 72.
func TestNetworkSorts(t *testing.T) {
	for n := 2; n <= 12; n++ {
		cmps := Comparators(n)
		for m := 0; m < 1<<n; m++ {
			x := make([]int, n)
			for i := range x {
				x[i] = m >> i & 1
			}
			for _, c := range cmps {
				if x[c[0]] > x[c[1]] {
					x[c[0]], x[c[1]] = x[c[1]], x[c[0]]
				}
			}
			for i := 1; i < n; i++ {
				if x[i-1] > x[i] {
					t.Fatalf("n=%d input %b not sorted", n, m)
				}
			}
		}
	}
	r := rand.New(rand.NewSource(1))
	for trial := 0; trial < 200; trial++ {
		x := make([]float64, 72)
		for i := range x {
			x[i] = r.Float64()
		}
		for _, c := range Comparators(72) {
			if x[c[0]] > x[c[1]] {
				x[c[0]], x[c[1]] = x[c[1]], x[c[0]]
			}
		}
		for i := 1; i < 72; i++ {
			if x[i-1] > x[i] {
				t.Fatal("72 not sorted")
			}
		}
	}
}

// The compiled circuit is the gate: with the fit where it says and a_i = (d_i >= 13), it agrees with ringBg's p25 >= 13 on every
// uniform-background ring in the data, live fit and final crop.
func TestCircuitIsTheGate(t *testing.T) {
	ps, err := LoadPhotos("testdata/rings.json")
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, p := range ps {
		for _, ring := range [][]*float64{p.Nearest[p.RhoIndex(1.04)], p.FinalNearest[p.RhoIndex(1.04)]} {
			d := present(ring)
			c := RingGate(len(d), 0.25)
			x := make([]bool, 2*len(d)+1)
			x[0] = true
			for i, v := range d {
				x[1+i] = v >= 13
			}
			if got, want := c.Eval(x), RingQuantile(ring, 0.25) >= 13; got != want {
				t.Errorf("%s: circuit %v, ringBg %v", p.Name, got, want)
			}
			checked++
		}
	}
	t.Logf("%d rings agree", checked)
}

// The data reproduces Argon's recorded numbers: Neutron Control 22.5 at the live fit, FX-4 3.5 outside its final crop.
func TestReproducesArgon(t *testing.T) {
	ps, _ := LoadPhotos("testdata/rings.json")
	for _, p := range ps {
		switch {
		case p.Kind == "stand-in" && math.Abs(*p.OutsideConcentricCode-22.5) > 0.05:
			t.Errorf("Neutron Control stand-in p25 %v, Argon 22.5", *p.OutsideConcentricCode)
		case p.Name[:4] == "FX-4" && math.Abs(*p.OutsideConcentricFinalCode-3.5) > 0.05:
			t.Errorf("FX-4 final p25 %v, Argon 3.5", *p.OutsideConcentricFinalCode)
		}
		if got := RingQuantile(p.Nearest[p.RhoIndex(1.04)], 0.25); p.OutsideConcentricCode != nil && got != *p.OutsideConcentricCode {
			t.Errorf("%s: Go reads %v, JavaScript ringBg %v", p.Name, got, *p.OutsideConcentricCode)
		}
	}
}

// The counting oracle matches brute force, so it can stand in for brute force at n = 72.
func TestOracleMatchesBruteForce(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	c := RingGate(8, 0.25)
	for _, s := range []Semiring{Boolean, Probability, Tropical} {
		for trial := 0; trial < 50; trial++ {
			w := randomWeights(r, s, len(c.Names))
			if a, b := CountingOracle(8, 0.25, s, w), BruteForce(c, s, w); !closeTo(a, b) {
				t.Fatalf("%s: oracle %v brute %v", s.Name, a, b)
			}
		}
	}
}

// Before: the circuit as compiled, read node by node, is wrong for probability and tropical (and Boolean once a shared leaf
// shows up with both signs). After: the decision diagram, smoothed, is right for all three.
func TestReadingsSmall(t *testing.T) {
	res := SmallInstance(8, 0.25, 100, 11)
	for _, row := range res.Rows {
		t.Logf("%-22s before %3d/%d  split %3d/%d  split+smooth %3d/%d  worst before %.3g", row.Semiring, row.Before, row.Trials, row.Split, row.Trials, row.Smoothed, row.Trials, row.WorstBefore)
		if row.Smoothed != row.Trials {
			t.Errorf("%s: smoothed decision diagram wrong on %d trials", row.Semiring, row.Trials-row.Smoothed)
		}
	}
}

// The kernel's compile step on the full 72-sample gate: the uncompiled circuit is refused, the compiled one passes every
// guarantee, and its probability and most likely world match the counting oracle on every photo.
func TestKernelCompileOnThePhotos(t *testing.T) {
	ps, err := LoadPhotos("testdata/rings.json")
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, p := range ps {
		if !p.Uniform {
			continue
		}
		i, j := p.RhoIndex(1.04), p.RhoIndex(1.04*1.015)
		for _, ring := range []struct {
			which      string
			at, bigger []*float64
		}{{"live fit", p.Nearest[i], p.Nearest[j]}, {"final crop", p.FinalNearest[i], p.FinalNearest[j]}} {
			r := KernelInstance(p.Name, ring.which, ring.at, ring.bigger, 13)
			if r.Refused == "" {
				t.Errorf("%s %s: the uncompiled circuit should be refused", r.Photo, r.Ring)
			}
			if !r.CompiledCertified {
				t.Errorf("%s %s: compiled circuit failed a guarantee", r.Photo, r.Ring)
			}
			if math.IsNaN(r.Probability) || math.IsInf(r.Probability, 0) || !relClose(r.Probability, r.ProbabilityExact) {
				t.Errorf("%s %s: probability %v, exact %v", r.Photo, r.Ring, r.Probability, r.ProbabilityExact)
			}
			if !(math.Abs(r.Cost-r.CostExact) <= 1e-9*math.Max(1, math.Abs(r.CostExact))) {
				t.Errorf("%s %s: cheapest world %v, exact %v", r.Photo, r.Ring, r.Cost, r.CostExact)
			}
			checked++
		}
	}
	if checked < 10 {
		t.Fatalf("only %d rings checked", checked)
	}
}

func TestWitnessModelOnTeeHoles(t *testing.T) {
	_, holes, err := LoadTeeHoles("testdata/tee-witnesses.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(holes) != 36 {
		t.Fatalf("%d holes, want 36", len(holes))
	}
	scores, err := LeaveOneOut(holes, 1)
	if err != nil {
		t.Fatal(err)
	}
	by := map[string]DesignScore{}
	for _, s := range scores {
		by[s.Design.Name] = s
		t.Logf("%-34s log loss %.3f  Brier %.3f  %d/%d", s.Design.Name, s.LogLoss, s.Brier, s.Correct, s.Holes)
	}
	// Counting the rerun as a fourth independent opinion must cost something, and modelling it as reading Ray must win part
	// of that back.
	naive, aware := by["All four, treated as independent"], by["All four, rerun reads Ray"]
	if !(aware.LogLoss < naive.LogLoss) {
		t.Fatalf("dependency-aware log loss %.3f is not below the naive %.3f", aware.LogLoss, naive.LogLoss)
	}
	if !(by["Template alone"].LogLoss < by["Prior only"].LogLoss) {
		t.Fatal("the template witness does not beat the base rate")
	}
}
