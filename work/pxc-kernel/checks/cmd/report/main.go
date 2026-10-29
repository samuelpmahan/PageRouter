// Command report runs both checks and writes out/report.json for the page.
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"reflect"
	"strings"

	"pxc"
	rg "pxc-checks"
)

type grid struct {
	X, Y         string
	Xs, Ys       []float64
	Loss, Smooth [][]float64
	Errors       [][]int
}

func lin(a, b float64, n int) []float64 {
	v := make([]float64, n)
	for i := range v {
		v[i] = a + (b-a)*float64(i)/float64(n-1)
	}
	return v
}

func main() {
	ps, err := rg.LoadPhotos("testdata/rings.json")
	if err != nil {
		panic(err)
	}
	out := map[string]any{}

	// ---- Check 1
	small := rg.SmallInstance(8, 0.25, 300, 11)
	smallInd := rg.SmallInstanceIndependent(8, 0.25, 300, 12)
	out["small"], out["smallIndependent"] = small, smallInd
	var real []rg.RealRow
	first := true
	for _, p := range ps {
		if !p.Uniform {
			continue
		}
		i, j := p.RhoIndex(1.04), p.RhoIndex(1.04*1.015)
		real = append(real, rg.RealInstance(p.Name, "live fit", p.Nearest[i], p.Nearest[j], 13, first))
		first = false
		real = append(real, rg.RealInstance(p.Name, "final crop", p.FinalNearest[i], p.FinalNearest[j], 13, false))
	}
	out["real"] = real
	fmt.Fprintf(os.Stderr, "72-sample circuit: %d AND, %d OR, %d AND flagged, %d OR not deterministic, decision diagram %d nodes\n", real[0].Ands, real[0].Ors, real[0].FlaggedAnds, real[0].NondeterministicOr, real[0].BDDNodes)
	// ---- The kernel's compile step (pxc-go): before and after, on every ring.
	var kernel []rg.KernelRow
	for _, p := range ps {
		if !p.Uniform {
			continue
		}
		i, j := p.RhoIndex(1.04), p.RhoIndex(1.04*1.015)
		kernel = append(kernel, rg.KernelInstance(p.Name, "live fit", p.Nearest[i], p.Nearest[j], 13),
			rg.KernelInstance(p.Name, "final crop", p.FinalNearest[i], p.FinalNearest[j], 13))
	}
	out["kernel"] = kernel
	k0 := kernel[0]
	fmt.Fprintf(os.Stderr, "kernel compile at %d samples: %d AND (%d overlap), %d OR (%d uncertified, %d unsmooth) -> %d decisions, %d AND, %d OR\n",
		k0.N, k0.Ands, k0.OverlappingAnds, k0.Ors, k0.UncertifiedOrs, k0.UnsmoothOrs, k0.Decisions, k0.CompiledAnds, k0.CompiledOrs)
	out["teePad"] = teePad()
	out["witness"] = witness()
	ind72 := rg.Analyze(rg.RingGateIndependent(72, 0.25), rg.GateOrder(72)[:73])
	out["independent72"] = ind72

	// ---- Check 2
	var obs []rg.Observation
	for _, p := range ps {
		if !p.Uniform {
			continue
		}
		argon := math.NaN()
		if strings.HasPrefix(p.Name, "FX-4") {
			argon = 3.5
		}
		if p.Kind == "stand-in" {
			obs = append(obs, rg.Observation{Name: "Neutron Control, live fit", Label: 1, Ring: p.Nearest, Smooth: p.Bilinear, Rhos: p.Rhos, Argon: 22.5, WhichFit: "live"})
		}
		if p.Med0 < 1.03 && p.Kind != "stand-in" {
			obs = append(obs, rg.Observation{Name: strings.SplitN(p.Name, " (", 2)[0] + ", live fit", Label: -1, Ring: p.Nearest, Smooth: p.Bilinear, Rhos: p.Rhos, Argon: math.NaN(), WhichFit: "live"})
		}
		obs = append(obs, rg.Observation{Name: strings.SplitN(p.Name, " (", 2)[0] + ", final crop", Label: -1, Ring: p.FinalNearest, Smooth: p.FinalBilinear, Rhos: p.Rhos, Argon: argon, WhichFit: "final"})
	}
	type obsOut struct {
		Name         string
		Label        float64
		Argon        *float64
		P25At        float64
		P25Rho, P25Q []float64
	}
	rhos, qs := lin(0.96, 1.18, 89), lin(0.02, 0.6, 59)
	var oo []obsOut
	for _, o := range obs {
		r := obsOut{Name: o.Name, Label: o.Label, P25At: o.P25(1.04, 0.25)}
		if !math.IsNaN(o.Argon) {
			a := o.Argon
			r.Argon = &a
		}
		for _, x := range rhos {
			r.P25Rho = append(r.P25Rho, o.P25(x, 0.25))
		}
		for _, x := range qs {
			r.P25Q = append(r.P25Q, o.P25(1.04, x))
		}
		oo = append(oo, r)
	}
	out["observations"], out["rhoAxis"], out["qAxis"] = oo, rhos, qs
	l0, e0 := rg.Loss(obs, 1.04, 0.25, 13, false)
	ls, _ := rg.Loss(obs, 1.04, 0.25, 13, true)
	H := rg.Hessian(obs, [3]float64{1.04, 0.25, 13}, 0.5)
	vals, vecs := rg.Eigen(H)
	out["atCurrent"] = map[string]any{"loss": l0, "smooth": ls, "errors": e0, "hessian": H, "eigenvalues": vals, "eigenvectors": vecs, "scale": rg.Scale, "tau": rg.Tau}
	// Exact derivatives: the code's own p25 is a step function of rho and q.
	d := func(f func(x float64) float64, x, h float64) float64 { return (f(x+h) - f(x-h)) / (2 * h) }
	exactGrad := [3]float64{
		d(func(x float64) float64 { l, _ := rg.Loss(obs, x, 0.25, 13, false); return l }, 1.04, 0.0005),
		d(func(x float64) float64 { l, _ := rg.Loss(obs, 1.04, x, 13, false); return l }, 0.25, 0.001),
		d(func(x float64) float64 { l, _ := rg.Loss(obs, 1.04, 0.25, x, false); return l }, 13, 0.01),
	}
	out["exactGradient"] = exactGrad
	mk := func(xn, yn string, xs, ys []float64, f func(x, y float64) (float64, float64, int)) grid {
		g := grid{X: xn, Y: yn, Xs: xs, Ys: ys}
		for _, y := range ys {
			var lr, sr []float64
			var er []int
			for _, x := range xs {
				l, s, e := f(x, y)
				lr, sr, er = append(lr, l), append(sr, s), append(er, e)
			}
			g.Loss, g.Smooth, g.Errors = append(g.Loss, lr), append(g.Smooth, sr), append(g.Errors, er)
		}
		return g
	}
	both := func(rho, q, T float64) (float64, float64, int) {
		l, e := rg.Loss(obs, rho, q, T, false)
		s, _ := rg.Loss(obs, rho, q, T, true)
		return l, s, e
	}
	gx, gq, gT := lin(0.97, 1.15, 37), lin(0.02, 0.6, 30), lin(0, 30, 31)
	out["grids"] = []grid{
		mk("rho", "q", gx, gq, func(x, y float64) (float64, float64, int) { return both(x, y, 13) }),
		mk("rho", "T", gx, gT, func(x, y float64) (float64, float64, int) { return both(x, 0.25, y) }),
		mk("q", "T", gq, gT, func(x, y float64) (float64, float64, int) { return both(1.04, x, y) }),
	}
	// Maximum margin at each (rho, q): the gap between the lowest ring that should fire and the highest that must not, and the
	// T halfway between, which is how Argon set 13.
	type marginGrid struct {
		Rhos, Qs     []float64
		Margin, Best [][]float64
	}
	mg := marginGrid{Rhos: gx, Qs: gq}
	for _, q := range gq {
		var mr, br []float64
		for _, rho := range gx {
			lo, hi := math.Inf(1), math.Inf(-1)
			for _, o := range obs {
				v := o.P25(rho, q)
				if o.Label > 0 {
					lo = math.Min(lo, v)
				} else {
					hi = math.Max(hi, v)
				}
			}
			mr, br = append(mr, lo-hi), append(br, (lo+hi)/2)
		}
		mg.Margin, mg.Best = append(mg.Margin, mr), append(mg.Best, br)
	}
	out["margin"] = mg
	b, err := json.Marshal(clean(out))
	if err != nil {
		panic(err)
	}
	os.MkdirAll("out", 0o755)
	os.WriteFile("out/report.json", b, 0o644)
	fmt.Fprintf(os.Stderr, "loss at (1.04, 0.25, 13): exact %.4f smooth %.4f, %d wrong; eigenvalues %v\n", l0, ls, e0, vals)
	fmt.Fprintf(os.Stderr, "eigenvectors (columns, scaled rho, q, T): %v\nexact gradient %v\n", vecs, exactGrad)
}

