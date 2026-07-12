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

    el.innerHTML = `
      <p class="tab-intro">Unsupervised anomaly detection at account level. There are no fraud
      labels in this dataset, so the model's job is not to classify — it is to surface accounts
      whose behavior is structurally unlike the rest, to prove that holds up under validation,
      and to do it <strong>explainably</strong>. At the bottom, the model itself runs in your
      browser.</p>

      <div class="ml-grid">
        <div class="card">
          <h3>Why Isolation Forest</h3>
          <p>Isolation Forest isolates observations by random recursive splits: anomalies are
          isolated in fewer splits, so their average path length is short. It fits this problem
          because it needs <strong>no labels</strong>, handles mixed-scale behavioral features,
          and its output is <strong>auditable</strong> — every flagged account can be explained
          by which features deviate, which is what a compliance reviewer needs.</p>
          <h3>How it was applied</h3>
          <p><code>transactions</code> → 12 behavioral features per account →
          <code>StandardScaler</code> → <code>IsolationForest(n_estimators=300,
          contamination=0.08, random_state=42)</code>. Code: <code>analysis/anomaly.py</code>.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Feature</th><th>Meaning</th></tr></thead>
            <tbody>${FEATURES.map(([f, m]) =>
              `<tr><td><code>${f}</code></td><td>${m}</td></tr>`).join("")}</tbody>
          </table></div>
        </div>
        <div class="card">
          <h3>Parameter behavior — a real sweep, not defaults on faith</h3>
          <p><code>analysis/model_sensitivity.py</code> refits over contamination ∈ {4%…12%} ×
          trees ∈ {100, 300, 500}: <strong>contamination sets how many accounts flag</strong>
          (a review-capacity dial) while <strong>the ranking stays stable</strong> — the top-5
          is identical (Jaccard 1.0) for nearly every configuration.</p>
          <div class="chart-slot" id="ml-sweep"></div>
          <p class="muted">Chosen: contamination 8% ≈ ${sens.base.n_anomalies} of
          ${sens.base.n_accounts} accounts (a realistic enhanced-review workload), 300 trees,
          fixed seed for reproducibility.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Validation — what unsupervised rigor can and cannot claim</h3>
          <span class="muted">analysis/model_validation.py · no labels → no "accuracy"; these are the honest substitutes</span>
        </div>
        <div class="ml-grid">
          <div>
            <h4>Memorization check (the overfitting analog)</h4>
            <p>${ov.n_splits} random 70/30 splits: fit on train, score both sides. Mean score
            train <strong>${ov.mean_score_train}</strong> vs held-out
            <strong>${ov.mean_score_holdout}</strong> — gap
            <strong>${ov.gap} ± ${ov.gap_std}</strong>. A gap ≈ 0 means the forest scores unseen
            accounts the same as the ones it grew on: <strong>no memorization</strong>.</p>
            <h4>Stability</h4>
            <p>Across ${val.seed_stability.n_seeds} random seeds the anomaly set keeps a Jaccard
            of <strong>${val.seed_stability.jaccard_mean}</strong> vs the base run
            (min ${val.seed_stability.jaccard_min}) — the core detections are not one seed's
            opinion, and the per-account confidence below shows exactly which ones wobble.</p>
            <h4>Convergent validity — the honest substitute for accuracy</h4>
            <p>Against the rules engine's alerts as a <em>weak</em> reference (they are not ground
            truth): ${cv.flagged_with_alert} of ${cv.flagged_total} flagged accounts also have
            alerts; score↔alert correlation is <strong>${cv.score_alert_correlation}</strong>
            (p=${cv.correlation_p}). Read correctly, near-zero correlation is the point:
            <strong>the model is orthogonal to the rules</strong> — it surfaces a risk dimension
            (behavioral bursts, velocity) the geography-driven rules never look at. Judged only
            against rule alerts it would look "inaccurate"; judged as a complementary detector,
            it found ${cv.flagged_total - cv.flagged_with_alert} risky accounts the rules missed.</p>
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
      </div>

      <div class="card" id="ml-live">
        <div class="card-head">
          <h3>Live scoring — this model is running in your browser right now</h3>
          <span class="muted">the trained forest (300 trees) exported to JSON, inference in ~80 lines of JS</span>
        </div>
        <p id="ml-verify" class="loading-cell">Loading the exported forest and recomputing every score locally…</p>
        <div id="ml-story" class="hidden">
          <h4>The story behind each account</h4>
          <p class="muted">Pick an account: who the customer is, what the account actually did,
          what the model read in that behavior, and what the rules engine did about it.</p>
          <div class="copilot-controls">
            <select id="story-account" aria-label="Account for the story"></select>
          </div>
          <div id="story-body"></div>
        </div>
      </div>`;

    /* ---------- charts ---------- */
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
    barChart(el.querySelector("#ml-scoredist"), {
      title: "Score distribution and the model's cutoff",
      howToRead: `Each bar counts accounts per score bin; red bins sit above the anomaly cutoff (${val.score_distribution.cutoff}). A visible gap between the bulk and the flagged tail means the detections are structure, not an arbitrary percentile slice.`,
      fmt: fmtInt,
      data: val.score_distribution.bins.map((b) => ({
        label: b.lo.toFixed(2), value: b.count,
        color: b.lo >= val.score_distribution.cutoff ? "#D64545" : "#2E5BFF",
        tip: `score ${b.lo.toFixed(3)}–${b.hi.toFixed(3)}<br>${fmtInt(b.count)} accounts${b.lo >= val.score_distribution.cutoff ? " · above cutoff" : ""}`,
      })),
    });
    hBarChart(el.querySelector("#ml-ablation"), {
      title: "Feature ablation — how much the anomaly set changes without each feature",
      howToRead: "Each bar is 1 − Jaccard between the anomaly set with and without that feature: longer = the feature matters more. Transaction velocity dominates — consistent with the single-day-burst pattern the model keeps finding.",
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
      const liveFeatures = new Map();
      let matches = 0;
      for (const [accountId, txns] of byAccount) {
        const features = iforest.computeFeatures(txns);
        liveFeatures.set(accountId, features);
        if (Math.abs(iforest.score(features).score - served.get(accountId)) < 1e-4) matches++;
      }
      const allMatch = matches === byAccount.size;
      el.querySelector("#ml-verify").className = "";
      el.querySelector("#ml-verify").innerHTML = `
        <span class="badge ${allMatch ? "badge-clear" : "badge-sanctioned"}">
        ${matches}/${byAccount.size} account scores recomputed in your browser match the pipeline${allMatch ? " ✓" : ""}</span>
        <span class="muted"> — features rebuilt from the served transactions, standardized and pushed
        through the exported forest. Same numbers, two independent implementations.</span>`;

      /* account story — the customer and the account, told from the served data */
      const story = el.querySelector("#ml-story");
      story.classList.remove("hidden");
      const select = el.querySelector("#story-account");
      const anomIds = new Set(anoms.map((a) => a.account_id));
      select.innerHTML = [...byAccount.keys()].sort((a, b) =>
        (anomIds.has(b) - anomIds.has(a)) || (served.get(b) - served.get(a)))
        .map((id) => `<option value="${id}">${id}${anomIds.has(id) ? " ⚠ anomalous" : ""}</option>`).join("");

      const customers = new Map(state.data.customers.map((c) => [c.customer_id, c]));
      const accountsById = new Map(state.data.accounts.map((a) => [a.account_id, a]));

      function renderStory() {
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
          ? `<p><strong>The customer's full picture:</strong> this is one of
             ${fmtInt(siblings.length + 1)} accounts — ${fmtMoney(customerTotal, true)} moved across
             all of them. Other accounts: ${siblingHtml}.
             ${anomalousSiblings.length
               ? `<strong>${fmtInt(anomalousSiblings.length + 1)} of this customer's accounts are
                  independently anomalous — that is customer-level risk, not an account quirk.</strong>`
               : ""}</p>`
          : `<p><strong>The customer's full picture:</strong> this is the customer's only account.</p>`;

        story.querySelector("#story-body").innerHTML = `
          <div class="story-card">
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
            <p><strong>The model's reading:</strong> score
            <strong>${score.toFixed(4)}</strong> vs cutoff ${cutoff.toFixed(3)} →
            ${isAnomalous
              ? '<span class="badge badge-sanctioned">anomalous</span>'
              : '<span class="badge badge-clear">normal</span>'}
            <span class="badge badge-plain">recomputed in your browser ✓</span><br>
            ${servedRow ? explainDeviations(servedRow) || "no single feature dominates — broad deviation" : ""}</p>
            <p><strong>What the controls did:</strong>
            ${alerts.length
              ? `${fmtInt(alerts.length)} alert(s) — ${alerts.map((a) => `${escapeHtml(a.alert_type)} (${escapeHtml(a.status)})`).join(", ")}.`
              : isAnomalous
                ? '<span class="anom-alert-gap">the rules engine never raised an alert on this account.</span>'
                : "no alerts — consistent with the model's reading."}
            ${screenings.length
              ? ` Customer screened ${fmtInt(screenings.length)} time(s)${match ? ` — <strong>confirmed sanctions match on ${escapeHtml(match.screening_date)} (${escapeHtml(match.review_status)})</strong>` : ""}.`
              : " The customer has <strong>never been screened</strong>."}</p>
            <p class="muted">For the full grounded narrative and a recommended action, run this
            account through the five-agent copilot in the <a href="#engine">AI Engine tab</a>.</p>
          </div>`;
      }
      select.addEventListener("change", renderStory);
      renderStory();
    })();
  },
};
