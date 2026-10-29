package pxc

import (
	"errors"
	"fmt"
	"math"
	"math/rand"
	"testing"
)

func closeTo(a, b float64) bool {
	if a == b {
		return true
	}
	return math.Abs(a-b) <= 1e-9*math.Max(1, math.Abs(b))
}

// randomCircuit makes a circuit with plenty of sharing: each gate picks two earlier gates or literals at random.
func randomCircuit(rng *rand.Rand, nv, gates int) *Circuit {
	names := make([]string, nv)
	for i := range names {
		names[i] = fmt.Sprintf("x%d", i)
	}
	b := NewBuilder(names)
	pool := []int{}
	for v := 0; v < nv; v++ {
		pool = append(pool, b.Literal(v, false), b.Literal(v, true))
	}
	last := pool[0]
	for g := 0; g < gates; g++ {
		x, y := pool[rng.Intn(len(pool))], pool[rng.Intn(len(pool))]
		if rng.Intn(2) == 0 {
			last = b.And(x, y)
		} else {
			last = b.Or(x, y)
		}
		pool = append(pool, last)
	}
	return b.Finish(last)
}

func randomProbabilities(rng *rand.Rand, nv int) []float64 {
	p := make([]float64, nv)
	for v := range p {
		switch rng.Intn(6) {
		case 0:
			p[v] = 0 // evidence: known false
		case 1:
			p[v] = 1 // evidence: known true
		default:
			p[v] = 0.05 + 0.9*rng.Float64()
		}
	}
	return p
}

// Every compiled circuit must pass all three guarantees, mean the same thing as the circuit it came from, and give the
// brute-force answer in every reading. If Compile ever produced an overlapping AND or an uncertified OR, this fails.
func TestCompiledCircuitsHoldEveryGuarantee(t *testing.T) {
	rng := rand.New(rand.NewSource(62))
	for trial := 0; trial < 300; trial++ {
		nv := 3 + rng.Intn(10)
		c := randomCircuit(rng, nv, 5+rng.Intn(60))
		out, _, err := Compiled(c)
		if err != nil {
			t.Fatalf("trial %d: %v", trial, err)
		}
		world := make([]bool, nv)
		for m := 0; m < 1<<nv; m++ {
			for v := range world {
				world[v] = m&(1<<v) != 0
			}
			if c.Holds(world) != out.Holds(world) {
				t.Fatalf("trial %d: compiled circuit disagrees with the original on world %b", trial, m)
			}
		}
		p := randomProbabilities(rng, nv)
		for _, r := range Readings {
			w := r.WeighAll(p)
			got, err := Evaluate(out, r, w)
			if err != nil {
				t.Fatalf("trial %d %s: %v", trial, r.Name, err)
			}
			if want := BruteForce(c, r, w); !closeTo(got, want) {
				t.Fatalf("trial %d %s: compiled %v, brute force %v", trial, r.Name, got, want)
			}
		}
	}
}

func TestCheckFindsAnOverlappingAnd(t *testing.T) {
	b := NewBuilder([]string{"x", "y", "z"})
	x, y, z := b.Literal(0, false), b.Literal(1, false), b.Literal(2, false)
	c := b.Finish(b.And(b.Or(x, y), b.Or(x, z))) // both sides read x
	a := Check(c)
	if a.Decomposable() || len(a.OverlappingAnds[c.Root]) != 1 || a.OverlappingAnds[c.Root][0] != 0 {
		t.Fatalf("expected the root AND to overlap on x, got %+v", a)
	}
	var ge *GuaranteeError
	if _, err := Evaluate(c, Probability, Probability.WeighAll([]float64{.5, .5, .5})); !errors.As(err, &ge) {
		t.Fatalf("Evaluate should refuse, got %v", err)
	}
}