// clean turns NaN and infinities into null or a string so the report is valid JSON.
func clean(v any) any {
	b, err := json.Marshal(v)
	if err == nil {
		var x any
		json.Unmarshal(b, &x)
		return x
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Float32, reflect.Float64:
		f := rv.Float()
		switch {
		case math.IsNaN(f):
			return nil
		case math.IsInf(f, 1):
			return "+Infinity"
		case math.IsInf(f, -1):
			return "-Infinity"
		}
		return f
	case reflect.Map:
		m := map[string]any{}
		for _, k := range rv.MapKeys() {
			m[fmt.Sprint(k.Interface())] = clean(rv.MapIndex(k).Interface())
		}
		return m
	case reflect.Slice, reflect.Array:
		s := make([]any, rv.Len())
		for i := range s {
			s[i] = clean(rv.Index(i).Interface())
		}
		return s
	case reflect.Struct:
		m := map[string]any{}
		for i := 0; i < rv.NumField(); i++ {
			if rv.Type().Field(i).IsExported() {
				m[rv.Type().Field(i).Name] = clean(rv.Field(i).Interface())
			}
		}
		return m
	case reflect.Pointer, reflect.Interface:
		if rv.IsNil() {
			return nil
		}
		return clean(rv.Elem().Interface())
	}
	return v
}

