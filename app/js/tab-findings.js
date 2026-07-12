/* Findings: thematic deep-dives, each with its evidence chart. Live data where
   the computation is a join/filter; eda_stats.json where it is statistics. */
window.FE.tabs.findings = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, HIGH_RISK } = window.FE;
    const { barChart, hBarChart, lineChart } = window.FE.charts;
    const d = state.data;
    const k = state.kpis;

    const card = (id, title, lead) => `
      <div class="card finding-card" id="f-${id}">
        <h3>${title}</h3>
        <p>${lead}</p>
        <div class="chart-slot" id="fc-${id}"></div>
      </div>`;

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

    el.innerHTML = `
      <p class="tab-intro">What the analysis actually surfaced, theme by theme. Each figure has a
      hover tooltip per mark and an <span class="muted">&#9432; how to read</span> note. The five
      headline insights distilled from these findings live in the
      <a href="https://github.com/cardavil/Fraud_Exploration/blob/main/reports/EXECUTIVE_SUMMARY.md"
         target="_blank" rel="noopener">executive summary</a> (the assessment deliverable).</p>
      <div class="findings-grid">
        ${card("gap", "Detection works; escalation doesn't",
          `All ${fmtInt(k.hrUnalerted.total)} sanctioned-country transactions were flagged by the rules —
           but only ${fmtInt(k.hrUnalerted.total - k.hrUnalerted.n)} ever became an alert, leaving
           <strong>${fmtMoney(k.hrUnalerted.value, true)} unworked</strong>. Overall,
           ${fmtPct(k.gap.n / k.gap.of)} of flagged transactions never became a case.`)}
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
           sanctioned-country transactions as domestic — the status data itself is a control failure.`)}
        ${card("monitoring", "Monitoring never scaled — and is mis-aimed",
          `Volume tripled while alert creation stayed flat; ${fmtPct(k.fp.n / k.fp.of)} of closed
           alerts are false positives, and the KYC risk rating shows no statistical relationship with
           flagged activity (Cramér's V = 0.052). Capacity is spent on noise while the backlog holds
           ${k.critHigh} unresolved Critical/High alerts (median age 90 days).`)}
        ${card("chargebacks", "Chargebacks are accelerating",
          `Monthly chargeback value grew ~${k.chargebacks.ratio.toFixed(0)}× in four months
           (${fmtMoney(k.chargebacks.from, true)} → ${fmtMoney(k.chargebacks.to, true)}).
           Fraud-coded cases (CNP + Unauthorized) account for 21% of disputes; top-6 merchants
           concentrate 64% of cases.`)}
      </div>`;

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

    lineChart(el.querySelector("#fc-chargebacks"), {
      title: "Monthly chargeback value",
      howToRead: "Dollar value of chargebacks per month. Chargebacks lag the underlying fraud by weeks, so a climb this steep means the vector opened recently and is probably still open.",
      fmt: (v) => fmtMoney(v, true),
      series: [{ name: "Chargeback value", color: "#D64545",
        points: state.stats.monthly.chargebacks.map((m) => ({ x: m.month, y: m.value })) }],
    });
  },
};
