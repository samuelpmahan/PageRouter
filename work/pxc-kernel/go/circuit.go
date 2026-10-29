// Package pxc is the start of the PxC kernel in Go: a Calculation's circuit (Γ), its compiled form, and the
// FunctionalGuarantees that make reading one circuit in many semirings honest.
//
// A circuit built straight from a Calculation answers yes or no. Reading the same circuit as a probability, a most likely
// world or a world count is only right when every AND is decomposable (its two sides share no variable), every OR is
// deterministic (its two sides are never true together) and, for some readings, every OR is smooth (both sides mention the
// same variables). Compile turns any circuit into one that holds all three, by Shannon expansion into an ordered decision
// diagram (a special case of decision-DNNF). Evaluate refuses a circuit it cannot certify.
//
// Model builds on the same steps: a Bayesian network over yes-or-no nodes (a hidden truth and the witnesses that look at it)
// becomes a circuit, is compiled, and is read twice to give P(query | evidence). Fit sets its tables from labelled rows.
package pxc

import (
	"fmt"
	"sort"
)

// Kind is what a node of a circuit does.
type Kind uint8

const (
	False Kind = iota
	True
	Literal // a variable or its negation
	And
	Or
)

func (k Kind) String() string {
	return [...]string{"False", "True", "Literal", "And", "Or"}[k]
}

// Node is one gate. AND and OR are binary; a builder folds longer lists into balanced trees.
type Node struct {
	Kind     Kind
	Variable int  // Literal only
	Negated  bool // Literal only
	Children [2]int
}

// Circuit is a directed acyclic graph of gates. Children always have smaller ids than their parent, so Nodes is already in
// evaluation order. Node 0 is False and node 1 is True.
type Circuit struct {
	Nodes     []Node
	Root      int
	Variables []string
}

// Builder makes circuits with structural sharing: the same gate over the same children is one node.
type Builder struct {
	c      *Circuit
	unique map[Node]int
	byName map[string]int
}

// NewBuilder starts an empty circuit over the named variables.
func NewBuilder(variables []string) *Builder {
	b := &Builder{c: &Circuit{Variables: append([]string(nil), variables...)}, unique: map[Node]int{}, byName: map[string]int{}}
	for i, v := range variables {
		b.byName[v] = i
	}
	b.add(Node{Kind: False})
	b.add(Node{Kind: True})
	return b
}

func (b *Builder) add(n Node) int {
	if id, ok := b.unique[n]; ok {
		return id
	}
	b.c.Nodes = append(b.c.Nodes, n)
	id := len(b.c.Nodes) - 1
	b.unique[n] = id
	return id
}

// Variable returns the index of a named variable, adding it when it is new.
func (b *Builder) Variable(name string) int {
	if v, ok := b.byName[name]; ok {
		return v
	}
	b.c.Variables = append(b.c.Variables, name)
	b.byName[name] = len(b.c.Variables) - 1
	return len(b.c.Variables) - 1
}

// Literal is variable v, or NOT v when negated.
func (b *Builder) Literal(v int, negated bool) int {
	if v < 0 || v >= len(b.c.Variables) {
		panic(fmt.Sprintf("pxc: variable %d outside 0..%d", v, len(b.c.Variables)-1))
	}
	return b.add(Node{Kind: Literal, Variable: v, Negated: negated})
}

// Constant is node 0 (False) or node 1 (True).
func (b *Builder) Constant(value bool) int {
	if value {
		return 1
	}
	return 0
}

// And of two nodes, with the constant rules applied (x AND False = False, x AND True = x, x AND x = x).
func (b *Builder) And(x, y int) int {
	switch {
	case x == 0 || y == 0:
		return 0
	case x == 1:
		return y
	case y == 1 || x == y:
		return x
	}
	if x > y {
		x, y = y, x
	}
	return b.add(Node{Kind: And, Children: [2]int{x, y}})
}

// Or of two nodes, with the constant rules applied.
func (b *Builder) Or(x, y int) int {
	switch {
	case x == 1 || y == 1:
		return 1
	case x == 0:
		return y
	case y == 0 || x == y:
		return x
	}
	if x > y {
		x, y = y, x
	}
	return b.add(Node{Kind: Or, Children: [2]int{x, y}})
}

// AndAll folds a list into a balanced tree of ANDs (True for an empty list).
func (b *Builder) AndAll(xs ...int) int { return b.fold(xs, 1, b.And) }

// OrAll folds a list into a balanced tree of ORs (False for an empty list).
func (b *Builder) OrAll(xs ...int) int { return b.fold(xs, 0, b.Or) }

func (b *Builder) fold(xs []int, empty int, op func(int, int) int) int {
	switch len(xs) {
	case 0:
		return empty
	case 1:
		return xs[0]
	}
	m := len(xs) / 2
	return op(b.fold(xs[:m], empty, op), b.fold(xs[m:], empty, op))
}

// Finish fixes the root and returns the circuit.
func (b *Builder) Finish(root int) *Circuit {
	b.c.Root = root
	return b.c
}

// FromPolynomial builds the circuit of a kernel provenance polynomial: OR over monomials, AND over each monomial's
// variables, every variable positive. It is the same list of lists that kernel.mjs sum() records and evaluate() reads.
func FromPolynomial(polynomial [][]string) *Circuit {
	seen := map[string]bool{}
	var names []string
	for _, m := range polynomial {
		for _, v := range m {
			if !seen[v] {
				seen[v] = true
				names = append(names, v)
			}
		}
	}
	sort.Strings(names)
	b := NewBuilder(names)
	terms := make([]int, 0, len(polynomial))
	for _, m := range polynomial {
		lits := make([]int, 0, len(m))
		for _, v := range m {
			lits = append(lits, b.Literal(b.Variable(v), false))
		}
		terms = append(terms, b.AndAll(lits...))
	}
	return b.Finish(b.OrAll(terms...))
}

// Reachable marks the nodes the root depends on.
func (c *Circuit) Reachable() []bool {
	r := make([]bool, len(c.Nodes))
	r[c.Root] = true
	for i := c.Root; i >= 0; i-- {
		if r[i] && (c.Nodes[i].Kind == And || c.Nodes[i].Kind == Or) {
			r[c.Nodes[i].Children[0]] = true
			r[c.Nodes[i].Children[1]] = true
		}
	}
	return r
}

// Size counts the AND and OR gates the root depends on.
func (c *Circuit) Size() (ands, ors int) {
	for i, ok := range c.Reachable() {
		if !ok {
			continue
		}
		switch c.Nodes[i].Kind {
		case And:
			ands++
		case Or:
			ors++
		}
	}
	return
}

// Holds evaluates the circuit on one world (world[v] is the truth of variable v).
func (c *Circuit) Holds(world []bool) bool {
	val := make([]bool, c.Root+1)
	for i := 0; i <= c.Root; i++ {
		n := c.Nodes[i]
		switch n.Kind {
		case False:
		case True:
			val[i] = true
		case Literal:
			val[i] = world[n.Variable] != n.Negated
		case And:
			val[i] = val[n.Children[0]] && val[n.Children[1]]
		case Or:
			val[i] = val[n.Children[0]] || val[n.Children[1]]
		}
	}
	return val[c.Root]
}