// teePad is the Lab's own provenance example read as a probability, before and after the compile step.
func teePad() map[string]any {
	poly := [][]string{{"corner", "rectangle"}, {"edge1", "edge2", "rectangle"}, {"anchor", "map"}}
	chance := map[string]float64{"corner": 0.6, "rectangle": 0.95, "edge1": 0.8, "edge2": 0.8, "anchor": 0.7, "map": 0.9}
	c := pxc.FromPolynomial(poly)
	p := make([]float64, len(c.Variables))
	for v, name := range c.Variables {
		p[v] = chance[name]
	}
	w := pxc.Probability.WeighAll(p)
	compiled, d, err := pxc.Compiled(c)
	if err != nil {
		panic(err)
	}
	after, err := pxc.Evaluate(compiled, pxc.Probability, w)
	if err != nil {
		panic(err)
	}
	_, refused := pxc.Evaluate(c, pxc.Probability, w)
	a := pxc.Check(c)
	ands, ors := c.Size()
	cands, cors := compiled.Size()
	return map[string]any{"polynomial": poly, "chance": chance, "asWritten": pxc.EvaluateAsWritten(c, pxc.Probability, w),
		"compiled": after, "bruteForce": pxc.BruteForce(c, pxc.Probability, w), "refused": refused.Error(),
		"ands": ands, "ors": ors, "uncertifiedOrs": len(a.UncertifiedOrs), "decisions": d.Size(), "compiledAnds": cands, "compiledOrs": cors}
}

func witness() map[string]any {
	source, holes, err := rg.LoadTeeHoles("testdata/tee-witnesses.json")
	if err != nil {
		panic(err)
	}
	intro, copied, err := rg.IntroPosteriors()
	if err != nil {
		panic(err)
	}
	scores, err := rg.LeaveOneOut(holes, 1)
	if err != nil {
		panic(err)
	}
	type rate struct {
		Witness                             string
		HitCount, Right, FalseCount, Wrong  int
		Hit, FalseAlarm, LogLikelihoodRatio float64
	}
	var rates []rate
	right := 0
	for _, h := range holes {
		if h.Row()["TeeRight"] {
			right++
		}
	}
	for _, w := range rg.Witnesses {
		r := rate{Witness: w, Right: right, Wrong: len(holes) - right}
		for _, h := range holes {
			row := h.Row()
			if row[w] && row["TeeRight"] {
				r.HitCount++
			}
			if row[w] && !row["TeeRight"] {
				r.FalseCount++
			}
		}
		r.Hit = (float64(r.HitCount) + 1) / float64(r.Right+2)
		r.FalseAlarm = (float64(r.FalseCount) + 1) / float64(r.Wrong+2)
		r.LogLikelihoodRatio = math.Log(r.Hit / r.FalseAlarm)
		rates = append(rates, r)
	}
	agree := 0
	for _, h := range holes {
		if h.Row()["Ray"] == h.Row()["Rerun"] {
			agree++
		}
	}
	type designOut struct {
		Name, Note     string
		LogLoss, Brier float64
		Correct, Holes int
		LeaveOneOut    []float64
	}
	var designs []designOut
	for _, s := range scores {
		designs = append(designs, designOut{s.Design.Name, s.Design.Note, s.LogLoss, s.Brier, s.Correct, s.Holes, s.LeaveOneOut})
	}
	var rows []map[string]any
	for _, h := range holes {
		rows = append(rows, map[string]any{"course": h.Course, "hole": h.Hole, "errPx": h.FusionErrPx, "values": h.Row()})
	}
	var rerun []float64 // the fitted table for Rerun given (TeeRight, Ray), all holes
	for _, s := range scores {
		if s.Design.RerunCopiesRay {
			for _, n := range s.Fitted {
				if n.Name == "Rerun" {
					rerun = n.True
				}
			}
		}
	}
	return map[string]any{"source": source, "intro": intro, "introCopied": copied, "rates": rates, "rayRerunAgree": agree,
		"designs": designs, "holes": rows, "rerunTable": rerun}
}
