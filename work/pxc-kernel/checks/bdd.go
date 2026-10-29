package ringgate

// A reduced ordered binary decision diagram. Building it from a circuit IS Shannon expansion: every node splits on one variable,
// f = (x AND f|x=1) OR (NOT x AND f|x=0), and the memo tables make each distinct cofactor one node. The result read as a circuit
// is decomposable (x never appears below its own split) and deterministic (x and NOT x cannot both hold).
type BDD struct {
	Var    []int // level of the variable split at node i; terminals 0 (false) and 1 (true) have Var = number of variables
	Lo, Hi []int
	NVars  int
	unique map[[3]int]int
	memo   map[[3]int]int
}

func NewBDD(nvars int) *BDD {
	d := &BDD{NVars: nvars, unique: map[[3]int]int{}, memo: map[[3]int]int{}}
	d.Var = []int{nvars, nvars}
	d.Lo = []int{0, 1}
	d.Hi = []int{0, 1}
	return d
}

func (d *BDD) mk(v, lo, hi int) int {
	if lo == hi {
		return lo
	}
	k := [3]int{v, lo, hi}
	if id, ok := d.unique[k]; ok {
		return id
	}
	d.Var = append(d.Var, v)
	d.Lo = append(d.Lo, lo)
	d.Hi = append(d.Hi, hi)
	d.unique[k] = len(d.Var) - 1
	return len(d.Var) - 1
}

func (d *BDD) Lit(v int, neg bool) int {
	if neg {
		return d.mk(v, 1, 0)
	}
	return d.mk(v, 0, 1)
}

const opAnd, opOr = 0, 1

func (d *BDD) Apply(op, a, b int) int {
	if op == opAnd {
		if a == 0 || b == 0 {
			return 0
		}
		if a == 1 {
			return b
		}
		if b == 1 || a == b {
			return a
		}
	} else {
		if a == 1 || b == 1 {
			return 1
		}
		if a == 0 {
			return b
		}
		if b == 0 || a == b {
			return a
		}
	}
	if a > b {
		a, b = b, a
	}
	k := [3]int{op, a, b}
	if r, ok := d.memo[k]; ok {
		return r
	}
	v := min(d.Var[a], d.Var[b])
	alo, ahi, blo, bhi := a, a, b, b
	if d.Var[a] == v {
		alo, ahi = d.Lo[a], d.Hi[a]
	}
	if d.Var[b] == v {
		blo, bhi = d.Lo[b], d.Hi[b]
	}
	r := d.mk(v, d.Apply(op, alo, blo), d.Apply(op, ahi, bhi))
	d.memo[k] = r
	return r
}

// Compile builds the BDD of every circuit node (in circuit order) under a variable order; order[level] = variable.
func Compile(c *Circuit, order []int) (*BDD, []int) {
	level := make([]int, len(c.Names))
	for l, v := range order {
		level[v] = l
	}
	d := NewBDD(len(c.Names))
	of := make([]int, len(c.Nodes))
	for i, n := range c.Nodes {
		switch n.Kind {
		case KFalse:
			of[i] = 0
		case KTrue:
			of[i] = 1
		case KLeaf:
			of[i] = d.Lit(level[n.Var], n.Neg)
		case KAnd:
			of[i] = d.Apply(opAnd, of[n.A], of[n.B])
		case KOr:
			of[i] = d.Apply(opOr, of[n.A], of[n.B])
		}
	}
	return d, of
}

// Reachable decision nodes under root, and how many variables the edges skip (each skip is one smoothing gadget x OR NOT x).
func (d *BDD) Count(root int) (nodes, skips int) {
	seen := map[int]bool{}
	var walk func(int)
	walk = func(i int) {
		if i <= 1 || seen[i] {
			return
		}
		seen[i] = true
		nodes++
		for _, ch := range []int{d.Lo[i], d.Hi[i]} {
			if ch != 0 {
				skips += d.Var[ch] - d.Var[i] - 1
			}
			walk(ch)
		}
	}
	if root > 1 {
		skips += d.Var[root]
	} else if root == 1 {
		skips += d.NVars
	}
	walk(root)
	return
}
