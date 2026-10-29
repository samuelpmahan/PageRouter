package ringgate

import (
	"encoding/json"
	"math"
	"os"
	"sort"
)

// Photo is one row of testdata/rings.json (harness/extract.mjs): Argon's live fit, the silhouette's final crop, and the 72 ring
// samples' colour distance to the background at every ring scale rho on the grid, nearest-pixel exactly as ringBg reads them,
// and bilinear for the smooth loss. A nil sample fell outside the image; ringBg drops those.
type Photo struct {
	Name, Label, Kind, Note    string
	Uniform, Applied, FaintOK  bool
	Med0                       float64
	OutsideConcentricCode      *float64
	OutsideConcentricFinalCode *float64
	Rhos                       []float64
	Nearest, Bilinear          [][]*float64
	FinalNearest               [][]*float64 `json:"finalNearest"`
	FinalBilinear              [][]*float64 `json:"finalBilinear"`
	Reason                     string
}

func LoadPhotos(path string) ([]Photo, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ps []Photo
	return ps, json.Unmarshal(b, &ps)
}

func present(ring []*float64) []float64 {
	var v []float64
	for _, x := range ring {
		if x != nil {
			v = append(v, *x)
		}
	}
	return v
}

// RingQuantile is ringBg's reading: drop samples outside the image, sort, take index floor(len q).
func RingQuantile(ring []*float64, q float64) float64 {
	v := present(ring)
	if len(v) == 0 {
		return math.NaN()
	}
	sort.Float64s(v)
	i := int(float64(len(v)) * q)
	if i > len(v)-1 {
		i = len(v) - 1
	}
	return v[i]
}

func (p Photo) RhoIndex(rho float64) int {
	best := 0
	for i, r := range p.Rhos {
		if math.Abs(r-rho) < math.Abs(p.Rhos[best]-rho) {
			best = i
		}
	}
	return best
}
