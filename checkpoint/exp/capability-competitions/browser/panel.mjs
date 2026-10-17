import {
  createCompetitionRegistry,
  NAME_THAT_LLM,
  NFL_WR_CUT_RECOVERY,
} from '../capabilities.mjs';
import { makeNameThatLlmReport, makeNflReport, runSyntheticReference } from './fixtures.mjs';

const DRIVE_URL = 'https://drive.google.com/drive/folders/17r9efXgPC-NRwLtMPj7EET3cZLXp6_bO';
const REPO = 'https://github.com/samuelpmahan/PageRouter/blob/main/checkpoint/exp/capability-competitions';
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const pretty = value => JSON.stringify(value, null, 2);
const metric = value => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value) : '—';

function callsIn(trace, rows = []) {
  for (const call of trace?.calls || []) {
    rows.push(call);
    callsIn(call, rows);
  }
  return rows;
}

function metricMarkup(result) {
  if (!result || result.metrics === null) return '<p class="cr-empty">This report has no evaluation arrays to score.</p>';
  if (result.experiment === NAME_THAT_LLM) {
    const { baseline, candidate } = result;
    return `<div class="cr-metric-grid">
      <article class="cr-metric"><span>Baseline · macro recall</span><strong>${metric(baseline.macroRecall)}</strong><small>Accuracy ${metric(baseline.accuracy)} · ${result.count} synthetic rows</small></article>
      <article class="cr-metric"><span>Candidate · macro recall</span><strong>${metric(candidate.macroRecall)}</strong><small>Accuracy ${metric(candidate.accuracy)} · all 18 fixed labels present</small></article>
      <article class="cr-metric cr-delta"><span>Candidate − baseline</span><strong>${metric(result.macroRecallDelta)}</strong><small>Plumbing output only; no efficacy claim</small></article>
    </div>`;
  }
  const rowBase = result.rowWeighted.baseline;
  const rowCandidate = result.rowWeighted.candidate;
  const player = result.playerWeighted;
  return `<div class="cr-metric-grid">
    <article class="cr-metric"><span>Baseline · pooled play rows</span><strong>MAE ${metric(rowBase.mae)}</strong><small>RMSE ${metric(rowBase.rmse)} · ${result.count} synthetic plays</small></article>
    <article class="cr-metric"><span>Candidate · pooled play rows</span><strong>MAE ${metric(rowCandidate.mae)}</strong><small>RMSE ${metric(rowCandidate.rmse)}</small></article>
    <article class="cr-metric"><span>Equal-player MAE</span><strong>${metric(player.baselineMae)} → ${metric(player.candidateMae)}</strong><small>${result.playerCount} players · delta ${metric(player.maeDeltaCandidateMinusBaseline)}</small></article>
  </div><p class="cr-note">Pooled metrics weight each play row equally. Equal-player metrics first average a player’s plays, then weight each player equally.</p>`;
}

function paintResult(root, result, execution, replay = null) {
  const trace = callsIn(execution.trace);
  root.querySelector('[data-cr-status]').textContent = `Native run complete · ${result.status} · ${result.sourceKind}`;
  root.querySelector('[data-cr-trace]').textContent = `${trace.length} native trace calls · ${trace.map(call => call.id).join(' → ') || 'no nested calls'}`;
  root.querySelector('[data-cr-metrics]').innerHTML = metricMarkup(result);
  root.querySelector('[data-cr-result]').textContent = pretty(result);
  root.querySelector('[data-cr-replay]').textContent = replay
    ? `Native replay ${replay.matches ? 'matched' : 'did not match'}${replay.exact ? ' exactly' : ''} · result hash ${replay.hash ? 'matched' : 'differed'}`
    : 'Replay has not run yet.';
}

