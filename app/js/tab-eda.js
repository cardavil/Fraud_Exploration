/* EDA as a visible process: six steps from raw data to associations.
   Step 2 reads the cleaning audit trail live from the database and every
   treatment expands into real before→after examples (cleaning_examples.json).
   Step 3 closes with a computed integrity panel: FKs, duplicate keys and
   empty-share thresholds. Statistics come from analysis/export_eda_stats.py. */
window.FE.tabs.eda = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, openData } = window.FE;
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

    /* Deep-links for treatments whose rows are expressible as explorer filters. */
    const DRILL = {
      3: { table: "customers", filters: [{ col: "pep_flag", kind: "categorical", value: "Unknown" }] },
      4: { table: "customers", filters: [{ col: "nationality", kind: "categorical", value: "Unknown" }] },
      10: { table: "accounts", filters: [{ col: "currency", kind: "categorical", value: "Unknown" }] },
      11: { table: "accounts", filters: [{ col: "account_balance", kind: "max", value: -0.01 }] },
      16: { table: "transactions", filters: [{ col: "amount", kind: "max", value: 0 }] },
      18: { table: "transactions", filters: [{ col: "counterparty_country", kind: "categorical", value: "Unknown" }] },
      23: { table: "compliance_alerts", filters: [{ col: "assigned_analyst", kind: "categorical", value: "Unassigned" }] },
      27: { table: "sanctions_screening", filters: [{ col: "reviewed_by", kind: "categorical", value: "Unreviewed" }] },
    };
    const KIND_BADGE = {
      kept: '<span class="badge badge-offshore">kept &amp; flagged</span>',
      dropped: '<span class="badge badge-plain">rows dropped</span>',
    };

    /* ---------- integrity checks (computed live, client-side) ---------- */
    const d = state.data;
    const keySet = (table, col) => new Set(d[table].map((r) => r[col]));
    const FKS = [
      ["accounts", "customer_id", "customers"],
      ["transactions", "account_id", "accounts"],
      ["compliance_alerts", "account_id", "accounts"],
      ["compliance_alerts", "transaction_id", "transactions"],
      ["sanctions_screening", "customer_id", "customers"],
      ["chargebacks", "transaction_id", "transactions"],
      ["account_scores", "account_id", "accounts"],
    ];
    const PARENT_PK = { customers: "customer_id", accounts: "account_id", transactions: "transaction_id" };
    const fkResults = FKS.map(([child, col, parent]) => {
      const parents = keySet(parent, PARENT_PK[parent]);
      const violations = d[child].filter((r) => r[col] != null && !parents.has(r[col])).length;
      return { label: `${child}.${col} → ${parent}`, violations };
    });
    const PKS = { customers: "customer_id", accounts: "account_id", transactions: "transaction_id",
      compliance_alerts: "alert_id", sanctions_screening: "screening_id", chargebacks: "chargeback_id" };
    const dupResults = Object.entries(PKS).map(([table, pk]) =>
      ({ table, dupes: d[table].length - keySet(table, pk).size }));
    const NULL_WARN = 0.2;
    const nullWarnings = [];
    for (const table of Object.keys(PKS)) {
      const rows = d[table];
      for (const col of Object.keys(rows[0] ?? {})) {
        const empty = rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
        if (empty / rows.length > NULL_WARN) {
          nullWarnings.push({ label: `${table}.${col}`, share: empty / rows.length, n: empty });
        }
      }
    }
    const fkTotal = fkResults.reduce((s, f) => s + f.violations, 0);
    const dupTotal = dupResults.reduce((s, x) => s + x.dupes, 0);
    const countsOk = Object.entries(EXPECTED).filter(([t, n]) => d[t].length === n).length;

    const step = (n, title, chip, body) => `
      <div class="eda-step">
        <div class="eda-step-head">
          <span class="eda-step-n">${n}</span><h3>${title}</h3>
          <span class="eda-chip">${chip}</span>
        </div>
        <div class="eda-step-body">${body}</div>
      </div>`;

    el.innerHTML = `
      <p class="tab-intro">The cleaning and analysis process, step by step. Cleaning runs in
      <code>analysis/clean.py</code> with every treatment logged; click any treatment to see real
      before&rarr;after examples, or jump to the affected rows in the Data tab.</p>

      ${step(1, "Raw dataset intake", `${fmtInt(log.length)} issues found`, `
        <p>The six source tables contained data-quality issues: duplicate primary keys,
        inconsistent casing (<code>'india'</code>, <code>'CARD PAYMENT'</code>), stray whitespace,
        empty compliance flags and unreliable booleans. <strong>${fmtInt(log.length)} distinct
        issues</strong> affecting <strong>${fmtInt(totalTreated)} values</strong>,
        including ${fmtInt(dupes)} duplicate records dropped.</p>`)}

      ${step(2, "Audited cleaning — every treatment logged", "31 treatments · expandable examples", `
        <p>Every treatment is written to an audit trail, served live from the
        <code>cleaning_log</code> table. Compliance-relevant decisions are explicit: an empty PEP
        flag is recoded <em>Unknown</em>, never assumed <em>No</em>, and suspicious values are
        retained and flagged rather than deleted. Click a row to see its examples.</p>
        <div class="table-wrap">
          <table>
            <thead><tr><th></th><th>Table</th><th>Issue</th><th>Treatment</th><th class="num">Rows</th></tr></thead>
            <tbody id="clean-log-body">${log.map((r) => {
              const ex = state.examples?.[String(r.step_id)];
              const hasExamples = ex && ex.examples.length;
              return `
              <tr class="log-row ${hasExamples ? "expandable" : ""}" data-step="${r.step_id}">
                <td class="chev">${hasExamples ? "&#9656;" : ""}</td>
                <td><strong>${escapeHtml(r.table_name)}</strong></td>
                <td>${escapeHtml(r.issue)} ${KIND_BADGE[ex?.kind] ?? ""}</td>
                <td>${escapeHtml(r.treatment)}</td>
                <td class="num">${fmtInt(r.rows_affected)}</td>
              </tr>
              ${hasExamples ? `
              <tr class="example-row hidden" data-for="${r.step_id}">
                <td></td>
                <td colspan="4">
                  <table class="example-table">
                    <thead><tr><th>Key</th><th>Column</th><th>Before</th><th>After</th></tr></thead>
                    <tbody>${ex.examples.map((e) => `
                      <tr><td>${escapeHtml(e.key)}</td><td><code>${escapeHtml(e.column)}</code></td>
                      <td class="ex-before">${escapeHtml(String(e.before))}</td>
                      <td class="ex-after">${escapeHtml(String(e.after))}</td></tr>`).join("")}
                    </tbody>
                  </table>
                  ${DRILL[r.step_id] ? `<a href="#data" class="drill-link" data-step="${r.step_id}">See the affected rows in the Data tab &rarr;</a>` : ""}
                </td>
              </tr>` : ""}`;
            }).join("")}
            </tbody>
          </table>
        </div>`)}

      ${step(3, "Typed, keyed and verified", `counts ${countsOk}/6 ✓ · FKs ${fkTotal} violations`, `
        <p>Dates are parsed to date types, primary/foreign keys enforced on the serving layer,
        and the clean row counts verified live against the pipeline's expected output:</p>
        <div class="check-row">${Object.entries(EXPECTED).map(([t, n]) => {
          const ok = d[t].length === n;
          return `<span class="badge ${ok ? "badge-clear" : "badge-sanctioned"}">${t}: ${fmtInt(d[t].length)}${ok ? " ✓" : ` (expected ${n})`}</span>`;
        }).join(" ")}</div>
        <h4 class="integrity-title">Integrity panel — computed live on the served data</h4>
        <div class="check-row">${fkResults.map((f) =>
          `<span class="badge ${f.violations ? "badge-sanctioned" : "badge-clear"}">${escapeHtml(f.label)}: ${f.violations} violations</span>`).join(" ")}
        </div>
        <div class="check-row">${dupResults.map((x) =>
          `<span class="badge ${x.dupes ? "badge-sanctioned" : "badge-clear"}">${x.table}: ${x.dupes} duplicate keys</span>`).join(" ")}
        </div>
        <div class="check-row">${nullWarnings.length
          ? nullWarnings.map((w) =>
              `<span class="badge badge-offshore">${escapeHtml(w.label)}: ${fmtPct(w.share)} empty (${fmtInt(w.n)})</span>`).join(" ")
          : ""}
          <span class="badge badge-clear">every other column &lt; ${fmtPct(NULL_WARN)} empty</span>
        </div>
        <details class="notes">
          <summary>Notes on the amber items</summary>
          <p>Empty <code>resolution_date</code> values correspond to unresolved alerts and
          disputes — structurally expected, and their share is itself the backlog finding.
