/* Findings: the KPI surface (every tile opens its explanatory popup) plus
   thematic deep-dives, each with its evidence chart. Live data where the
   computation is a join/filter; eda_stats.json where it is statistics. */
window.FE.tabs.findings = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, HIGH_RISK, openModal } = window.FE;
    const { barChart, hBarChart, lineChart } = window.FE.charts;
    const d = state.data;
    const k = state.kpis;

    const card = (id, title, lead, drill = "") => `
      <div class="card finding-card" id="f-${id}">
        <h3>${title}</h3>
        <p>${lead}</p>
        ${drill ? `<p class="drill-row">${drill}</p>` : ""}
        <div class="chart-slot" id="fc-${id}"></div>
      </div>`;
    const drillLink = (label, table, filters) =>
      `<a href="#data" class="drill-link" data-drill='${JSON.stringify({ table, filters })}'>${label} &rarr;</a>`;

    // Post-match activity per confirmed sanctions match (live computation).
    const confirmed = d.sanctions_screening.filter((s) => s.match_result === "Confirmed Match");
    const custAccounts = new Map();
    for (const a of d.accounts) {
      if (!custAccounts.has(a.customer_id)) custAccounts.set(a.customer_id, []);
      custAccounts.get(a.customer_id).push(a.account_id);
    }
    const postMatch = confirmed.map((s) => {
      const accounts = new Set(custAccounts.get(s.customer_id) ?? []);
      const after = d.transactions.filter((t) => accounts.has(t.account_id)
        && t.transaction_date > s.screening_date);
      return { customer: s.customer_id, status: s.review_status, date: s.screening_date,
        n: after.length, value: after.reduce((x, t) => x + (t.amount || 0), 0) };
    }).sort((a, b) => b.value - a.value);

    /* KPI surface — each tile opens a popup: definition, live formula, why it matters. */
    const KPIS = [
      {
        id: "hr", cls: "kpi-risk", label: "Unalerted high-risk value",
        value: fmtMoney(k.hrUnalerted.value, true),
        note: `${k.hrUnalerted.n} sanctioned-country txns without an alert`,
        what: "Total value of transactions with counterparties in sanctioned or high-risk jurisdictions (Iran, North Korea, Syria, Russia, Myanmar, Afghanistan) that never generated a compliance alert.",
        formula: `${fmtInt(k.hrUnalerted.total)} sanctioned-country txns − ${fmtInt(k.hrUnalerted.total - k.hrUnalerted.n)} with an alert = <strong>${fmtInt(k.hrUnalerted.n)} unalerted</strong> worth <strong>${fmtMoney(k.hrUnalerted.value)}</strong>`,
        why: "These are the highest-inherent-risk flows in the book. Every one was detected (all are flagged) — none was worked. This is exposure sitting in plain sight, and the first number a regulator would ask about.",
      },
      {
        id: "gap", cls: "kpi-risk", label: "Escalation gap",
        value: fmtPct(k.gap.n / k.gap.of),
        note: `${fmtInt(k.gap.n)} of ${fmtInt(k.gap.of)} flagged txns never became a case`,
        what: "Share of transactions flagged for review by the monitoring rules that never received a compliance alert.",
        formula: `${fmtInt(k.gap.n)} flagged-without-alert ÷ ${fmtInt(k.gap.of)} flagged = <strong>${fmtPct(k.gap.n / k.gap.of, 1)}</strong> (${fmtMoney(k.gap.value, true)} unworked)`,
        why: "Detection and escalation are different controls. Rules are firing, but the output isn't converted into cases — the monitoring program produces signals nobody consumes.",
      },
      {
        id: "screening", cls: "kpi-warn", label: "Screening coverage",
        value: fmtPct(k.screening.done / k.screening.total),
        note: `${fmtInt(k.screening.total - k.screening.done)} of ${fmtInt(k.screening.total)} customers never screened`,
        what: "Share of the customer base that has been through sanctions screening at least once.",
        formula: `${fmtInt(k.screening.done)} screened ÷ ${fmtInt(k.screening.total)} customers = <strong>${fmtPct(k.screening.done / k.screening.total, 1)}</strong>`,
        why: "The unscreened third includes sanctioned-nationality customers and PEPs. Screening that isn't universal isn't a control — it's a sample.",
      },
      {
        id: "fp", cls: "kpi-warn", label: "False-positive rate",
        value: fmtPct(k.fp.n / k.fp.of),
        note: `${fmtInt(k.fp.n)} of ${fmtInt(k.fp.of)} closed alerts were false positives`,
        what: "Share of closed compliance alerts resolved as false positives.",
        formula: `${fmtInt(k.fp.n)} closed as FP ÷ ${fmtInt(k.fp.of)} closed alerts = <strong>${fmtPct(k.fp.n / k.fp.of, 1)}</strong>`,
        why: "Analyst capacity is being spent clearing noise while real flags (see the escalation gap) go unworked. High FP rates usually mean rule thresholds were never tuned against outcomes.",
      },
      {
        id: "crit", cls: "kpi-risk", label: "Unresolved Critical / High",
        value: String(k.critHigh),
        note: "high-severity alerts still open in the backlog",
        what: "Compliance alerts with Critical or High severity whose status is not Closed (Open, Escalated or Under Review).",
        formula: `Critical/High alerts with status ∉ {Closed…} = <strong>${k.critHigh}</strong>; backlog median age 90 days, max 417`,
        why: "A two-speed operation: fresh alerts get closed fast while the old, severe ones rot. Backlog age on high-severity items is a standard exam finding.",
      },
      {
        id: "nonactive", cls: "kpi-risk", label: "Value through non-active accounts",
        value: fmtMoney(k.nonActive.value, true),
        note: `${fmtInt(k.nonActive.n)} txns through Closed / Dormant / Frozen accounts`,
        what: "Transaction value flowing through accounts whose status should block or restrict activity.",
        formula: `${fmtInt(k.nonActive.n)} txns on Closed+Dormant+Frozen accounts = <strong>${fmtMoney(k.nonActive.value)}</strong>; ${fmtInt(k.nonActive.intlMisclassified)} sanctioned-country txns also marked "domestic"`,
        why: "Either the status field is stale (data governance failure) or the blocking control is not enforced (worse). Both make every downstream control unreliable.",
      },
      {
        id: "struct", cls: "kpi-warn", label: "Structuring-band share",
        value: fmtPct(k.structuring.share, 1),
        note: `${fmtInt(k.structuring.n)} txns in the $9,000–9,999 band — ${k.structuring.ratio}× its neighbors`,
        what: "Share of transactions that sit just under the $10,000 reporting threshold.",
        formula: `${fmtInt(k.structuring.n)} txns in $9,000–9,999 ÷ 1,587 valid-amount txns = <strong>${fmtPct(k.structuring.share, 1)}</strong>, ${k.structuring.ratio}× the neighboring $1k bands`,
        why: "The classic structuring signature: amounts split to stay under the reporting threshold. The band collapses immediately above $10k — this is behavioral, not organic.",
      },
      {
        id: "cb", cls: "kpi-warn", label: "Chargeback growth",
        value: `${k.chargebacks.ratio.toFixed(0)}×`,
        note: `monthly value ${fmtMoney(k.chargebacks.from, true)} → ${fmtMoney(k.chargebacks.to, true)} (${k.chargebacks.fromMonth} → ${k.chargebacks.toMonth})`,
        what: "Growth of monthly chargeback value over the last four months of the dataset.",
        formula: `${fmtMoney(k.chargebacks.to)} (${k.chargebacks.toMonth}) ÷ ${fmtMoney(k.chargebacks.from)} (${k.chargebacks.fromMonth}) = <strong>${k.chargebacks.ratio.toFixed(1)}×</strong>`,
        why: "Chargebacks lag fraud by weeks — an acceleration this sharp usually means a fraud vector opened recently and is still open.",
      },
    ];

    el.innerHTML = `
      <p class="tab-intro">What the analysis actually surfaced. The tiles are the live KPI surface —
      click one for its definition, exact formula and why it matters. Below, each theme gets its
      evidence chart with hover tooltips and an <span class="muted">&#9432; how to read</span> note.
      The five headline insights distilled from these findings live in the
      <a href="https://github.com/cardavil/Fraud_Exploration/blob/main/reports/EXECUTIVE_SUMMARY.md"
         target="_blank" rel="noopener">executive summary</a> (the assessment deliverable).</p>
      <div class="kpi-strip kpi-grid-4">
        ${KPIS.map((x) => `
          <button class="kpi-tile ${x.cls}" data-kpi="${x.id}">
            <span class="kpi-label">${x.label}</span>
            <span class="kpi-value">${x.value}</span>
            <span class="kpi-note">${x.note}</span>
          </button>`).join("")}
      </div>
      <div class="findings-grid">
        ${card("gap", "Detection works; escalation doesn't",
          `All ${fmtInt(k.hrUnalerted.total)} sanctioned-country transactions were flagged by the rules —
           but only ${fmtInt(k.hrUnalerted.total - k.hrUnalerted.n)} ever became an alert, leaving
           <strong>${fmtMoney(k.hrUnalerted.value, true)} unworked</strong>. Overall,
           ${fmtPct(k.gap.n / k.gap.of)} of flagged transactions never became a case.`,
          drillLink("See the flagged transactions", "transactions",
            [{ col: "flagged_for_review", kind: "categorical", value: "Yes" }]))}
        ${card("sanctions", "Confirmed sanctions matches keep transacting",
          `${confirmed.length} confirmed matches, zero resolved. Money kept moving <em>after</em> the
           match was confirmed — and ${fmtInt(k.screening.total - k.screening.done)} of
           ${fmtInt(k.screening.total)} customers (incl. sanctioned-nationality and PEP customers)
           were never screened at all.`)}
        ${card("structuring", "A structuring pattern in plain sight",
          `${fmtInt(k.structuring.n)} transactions (${fmtPct(k.structuring.share, 1)}) sit in the
           $9,000–9,999 band — ${k.structuring.ratio}× the neighboring bands, collapsing right above
           $10,000. Only 9 structuring alerts exist.`)}
        ${card("controls", "Account-status controls are not enforced",
          `<strong>${fmtMoney(k.nonActive.value, true)}</strong> moved through Closed, Dormant and
           Frozen accounts (${fmtInt(k.nonActive.n)} transactions). The
           <code>is_international</code> flag misclassifies ${fmtInt(k.nonActive.intlMisclassified)}
           sanctioned-country transactions as domestic — the status data itself is a control failure.`,
          ["Dormant", "Closed", "Frozen"].map((s) => drillLink(`${s} accounts`, "accounts",
            [{ col: "status", kind: "categorical", value: s }])).join(" · "))}
        ${card("monitoring", "Monitoring never scaled — and is mis-aimed",
          `Volume tripled while alert creation stayed flat; ${fmtPct(k.fp.n / k.fp.of)} of closed
           alerts are false positives, and the KYC risk rating shows no statistical relationship with
           flagged activity (Cramér's V = 0.052). Capacity is spent on noise while the backlog holds
           ${k.critHigh} unresolved Critical/High alerts (median age 90 days).`,
          drillLink("See the open Critical alerts", "compliance_alerts",
            [{ col: "status", kind: "categorical", value: "Open" },
             { col: "severity", kind: "categorical", value: "Critical" }]))}
        ${card("needles", "Needles & schemes — what single-level monitoring misses",
          (() => {
            const needles = state.data.transaction_scores
              .filter((t) => t.anomaly === -1 && !t.flagged_by_rules);
            const schemers = state.data.customer_scores.filter((c) => c.structuring_days > 0);
            return `The three-tier models expose two blind spots: <strong>${fmtInt(needles.length)}
             transaction needles</strong> the rules never flagged (top:
             ${fmtMoney(Math.max(...needles.map((t) => t.amount || 0)), true)} — extreme for its own
             account, invisible in account averages), and <strong>${fmtInt(schemers.length)}
             customers with cross-account structuring days</strong> — daily sums over $10,000 split
             under the threshold across their own accounts, invisible at both transaction and
             account level.`;
          })(),
          drillLink("See tier-1 scores", "transaction_scores",
            [{ col: "anomaly", kind: "min", value: -1 }, { col: "anomaly", kind: "max", value: -1 },
             { col: "flagged_by_rules", kind: "max", value: 0 }]))}
        ${card("chargebacks", "Chargebacks are accelerating",
          `Monthly chargeback value grew ~${k.chargebacks.ratio.toFixed(0)}× in four months
           (${fmtMoney(k.chargebacks.from, true)} → ${fmtMoney(k.chargebacks.to, true)}).
           Fraud-coded cases (CNP + Unauthorized) account for 21% of disputes; top-6 merchants
           concentrate 64% of cases.`)}
      </div>`;

    el.querySelectorAll(".kpi-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const x = KPIS.find((q) => q.id === tile.dataset.kpi);
        openModal(x.label, `
          <p>${escapeHtml(x.what)}</p>
          <div class="modal-formula">${x.formula}</div>
          <p><strong>Why it matters:</strong> ${escapeHtml(x.why)}</p>`);
      });
    });

    el.querySelectorAll(".drill-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        const { table, filters } = JSON.parse(link.dataset.drill);
        window.FE.openData(table, filters);
      });
    });

    hBarChart(el.querySelector("#fc-gap"), {
      title: "The escalation funnel, in transactions",
      howToRead: "Each pair compares what the rules detected (blue) against what became a case (red). The drop between bars is the escalation gap — detected risk that nobody worked.",
      fmt: fmtInt,
      data: [
        { label: "Flagged for review", value: k.gap.of, color: "#2E5BFF", tip: `<strong>${fmtInt(k.gap.of)}</strong> txns flagged by rules` },
        { label: "…that got an alert", value: k.gap.of - k.gap.n, color: "#D64545", emphasize: true, tip: `<strong>${fmtInt(k.gap.of - k.gap.n)}</strong> escalated (${fmtPct((k.gap.of - k.gap.n) / k.gap.of)})` },
        { label: "Sanctioned-country txns", value: k.hrUnalerted.total, color: "#2E5BFF", tip: `<strong>${fmtInt(k.hrUnalerted.total)}</strong> txns to sanctioned/high-risk countries — all flagged` },
        { label: "…that got an alert", value: k.hrUnalerted.total - k.hrUnalerted.n, color: "#D64545", emphasize: true, tip: `<strong>${fmtInt(k.hrUnalerted.total - k.hrUnalerted.n)}</strong> escalated · ${fmtMoney(k.hrUnalerted.value, true)} left unalerted` },
      ],
    });

    hBarChart(el.querySelector("#fc-sanctions"), {
      title: "Value moved AFTER a confirmed sanctions match",
      howToRead: "Each bar is one customer with a confirmed sanctions match: total transaction value across their accounts after the screening date. Any bar above zero is a control failure — matched customers should be frozen pending resolution.",
      fmt: (v) => fmtMoney(v, true),
      data: postMatch.map((p) => ({
        label: `${p.customer} (${p.status})`, value: p.value,
        color: "#D64545", emphasize: p.value > 500000,
        tip: `<strong>${escapeHtml(p.customer)}</strong> · match ${escapeHtml(p.date)} (${escapeHtml(p.status)})<br>${fmtInt(p.n)} txns · ${fmtMoney(p.value)} after the match`,
      })),
    });

    barChart(el.querySelector("#fc-structuring"), {
      title: "Transactions per $1,000 band — the $9k–10k spike",
      howToRead: "Bars are transaction counts per $1,000 amount band. A smooth decay is organic; the amber band just under the $10,000 reporting threshold at 3.3× its neighbors, collapsing right above, is deliberate splitting.",
      fmt: fmtInt,
      data: state.stats.structuring.bands.map((b) => ({
        label: `$${b.band}`, value: b.count,
        color: b.lo === 9000 ? "#E8A33D" : "#2E5BFF", emphasize: b.lo === 9000,
        tip: `<strong>$${b.band}</strong>: ${fmtInt(b.count)} txns`,
      })),
    });

    const statusMap = new Map(d.accounts.map((a) => [a.account_id, a.status]));
    const byStatus = {};
    for (const t of d.transactions) {
      const s = statusMap.get(t.account_id);
      if (["Closed", "Dormant", "Frozen"].includes(s)) {
        byStatus[s] ??= { n: 0, value: 0 };
        byStatus[s].n++;
        byStatus[s].value += t.amount || 0;
      }
    }
    hBarChart(el.querySelector("#fc-controls"), {
      title: "Transaction value through accounts that should not transact",
      howToRead: "Each bar is the total value that flowed through accounts in a status that should block or restrict activity. The expected value for all three is zero.",
      fmt: (v) => fmtMoney(v, true),
      data: ["Dormant", "Closed", "Frozen"].map((s) => ({
        label: s, value: byStatus[s]?.value ?? 0, color: "#E8A33D", emphasize: true,
        tip: `<strong>${s}</strong>: ${fmtInt(byStatus[s]?.n ?? 0)} txns · ${fmtMoney(byStatus[s]?.value ?? 0)}`,
      })),
    });

    lineChart(el.querySelector("#fc-monitoring"), {
      title: "Monthly transactions vs alerts created (counts)",
      howToRead: "One axis, two counts. The blue line (transactions) triples across the window; the red line (alerts) never leaves single-to-low-double digits. The widening gap is unmonitored growth.",
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

    hBarChart(el.querySelector("#fc-needles"), {
      title: "Top model-only needles — flagged by tier 1, missed by the rules",
      howToRead: "Each bar is one transaction the tier-1 model flagged but the rules engine never did. The tooltip shows why: usually an amount many times the account's own median, on an account whose averages look normal.",
      fmt: (v) => fmtMoney(v, true),
      data: state.data.transaction_scores
        .filter((t) => t.anomaly === -1 && !t.flagged_by_rules && t.amount)
        .sort((a, b) => b.amount - a.amount).slice(0, 6)
        .map((t) => ({
          label: t.transaction_id, value: t.amount, color: "#D64545", emphasize: t.amount > 300000,
          tip: `<strong>${escapeHtml(t.transaction_id)}</strong> · ${escapeHtml(t.account_id)}<br>${fmtMoney(t.amount)} — ${t.rel_amount >= 49 ? "50+" : t.rel_amount.toFixed(0)}× its account's median · score ${t.score.toFixed(3)}`,
        })),
    });

    lineChart(el.querySelector("#fc-chargebacks"), {
      title: "Monthly chargeback value",
      howToRead: "Dollar value of chargebacks per month. Chargebacks lag the underlying fraud by weeks, so a climb this steep means the vector opened recently and is probably still open.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Chargeback value", color: "#D64545",
        points: state.stats.monthly.chargebacks.map((m) => ({ x: m.month, y: m.value })) }],
    });
  },
};
