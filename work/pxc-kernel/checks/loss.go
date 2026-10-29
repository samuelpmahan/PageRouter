package ringgate

import (
	"math"
	"sort"
)

// Observation is one ring the gate was set on, with the answer it should give.
//
// There is no fitting loss in the code: Argon set T = 13 by hand, midway between the Neutron Control rim (p25 22.5, should
// fire) and the drop shadows outside FX-4, Orbital and Impulse after the refit (p25 3.5, must not fire), 9.5 of margin each way.
// That is a maximum-margin choice. The loss here is the smooth version of the same idea, a logistic loss on the margin
// (p25 - T) at temperature Tau, so it has a minimum where the margin is balanced and a curvature that can be measured.
type Observation struct {
	Name     string
	Label    float64 // +1 fire, -1 do not fire
	Ring     [][]*float64
	Smooth   [][]*float64
	Rhos     []float64
	Argon    float64 // Argon's recorded p25, when he recorded one (NaN otherwise)
	WhichFit string
}

const Tau = 2.0 // one re-encode noise unit of colour distance (harness/noise.py: p95 of |change| is 2 to 6)

func (o Observation) idx(rho float64) int {
	best := 0
	for i, r := range o.Rhos {
		if math.Abs(r-rho) < math.Abs(o.Rhos[best]-rho) {
			best = i
		}
	}
	return best
}

// P25 is exactly what the code computes: nearest-pixel samples, nearest grid rho, index floor(len q).
func (o Observation) P25(rho, q float64) float64 { return RingQuantile(o.Ring[o.idx(rho)], q) }

// P25Smooth uses bilinear samples, interpolates between grid rhos, and reads the quantile at the continuous position len q,
// which equals the code's index at q = 0.25 and moves smoothly in between. Only this one has derivatives.
func (o Observation) P25Smooth(rho, q float64) float64 {
	step := o.Rhos[1] - o.Rhos[0]
	f := (rho - o.Rhos[0]) / step
	i := int(math.Floor(f))
	if i < 0 {
		i, f = 0, 0
	}
	if i >= len(o.Rhos)-1 {
		i, f = len(o.Rhos)-2, float64(len(o.Rhos)-1)
	}
	t := f - float64(i)
	return (1-t)*quantileSmooth(o.Smooth[i], q) + t*quantileSmooth(o.Smooth[i+1], q)
}

func quantileSmooth(ring []*float64, q float64) float64 {
	v := present(ring)
	sort.Float64s(v)
	pos := q * float64(len(v))
	i := int(math.Floor(pos))
	if i >= len(v)-1 {
		return v[len(v)-1]
	}
	if i < 0 {
		return v[0]
	}
	t := pos - float64(i)
	return (1-t)*v[i] + t*v[i+1]
}

func softplus(x float64) float64 {
	if x > 30 {
		return x
	}
	return math.Log1p(math.Exp(x))
}

// Loss over the observations at constants (rho, q, T); errors counts wrong decisions of the real gate.
func Loss(obs []Observation, rho, q, T float64, smooth bool) (loss float64, errors int) {
	for _, o := range obs {
		var p float64
		if smooth {
			p = o.P25Smooth(rho, q)
		} else {
			p = o.P25(rho, q)
		}
		loss += softplus(-o.Label * (p - T) / Tau)
		if (p >= T) != (o.Label > 0) {
			errors++
		}
	}
	return
}

// Scale puts the three constants in units of one natural step each, so curvatures compare: rho in 1% of the radius, q in one
// ring sample (1/72), T in one unit of colour distance.
var Scale = [3]float64{0.01, 1.0 / 72, 1}

// Hessian of the smooth loss at x by central differences of h scaled units.
func Hessian(obs []Observation, x [3]float64, h float64) [3][3]float64 {
	f := func(u [3]float64) float64 { l, _ := Loss(obs, u[0], u[1], u[2], true); return l }
	var H [3][3]float64
	for i := 0; i < 3; i++ {
		for j := i; j < 3; j++ {
			at := func(si, sj float64) float64 {
				u := x
				u[i] += si * h * Scale[i]
				u[j] += sj * h * Scale[j]
				return f(u)
			}
			var v float64
			if i == j {
				v = (at(1, 0) - 2*f(x) + at(-1, 0)) / (h * h)
			} else {
				v = (at(1, 1) - at(1, -1) - at(-1, 1) + at(-1, -1)) / (4 * h * h)
			}
			H[i][j], H[j][i] = v, v
		}
	}
	return H
}

// Eigen decomposes a symmetric 3x3 matrix by Jacobi rotations; vectors are columns, sorted by eigenvalue, largest first.
func Eigen(A [3][3]float64) ([3]float64, [3][3]float64) {
	V := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	for sweep := 0; sweep < 100; sweep++ {
		off := A[0][1]*A[0][1] + A[0][2]*A[0][2] + A[1][2]*A[1][2]
		if off < 1e-30 {
			break
		}
		for p := 0; p < 2; p++ {
			for q := p + 1; q < 3; q++ {
				if math.Abs(A[p][q]) < 1e-300 {
					continue
				}
				theta := (A[q][q] - A[p][p]) / (2 * A[p][q])
				t := math.Copysign(1, theta) / (math.Abs(theta) + math.Sqrt(theta*theta+1))
				c := 1 / math.Sqrt(t*t+1)
				s := t * c
				for k := 0; k < 3; k++ {
					akp, akq := A[k][p], A[k][q]
					A[k][p], A[k][q] = c*akp-s*akq, s*akp+c*akq
				}
				for k := 0; k < 3; k++ {
					apk, aqk := A[p][k], A[q][k]
					A[p][k], A[q][k] = c*apk-s*aqk, s*apk+c*aqk
				}
				for k := 0; k < 3; k++ {
					vkp, vkq := V[k][p], V[k][q]
					V[k][p], V[k][q] = c*vkp-s*vkq, s*vkp+c*vkq
				}
			}
		}
	}
	vals := [3]float64{A[0][0], A[1][1], A[2][2]}
	idx := []int{0, 1, 2}
	sort.Slice(idx, func(a, b int) bool { return vals[idx[a]] > vals[idx[b]] })
	var sv [3]float64
	var sV [3][3]float64
	for c, i := range idx {
		sv[c] = vals[i]
		for r := 0; r < 3; r++ {
			sV[r][c] = V[r][i]
		}
	}
	return sv, sV
}
