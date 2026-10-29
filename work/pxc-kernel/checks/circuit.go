package ringgate

import (
	"fmt"
	"math/bits"
)

// Kind of a circuit node.
type Kind uint8

const (
	KFalse Kind = iota
	KTrue
	KLeaf // a literal: variable Var, negated when Neg
	KAnd
	KOr
)

// Node is one gate of a Boolean circuit in negation normal form: negation only on leaves.
type Node struct {
	Kind Kind
	Var  int
	Neg  bool
	A, B int
}

// Circuit is a DAG of Nodes, children always before parents, hash-consed so equal sub-circuits are one node.
type Circuit struct {
	Nodes []Node
	Names []string // variable names
	Root  int
	cons  map[Node]int
}

func NewCircuit(names []string) *Circuit {
	c := &Circuit{Names: names, cons: map[Node]int{}}
	c.add(Node{Kind: KFalse})
	c.add(Node{Kind: KTrue})
	return c
}

func (c *Circuit) add(n Node) int {
	if id, ok := c.cons[n]; ok {
		return id
	}
	c.Nodes = append(c.Nodes, n)
	c.cons[n] = len(c.Nodes) - 1
	return len(c.Nodes) - 1
}

const (
	False = 0
	True  = 1
)

func (c *Circuit) Lit(v int, neg bool) int { return c.add(Node{Kind: KLeaf, Var: v, Neg: neg}) }

func (c *Circuit) And(a, b int) int {
	switch {
	case a == False || b == False:
		return False
	case a == True:
		return b
	case b == True:
		return a
	case a == b:
		return a
	}
	if a > b {
		a, b = b, a
	}
	return c.add(Node{Kind: KAnd, A: a, B: b})
}

func (c *Circuit) Or(a, b int) int {
	switch {
	case a == True || b == True:
		return True
	case a == False:
		return b
	case b == False:
		return a
	case a == b:
		return a
	}
	if a > b {
		a, b = b, a
	}
	return c.add(Node{Kind: KOr, A: a, B: b})
}

// Comparators of Batcher's odd-even merge sort for n wires, padded to a power of two; a comparator touching a padding wire
// is dropped, which is exact because padding holds the maximum and sits above every real wire.
func Comparators(n int) [][2]int {
	p := 1
	for p < n {
		p <<= 1
	}
	var out [][2]int
	for k := 1; k < p; k <<= 1 {
		for j := k; j >= 1; j >>= 1 {
			for i := j % k; i < p-j; i += 2 * j {
				for x := 0; x < j && x+i+j < p; x++ {
					if (x+i)/(2*k) == (x+i+j)/(2*k) {
						a, b := x+i, x+i+j
						if b < n {
							out = append(out, [2]int{a, b})
						}
					}
				}
			}
		}
	}
	return out
}

// Select returns the node computing the k-th smallest (0-based, ascending) of Boolean wires: on bits, min is AND and max is OR,
// so this is the same min/max network the real-valued ringBg sort runs, read on the events "sample is not background".
func (c *Circuit) Select(wires []int, k int) int {
	w := append([]int(nil), wires...)
	for _, cmp := range Comparators(len(w)) {
		a, b := w[cmp[0]], w[cmp[1]]
		w[cmp[0]], w[cmp[1]] = c.And(a, b), c.Or(a, b)
	}
	return w[k]
}

// RingGate builds the gate's circuit for n ring samples read at quantile q:
//
//	variable 0      fit: Argon's rim fit is where it says (true) or 1.5% larger, his own tolerance G4 (false)
//	variable 1+i    a_i: sample i is not background, with the fit where it says
//	variable 1+n+i  c_i: sample i is not background, with the fit 1.5% larger
//	b_i = (fit AND a_i) OR (NOT fit AND c_i);  gate = sorted(b)[floor(n q)]
//
// sorted(b)[k] is true exactly when at most k samples are background, so the gate fires when at least n - k samples sit off the
// background: for n = 72, q = 0.25 that is 54 of 72, the same decision as p25 >= T.
func RingGate(n int, q float64) *Circuit {
	names := []string{"fit"}
	for i := 0; i < n; i++ {
		names = append(names, fmt.Sprintf("a%d", i))
	}
	for i := 0; i < n; i++ {
		names = append(names, fmt.Sprintf("c%d", i))
	}
	c := NewCircuit(names)
	b := make([]int, n)
	for i := range b {
		b[i] = c.Or(c.And(c.Lit(0, false), c.Lit(1+i, false)), c.And(c.Lit(0, true), c.Lit(1+n+i, false)))
	}
	c.Root = c.Select(b, int(float64(n)*q))
	return c
}

// Varset is a bitset over variables.
type Varset []uint64

func newVarset(n int) Varset { return make(Varset, (n+63)/64) }
func (s Varset) set(v int)   { s[v/64] |= 1 << (v % 64) }
func (s Varset) union(t Varset) Varset {
	u := make(Varset, len(s))
	for i := range s {
		u[i] = s[i] | t[i]
	}
	return u
}
func (s Varset) meet(t Varset) Varset {
	u := make(Varset, len(s))
	for i := range s {
		u[i] = s[i] & t[i]
	}
	return u
}
func (s Varset) Count() int {
	n := 0
	for _, w := range s {
		n += bits.OnesCount64(w)
	}
	return n
}
func (s Varset) Members() []int {
	var out []int
	for i, w := range s {
		for w != 0 {
			b := bits.TrailingZeros64(w)
			out = append(out, i*64+b)
			w &= w - 1
		}
	}
	return out
}

// Reachable lists the nodes under the root, children first.
func (c *Circuit) Reachable() []int {
	seen := make([]bool, len(c.Nodes))
	var order []int
	var walk func(int)
	walk = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		n := c.Nodes[i]
		if n.Kind == KAnd || n.Kind == KOr {
			walk(n.A)
			walk(n.B)
		}
		order = append(order, i)
	}
	walk(c.Root)
	return order
}

// Vars returns, for every node, the set of variables (uncertain leaves) beneath it.
func (c *Circuit) Vars() []Varset {
	nv := len(c.Names)
	vs := make([]Varset, len(c.Nodes))
	for i, n := range c.Nodes {
		switch n.Kind {
		case KLeaf:
			vs[i] = newVarset(nv)
			vs[i].set(n.Var)
		case KAnd, KOr:
			vs[i] = vs[n.A].union(vs[n.B])
		default:
			vs[i] = newVarset(nv)
		}
	}
	return vs
}

// Eval runs the circuit on one full assignment: this is just running the program.
func (c *Circuit) Eval(x []bool) bool {
	val := make([]bool, len(c.Nodes))
	for i, n := range c.Nodes {
		switch n.Kind {
		case KTrue:
			val[i] = true
		case KLeaf:
			val[i] = x[n.Var] != n.Neg
		case KAnd:
			val[i] = val[n.A] && val[n.B]
		case KOr:
			val[i] = val[n.A] || val[n.B]
		}
	}
	return val[c.Root]
}

// Size counts the reachable AND and OR nodes and the leaves.
func (c *Circuit) Size() (ands, ors, leaves int) {
	for _, i := range c.Reachable() {
		switch c.Nodes[i].Kind {
		case KAnd:
			ands++
		case KOr:
			ors++
		case KLeaf:
			leaves++
		}
	}
	return
}
