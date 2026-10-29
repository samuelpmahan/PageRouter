package pxc

import (
	"fmt"
	"math/bits"
	"strings"
)

// variableSet is a bitset over variable indexes.
type variableSet []uint64

func newSet(n int) variableSet { return make(variableSet, (n+63)/64) }

func (s variableSet) add(v int)      { s[v/64] |= 1 << (v % 64) }
func (s variableSet) has(v int) bool { return s[v/64]&(1<<(v%64)) != 0 }
func (s variableSet) union(t variableSet) {
	for i := range s {
		s[i] |= t[i]
	}
}

func (s variableSet) meets(t variableSet) bool {
	for i := range s {
		if s[i]&t[i] != 0 {
			return true
		}
	}
	return false
}

func (s variableSet) equal(t variableSet) bool {
	for i := range s {
		if s[i] != t[i] {
			return false
		}
	}
	return true
}

func (s variableSet) members() []int {
	var out []int
	for i, w := range s {
		for w != 0 {
			b := bits.TrailingZeros64(w)
			out = append(out, i*64+b)
			w &^= 1 << b
		}
	}
	return out
}

// Audit is what the FunctionalGuarantees found on one circuit, node by node. Only nodes the root depends on are checked.
type Audit struct {
	Ands, Ors int
	// OverlappingAnds maps an AND node to the variables both of its children read: each one breaks decomposability.
	OverlappingAnds map[int][]int
	// UncertifiedOrs lists OR nodes for which no variable is forced true on one side and false on the other. Such an OR may
	// have both children true at once. The check is syntactic, so it never certifies an OR that is not deterministic.
	UncertifiedOrs []int
	// UnsmoothOrs lists OR nodes whose two children read different variables.
	UnsmoothOrs []int
}

// Decomposable reports whether no AND overlaps.
func (a Audit) Decomposable() bool { return len(a.OverlappingAnds) == 0 }

// Deterministic reports whether every OR is certified.
func (a Audit) Deterministic() bool { return len(a.UncertifiedOrs) == 0 }

// Smooth reports whether every OR's children read the same variables.
func (a Audit) Smooth() bool { return len(a.UnsmoothOrs) == 0 }

func (a Audit) String() string {
	return fmt.Sprintf("%d AND (%d overlap), %d OR (%d not certified deterministic, %d not smooth)",
		a.Ands, len(a.OverlappingAnds), a.Ors, len(a.UncertifiedOrs), len(a.UnsmoothOrs))
}

// Check runs the three structural FunctionalGuarantees on a circuit.
//
// Decomposable: for every AND, the variables under its two children are disjoint.
// Deterministic: for every OR, some variable is forced true under one child and false under the other. A literal forces
// itself, an AND forces everything either child forces, and an OR forces only what both children force.
// Smooth: for every OR, both children read the same variables.
func Check(c *Circuit) Audit {
	n, nv := c.Root+1, len(c.Variables)
	reach := c.Reachable()
	vars := make([]variableSet, n)
	pos := make([]variableSet, n) // literals forced true
	neg := make([]variableSet, n) // literals forced false
	a := Audit{OverlappingAnds: map[int][]int{}}
	for i := 0; i < n; i++ {
		if !reach[i] {
			continue
		}
		vars[i], pos[i], neg[i] = newSet(nv), newSet(nv), newSet(nv)
		node := c.Nodes[i]
		switch node.Kind {
		case Literal:
			vars[i].add(node.Variable)
			if node.Negated {
				neg[i].add(node.Variable)
			} else {
				pos[i].add(node.Variable)
			}
		case And:
			l, r := node.Children[0], node.Children[1]
			a.Ands++
			if vars[l].meets(vars[r]) {
				shared := newSet(nv)
				for _, v := range vars[l].members() {
					if vars[r].has(v) {
						shared.add(v)
					}
				}
				a.OverlappingAnds[i] = shared.members()
			}
			for _, s := range [][2]variableSet{{vars[i], vars[l]}, {vars[i], vars[r]}, {pos[i], pos[l]}, {pos[i], pos[r]}, {neg[i], neg[l]}, {neg[i], neg[r]}} {
				s[0].union(s[1])
			}
		case Or:
			l, r := node.Children[0], node.Children[1]
			a.Ors++
			vars[i].union(vars[l])
			vars[i].union(vars[r])
			for w := range pos[i] {
				pos[i][w] = pos[l][w] & pos[r][w]
				neg[i][w] = neg[l][w] & neg[r][w]
			}
			if !pos[l].meets(neg[r]) && !neg[l].meets(pos[r]) {
				a.UncertifiedOrs = append(a.UncertifiedOrs, i)
			}
			if !vars[l].equal(vars[r]) {
				a.UnsmoothOrs = append(a.UnsmoothOrs, i)
			}
		}
	}
	return a
}

// GuaranteeError says which structural FunctionalGuarantee a circuit failed, so a caller can see why a reading was refused.
type GuaranteeError struct {
	Reading string
	Audit   Audit
	Needs   []string
}

func (e *GuaranteeError) Error() string {
	return fmt.Sprintf("pxc: refusing the %s reading: it needs a %s circuit, and this one has %s; compile it first",
		e.Reading, strings.Join(e.Needs, " and "), e.Audit)
}
