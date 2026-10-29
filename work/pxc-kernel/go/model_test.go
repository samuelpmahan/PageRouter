package pxc

import (
	"fmt"
	"math"
	"math/rand"
	"testing"
)

// randomModel builds a network of n nodes in which each node takes up to two earlier nodes as parents.
func randomModel(rng *rand.Rand, n int) *Model {
	m := NewModel()
	for i := 0; i < n; i++ {
		var parents []string
		for k := 0; k < i && len(parents) < 2; k++ {
			if rng.Intn(3) == 0 {
				parents = append(parents, fmt.Sprintf("n%d", k))
			}
		}
		name := fmt.Sprintf("n%d", i)
		m.Add(name, parents...)
		table := make([]float64, 1<<len(parents))
		for u := range table {
			table[u] = 0.05 + 0.9*rng.Float64()
		}
		m.Set(name, table...)
	}
	return m
}

func TestModelProbabilityMatchesEnumeration(t *testing.T) {
	rng := rand.New(rand.NewSource(7))
	for trial := 0; trial < 200; trial++ {
		m := randomModel(rng, 2+rng.Intn(5))
		values := map[string]bool{}
		for _, node := range m.Nodes {
			if rng.Intn(2) == 0 {
				values[node.Name] = rng.Intn(2) == 0
			}
		}
		got, err := m.Probability(values)
		if err != nil {
			t.Fatalf("trial %d: %v", trial, err)
		}
		if want := m.Enumerate(values); math.Abs(got-want) > 1e-9 {
			t.Fatalf("trial %d: P(%v) = %v, enumeration says %v", trial, values, got, want)
		}
	}
}

// The intro on the page: an even prior, and witnesses that each say yes 80% of the time when the truth holds and 20% when it
// does not, so each agreeing witness multiplies the odds by 4.
func TestWitnessesMultiplyTheOdds(t *testing.T) {
	m := NewModel().Add("truth").Set("truth", 0.5).
		Witness("a", "truth", 0.8, 0.2).Witness("b", "truth", 0.8, 0.2).Witness("c", "truth", 0.8, 0.2)
	evidence := map[string]bool{}
	for i, w := range []string{"a", "b", "c"} {
		evidence[w] = true
		got, err := m.Posterior("truth", evidence)
		if err != nil {
			t.Fatal(err)
		}
		odds := math.Pow(4, float64(i+1))
		if want := odds / (1 + odds); math.Abs(got-want) > 1e-12 {
			t.Fatalf("%d witnesses: posterior %v, want %v", i+1, got, want)
		}
	}
	// One yes and one no cancel.
	got, _ := m.Posterior("truth", map[string]bool{"a": true, "b": false})
	if math.Abs(got-0.5) > 1e-12 {
		t.Fatalf("a yes and a no: posterior %v, want 0.5", got)
	}
}

// A second witness that only repeats the first (it reads the first witness, not the truth) must add nothing. Treated as an
// independent witness it would push 0.8 to 16/17: that is the double counting the dependency removes.
func TestARepeatedWitnessAddsNothing(t *testing.T) {
	repeat := NewModel().Add("truth").Set("truth", 0.5).
		Witness("a", "truth", 0.8, 0.2).
		Add("echo", "truth", "a").Set("echo", 0, 0, 1, 1) // rows: (truth, a) = (no,no) (yes,no) (no,yes) (yes,yes)
	got, err := repeat.Posterior("truth", map[string]bool{"a": true, "echo": true})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(got-0.8) > 1e-12 {
		t.Fatalf("repeated witness: posterior %v, want 0.8", got)
	}
	naive := NewModel().Add("truth").Set("truth", 0.5).
		Witness("a", "truth", 0.8, 0.2).Witness("echo", "truth", 0.8, 0.2)
	got, _ = naive.Posterior("truth", map[string]bool{"a": true, "echo": true})
	if math.Abs(got-16.0/17) > 1e-12 {
		t.Fatalf("naive pair: posterior %v, want 16/17", got)
	}
}

func TestModelCircuitNeedsTheCompileStep(t *testing.T) {
	m := NewModel().Add("truth").Witness("a", "truth", 0.8, 0.2).Witness("b", "truth", 0.8, 0.2)
	c, probs := m.circuit(map[string]bool{"a": true, "b": true})
	if _, err := Evaluate(c, Probability, Probability.WeighAll(probs)); err == nil {
		t.Fatal("the uncompiled witness circuit was read as a probability; both witnesses share the truth, so it must be refused")
	}
	out, _, err := Compiled(c)
	if err != nil {
		t.Fatal(err)
	}
	if a := Check(out); !a.Decomposable() || !a.Deterministic() || !a.Smooth() {
		t.Fatalf("compiled witness circuit fails a guarantee: %v", a)
	}
}

func TestFitCountsWithSmoothing(t *testing.T) {
	rows := []map[string]bool{
		{"truth": true, "a": true}, {"truth": true, "a": true}, {"truth": true, "a": false},
		{"truth": false, "a": false}, {"truth": false, "a": false},
	}
	m := NewModel().Add("truth").Add("a", "truth")
	m.Fit(rows, 1)
	if want := (3.0 + 1) / (5 + 2); math.Abs(m.Nodes[0].True[0]-want) > 1e-12 {
		t.Fatalf("prior %v, want %v", m.Nodes[0].True[0], want)
	}
	if hit, want := m.Nodes[1].True[1], (2.0+1)/(3+2); math.Abs(hit-want) > 1e-12 {
		t.Fatalf("hit rate %v, want %v", hit, want)
	}
	if fa, want := m.Nodes[1].True[0], (0.0+1)/(2+2); math.Abs(fa-want) > 1e-12 {
		t.Fatalf("false-alarm rate %v, want %v", fa, want)
	}
}
