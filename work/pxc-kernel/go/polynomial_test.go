package pxc

import "testing"

// Sam's tee pad, from the Lab's provenance.evaluate examples: the pose from a corner of the known rectangle, or from two edges
// of it, or from the basket anchor and the course map.
var teePad = [][]string{{"corner", "rectangle"}, {"edge1", "edge2", "rectangle"}, {"anchor", "map"}}

func TestTeePadDerivationsAndWorlds(t *testing.T) {
	c := FromPolynomial(teePad)
	// The polynomial as recorded: every AND is decomposable (a monomial names each variable once), but the ORs between ways
	// are not deterministic, because two ways can both hold.
	a := Check(c)
	if !a.Decomposable() || a.Deterministic() {
		t.Fatalf("expected decomposable but not deterministic, got %s", a)
	}
	p := map[string]float64{"corner": 0.6, "rectangle": 0.95, "edge1": 0.8, "edge2": 0.8, "anchor": 0.7, "map": 0.9}
	probs := make([]float64, len(c.Variables))
	for v, name := range c.Variables {
		probs[v] = p[name]
	}
	w := Probability.WeighAll(probs)
	asWritten := EvaluateAsWritten(c, Probability, w)
	truth := BruteForce(c, Probability, w)
	if closeTo(asWritten, truth) || asWritten <= truth {
		t.Fatalf("reading the polynomial as a probability should overcount: as written %v, truth %v", asWritten, truth)
	}
	if _, err := Evaluate(c, Probability, w); err == nil {
		t.Fatal("Evaluate should refuse the uncompiled polynomial")
	}
	out, _, err := Compiled(c)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Evaluate(out, Probability, w)
	if err != nil || !closeTo(got, truth) {
		t.Fatalf("compiled %v (err %v), truth %v", got, err, truth)
	}
	// Counting derivations is a different question from counting worlds. On the polynomial, with every input present, the
	// kernel's counting reading says 3 ways (one per monomial), and that is right without any compile step.
	ones := WorldCount.WeighAll([]float64{1, 1, 1, 1, 1, 1})
	if ways := EvaluateAsWritten(c, WorldCount, ones); ways != 3 {
		t.Fatalf("expected 3 derivations, got %v", ways)
	}
	if worlds := BruteForce(c, WorldCount, ones); worlds != 1 {
		t.Fatalf("with every input known present there is one world, got %v", worlds)
	}
}
