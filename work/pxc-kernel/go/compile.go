package pxc

import "sort"

// Decision is one node of a decision diagram: "if Variable then High else Low". Ids 0 and 1 are the False and True ends.
type Decision struct {
	Variable  int
	High, Low int
}

// DecisionDiagram is an ordered, reduced decision diagram: on every path the variables appear in Order, at most once, and no
// two nodes are the same decision. Each decision is a Shannon expansion, f = (x AND f[x=1]) OR (NOT x AND f[x=0]), which is
// why its AND is decomposable (x is not in either cofactor) and its OR deterministic (x and NOT x are never both true).
type DecisionDiagram struct {
	Variables []string
	Order     []int // Order[level] = variable
	Nodes     []Decision
	Root      int

	level  []int // level[variable]
	unique map[Decision]int
	memo   map[[3]int]int
}

const (
	opAnd = iota
	opOr
)

func newDiagram(variables []string, order []int) *DecisionDiagram {
	d := &DecisionDiagram{Variables: variables, Order: order, level: make([]int, len(variables)),
		unique: map[Decision]int{}, memo: map[[3]int]int{}}
	for i := range d.level {
		d.level[i] = len(order) // a variable missing from the order would never be decided; Compile rejects that
	}
	for l, v := range order {
		d.level[v] = l
	}
	d.Nodes = []Decision{{Variable: -1}, {Variable: -1}}
	return d
}

// Level of a node: its variable's place in the order, or len(Order) for the two ends.
func (d *DecisionDiagram) Level(id int) int {
	if id < 2 {
		return len(d.Order)
	}
	return d.level[d.Nodes[id].Variable]
}

func (d *DecisionDiagram) make(v, high, low int) int {
	if high == low {
		return high
	}
	key := Decision{v, high, low}
	if id, ok := d.unique[key]; ok {
		return id
	}
	d.Nodes = append(d.Nodes, key)
	d.unique[key] = len(d.Nodes) - 1
	return len(d.Nodes) - 1
}

func (d *DecisionDiagram) apply(op, f, g int) int {
	switch {
	case op == opAnd && (f == 0 || g == 0):
		return 0
	case op == opAnd && f == 1:
		return g
	case op == opAnd && g == 1:
		return f
	case op == opOr && (f == 1 || g == 1):
		return 1
	case op == opOr && f == 0:
		return g
	case op == opOr && g == 0:
		return f
	case f == g:
		return f
	}
	if f > g {
		f, g = g, f
	}
	key := [3]int{op, f, g}
	if r, ok := d.memo[key]; ok {
		return r
	}
	lf, lg := d.Level(f), d.Level(g)
	l := min(lf, lg)
	v := d.Order[l]
	fh, fl, gh, gl := f, f, g, g
	if lf == l {
		fh, fl = d.Nodes[f].High, d.Nodes[f].Low
	}
	if lg == l {
		gh, gl = d.Nodes[g].High, d.Nodes[g].Low
	}
	r := d.make(v, d.apply(op, fh, gh), d.apply(op, fl, gl))
	d.memo[key] = r
	return r
}

// Order picks a variable order for Compile: variables that more gates depend on come first, so a leaf shared across the whole
// circuit (the ring gate's rim fit) is decided once at the top instead of being re-decided under every branch. Ties keep the
// order in which a depth-first walk from the root first meets each variable.
func Order(c *Circuit) []int {
	reach := c.Reachable()
	users := make([]int, len(c.Variables)) // how many gates read each variable, directly or not
	first := make([]int, len(c.Variables))
	for i := range first {
		first[i] = -1
	}
	vars := make([]variableSet, c.Root+1)
	for i := 0; i <= c.Root; i++ {
		if !reach[i] {
			continue
		}
		vars[i] = newSet(len(c.Variables))
		n := c.Nodes[i]
		switch n.Kind {
		case Literal:
			vars[i].add(n.Variable)
		case And, Or:
			vars[i].union(vars[n.Children[0]])
			vars[i].union(vars[n.Children[1]])
			for _, v := range vars[i].members() {
				users[v]++
			}
		}
	}
	seen, clock := make([]bool, c.Root+1), 0
	var walk func(i int)
	walk = func(i int) {
		if seen[i] {
			return
		}
		seen[i] = true
		n := c.Nodes[i]
		switch n.Kind {
		case Literal:
			if first[n.Variable] < 0 {
				first[n.Variable] = clock
				clock++
			}
		case And, Or:
			walk(n.Children[0])
			walk(n.Children[1])
		}
	}
	walk(c.Root)
	order := make([]int, 0, len(c.Variables))
	for v := range c.Variables {
		if first[v] < 0 {
			first[v] = clock + v // unused by the root: decided last, never appears in the diagram
		}
		order = append(order, v)
	}
	sort.SliceStable(order, func(a, b int) bool {
		if users[order[a]] != users[order[b]] {
			return users[order[a]] > users[order[b]]
		}
		return first[order[a]] < first[order[b]]
	})
	return order
}

