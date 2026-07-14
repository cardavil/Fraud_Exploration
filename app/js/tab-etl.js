/* ETL: the cleaning, applied in response to what the EDA surfaced. The audit
   trail is served live from the cleaning_log table and every treatment expands
   into real before→after examples (cleaning_examples.json); the tab closes with
   a live integrity panel over the cleaned data (counts, FKs, dup keys, empties). */
window.FE.tabs.etl = {
  render(el) {
    const { state, fmtInt, fmtPct, escapeHtml } = window.FE;
    const log = state.data.cleaning_log;
    const EXPECTED = { customers: 83, accounts: 105, transactions: 1600,
      compliance_alerts: 65, sanctions_screening: 95, chargebacks: 70 };
    const KIND_BADGE = {
      kept: '<span class="badge badge-offshore">kept &amp; flagged</span>',
      dropped: '<span class="badge badge-plain">rows dropped</span>',
    };

    /* ---------- integrity checks over the CLEANED data (computed live) ---------- */
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
    const countsOk = Object.entries(EXPECTED).filter(([t, n]) => d[t].length === n).length;

    const step = (n, title, chip, body) => `
      <div class="eda-step">
        <div class="eda-step-head">
          <span class="eda-step-n">${n}</span><h3>${title}</h3>
          ${chip ? `<span class="eda-chip">${chip}</span>` : ""}
        </div>
        <div class="eda-step-body">${body}</div>
      </div>`;

    el.innerHTML = `
      ${step(1, "Audited cleaning — every treatment logged", "31 treatments · expandable examples", `
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
                </td>
              </tr>` : ""}`;
            }).join("")}
            </tbody>
          </table>
        </div>`)}

      ${step(2, "Validation and integrity", `counts ${countsOk}/6 ✓ · FKs ${fkTotal} violations`, `
        <p>Dates are parsed to date types, primary/foreign keys enforced on the serving layer,
        and the clean row counts verified live against the pipeline's expected output:</p>
        <div class="check-row">${Object.entries(EXPECTED).map(([t, n]) => {
          const ok = d[t].length === n;
          return `<span class="badge ${ok ? "badge-clear" : "badge-sanctioned"}">${t}: ${fmtInt(d[t].length)}${ok ? " ✓" : ` (expected ${n})`}</span>`;
        }).join(" ")}</div>
        <h4 class="integrity-title">Integrity panel — computed live on the cleaned data</h4>
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

      <p class="tab-foot">Cleaning runs in <code>analysis/clean.py</code> in response to what the EDA
      surfaced; every treatment is logged and shown above with its before&rarr;after examples.</p>
    `;

    el.querySelectorAll(".log-row.expandable").forEach((row) => {
      row.addEventListener("click", () => {
        const sub = el.querySelector(`.example-row[data-for="${row.dataset.step}"]`);
        const open = !sub.classList.contains("hidden");
        sub.classList.toggle("hidden");
        row.querySelector(".chev").innerHTML = open ? "&#9656;" : "&#9662;";
      });
    });
  },
};
