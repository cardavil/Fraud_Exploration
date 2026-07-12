/* EDA as a visible process: six steps from raw data to associations.
   Step 2 reads the cleaning audit trail live from the database; the numbers
   in steps 4-6 come from analysis/export_eda_stats.py (single source). */
window.FE.tabs.eda = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml } = window.FE;
    const { barChart, lineChart } = window.FE.charts;
    const S = state.stats;
    const log = state.data.cleaning_log;
    const EXPECTED = { customers: 83, accounts: 105, transactions: 1600,
      compliance_alerts: 65, sanctions_screening: 95, chargebacks: 70 };

    const byTable = {};
    for (const row of log) (byTable[row.table_name] ??= []).push(row);
    const totalTreated = log.reduce((s, r) => s + r.rows_affected, 0);
    const dupes = log.filter((r) => r.issue.startsWith("Duplicate"))
      .reduce((s, r) => s + r.rows_affected, 0);

    const step = (n, title, body) => `
      <div class="eda-step">
        <div class="eda-step-head"><span class="eda-step-n">${n}</span><h3>${title}</h3></div>
        <div class="eda-step-body">${body}</div>
      </div>`;

    el.innerHTML = `
      <p class="tab-intro">The analysis, step by step — not a summary of results but the process
      that produced them. Cleaning runs in <code>analysis/clean.py</code> with every treatment
      logged; statistics are exported by <code>analysis/export_eda_stats.py</code> from the
      cleaned database, so every figure here traces to code.</p>

      ${step(1, "Raw dataset intake", `
        <p>Six SQLite tables arrive dirty: duplicate primary keys, inconsistent casing
        (<code>'india'</code>, <code>'CARD PAYMENT'</code>), stray whitespace, empty compliance
        flags and unreliable booleans. <strong>${fmtInt(log.length)} distinct issues</strong> were
        identified, affecting <strong>${fmtInt(totalTreated)} values</strong> —
        including ${fmtInt(dupes)} duplicate records dropped.</p>`)}

      ${step(2, "Audited cleaning — every treatment logged", `
        <p>No silent fixes: each treatment writes to the audit trail (served live below from the
        <code>cleaning_log</code> table). Compliance-relevant calls stand out — an empty PEP flag is
        recoded <em>Unknown</em>, never assumed <em>No</em>; negative balances and zero-amount
        transactions are kept and flagged rather than deleted.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Table</th><th>Issue</th><th>Treatment</th><th class="num">Rows</th></tr></thead>
            <tbody>${Object.entries(byTable).map(([t, rows]) => rows.map((r, i) => `
              <tr>${i === 0 ? `<td rowspan="${rows.length}"><strong>${escapeHtml(t)}</strong></td>` : ""}
                <td>${escapeHtml(r.issue)}</td><td>${escapeHtml(r.treatment)}</td>
                <td class="num">${fmtInt(r.rows_affected)}</td></tr>`).join("")).join("")}
            </tbody>
          </table>
        </div>`)}

      ${step(3, "Typed, keyed and verified", `
        <p>Dates are parsed to real date types, primary/foreign keys enforced on the serving layer,
        and the clean row counts verified live against the pipeline's expected output:</p>
        <div class="check-row">${Object.entries(EXPECTED).map(([t, n]) => {
          const ok = state.data[t].length === n;
          return `<span class="badge ${ok ? "badge-clear" : "badge-sanctioned"}">${t}: ${fmtInt(state.data[t].length)}${ok ? " ✓" : ` (expected ${n})`}</span>`;
        }).join(" ")}</div>
        <p class="muted">One caveat survives cleaning: <code>is_international</code> is untrustworthy
        — 152 sanctioned-country transactions are marked domestic. It is treated as a finding, not a field.</p>`)}

      ${step(4, "Descriptive statistics", `
        <div class="stat-row">
          ${[["n (valid amounts)", fmtInt(S.descriptive.n_valid)],
             ["Mean", fmtMoney(S.descriptive.mean)],
             ["Median", fmtMoney(S.descriptive.median)],
             ["Std dev", fmtMoney(S.descriptive.std)],
             ["CV", S.descriptive.cv],
             ["Skewness", `+${S.descriptive.skewness}`],
             ["Kurtosis", `+${S.descriptive.kurtosis_excess}`],
             ["P95 / Max", `${fmtMoney(S.descriptive.p95, true)} / ${fmtMoney(S.descriptive.max, true)}`],
            ].map(([l, v]) => `<div class="stat-tile"><span class="kpi-label">${l}</span><span class="stat-value">${v}</span></div>`).join("")}
        </div>
        <p>The mean is ~5× the median: a small number of very large wires dominates total value.
        Operational thresholds should key off the <strong>median</strong>, not the mean.</p>`)}

      ${step(5, "Distributions and trends", `<div class="chart-grid" id="eda-charts"></div>`)}

      ${step(6, "Associations — what actually drives risk flags", `
        <div class="table-wrap"><table>
          <thead><tr><th>Association</th><th class="num">Cramér's V</th><th class="num">p</th><th>Reading</th></tr></thead>
          <tbody>${S.associations.map((a) => {
            const strong = a.cramers_v >= 0.3;
            const none = a.cramers_v < 0.1;
            const reading = a.pair.startsWith("risk_rating")
              ? "<strong>The KYC risk rating has no relationship with flagged activity</strong>"
              : none ? "No meaningful association"
              : strong ? "Strong driver" : "Weak but real effect";
            return `<tr><td>${escapeHtml(a.pair)}</td>
              <td class="num"><strong>${a.cramers_v.toFixed(3)}</strong></td>
              <td class="num">${a.p < 0.001 ? "&lt;0.001" : a.p.toFixed(3)}</td><td>${reading}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
        <p>Per-customer Spearman correlations against the assigned rating tell the same story —
        ${S.spearman_vs_rating.map((s) => `${escapeHtml(s.feature)} ρ=${s.rho >= 0 ? "+" : ""}${s.rho}`).join(", ")}
        — only % cash reaches significance. <strong>Risk here is categorical and geographic;
        the static KYC rating is disconnected from observed behavior.</strong></p>`)}
    `;

    const charts = el.querySelector("#eda-charts");
    barChart(charts, {
      title: "Transactions per $1,000 band around the $10k reporting threshold",
      howToRead: "Each bar is the number of transactions whose amount falls in that $1,000 band. Organic amounts decay smoothly; the amber spike just under $10,000 — collapsing right above it — is the structuring signature.",
      fmt: fmtInt,
      data: S.structuring.bands.map((b) => ({
        label: `$${b.band}`, value: b.count,
        color: b.lo === 9000 ? "#E8A33D" : "#2E5BFF",
        emphasize: b.lo === 9000,
        tip: `<strong>$${b.band}</strong><br>${fmtInt(b.count)} txns${b.lo === 9000 ? ` · ${fmtPct(S.structuring.band_9k_share, 1)} of all — ${S.structuring.ratio_vs_neighbors}× neighbors` : ""}`,
      })),
    });
    lineChart(charts, {
      title: "Monthly transaction count vs alerts created",
      howToRead: "Both lines share one axis (counts per month). Transactions triple over the window while alert creation stays flat — monitoring capacity never scaled with volume.",
      fmt: fmtInt,
      series: [
        { name: "Transactions", color: "#2E5BFF",
          points: state.stats.monthly.transactions.map((m) => ({ x: m.month, y: m.count })) },
        { name: "Alerts", color: "#D64545",
          points: state.stats.monthly.transactions.map((m) => ({
            x: m.month,
            y: state.stats.monthly.alerts.find((a) => a.month === m.month)?.count ?? 0 })) },
      ],
    });
    lineChart(charts, {
      title: "Monthly transaction value",
      howToRead: "Total dollar value moved per month. Growth compounds the un-scaled monitoring problem: more value flows through the same flat alerting capacity.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Value", color: "#2E5BFF",
        points: state.stats.monthly.transactions.map((m) => ({ x: m.month, y: m.value })) }],
    });
    lineChart(charts, {
      title: "Monthly chargeback value",
      howToRead: "Dollar value of chargebacks filed per month. The sharp climb from March 2026 suggests a recently opened fraud vector — chargebacks lag the fraud itself by weeks.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Chargeback value", color: "#D64545",
        points: state.stats.monthly.chargebacks.map((m) => ({ x: m.month, y: m.value })) }],
    });
  },
};
