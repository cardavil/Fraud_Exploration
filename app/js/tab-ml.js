/* ML Model: what Isolation Forest is, how it was applied, how the parameters
   behave (real sweep), how it VALIDATES (overfitting, bootstrap confidence,
   stability, convergent validity, ablation — model_validation.json), what it
   found, and — live — the model itself running in the browser (iforest.js):
   every score recomputed client-side and verified against the pipeline, plus
   a what-if playground. */
window.FE.tabs.ml = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, openModal, closeModal, goTo } = window.FE;
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
          <summary>Table notes — selection, driver criteria and rules-engine definitions</summary>
          <p>The table shows the <strong>10 highest-scored</strong> of the
          ${fmtInt(t1v.n_flagged)} flagged transactions.</p>
          <p><strong>Score</strong> — the tier-1 anomaly score (higher = more anomalous);
          the top 5% of transactions flag as anomalous under the model's contamination setting.</p>
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
          <code>transaction_scores</code> table on the serving layer.</p>
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
        <details class="notes">
          <summary>Badge definitions</summary>
          <p><span class="badge badge-clear">flagged in N% of refits</span> bootstrap confidence:
          share of 200 refits on 80% subsamples that flag the account (green ≥ 90%, amber ≥ 60%,
          red below). <span class="anom-alert-gap">Never alerted</span> the rules engine has no
          alert on this account. The bar length is the anomaly score relative to the highest
          detection.</p>
          <p><strong>Why</strong> — the chips name the account's features that deviate most from
          the population median (shown when at least 2.5× the median, top 4 listed); the model
          scores on all 16 features.</p>
        </details>
      </div>

      <div class="card" id="ml-live">
        <div class="card-head">
          <h3>In-browser verification and account detail</h3>
          <span class="muted">the trained forest (300 trees) exported to JSON; inference reimplemented in dependency-free JS</span>
        </div>
        <p id="ml-verify" class="loading-cell">Loading the exported forest and recomputing every score locally…</p>
        <div id="ml-detail" class="hidden">
          <h4>Account detail</h4>
          <p class="muted">Account activity, model assessment and alert records. The holder's
          full profile — accounts, tier-3 model, screening — opens from the Customer overview
          button.</p>
          <div class="sentinel-controls">
            <select id="detail-account" aria-label="Account to inspect"></select>
          </div>
          <div id="detail-body"></div>
        </div>
        <div id="ml-live-notes"></div>
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
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Customer</th><th class="num">Score</th><th class="num">Accounts</th>
          <th class="num">Anomalous accts</th><th class="num">Structuring days</th><th>Screening</th>
          <th class="num">Total value</th><th></th></tr></thead>
          <tbody>${custRows.map((r, i) => `
            <tr><td>${i + 1}</td>
            <td><a href="#" class="drill-link cust-open" data-cust="${escapeHtml(r.customer_id)}"><strong>${escapeHtml(r.customer_id)}</strong></a> <span class="muted">${escapeHtml(r.full_name ?? "")}</span></td>
            <td class="num">${r.score.toFixed(3)}</td>
            <td class="num">${fmtInt(r.n_accounts)}</td>
            <td class="num">${r.n_anomalous_accounts ? `<strong>${fmtInt(r.n_anomalous_accounts)}</strong>` : "0"}</td>
            <td class="num">${r.structuring_days ? `<span class="badge badge-offshore">${fmtInt(r.structuring_days)}</span>` : "0"}</td>
            <td>${r.never_screened ? '<span class="badge badge-sanctioned">never screened</span>' : '<span class="badge badge-clear">screened</span>'}</td>
            <td class="num">${fmtMoney(r.total_value, true)}</td>
            <td>${r.anomaly === -1 ? '<span class="badge badge-sanctioned">anomalous</span>' : ""}</td></tr>`).join("")}
          </tbody>
        </table></div>
        <details class="notes">
          <summary>Column definitions, method and cross-tier consistency</summary>
          <dl>
            <dt>Score</dt><dd>tier-3 anomaly score (higher = more anomalous); the red badge marks the ${t3v.n_flagged} customers the model flags</dd>
            <dt>Accounts / Anomalous accts</dt><dd>accounts held by the customer, and how many of them the tier-2 account model flags</dd>
            <dt>Structuring days</dt><dd>calendar days where the customer's combined transactions total $10,000 or more while every individual transaction stays under the threshold and at least two of their own accounts are used — the cross-account structuring signal</dd>
            <dt>Screening</dt><dd><span class="badge badge-clear">screened</span> at least one sanctions screening on record · <span class="badge badge-sanctioned">never screened</span> none</dd>
            <dt>Total value</dt><dd>value moved across all of the customer's accounts</dd>
          </dl>
          <p>The customer model combines account structure (number of accounts, anomalous
          accounts, peak account score), cross-account signals (structuring days, value through
          non-active accounts) and KYC attributes (rating, PEP, screening state, post-match
          activity). Cross-tier consistency:
          ${fmtPct(t3v.cross_tier.anomalous_account_customers_in_top15)} of anomalous-account
          customers rank in this top-15; Spearman between customer score and peak account score
          is ${t3v.cross_tier.spearman_score_vs_max_account_score} — the customer tier re-ranks
          with information of its own rather than duplicating the account tier.</p>
        </details>
      </div>
      <p class="tab-foot">Three unsupervised Isolation Forests score risk at the transaction,
      account and customer level. The account model also runs in the browser for independent
      verification.</p>`;

    /* Customer overview modal — the single customer-level view, opened from the
       account detail and from the tier-3 ranking. */
    function openCustomerOverview(customerId) {
      const customer = state.data.customers.find((c) => c.customer_id === customerId) ?? {};
      const accounts = state.data.accounts.filter((a) => a.customer_id === customerId);
      const scoreById = new Map(scores.map((s) => [s.account_id, s]));
      const anomalousAccounts = accounts.filter((a) => scoreById.get(a.account_id)?.anomaly === -1);
      const totalValue = accounts.reduce((s, a) => s + (scoreById.get(a.account_id)?.total ?? 0), 0);
      const cs = state.data.customer_scores.find((x) => x.customer_id === customerId);
      const screenings = state.data.sanctions_screening.filter((s) => s.customer_id === customerId);
      const match = screenings.find((s) => s.match_result === "Confirmed Match");

      openModal(`Customer overview — ${customerId}`, `
        <p><strong>${escapeHtml(customer.full_name ?? customerId)}</strong> ·
        ${escapeHtml(customer.occupation ?? "occupation unknown")} ·
        ${escapeHtml(customer.nationality ?? "nationality unknown")} ·
        ${escapeHtml(customer.customer_type ?? "")}<br>
        KYC rating <strong>${escapeHtml(customer.risk_rating ?? "?")}</strong>
        ${customer.pep_flag === "Yes" ? '· <span class="badge badge-sanctioned">PEP</span>' : ""}
        ${customer.pep_flag === "Unknown" ? '· <span class="badge badge-offshore">PEP status unknown</span>' : ""}
        · onboarded ${escapeHtml(customer.onboarding_date ?? "?")} (${escapeHtml(customer.onboarding_channel ?? "?")})</p>
        <p><strong>Accounts (${fmtInt(accounts.length)})</strong> — ${fmtMoney(totalValue, true)} moved across all of them:<br>
        ${accounts.map((a) => {
          const anomalous = scoreById.get(a.account_id)?.anomaly === -1;
          return `<span class="badge ${anomalous ? "badge-sanctioned" : "badge-plain"}">${escapeHtml(a.account_id)} · ${escapeHtml(a.status)}${anomalous ? " · anomalous" : ""}</span>`;
        }).join(" ")}
        ${anomalousAccounts.length > 1 ? `<br><strong>${fmtInt(anomalousAccounts.length)} of this customer's accounts are independently anomalous.</strong>` : ""}</p>
        <div class="modal-formula">
        ${cs
          ? `Customer model (tier 3): score <strong>${cs.score.toFixed(3)}</strong>
             ${cs.anomaly === -1 ? '<span class="badge badge-sanctioned">anomalous</span>' : '<span class="badge badge-clear">normal</span>'}<br>
             structuring days: <strong>${fmtInt(cs.structuring_days)}</strong> ·
             tier-1 share: ${fmtPct(cs.pct_txn_anomalous)} ·
             sanctioned-value share: ${fmtPct(cs.hr_value_share)} ·
             non-active-value share: ${fmtPct(cs.nonactive_value_share)}
             ${cs.post_match_value > 0 ? `<br><strong>${fmtMoney(cs.post_match_value)} moved after a confirmed sanctions match</strong>` : ""}`
          : "KYC-only record at tier 3 — no scored activity."}
        </div>
        <p><strong>Screening</strong> — ${screenings.length
          ? `${fmtInt(screenings.length)} screening(s)${match
              ? `; <strong>confirmed match on ${escapeHtml(match.screening_date)} (${escapeHtml(match.review_status)})</strong>` : "; no confirmed matches"}.`
          : '<span class="badge badge-sanctioned">never screened</span>'}</p>
        <p class="muted">Structuring days = calendar days with combined transactions of $10,000+
        split under the threshold across at least two of the customer's own accounts.</p>
        <p><a href="#engine" class="modal-link" id="ov-run-sentinel">Run Sentinel on this customer &rarr;</a></p>`);

      document.getElementById("ov-run-sentinel")?.addEventListener("click", (e) => {
        e.preventDefault();
        closeModal();
        goTo("engine");
        const sentinelSelect = document.getElementById("sn-account");
        if (sentinelSelect) sentinelSelect.value = customerId;
      });
    }

    el.querySelectorAll(".cust-open").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        openCustomerOverview(link.dataset.cust);
      });
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
        ${matches}/${byAccount.size} account scores recomputed in your browser match the pipeline${allMatch ? " ✓" : ""}</span>`;
      el.querySelector("#ml-live-notes").innerHTML = `
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
      const sortedIds = [...byAccount.keys()].sort((a, b) => a.localeCompare(b));
      const accountOption = (id) => `<option value="${id}">${id}</option>`;
      select.innerHTML = `
        <optgroup label="Anomalous accounts">${sortedIds.filter((id) => anomIds.has(id)).map(accountOption).join("")}</optgroup>
        <optgroup label="Other accounts">${sortedIds.filter((id) => !anomIds.has(id)).map(accountOption).join("")}</optgroup>`;

      const accountsById = new Map(state.data.accounts.map((a) => [a.account_id, a]));

      function renderDetail() {
        const id = select.value;
        const account = accountsById.get(id);
        const txns = byAccount.get(id);
        const f = liveFeatures.get(id);
        const { score, isAnomalous, cutoff } = iforest.score(f);
        const servedRow = scores.find((s) => s.account_id === id);
        const alerts = state.data.compliance_alerts.filter((a) => a.account_id === id);

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
        const tier1Flagged = txns.filter((t) => txnScoreMap.get(t.transaction_id)?.anomaly === -1).length;

        detail.querySelector("#detail-body").innerHTML = `
          <div class="detail-card">
            <p><strong>${escapeHtml(account.account_type ?? "")} account ${escapeHtml(id)}</strong>
            — opened ${escapeHtml(account.open_date ?? "?")} · status
            <strong>${escapeHtml(account.status)}</strong> · branch ${escapeHtml(account.branch_country ?? "?")}.
            Held by ${escapeHtml(account.customer_id)}
            <a href="#" class="drill-link" id="detail-cust-btn">Customer overview &rarr;</a></p>
            <p><strong>Activity:</strong> across ${fmtInt(spanDays)} days it moved
            <strong>${fmtMoney(f.total)}</strong> in ${fmtInt(f.n_tx)} transactions
            (${f.tx_per_month.toFixed(1)}/month, ${fmtMoney(f.velocity_value, true)}/month)${burstValue > f.total * 0.5
              ? ` — <strong>including ${fmtMoney(burstValue)} on ${escapeHtml(burstDay)} alone</strong>` : ""}.
            ${geo.length ? geo.join("; ") + "." : "No sanctioned, offshore or threshold-band exposure."}</p>
            <p><strong>Model assessment:</strong> score
            <strong>${score.toFixed(4)}</strong> vs cutoff ${cutoff.toFixed(3)} →
            ${isAnomalous
              ? '<span class="badge badge-sanctioned">anomalous</span>'
              : '<span class="badge badge-clear">normal</span>'}
            <span class="badge badge-plain">recomputed in your browser ✓</span><br>
            ${servedRow ? explainDeviations(servedRow) || "no single feature dominates — broad deviation" : ""}<br>
            Tier 1 flagged ${fmtInt(tier1Flagged)} of the account's ${fmtInt(txns.length)} transactions.</p>
            <p><strong>Alerts:</strong>
            ${alerts.length
              ? `${fmtInt(alerts.length)} alert(s) — ${alerts.map((a) => `${escapeHtml(a.alert_type)} (${escapeHtml(a.status)})`).join(", ")}.`
              : isAnomalous
                ? '<span class="anom-alert-gap">the rules engine never raised an alert on this account.</span>'
                : "no alerts on this account."}</p>
            <p class="muted">A full narrative with a recommended action is available for this
            customer in the <a href="#engine">AI Engine tab</a>.</p>
          </div>`;
        detail.querySelector("#detail-cust-btn").addEventListener("click", (e) => {
          e.preventDefault();
          openCustomerOverview(account.customer_id);
        });
      }
      select.addEventListener("change", renderDetail);
      renderDetail();
    })();
  },
};