<code>is_international</code> remains unreliable after cleaning (148
          sanctioned-country transactions marked domestic) and is treated as a finding, not a
          usable field.</p>
        </details>`)}

      ${step(4, "Descriptive statistics", `n = ${fmtInt(S.descriptive.n_valid)}`, `
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

      ${step(5, "Distributions and trends", "4 figures", `<div class="chart-grid" id="eda-charts"></div>`)}

      ${step(6, "Associations — what drives risk flags", "5 pairs · 1 null result", `
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
        <p><strong>Risk in this dataset is categorical and geographic; the static KYC rating is
        disconnected from observed behavior.</strong></p>
        <details class="notes">
          <summary>Definitions and supporting detail</summary>
          <p><strong>Cramér's V</strong> measures the strength of association between two
          categorical variables, from 0 (none) to 1 (perfect); <strong>p</strong> is the
          probability of seeing an association at least this strong by chance.</p>
          <p>Per-customer correlations between the assigned rating and observed behavior:
          ${S.spearman_vs_rating.map((s) => `${escapeHtml(s.feature)} ρ=${s.rho >= 0 ? "+" : ""}${s.rho} (p=${s.p})`).join(", ")}.
          Only % cash reaches statistical significance.</p>
        </details>`)}
    `;

    /* expandable treatment rows + drill links */
    el.querySelectorAll(".log-row.expandable").forEach((row) => {
      row.addEventListener("click", () => {
        const sub = el.querySelector(`.example-row[data-for="${row.dataset.step}"]`);
        const open = !sub.classList.contains("hidden");
        sub.classList.toggle("hidden");
        row.querySelector(".chev").innerHTML = open ? "&#9656;" : "&#9662;";
      });
    });
    el.querySelectorAll(".drill-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const preset = DRILL[link.dataset.step];
        openData(preset.table, preset.filters);
      });
    });

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
