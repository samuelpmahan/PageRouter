import { WORK, FIXTURES, cases } from './paths.mjs';
// Record RimFit v3 exactly as the app runs it in Chromium (same modules, canvas pixels, the app's review flow) for every
// truth-set photo. Node replays these receipts as rimfit/v3@chromium, because v3 gives different answers on Node's V8.
import { chromium } from 'playwright'; import fs from 'node:fs';
const cases = cases;
const idx = JSON.parse(fs.readFileSync(`${WORK}/raw/index.json`,'utf8'));
const b = await chromium.launch(); const p = await b.newPage(); await p.goto('http://localhost:4173/');
const out = {};
for (const c of cases) {
  const r = await p.evaluate(async (b64) => {
    const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob(); const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const { recoverRimEllipseV3 } = await import('./rimfit-v3/recover.mjs');
    const { adaptRimFitResult } = await import('./experimental/ellipse-fit-fix/fit-adapter.mjs');
    const { refineEllipseWithRimEvidence } = await import('./experimental/ellipse-fit-fix/rim-aware-refinement.mjs');
    const { validateEllipseBounds } = await import('./experimental/ellipse-fit-fix/ellipse-geometry.mjs');
    const t0 = performance.now(); const img = { width: bmp.width, height: bmp.height, data };
    const result = recoverRimEllipseV3(img, { maxRefinementDimension: 384 });
    const proposal = adaptRimFitResult(result, { data, width: img.width, height: img.height, maxRefinementDimension: 384 });
    let refinement = null; if (proposal.status === 'MAYBE' && proposal.ellipse) { try { refinement = refineEllipseWithRimEvidence(img, proposal, { enabled: true }); } catch { refinement = { status: 'ABSTAIN', reason: 'error' }; } }
    const refined = refinement?.status === 'MAYBE' && refinement.ellipse && validateEllipseBounds(img.width, img.height, refinement.ellipse, 0);
    const q = result.algorithm?.quality ?? {};
    return { v3Status: result.status, abstainReasons: q.abstainReasons ?? [], proposalStatus: proposal.status, proposalEllipse: proposal.ellipse ?? null,
      diagnostic: proposal.diagnostics?.unacceptedDiagnosticEllipse ?? null, refinement: refinement?.status ?? null, refinementReason: refinement?.reason ?? null,
      ellipse: refined ? refinement.ellipse : null, ms: Math.round(performance.now() - t0) };
  }, fs.readFileSync(c.file).toString('base64'));
  out[idx.find(x => x.name === c.name).sha256] = { name: c.name, ...r }; process.stdout.write(r.ellipse ? 'E' : '.');
}
fs.writeFileSync(`${FIXTURES}/v3-chromium.json`, JSON.stringify(out, null, 1)); await b.close(); console.log();
