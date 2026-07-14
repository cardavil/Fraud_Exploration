/* DSS: descriptive & sampling statistics over the cleaned data — descriptive
   stats, distributions and trends, and categorical associations. Figures come
   from analysis/export_eda_stats.py; charts render via window.FE.charts. */
window.FE.tabs.dss = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml } = window.FE;
    const { barChart, lineChart } = window.FE.charts;
    const S = state.stats;

    const step = (n, title, chip, body) => `
      <div class="eda-step">
        <div class="eda-step-head">
          <span class="eda-step-n">${n}</span><h3>${title}</h3>
          ${chip ? `<span class="eda-chip">${chip}</span>` : ""}
        </div>
        <div class="eda-step-body">${body}</div>
      </div>`;

    el.innerHTML = `
      ${step(1, "Descriptive statistics — transaction amounts", "", `
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

      ${step(2, "Distributions and trends", "4 figures", `<div class="chart-grid" id="dss-charts"></div>`)}

      ${step(3, "Association and correlation", "5 pairs · 1 null result", `
        <div class="table-wrap"><table>
          <thead><tr><th>Variable pair</th><th class="num">Cramér's V</th><th class="num">p</th><th>Reading</th></tr></thead>
          <tbody>${S.associations.map((a) => {
            const strong = a.cramers_v >= 0.3;
            const none = a.cramers_v < 0.1;
            const reading = a.pair.startsWith("risk_rating")
              ? "<strong>The KYC risk rating has no association with flagged activity</strong>"
              : none ? "No meaningful association"
              : strong ? "Strong driver" : "Weak but real effect";
            return `<tr><td>${escapeHtml(a.pair)}</td>
              <td class="num"><strong>${a.cramers_v.toFixed(3)}</strong></td>
              <td class="num">${a.p < 0.001 ? "&lt;0.001" : a.p.toFixed(3)}</td><td>${reading}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
        <p><strong>Risk in this dataset is categorical and geographic; the static KYC rating is
        disconnected from observed behavior.</strong></p>
        <details class="notes">
          <summary>Definitions and supporting detail</summary>
          <p>Two measures, one per variable type. <strong>Cramér's V</strong> measures
          <em>association</em> between two <strong>categorical</strong> variables (0 = none,
          1 = perfect); <strong>p</strong> is the probability of an association at least this
          strong by chance. <strong>Spearman's ρ</strong> measures rank <em>correlation</em> for
          the <strong>ordinal</strong> risk rating against observed behavior — a different measure
          because the rating is ordered, not nominal.</p>
          <p>Per-customer Spearman correlations (rating vs behavior):
          ${S.spearman_vs_rating.map((s) => `${escapeHtml(s.feature)} ρ=${s.rho >= 0 ? "+" : ""}${s.rho} (p=${s.p})`).join(", ")}.
          Only % cash reaches statistical significance.</p>
        </details>`)}
    `;

    const charts = el.querySelector("#dss-charts");
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
          points: S.monthly.transactions.map((m) => ({ x: m.month, y: m.count })) },
        { name: "Alerts", color: "#D64545",
          points: S.monthly.transactions.map((m) => ({
            x: m.month,
            y: S.monthly.alerts.find((a) => a.month === m.month)?.count ?? 0 })) },
      ],
    });
    lineChart(charts, {
      title: "Monthly transaction value",
      howToRead: "Total dollar value moved per month. Growth compounds the un-scaled monitoring problem: more value flows through the same flat alerting capacity.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Value", color: "#2E5BFF",
        points: S.monthly.transactions.map((m) => ({ x: m.month, y: m.value })) }],
    });
    lineChart(charts, {
      title: "Monthly chargeback value",
      howToRead: "Dollar value of chargebacks filed per month. The sharp climb from March 2026 suggests a recently opened fraud vector — chargebacks lag the fraud itself by weeks.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Chargeback value", color: "#D64545",
        points: S.monthly.chargebacks.map((m) => ({ x: m.month, y: m.value })) }],
    });
  },
};
