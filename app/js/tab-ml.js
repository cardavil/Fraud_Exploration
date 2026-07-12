/* ML Model: what Isolation Forest is, how it was applied, how the parameters
   behave (real sweep), how it VALIDATES (overfitting, bootstrap confidence,
   stability, convergent validity, ablation — model_validation.json), what it
   found, and — live — the model itself running in the browser (iforest.js):
   every score recomputed client-side and verified against the pipeline, plus
   a what-if playground. */
window.FE.tabs.ml = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml } = window.FE;
    const { barChart, hBarChart, lineChart } = window.FE.charts;
    const sens = state.sensitivity;
    const val = state.validation;
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
      ["pct_txn_anomalous / max_txn_score", "Tier-1 feed: share and peak of transaction-level anomaly"],
      ["max_day_share", "Burstiness: biggest single day / total value"],
      ["recent_intensity", "Share of value moved in the last 90 days"],
    ];

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
    const confidence = new Map(val.bootstrap.accounts.map((a) => [a.account_id, a.frequency]));
    const confidenceBadge = (id) => {
      const f = confidence.get(id);
      if (f == null) return "";
      const cls = f >= 0.9 ? "badge-clear" : f >= 0.6 ? "badge-offshore" : "badge-sanctioned";
      return `<span class="badge ${cls}">flagged in ${fmtPct(f)} of refits</span>`;
    };
    const ov = val.overfitting;
    const cv = val.convergent_validity;

    /* ---------- tier 1: transaction-level detections ---------- */
    const t1v = state.tier1;
    const txnScoreRows = state.data.transaction_scores;
    const topTxns = txnScoreRows.filter((t) => t.anomaly === -1)
      .sort((a, b) => b.score - a.score).slice(0, 10);
    const txnReasonChips = (t) => {
      const chips = [];
      if (t.rel_amount >= 5) chips.push(`${t.rel_amount >= 49 ? "50+" : t.rel_amount.toFixed(0)}× its account's median`);
      if (t.nonactive_status) chips.push("non-active account");
      if (t.hr_country) chips.push("sanctioned country");
      if (t.band_9k) chips.push("9–10k band");
      if (t.same_day_txns >= 4) chips.push(`${t.same_day_txns} txns same day`);
      if (t.offshore) chips.push("offshore");
      if (t.intl_mismatch) chips.push("intl flag wrong");
      return chips.slice(0, 3).map((c) => `<span class="why-chip">${c}</span>`).join("") || '<span class="why-chip">multi-feature</span>';
    };

    /* ---------- tier 3: customer ranking ---------- */
    const t3v = state.tier3;
    const custRows = [...state.data.customer_scores].sort((a, b) => b.score - a.score).slice(0, 15);

    el.innerHTML = `
      <p class="tab-intro">Detection runs at three levels — transaction, account and customer —
      because each level captures behavior the others cannot: individual outliers, behavioral
      patterns, and cross-account activity tied to the legal subject. All models are
      unsupervised Isolation Forests, validated for stability and generalization, and
      explainable feature by feature. The account model also runs in the browser for
      independent verification.</p>

      <h3 class="tier-heading">Tier 1 — Transaction-level detection</h3>
      <div class="card">
        <div class="card-head">
          <h3>Method and results</h3>
          <span class="muted">${fmtInt(t1v.n_flagged)} flagged (${fmtMoney(t1v.value_flagged, true)}) ·
            ${t1v.convergence_vs_rules.model_only} model-only ·
            ${fmtPct(t1v.bootstrap.share_of_detections_stable)} bootstrap-stable</span>
        </div>
        <p>Each transaction is scored in context: amount relative to its own account's history,
        reporting-threshold band, geography, cash, account status, burst timing and counterparty
        novelty. ${t1v.convergence_vs_rules.flagged_by_both} of ${fmtInt(t1v.n_flagged)}
        detections overlap the rules engine;
        <strong>${t1v.convergence_vs_rules.model_only} are model-only detections</strong>,
        including ${t1v.top_model_only.slice(0, 2).map((t) => fmtMoney(t.amount, true)).join(" and ")} transfers.</p>
        <p class="muted">The table shows the <strong>10 highest-scored</strong> of the
        ${fmtInt(t1v.n_flagged)} flagged transactions.
        <a href="#data" class="drill-link" id="t1-see-all">View all ${fmtInt(t1v.n_flagged)} in the Data tab &rarr;</a></p>
        <div class="table-wrap"><table>
          <thead><tr><th>Transaction</th><th>Account</th><th class="num">Amount</th>
          <th class="num">Score</th><th>Drivers</th><th>Rules engine</th></tr></thead>
          <tbody>${topTxns.map((t) => `
            <tr><td>${escapeHtml(t.transaction_id)}</td><td>${escapeHtml(t.account_id)}</td>
            <td class="num">${t.amount == null ? "—" : fmtMoney(t.amount)}</td>
            <td class="num">${t.score.toFixed(3)}</td><td>${txnReasonChips(t)}</td>
            <td>${t.flagged_by_rules ? '<span class="badge badge-plain">also flagged</span>'
                                     : '<span class="badge badge-sanctioned">model only</span>'}</td></tr>`).join("")}
          </tbody>
        </table></div>
        <details class="criteria-legend">
          <summary>Driver criteria and rules-engine definitions</summary>
          <p>The chips name the strongest signals behind each score (up to 3 shown; the model
          uses all 11 features):</p>
          <dl>
            <dt>N× its account's median</dt><dd>amount at least 5× the median amount of the same account</dd>
            <dt>non-active account</dt><dd>the account was Closed, Dormant or Frozen at the time</dd>
            <dt>sanctioned country</dt><dd>counterparty in a sanctioned or high-risk jurisdiction</dd>
            <dt>9–10k band</dt><dd>amount between $9,000 and $9,999, under the $10,000 reporting threshold</dd>
            <dt>N txns same day</dt><dd>4 or more transactions on the account that day</dd>
            <dt>offshore</dt><dd>counterparty in an offshore financial center</dd>
            <dt>intl flag wrong</dt><dd>sanctioned-country counterparty recorded as domestic</dd>
          </dl>
          <p><strong>Rules engine</strong> — comparison with the dataset's rule-based monitoring
          (<code>flagged_for_review</code>): <span class="badge badge-plain">also flagged</span>
          the rules marked it too · <span class="badge badge-sanctioned">model only</span>
          flagged only by the model. The full feature values per transaction are in the
          <code>transaction_scores</code> table (Data tab).</p>
        </details>
      </div>

      <h3 class="tier-heading">Tier 2 — Account-level detection</h3>
      <div class="ml-grid">
        <div class="card">
          <h3>Model</h3>
          <p>Isolation Forest isolates observations through random recursive splits; anomalies
          require fewer splits, so their average path length is short. It suits this problem
          because it requires no labels, handles mixed-scale behavioral features, and every
          flagged account can be explained by which features deviate.</p>
          <h3>Method</h3>
          <p><code>transactions</code> + tier-1 scores → 16 features per account →
          <code>StandardScaler</code> → <code>IsolationForest(n_estimators=300,
          contamination=0.08, random_state=42)</code>. Code: <code>analysis/anomaly.py</code>
          + <code>analysis/account_features.py</code>.</p>
          <details class="notes">
            <summary>Feature definitions (16 features)</summary>
            <div class="table-wrap"><table>
              <thead><tr><th>Feature</th><th>Meaning</th></tr></thead>
              <tbody>${FEATURES.map(([f, m]) =>
                `<tr><td><code>${f}</code></td><td>${m}</td></tr>`).join("")}</tbody>
            </table></div>
          </details>
        </div>
        <div class="card">
          <h3>Parameter sensitivity</h3>
          <p><code>analysis/model_sensitivity.py</code> refits over contamination ∈ {4%…12%} ×
          trees ∈ {100, 300, 500}. Contamination determines how many accounts flag (a
          review-capacity setting), while the ranking stays stable: the top-5 is identical
          (Jaccard 1.0) for nearly every configuration.</p>
          <div class="chart-slot" id="ml-sweep"></div>
          <p class="muted">Chosen: contamination 8% ≈ ${sens.base.n_anomalies} of
          ${sens.base.n_accounts} accounts (a realistic enhanced-review workload), 300 trees,
          fixed seed for reproducibility.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Validation</h3>
          <span class="muted">analysis/model_validation.py · unsupervised setting: no labels, no accuracy metric — stability and generalization checks below</span>
        </div>
        <div class="ml-grid">
          <div>
            <h4>Generalization (train / held-out comparison)</h4>
            <p>${ov.n_splits} random 70/30 splits: fit on train, score both sides. Mean score
            train <strong>${ov.mean_score_train}</strong> vs held-out
            <strong>${ov.mean_score_holdout}</strong>, gap
            <strong>${ov.gap} ± ${ov.gap_std}</strong>. A gap near zero indicates the model
            scores unseen accounts consistently with training accounts — no memorization.</p>
            <h4>Stability</h4>
            <p>Across ${val.seed_stability.n_seeds} random seeds the anomaly set keeps a Jaccard
            of <strong>${val.seed_stability.jaccard_mean}</strong> vs the base run
            (min ${val.seed_stability.jaccard_min}). The per-detection confidence in the
            results below identifies which individual detections are sensitive to resampling.</p>
            <h4>Comparison with rule-based alerts (weak reference)</h4>
            <p>Rule alerts are not ground truth, but they provide a reference:
            ${cv.flagged_with_alert} of ${cv.flagged_total} flagged accounts also have alerts;
            the score↔alert correlation is <strong>${cv.score_alert_correlation}</strong>
            (p=${cv.correlation_p}). The near-zero correlation indicates the model captures a
            risk dimension — velocity and burst behavior — that the geography-driven rules do
            not cover; as a complementary detector it identified
            ${cv.flagged_total - cv.flagged_with_alert} accounts with no alert history.</p>
          </div>
          <div>
            <div class="chart-slot" id="ml-scoredist"></div>
            <div class="chart-slot" id="ml-ablation"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Results — ${anoms.length} anomalous accounts, ${anoms.filter((a) => !a.has_alert).length} never alerted</h3>
          <span class="muted">bootstrap confidence: share of ${val.bootstrap.n_iterations} refits on ${fmtPct(val.bootstrap.subsample)} subsamples that flag the account</span>
        </div>
        <details class="notes">
          <summary>Badge definitions</summary>
          <p><span class="badge badge-clear">flagged in N% of refits</span> bootstrap confidence:
          share of 200 refits on 80% subsamples that flag the account (green ≥ 90%, amber ≥ 60%,
          red below). <span class="anom-alert-gap">Never alerted</span> the rules engine has no
          alert on this account. The bar length is the anomaly score relative to the highest
          detection.</p>
        </details>
        <div id="ml-anomalies">
          ${anoms.map((a) => `
            <div class="anom-item">
              <div class="anom-top">
                <div>
                  <span class="anom-id">${escapeHtml(a.account_id)}</span>
                  <span class="anom-meta"> · ${escapeHtml(a.risk_rating)} risk · ${escapeHtml(a.status)} ·
                    ${fmtInt(a.n_tx)} txns · ${fmtMoney(a.total, true)}</span>
                </div>
                <div class="anom-badges">
                  ${confidenceBadge(a.account_id)}
                  ${a.has_alert
                    ? '<span class="badge badge-plain">Has alert history</span>'
                    : '<span class="anom-alert-gap">Never alerted</span>'}
                </div>
              </div>
              <div class="anom-score-track" role="img" aria-label="Anomaly score ${a.score.toFixed(2)}">
                <div class="anom-score-fill" style="width:${(a.score / maxScore) * 100}%"></div>
              </div>
              <div class="anom-why">Why: ${explainDeviations(a) || "broad multi-feature deviation"}</div>
            </div>`).join("")}
        </div>
      </div>

      <div class="card" id="ml-live">
        <div class="card-head">
          <h3>In-browser verification and account detail</h3>
          <span class="muted">the trained forest (300 trees) exported to JSON; inference reimplemented in dependency-free JS</span>
        </div>
        <p id="ml-verify" class="loading-cell">Loading the exported forest and recomputing every score locally…</p>
        <div id="ml-detail" class="hidden">
          <h4>Account detail</h4>
          <p class="muted">Customer profile, account activity, model assessment across the three
          tiers, and the corresponding alert and screening records.</p>
          <div class="copilot-controls">
            <select id="detail-account" aria-label="Account to inspect"></select>
          </div>
          <div id="detail-body"></div>
        </div>
      </div>

      <h3 class="tier-heading">Tier 3 — Customer-level detection</h3>
      <div class="card">
        <div class="card-head">
          <h3>Method and ranking</h3>
          <span class="muted">${t3v.n_flagged} anomalous of ${fmtInt(state.data.customer_scores.length)} active customers ·
            ${t3v.kyc_only_customers.count} KYC-only records excluded ·
            seed stability ${t3v.seed_stability.jaccard_mean}</span>
        </div>
        <p>Regulatory filings concern the customer, and some patterns are only visible at this
        level. CUST0054 illustrates the tier's coverage: no anomalous accounts and every
        transaction under the reporting threshold, flagged on 2 cross-account structuring days,
        no screening on record, ${fmtMoney(3888353, true)} across 4 accounts.</p>
        <details class="notes">
          <summary>Method and cross-tier consistency</summary>
          <p>The customer model combines account structure (number of accounts, anomalous
          accounts, peak account score), cross-account signals (structuring split across the
          customer's own accounts, value through non-active accounts) and KYC attributes
          (rating, PEP, screening state, post-match activity). Cross-tier consistency:
          ${fmtPct(t3v.cross_tier.anomalous_account_customers_in_top15)} of anomalous-account
          customers rank in this top-15; Spearman between customer score and peak account score
          is ${t3v.cross_tier.spearman_score_vs_max_account_score} — the customer tier re-ranks
          with information of its own rather than duplicating the account tier.</p>
        </details>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Customer</th><th class="num">Score</th><th class="num">Accounts</th>
          <th class="num">Anomalous accts</th><th class="num">Structuring days</th><th>Screening</th>
          <th class="num">Total value</th><th></th></tr></thead>
          <tbody>${custRows.map((r, i) => `
            <tr><td>${i + 1}</td>
            <td><strong>${escapeHtml(r.customer_id)}</strong> <span class="muted">${escapeHtml(r.full_name ?? "")}</span></td>
            <td class="num">${r.score.toFixed(3)}</td>
            <td class="num">${fmtInt(r.n_accounts)}</td>
            <td class="num">${r.n_anomalous_accounts ? `<strong>${fmtInt(r.n_anomalous_accounts)}</strong>` : "0"}</td>
            <td class="num">${r.structuring_days ? `<span class="badge badge-offshore">${fmtInt(r.structuring_days)}</span>` : "0"}</td>
            <td>${r.never_screened ? '<span class="badge badge-sanctioned">never screened</span>' : "screened"}</td>
            <td class="num">${fmtMoney(r.total_value, true)}</td>
            <td>${r.anomaly === -1 ? '<span class="badge badge-sanctioned">anomalous</span>' : ""}</td></tr>`).join("")}
          </tbody>
        </table></div>
      </div>`;

    el.querySelector("#t1-see-all").addEventListener("click", (e) => {
      e.preventDefault();
      window.FE.openData("transaction_scores", [
        { col: "anomaly", kind: "min", value: -1 },
        { col: "anomaly", kind: "max", value: -1 },
      ]);
    });

    /* ---------- charts ---------- */
    const byTrees = {};
    for (const g of sens.grid) (byTrees[g.n_estimators] ??= []).push(g);
    lineChart(el.querySelector("#ml-sweep"), {
      title: "Anomalies flagged vs contamination, by forest size",
      howToRead: "Each line is a forest size; the x-axis is the contamination parameter. The lines overlap almost perfectly: contamination determines how many accounts flag, while forest size barely changes the outcome, indicating the detections are robust to parameter choice.",
      fmt: fmtInt,
      series: Object.entries(byTrees).map(([trees, rows], i) => ({
        name: `${trees} trees`,
        color: ["#2E5BFF", "#E8A33D", "#2FA36B"][i],
        points: rows.map((r) => ({ x: fmtPct(r.contamination, 0), y: r.n_anomalies })),
      })),
    });
    barChart(el.querySelector("#ml-scoredist"), {
      title: "Score distribution and the model's cutoff",
      howToRead: `Each bar counts accounts per score bin; red bins sit above the anomaly cutoff (${val.score_distribution.cutoff}). Separation between the bulk and the flagged tail indicates the detections reflect distinct structure rather than a percentile split of a continuous mass.`,
      fmt: fmtInt,
      data: val.score_distribution.bins.map((b) => ({
        label: b.lo.toFixed(2), value: b.count,
        color: b.lo >= val.score_distribution.cutoff ? "#D64545" : "#2E5BFF",
        tip: `score ${b.lo.toFixed(3)}–${b.hi.toFixed(3)}<br>${fmtInt(b.count)} accounts${b.lo >= val.score_distribution.cutoff ? " · above cutoff" : ""}`,
      })),
    });
    hBarChart(el.querySelector("#ml-ablation"), {
      title: "Feature ablation — how much the anomaly set changes without each feature",
      howToRead: "Each bar is 1 − Jaccard between the anomaly set with and without that feature: longer bars indicate more influential features. Transaction velocity dominates, consistent with the single-day burst pattern in the detections.",
      fmt: (v) => v.toFixed(2),
      data: val.ablation.slice(0, 6).map((a) => ({
        label: a.feature, value: Math.round((1 - a.jaccard_vs_base) * 100) / 100,
        color: "#2E5BFF", emphasize: a.jaccard_vs_base <= 0.5,
        tip: `without <code>${a.feature}</code>: Jaccard ${a.jaccard_vs_base} vs full model`,
      })),
    });

    /* ---------- live scoring: verification + account story ---------- */
    (async () => {
      const iforest = window.FE.iforest;
      try {
        await iforest.load();
      } catch {
        el.querySelector("#ml-verify").textContent = "Could not load the exported model.";
        return;
      }
      const byAccount = new Map();
      for (const t of state.data.transactions) {
        if (!byAccount.has(t.account_id)) byAccount.set(t.account_id, []);
        byAccount.get(t.account_id).push(t);
      }
      const served = new Map(scores.map((s) => [s.account_id, s.score]));
      const txnScoreMap = new Map(state.data.transaction_scores.map((t) =>
        [t.transaction_id, { score: t.score, anomaly: t.anomaly }]));
      const datasetMaxDate = Math.max(...state.data.transactions.map((t) => Date.parse(t.transaction_date)));
      const liveFeatures = new Map();
      let matches = 0;
      for (const [accountId, txns] of byAccount) {
        const features = iforest.computeFeatures(txns, txnScoreMap, datasetMaxDate);
        liveFeatures.set(accountId, features);
        if (Math.abs(iforest.score(features).score - served.get(accountId)) < 1e-4) matches++;
      }
      const allMatch = matches === byAccount.size;
      el.querySelector("#ml-verify").className = "";
      el.querySelector("#ml-verify").innerHTML = `
        <span class="badge ${allMatch ? "badge-clear" : "badge-sanctioned"}">
        ${matches}/${byAccount.size} account scores recomputed in your browser match the pipeline${allMatch ? " ✓" : ""}</span>
        <details class="notes">
          <summary>How this verification works</summary>
          <p>The 16 features are rebuilt in the browser from the served transactions and
          tier-1 scores, standardized with the exported scaler, and scored with the exported
          300-tree forest. Matching the pipeline's served scores confirms two independent
          implementations produce the same results.</p>
        </details>`;

      /* account detail — customer profile, activity, model assessment and controls */
      const detail = el.querySelector("#ml-detail");
      detail.classList.remove("hidden");
      const select = el.querySelector("#detail-account");
      const anomIds = new Set(anoms.map((a) => a.account_id));
      select.innerHTML = [...byAccount.keys()].sort((a, b) =>
        (anomIds.has(b) - anomIds.has(a)) || (served.get(b) - served.get(a)))
        .map((id) => `<option value="${id}">${id}${anomIds.has(id) ? " ⚠ anomalous" : ""}</option>`).join("");

      const customers = new Map(state.data.customers.map((c) => [c.customer_id, c]));
      const accountsById = new Map(state.data.accounts.map((a) => [a.account_id, a]));

      function renderDetail() {
        const id = select.value;
        const account = accountsById.get(id);
        const customer = customers.get(account.customer_id) ?? {};
        const txns = byAccount.get(id);
        const f = liveFeatures.get(id);
        const { score, isAnomalous, cutoff } = iforest.score(f);
        const servedRow = scores.find((s) => s.account_id === id);
        const alerts = state.data.compliance_alerts.filter((a) => a.account_id === id);
        const screenings = state.data.sanctions_screening.filter((s) => s.customer_id === account.customer_id);

        const byDay = new Map();
        for (const t of txns) byDay.set(t.transaction_date,
          (byDay.get(t.transaction_date) ?? 0) + (t.amount ?? 0));
        const [burstDay, burstValue] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
        const spanDays = Math.round(
          (Date.parse(txns[0].transaction_date) - Date.parse(txns[txns.length - 1].transaction_date)) / 86400000) + 1;

        const geo = [];
        if (f.pct_hr > 0) geo.push(`<strong>${fmtPct(f.pct_hr)} went to sanctioned countries</strong>`);
        if (f.pct_off > 0) geo.push(`${fmtPct(f.pct_off)} to offshore centers`);
        if (f.pct_struct > 0) geo.push(`${fmtPct(f.pct_struct)} sat in the $9,000–9,999 reporting-threshold band`);
        const match = screenings.find((s) => s.match_result === "Confirmed Match");

        /* the customer's full picture — most customers hold more than one account */
        const scoreById = new Map(scores.map((s) => [s.account_id, s]));
        const siblings = state.data.accounts
          .filter((x) => x.customer_id === account.customer_id && x.account_id !== id);
        const anomalousSiblings = siblings.filter((x) => scoreById.get(x.account_id)?.anomaly === -1);
        const customerTotal = [id, ...siblings.map((x) => x.account_id)]
          .reduce((s, accId) => s + (scoreById.get(accId)?.total ?? 0), 0);
        const siblingHtml = siblings.map((x) => {
          const sc = scoreById.get(x.account_id);
          const anomalous = sc?.anomaly === -1;
          return `<span class="badge ${anomalous ? "badge-sanctioned" : "badge-plain"}">${escapeHtml(x.account_id)} · ${escapeHtml(x.status)}${anomalous ? " · anomalous" : ""}</span>`;
        }).join(" ");
        const customerParagraph = siblings.length
          ? `<p><strong>Customer overview:</strong> one of ${fmtInt(siblings.length + 1)} accounts;
             ${fmtMoney(customerTotal, true)} moved across all of them.
             Other accounts: ${siblingHtml}.
             ${anomalousSiblings.length
               ? `<strong>${fmtInt(anomalousSiblings.length + 1)} of this customer's accounts are
                  independently anomalous.</strong>`
               : ""}</p>`
          : `<p><strong>Customer overview:</strong> this is the customer's only account.</p>`;

        detail.querySelector("#detail-body").innerHTML = `
          <div class="detail-card">
            <p><strong>${escapeHtml(customer.full_name ?? account.customer_id)}</strong>
            (${escapeHtml(account.customer_id)}) — ${escapeHtml(customer.occupation ?? "occupation unknown")},
            ${escapeHtml(customer.nationality ?? "nationality unknown")}, KYC-rated
            <strong>${escapeHtml(customer.risk_rating ?? "?")}</strong>${customer.pep_flag === "Yes" ? ", <strong>PEP</strong>" : ""}${customer.pep_flag === "Unknown" ? ", PEP status unknown" : ""} —
            opened this ${escapeHtml(account.account_type ?? "")} account on ${escapeHtml(account.open_date ?? "?")}.
            Its status today: <strong>${escapeHtml(account.status)}</strong>.</p>
            <p>Across ${fmtInt(spanDays)} days of activity it moved
            <strong>${fmtMoney(f.total)}</strong> in ${fmtInt(f.n_tx)} transactions
            (${f.tx_per_month.toFixed(1)}/month, ${fmtMoney(f.velocity_value, true)}/month)${burstValue > f.total * 0.5
              ? ` — <strong>including ${fmtMoney(burstValue)} on ${escapeHtml(burstDay)} alone</strong>` : ""}.
            ${geo.length ? geo.join("; ") + "." : "No sanctioned, offshore or threshold-band exposure."}</p>
            ${customerParagraph}
            <p><strong>Model assessment:</strong> score
            <strong>${score.toFixed(4)}</strong> vs cutoff ${cutoff.toFixed(3)} →
            ${isAnomalous
              ? '<span class="badge badge-sanctioned">anomalous</span>'
              : '<span class="badge badge-clear">normal</span>'}
            <span class="badge badge-plain">recomputed in your browser ✓</span><br>
            ${servedRow ? explainDeviations(servedRow) || "no single feature dominates — broad deviation" : ""}</p>
            <p><strong>Detection across tiers:</strong> tier 1 flagged
            ${fmtInt(txns.filter((t) => txnScoreMap.get(t.transaction_id)?.anomaly === -1).length)}
            of its ${fmtInt(txns.length)} transactions;
            ${(() => {
              const cs = state.data.customer_scores.find((x) => x.customer_id === account.customer_id);
              return cs
                ? `at customer level ${escapeHtml(account.customer_id)} scores ${cs.score.toFixed(3)}${cs.anomaly === -1 ? ' — <span class="badge badge-sanctioned">anomalous customer</span>' : ""}`
                : "the customer is KYC-only at tier 3 (no scored activity)";
            })()}.</p>
            <p><strong>Alerts and screening:</strong>
            ${alerts.length
              ? `${fmtInt(alerts.length)} alert(s) — ${alerts.map((a) => `${escapeHtml(a.alert_type)} (${escapeHtml(a.status)})`).join(", ")}.`
              : isAnomalous
                ? '<span class="anom-alert-gap">the rules engine never raised an alert on this account.</span>'
                : "no alerts — consistent with the model's reading."}
            ${screenings.length
              ? ` Customer screened ${fmtInt(screenings.length)} time(s)${match ? ` — <strong>confirmed sanctions match on ${escapeHtml(match.screening_date)} (${escapeHtml(match.review_status)})</strong>` : ""}.`
              : " The customer has <strong>never been screened</strong>."}</p>
            <p class="muted">A full narrative with a recommended action is available for this
            customer in the <a href="#engine">AI Engine tab</a>.</p>
          </div>`;
      }
      select.addEventListener("change", renderDetail);
      renderDetail();
    })();
  },
};
