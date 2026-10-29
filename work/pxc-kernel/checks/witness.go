package ringgate

import (
	"encoding/json"
	"math"
	"os"

	"pxc"
)

// The witness model on real labels: ChainSpot's tee recovery on two courses (36 holes with a surveyed tee). The hidden truth
// is "the template-fusion tee is within 13 px of the surveyed tee" (the project's own pass line). Four witnesses look at the
// same hole without seeing the truth, with thresholds fixed before fitting:
//
//	Template   template match score (normalised cross-correlation) at least 0.6
//	Ray        the ray method's tee lands within 13 px of the fusion tee
//	Rerun      the ray method rerun on jittered input lands within 13 px of the fusion tee (nearly a copy of Ray)
//	Evidence   the ray method's mean evidence along its path is at least 0.6

type TeeHole struct {
	Course          string
	Hole            int
	FusionErrPx     float64
	Ncc             float64
	FusionTeePx     [2]float64
	RayTeePx        [2]float64
	JitterRayTeePx  [2]float64
	RayMeanEvidence float64
}

type teeFile struct {
	Source string
	Holes  []TeeHole
}

func LoadTeeHoles(path string) (string, []TeeHole, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	var f teeFile
	if err := json.Unmarshal(b, &f); err != nil {
		return "", nil, err
	}
	return f.Source, f.Holes, nil
}

var Witnesses = []string{"Template", "Ray", "Rerun", "Evidence"}

func dist(p, q [2]float64) float64 { return math.Hypot(p[0]-q[0], p[1]-q[1]) }

// Row turns a hole into the truth and the four witness readings.
func (h TeeHole) Row() map[string]bool {
	return map[string]bool{
		"TeeRight": h.FusionErrPx <= 13,
		"Template": h.Ncc >= 0.6,
		"Ray":      dist(h.RayTeePx, h.FusionTeePx) <= 13,
		"Rerun":    dist(h.JitterRayTeePx, h.FusionTeePx) <= 13,
		"Evidence": h.RayMeanEvidence >= 0.6,
	}
}

// WitnessDesign is one model shape: which witnesses it listens to, and whether Rerun is modelled as depending on Ray.
type WitnessDesign struct {
	Name, Note     string
	Uses           []string
	RerunCopiesRay bool
}

var WitnessDesigns = []WitnessDesign{
	{"Prior only", "no witnesses: the base rate", nil, false},
	{"Template alone", "", []string{"Template"}, false},
	{"Ray alone", "", []string{"Ray"}, false},
	{"Template, Ray, Evidence", "three witnesses treated as independent given the truth", []string{"Template", "Ray", "Evidence"}, false},
	{"All four, treated as independent", "counts the rerun as a fourth opinion", []string{"Template", "Ray", "Rerun", "Evidence"}, false},
	{"All four, rerun reads Ray", "the rerun's table is conditioned on the truth and on Ray", []string{"Template", "Ray", "Rerun", "Evidence"}, true},
}

func (d WitnessDesign) Model() *pxc.Model {
	m := pxc.NewModel().Add("TeeRight")
	for _, w := range d.Uses {
		if w == "Rerun" && d.RerunCopiesRay {
			m.Add(w, "TeeRight", "Ray")
		} else {
			m.Add(w, "TeeRight")
		}
	}
	return m
}

func (d WitnessDesign) evidence(row map[string]bool) map[string]bool {
	e := map[string]bool{}
	for _, w := range d.Uses {
		e[w] = row[w]
	}
	return e
}

type DesignScore struct {
	Design         WitnessDesign
	LogLoss, Brier float64
	Correct, Holes int
	LeaveOneOut    []float64
	Fitted         []pxc.ModelNode // fitted on all holes, for the rates table
}

// LeaveOneOut fits each design on every hole but one, asks for P(TeeRight | that hole's witnesses), and scores the answers
// against the truth: log loss (natural log), Brier score, and how many land on the right side of one half.
func LeaveOneOut(holes []TeeHole, alpha float64) ([]DesignScore, error) {
	rows := make([]map[string]bool, len(holes))
	for i, h := range holes {
		rows[i] = h.Row()
	}
	var out []DesignScore
	for _, d := range WitnessDesigns {
		s := DesignScore{Design: d, Holes: len(holes)}
		for i := range rows {
			train := append(append([]map[string]bool{}, rows[:i]...), rows[i+1:]...)
			m := d.Model()
			m.Fit(train, alpha)
			p, err := m.Posterior("TeeRight", d.evidence(rows[i]))
			if err != nil {
				return nil, err
			}
			s.LeaveOneOut = append(s.LeaveOneOut, p)
			y := 0.0
			if rows[i]["TeeRight"] {
				y = 1
			}
			s.LogLoss -= y*math.Log(p) + (1-y)*math.Log(1-p)
			s.Brier += (p - y) * (p - y)
			if (p >= 0.5) == (y == 1) {
				s.Correct++
			}
		}
		s.LogLoss /= float64(len(rows))
		s.Brier /= float64(len(rows))
		m := d.Model()
		m.Fit(rows, alpha)
		s.Fitted = m.Nodes
		out = append(out, s)
	}
	return out, nil
}

// IntroPosteriors is the made-up example: an even prior and witnesses with hit rate 0.8 and false-alarm rate 0.2. It returns
// the posterior after 1, 2 and 3 agreeing independent witnesses, and after a witness plus an exact copy of it.
func IntroPosteriors() (independent []float64, copied float64, err error) {
	m := pxc.NewModel().Add("truth").Set("truth", 0.5).
		Witness("a", "truth", 0.8, 0.2).Witness("b", "truth", 0.8, 0.2).Witness("c", "truth", 0.8, 0.2)
	ev := map[string]bool{}
	for _, w := range []string{"a", "b", "c"} {
		ev[w] = true
		p, err := m.Posterior("truth", ev)
		if err != nil {
			return nil, 0, err
		}
		independent = append(independent, p)
	}
	c := pxc.NewModel().Add("truth").Set("truth", 0.5).Witness("a", "truth", 0.8, 0.2).
		Add("copy", "truth", "a").Set("copy", 0, 0, 1, 1)
	copied, err = c.Posterior("truth", map[string]bool{"a": true, "copy": true})
	return independent, copied, err
}
