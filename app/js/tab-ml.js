/* ML Model: what Isolation Forest is, how it was applied, how the parameters
   behave (real sweep from analysis/model_sensitivity.py) and what it found. */
window.FE.tabs.ml = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml } = window.FE;
    const { lineChart } = window.FE.charts;
    const sens = state.sensitivity;
    const scores = state.data.account_scores;

    const FEATURES = [
      ["n_tx", "Number of transactions"],
      ["avg_amt / std_amt / max_amt", "Amount profile: mean, dispersion, largest single txn"],
      ["total", "Total value moved"],
      ["pct_hr", "Share of txns to sanctioned/high-risk countries"],
      ["pct_off", "Share of txns to offshore centers"],
      ["pct_cash", "Share of cash transactions"],
      ["pct_struct", "Share in the $9,000–9,999 reporting-threshold band"],
      ["pct_intl", "Share marked international"],
      ["tx_per_month / velocity_value", "Velocity: transactions and value per month"],
    ];

    /* per-feature deviation explanation vs the population median */
    const FEATURE_LABELS = {
      n_tx: ["transactions", (v) => v.toFixed(0)],
      total: ["total value", (v) => fmtMoney(v, true)],
      max_amt: ["largest txn", (v) => fmtMoney(v, true)],
      pct_hr: ["sanctioned-country share", fmtPct],
      pct_off: ["offshore share", fmtPct],
      pct_cash: ["cash share", fmtPct],
      pct_struct: ["9–10k-band share", fmtPct],
      tx_per_month: ["txns/month", (v) => v.toFixed(1)],
      velocity_value: ["value/month", (v) => fmtMoney(v, true)],
    };
    const median = (arr) => {
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const medians = {};
    for (const key of Object.keys(FEATURE_LABELS)) medians[key] = median(scores.map((s) => s[key] ?? 0));
    function explainDeviations(acc) {
      const reasons = [];
      for (const [key, [label, fmt]] of Object.entries(FEATURE_LABELS)) {
        const v = acc[key], med = medians[key];
        if (v == null) continue;
        const ratio = med > 0 ? v / med : (v > 0 ? Infinity : 0);
        if (ratio >= 2.5 || (med === 0 && v >= 0.1)) {
          const vs = med > 0 && Number.isFinite(ratio)
            ? `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}× median`
            : `median ${fmt(med)}`;
          reasons.push({ ratio: Number.isFinite(ratio) ? ratio : 1000 + v,
            html: `<span class="why-chip">${label}: ${fmt(v)} (${vs})</span>` });
        }
      }
      return reasons.sort((a, b) => b.ratio - a.ratio).slice(0, 4).map((r) => r.html).join("");
    }

    const anoms = scores.filter((s) => s.anomaly === -1).sort((a, b) => b.score - a.score);
    const maxScore = Math.max(...anoms.map((a) => a.score));

    el.innerHTML = `
      <p class="tab-intro">Unsupervised anomaly detection at account level. There are no fraud
      labels in this dataset, so the model's job is not to classify — it is to surface accounts
      whose behavior is structurally unlike the rest, and to do it <strong>explainably</strong>.</p>

      <div class="ml-grid">
        <div class="card">
          <h3>Why Isolation Forest</h3>
          <p>Isolation Forest isolates observations by random recursive splits: anomalies are
          isolated in fewer splits, so their average path length is short. It fits this problem
          because it needs <strong>no labels</strong>, handles mixed-scale behavioral features,
          and its output is <strong>auditable</strong> — every flagged account can be explained
          by which features deviate (below), which is what a compliance reviewer needs.</p>
          <h3>How it was applied</h3>
          <p><code>transactions</code> → 12 behavioral features per account →
          <code>StandardScaler</code> → <code>IsolationForest(n_estimators=300,
          contamination=0.08, random_state=42)</code>. Code:
          <code>analysis/anomaly.py</code>.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Feature</th><th>Meaning</th></tr></thead>
            <tbody>${FEATURES.map(([f, m]) =>
              `<tr><td><code>${f}</code></td><td>${m}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3>Parameter behavior — a real sweep, not defaults on faith</h3>
          <p><code>analysis/model_sensitivity.py</code> refits the model over
          contamination ∈ {4%…12%} × trees ∈ {100, 300, 500}. Two results matter:
          <strong>contamination sets how many accounts flag</strong> (it is a review-capacity
          dial, ${sens.grid[0].n_anomalies} → ${sens.grid[sens.grid.length - 1].n_anomalies}
          accounts across the sweep) — and <strong>the ranking is stable</strong>: the top-5
          accounts are identical (Jaccard 1.0) for nearly every configuration, so the accounts
          below aren't artifacts of one parameter choice.</p>
          <div class="chart-slot" id="ml-sweep"></div>
          <p class="muted">Chosen configuration: contamination 8% ≈ ${sens.base.n_anomalies} of
          ${sens.base.n_accounts} accounts — a realistic enhanced-review workload; 300 trees
          (the ranking already stabilizes there); fixed seed for reproducibility.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Results — ${anoms.length} anomalous accounts, ${anoms.filter((a) => !a.has_alert).length} never alerted</h3>
          <span class="muted">the model surfaces risk the rules engine missed</span>
        </div>
        <div id="ml-anomalies">
          ${anoms.map((a) => `
            <div class="anom-item">
              <div class="anom-top">
                <div>
                  <span class="anom-id">${escapeHtml(a.account_id)}</span>
                  <span class="anom-meta"> · ${escapeHtml(a.risk_rating)} risk · ${escapeHtml(a.status)} ·
                    ${fmtInt(a.n_tx)} txns · ${fmtMoney(a.total, true)}</span>
                </div>
                ${a.has_alert
                  ? '<span class="badge badge-plain">Has alert history</span>'
                  : '<span class="anom-alert-gap">Never alerted</span>'}
              </div>
              <div class="anom-score-track" role="img" aria-label="Anomaly score ${a.score.toFixed(2)}">
                <div class="anom-score-fill" style="width:${(a.score / maxScore) * 100}%"></div>
              </div>
              <div class="anom-why">Why: ${explainDeviations(a) || "broad multi-feature deviation"}</div>
            </div>`).join("")}
        </div>
      </div>`;

    const byTrees = {};
    for (const g of sens.grid) (byTrees[g.n_estimators] ??= []).push(g);
    lineChart(el.querySelector("#ml-sweep"), {
      title: "Anomalies flagged vs contamination, by forest size",
      howToRead: "Each line is a forest size; the x-axis is the contamination parameter. The lines overlap almost perfectly: contamination linearly dials how many accounts flag, while forest size barely changes the outcome — evidence the detections are robust, not parameter luck.",
      fmt: fmtInt,
      series: Object.entries(byTrees).map(([trees, rows], i) => ({
        name: `${trees} trees`,
        color: ["#2E5BFF", "#E8A33D", "#2FA36B"][i],
        points: rows.map((r) => ({ x: fmtPct(r.contamination, 0), y: r.n_anomalies })),
      })),
    });
  },
};