func TestCheckFindsAnUncertifiedOr(t *testing.T) {
	b := NewBuilder([]string{"x", "y"})
	c := b.Finish(b.Or(b.Literal(0, false), b.Literal(1, false))) // x OR y: both can be true
	if a := Check(c); a.Deterministic() {
		t.Fatalf("x OR y was certified deterministic: %+v", a)
	}
	// (x AND y) OR (NOT x AND y) is deterministic, and the check certifies it.
	b = NewBuilder([]string{"x", "y"})
	c = b.Finish(b.Or(b.And(b.Literal(0, false), b.Literal(1, false)), b.And(b.Literal(0, true), b.Literal(1, false))))
	if a := Check(c); !a.Deterministic() || !a.Decomposable() || !a.Smooth() {
		t.Fatalf("a Shannon split should pass: %+v", a)
	}
}

// Break a compiled circuit on purpose, the two ways a buggy Compile could: give a decision the same sign on both branches
// (nondeterministic OR), or make a branch re-read the decision's variable (overlapping AND). The check must catch both.
func TestCheckCatchesABrokenCompile(t *testing.T) {
	c := ringGate(4, 3)
	out, _, err := Compiled(c)
	if err != nil {
		t.Fatal(err)
	}
	broken := &Circuit{Nodes: append([]Node(nil), out.Nodes...), Root: out.Root, Variables: out.Variables}
	decisionLiteral := func(and Node, other Node) (slot int, ok bool) { // the AND's literal whose opposite sits in the other branch
		for k := 0; k < 2; k++ {
			lit := broken.Nodes[and.Children[k]]
			if lit.Kind != Literal {
				continue
			}
			for _, o := range other.Children {
				if m := broken.Nodes[o]; m.Kind == Literal && m.Variable == lit.Variable && m.Negated != lit.Negated {
					return k, true
				}
			}
		}
		return 0, false
	}
	flipped := false
	reach := broken.Reachable()
	for i := 2; i < len(out.Nodes) && !flipped; i++ {
		n := broken.Nodes[i]
		if !reach[i] || n.Kind != Or {
			continue
		}
		left, right := broken.Nodes[n.Children[0]], broken.Nodes[n.Children[1]]
		if left.Kind != And || right.Kind != And {
			continue
		}
		k, ok := decisionLiteral(left, right)
		if !ok {
			continue
		}
		lit := broken.Nodes[left.Children[k]]
		// Give the left branch the same sign as the right one: append the flipped literal, a copy of the AND and a copy of the
		// OR, in that order, so children keep smaller ids than their parents, and make the copy the root.
		broken.Nodes = append(broken.Nodes, Node{Kind: Literal, Variable: lit.Variable, Negated: !lit.Negated})
		left.Children[k] = len(broken.Nodes) - 1
		broken.Nodes = append(broken.Nodes, left)
		n.Children[0] = len(broken.Nodes) - 1
		broken.Nodes = append(broken.Nodes, n)
		broken.Root = len(broken.Nodes) - 1
		flipped = true
	}
	if !flipped {
		t.Fatal("found no decision to break")
	}
	if a := Check(broken); a.Deterministic() {
		t.Fatalf("a decision with the same sign on both branches was certified: %+v", a)
	}

	// A branch that re-reads its decision's variable: x AND (x OR y), built by hand.
	over := &Circuit{Variables: []string{"x", "y"}, Nodes: []Node{{Kind: False}, {Kind: True},
		{Kind: Literal, Variable: 0}, {Kind: Literal, Variable: 1}, {Kind: Or, Children: [2]int{2, 3}}, {Kind: And, Children: [2]int{2, 4}}}, Root: 5}
	if a := Check(over); a.Decomposable() {
		t.Fatalf("x AND (x OR y) was certified decomposable: %+v", a)
	}
}

func TestOrderPutsTheSharedVariableFirst(t *testing.T) {
	c := ringGate(8, 6)
	if o := Order(c); c.Variables[o[0]] != "fit" {
		t.Fatalf("expected fit first, got %v", c.Variables[o[0]])
	}
}
