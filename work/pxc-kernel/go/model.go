package pxc

import (
	"fmt"
	"math"
)

// Model is a Bayesian network over yes-or-no nodes: each node has parents and a table giving P(node is true) for every
// combination of its parents. A hidden truth with witnesses is the smallest useful one: the truth has no parents, and each
// witness has the truth as its parent, with a hit rate (true given truth) and a false-alarm rate (true given not truth).
//
// The model is compiled, not hand-solved. Every table row becomes one independent variable of the circuit, a node becomes
// "the row its parents select, and that row's variable", and evidence and queries are ANDs of those. The circuit shares
// variables everywhere (every witness reads the truth), so it goes through Compile, and P(query | evidence) is the ratio of
// two Probability readings.
type Model struct {
	Nodes []ModelNode
	index map[string]int
}

// ModelNode is one node. True[u] is P(node is true | parents in configuration u), where bit i of u is parent i's value.
type ModelNode struct {
	Name    string
	Parents []int
	True    []float64
}

// NewModel starts an empty model.
func NewModel() *Model { return &Model{index: map[string]int{}} }

// Add declares a node after its parents. Its table starts at 0.5 for every row.
func (m *Model) Add(name string, parents ...string) *Model {
	if _, dup := m.index[name]; dup {
		panic("pxc: node " + name + " declared twice")
	}
	n := ModelNode{Name: name}
	for _, p := range parents {
		i, ok := m.index[p]
		if !ok {
			panic("pxc: parent " + p + " of " + name + " is not declared yet")
		}
		n.Parents = append(n.Parents, i)
	}
	n.True = make([]float64, 1<<len(n.Parents))
	for u := range n.True {
		n.True[u] = 0.5
	}
	m.index[name] = len(m.Nodes)
	m.Nodes = append(m.Nodes, n)
	return m
}

// Set fills a node's table, one probability per parent configuration in bit order.
func (m *Model) Set(name string, table ...float64) *Model {
	n := &m.Nodes[m.node(name)]
	if len(table) != len(n.True) {
		panic(fmt.Sprintf("pxc: %s needs %d table rows, got %d", name, len(n.True), len(table)))
	}
	copy(n.True, table)
	return m
}

// Witness is shorthand for a node whose only parent is truth: P(true | truth) = hit, P(true | not truth) = falseAlarm.
func (m *Model) Witness(name, truth string, hit, falseAlarm float64) *Model {
	return m.Add(name, truth).Set(name, falseAlarm, hit)
}

func (m *Model) node(name string) int {
	i, ok := m.index[name]
	if !ok {
		panic("pxc: no node " + name)
	}
	return i
}

// circuit builds the AND of the given node values, over one variable per table row, and returns it with each variable's
// probability.
func (m *Model) circuit(values map[string]bool) (*Circuit, []float64) {
	b := NewBuilder(nil)
	var probs []float64
	rowVar := make([][]int, len(m.Nodes))
	for i, n := range m.Nodes {
		rowVar[i] = make([]int, len(n.True))
		for u, p := range n.True {
			rowVar[i][u] = b.Variable(fmt.Sprintf("%s[%d]", n.Name, u))
			probs = append(probs, p)
		}
	}
	memo := map[[2]int]int{}
	var value func(i int, v bool) int // the circuit for "node i has value v"
	value = func(i int, v bool) int {
		key := [2]int{i, 0}
		if v {
			key[1] = 1
		}
		if r, ok := memo[key]; ok {
			return r
		}
		n := m.Nodes[i]
		rows := make([]int, 0, len(n.True))
		for u := range n.True {
			parts := make([]int, 0, len(n.Parents)+1)
			for k, p := range n.Parents {
				parts = append(parts, value(p, u&(1<<k) != 0))
			}
			parts = append(parts, b.Literal(rowVar[i][u], !v))
			rows = append(rows, b.AndAll(parts...))
		}
		memo[key] = b.OrAll(rows...)
		return memo[key]
	}
	parts := []int{}
	for i := range m.Nodes { // fixed order, so the same values always build the same circuit
		if v, ok := values[m.Nodes[i].Name]; ok {
			parts = append(parts, value(i, v))
		}
	}
	for name := range values {
		m.node(name) // panics on an unknown name
	}
	return b.Finish(b.AndAll(parts...)), probs
}

// Probability is P(values), computed by compiling the model's circuit and reading it as a probability.
func (m *Model) Probability(values map[string]bool) (float64, error) {
	c, probs := m.circuit(values)
	out, _, err := Compiled(c)
	if err != nil {
		return 0, err
	}
	return Evaluate(out, Probability, Probability.WeighAll(probs))
}

// Posterior is P(query is true | evidence) = P(query and evidence) / P(evidence).
func (m *Model) Posterior(query string, evidence map[string]bool) (float64, error) {
	joint := map[string]bool{query: true}
	for k, v := range evidence {
		if k == query && !v {
			return 0, nil
		}
		joint[k] = v
	}
	num, err := m.Probability(joint)
	if err != nil {
		return 0, err
	}
	den, err := m.Probability(evidence)
	if err != nil {
		return 0, err
	}
	if den == 0 {
		return math.NaN(), fmt.Errorf("pxc: the evidence has probability 0")
	}
	return num / den, nil
}

// Enumerate is P(values) by the definition: the sum over every assignment of the nodes that agrees with values, of the
// product of each node's table entry. It is the test oracle for Probability.
func (m *Model) Enumerate(values map[string]bool) float64 {
	n := len(m.Nodes)
	total := 0.0
	for a := 0; a < 1<<n; a++ {
		val := func(i int) bool { return a&(1<<i) != 0 }
		ok := true
		for name, v := range values {
			if val(m.node(name)) != v {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		w := 1.0
		for i, node := range m.Nodes {
			u := 0
			for k, p := range node.Parents {
				if val(p) {
					u |= 1 << k
				}
			}
			if val(i) {
				w *= node.True[u]
			} else {
				w *= 1 - node.True[u]
			}
		}
		total += w
	}
	return total
}

// Fit sets every table from labelled rows by counting, with alpha added to each outcome (Laplace smoothing), so a row that
// never occurs in the data reads 0.5 and no estimate is ever exactly 0 or 1.
func (m *Model) Fit(rows []map[string]bool, alpha float64) {
	for i := range m.Nodes {
		n := &m.Nodes[i]
		for u := range n.True {
			yes, all := alpha, 2*alpha
			for _, r := range rows {
				match := true
				for k, p := range n.Parents {
					if r[m.Nodes[p].Name] != (u&(1<<k) != 0) {
						match = false
						break
					}
				}
				if !match {
					continue
				}
				all++
				if r[n.Name] {
					yes++
				}
			}
			n.True[u] = yes / all
		}
	}
}