// Compile turns a circuit into a decision diagram by building every gate bottom up with Apply. order must list every
// variable once; nil means Order(c).
func Compile(c *Circuit, order []int) *DecisionDiagram {
	if order == nil {
		order = Order(c)
	}
	if len(order) != len(c.Variables) {
		panic("pxc: the order must list every variable once")
	}
	d := newDiagram(c.Variables, order)
	of := make([]int, c.Root+1)
	reach := c.Reachable()
	for i := 0; i <= c.Root; i++ {
		if !reach[i] {
			continue
		}
		n := c.Nodes[i]
		switch n.Kind {
		case False:
			of[i] = 0
		case True:
			of[i] = 1
		case Literal:
			if n.Negated {
				of[i] = d.make(n.Variable, 0, 1)
			} else {
				of[i] = d.make(n.Variable, 1, 0)
			}
		case And:
			of[i] = d.apply(opAnd, of[n.Children[0]], of[n.Children[1]])
		case Or:
			of[i] = d.apply(opOr, of[n.Children[0]], of[n.Children[1]])
		}
	}
	d.Root = of[c.Root]
	d.memo = nil // only needed while building
	return d
}

// Size counts the decisions the root depends on.
func (d *DecisionDiagram) Size() int {
	seen := map[int]bool{}
	var walk func(int)
	walk = func(id int) {
		if id < 2 || seen[id] {
			return
		}
		seen[id] = true
		walk(d.Nodes[id].High)
		walk(d.Nodes[id].Low)
	}
	walk(d.Root)
	return len(seen)
}

// Circuit writes the decision diagram back out as an AND/OR circuit the guarantees can check and any semiring can read.
// Each decision becomes (x AND high) OR (NOT x AND low). When smooth is set, every edge that jumps past variables picks up a
// (y OR NOT y) for each variable y it skipped, and so does the root for the variables above it, so both sides of every OR
// read the same variables.
func (d *DecisionDiagram) Circuit(smooth bool) *Circuit {
	b := NewBuilder(d.Variables)
	gate := map[int]int{}
	for _, v := range d.Order {
		gate[v] = b.Or(b.Literal(v, false), b.Literal(v, true))
	}
	type span struct{ from, to int }
	chains := map[span]int{}
	skipped := func(from, to int) int { // the AND of the smoothing gates for levels from..to-1
		if !smooth || from >= to {
			return 1
		}
		k := span{from, to}
		if id, ok := chains[k]; ok {
			return id
		}
		parts := make([]int, 0, to-from)
		for l := from; l < to; l++ {
			parts = append(parts, gate[d.Order[l]])
		}
		chains[k] = b.AndAll(parts...)
		return chains[k]
	}
	out := map[int]int{0: 0, 1: 1}
	var write func(id int) int
	write = func(id int) int {
		if r, ok := out[id]; ok {
			return r
		}
		n, l := d.Nodes[id], d.Level(id)
		high := b.And(skipped(l+1, d.Level(n.High)), write(n.High))
		low := b.And(skipped(l+1, d.Level(n.Low)), write(n.Low))
		r := b.Or(b.And(b.Literal(n.Variable, false), high), b.And(b.Literal(n.Variable, true), low))
		out[id] = r
		return r
	}
	root := b.And(skipped(0, d.Level(d.Root)), write(d.Root))
	if d.Root == 0 {
		root = 0
	}
	return b.Finish(root)
}