export function registerCompetitionReferences({ registry = createCompetitionRegistry() } = {}) {
  return window.capabilityLab.registerPanel({
    id: 'competition-references',
    title: 'Reference implementations',
    render(container) {
      container.innerHTML = `<section class="cr-panel" aria-labelledby="cr-heading">
        <header class="cr-hero">
          <div><p class="cr-kicker">Capability competitions · reference examples</p><h2 id="cr-heading">Reference implementations</h2>
          <p>Small editable reports exercise the native prediction metrics, trace, and deterministic replay. These are synthetic plumbing examples, not model training or evidence of efficacy.</p></div>
          <aside class="cr-synthetic"><strong>Synthetic · inconclusive</strong><span>No models are trained. No data is fetched.</span></aside>
        </header>
        <div class="cr-controls">
          <label for="cr-experiment">Example</label>
          <select id="cr-experiment" data-cr-select>
            <option value="${NAME_THAT_LLM}">Name That LLM · all 18 canonical labels</option>
            <option value="${NFL_WR_CUT_RECOVERY}">NFL receiver · five synthetic plays</option>
          </select>
          <button type="button" class="cr-primary" data-cr-run>Run</button>
          <button type="button" data-cr-replay-button disabled>Replay</button>
          <span class="cr-status" data-cr-status aria-live="polite">Choose an example and run it.</span>
        </div>
        <div class="cr-columns">
          <section class="cr-card"><h3>Editable report</h3><p class="cr-help">Edit JSON, then Run. The report must remain an inconclusive synthetic fixture.</p>
            <textarea data-cr-editor aria-label="Editable synthetic competition report" spellcheck="false"></textarea>
            <p class="cr-trace" data-cr-trace>Native execution trace will appear after Run.</p></section>
          <section class="cr-card"><h3>Baseline and candidate</h3><div data-cr-metrics><p class="cr-empty">Run the example to calculate native metric summaries.</p></div>
            <h3 class="cr-subhead">Replay status</h3><p class="cr-replay" data-cr-replay>Replay has not run yet.</p>
            <details class="cr-details"><summary>Native result receipt</summary><pre data-cr-result>Run a synthetic report to inspect its result.</pre></details></section>
        </div>
        <footer class="cr-footer"><div><strong>Run full experiments locally</strong><span>From <code>checkpoint</code>: install <code>exp/capability-competitions/requirements.txt</code>, then run <code>node exp/capability-competitions/cli.mjs list</code>. Use <code>run ntllm --train …</code> or <code>run nfl --data-dir … --drill … --route-family …</code> with your local CSVs.</span></div>
          <nav aria-label="Competition files"><a href="${REPO}/ntllm" target="_blank" rel="noreferrer">Name That LLM source</a><a href="${REPO}/nfl" target="_blank" rel="noreferrer">NFL source</a><a href="${DRIVE_URL}" target="_blank" rel="noreferrer">Drive folder for datasets and run reports</a></nav>
        </footer>
      </section>`;

      const select = container.querySelector('[data-cr-select]');
      const editor = container.querySelector('[data-cr-editor]');
      const runButton = container.querySelector('[data-cr-run]');
      const replayButton = container.querySelector('[data-cr-replay-button]');
      let receipt = null;
      const freshReport = () => select.value === NAME_THAT_LLM ? makeNameThatLlmReport() : makeNflReport();
      const clearDisplayedResult = message => {
        const status = container.querySelector('[data-cr-status]');
        status.classList.remove('cr-error');
        status.textContent = message;
        container.querySelector('[data-cr-trace]').textContent = 'Native execution trace will appear after Run.';
        container.querySelector('[data-cr-replay]').textContent = 'Replay has not run yet.';
        container.querySelector('[data-cr-result]').textContent = 'Run a synthetic report to inspect its result.';
        container.querySelector('[data-cr-metrics]').innerHTML = '<p class="cr-empty">Run the example to calculate native metric summaries.</p>';
      };
      const resetReceipt = () => {
        receipt = null;
        replayButton.disabled = true;
        clearDisplayedResult('Synthetic report ready · inconclusive');
      };
      editor.value = pretty(freshReport());
      select.addEventListener('change', () => { editor.value = pretty(freshReport()); resetReceipt(); });
      editor.addEventListener('input', () => {
        receipt = null;
        replayButton.disabled = true;
        clearDisplayedResult('Input changed — run again.');
      });
      runButton.addEventListener('click', () => {
        try {
          const report = JSON.parse(editor.value);
          const { execution, result } = runSyntheticReference(report, registry);
          receipt = { execution, result, inputText: editor.value };
          replayButton.disabled = false;
          container.querySelector('[data-cr-status]').classList.remove('cr-error');
          paintResult(container, result, execution);
        } catch (error) {
          receipt = null;
          replayButton.disabled = true;
          clearDisplayedResult(`Run failed · ${error.message}`);
          container.querySelector('[data-cr-status]').classList.add('cr-error');
        }
      });
      replayButton.addEventListener('click', () => {
        if (!receipt || editor.value !== receipt.inputText) return;
        try {
          const replay = registry.replay(receipt.execution);
          paintResult(container, receipt.result, receipt.execution, replay);
          container.querySelector('[data-cr-status]').textContent = `Native replay complete · ${replay.matches ? 'matched' : 'mismatch'}`;
        } catch (error) {
          container.querySelector('[data-cr-status]').textContent = `Replay failed · ${error.message}`;
          container.querySelector('[data-cr-status]').classList.add('cr-error');
        }
      });
    },
  });
}

export { metricMarkup };
