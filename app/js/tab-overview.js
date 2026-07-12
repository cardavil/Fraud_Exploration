/* Overview: the full KPI surface (8 tiles). Every tile opens a popup with the
   definition, the exact live formula, why it matters, and where to dig deeper. */
window.FE.tabs.overview = {
  render(el) {
    const { state, fmtMoney, fmtInt, fmtPct, openModal, goTo, escapeHtml } = window.FE;
    const k = state.kpis;

    const KPIS = [
      {
        id: "hr", cls: "kpi-risk", label: "Unalerted high-risk value",
        value: fmtMoney(k.hrUnalerted.value, true),
        note: `${k.hrUnalerted.n} sanctioned-country txns without an alert`,
        tab: "findings",
        what: "Total value of transactions with counterparties in sanctioned or high-risk jurisdictions (Iran, North Korea, Syria, Russia, Myanmar, Afghanistan) that never generated a compliance alert.",
        formula: `${fmtInt(k.hrUnalerted.total)} sanctioned-country txns − ${fmtInt(k.hrUnalerted.total - k.hrUnalerted.n)} with an alert = <strong>${fmtInt(k.hrUnalerted.n)} unalerted</strong> worth <strong>${fmtMoney(k.hrUnalerted.value)}</strong>`,
        why: "These are the highest-inherent-risk flows in the book. Every one was detected (all are flagged) — none was worked. This is exposure sitting in plain sight, and the first number a regulator would ask about.",
      },
      {
        id: "gap", cls: "kpi-risk", label: "Escalation gap",
        value: fmtPct(k.gap.n / k.gap.of),
        note: `${fmtInt(k.gap.n)} of ${fmtInt(k.gap.of)} flagged txns never became a case`,
        tab: "findings",
        what: "Share of transactions flagged for review by the monitoring rules that never received a compliance alert.",
        formula: `${fmtInt(k.gap.n)} flagged-without-alert ÷ ${fmtInt(k.gap.of)} flagged = <strong>${fmtPct(k.gap.n / k.gap.of, 1)}</strong> (${fmtMoney(k.gap.value, true)} unworked)`,
        why: "Detection and escalation are different controls. Rules are firing, but the output isn't converted into cases — the monitoring program produces signals nobody consumes.",
      },
      {
        id: "screening", cls: "kpi-warn", label: "Screening coverage",
        value: fmtPct(k.screening.done / k.screening.total),
        note: `${fmtInt(k.screening.total - k.screening.done)} of ${fmtInt(k.screening.total)} customers never screened`,
        tab: "findings",
        what: "Share of the customer base that has been through sanctions screening at least once.",
        formula: `${fmtInt(k.screening.done)} screened ÷ ${fmtInt(k.screening.total)} customers = <strong>${fmtPct(k.screening.done / k.screening.total, 1)}</strong>`,
        why: "The unscreened third includes sanctioned-nationality customers and PEPs. Screening that isn't universal isn't a control — it's a sample.",
      },
      {
        id: "fp", cls: "kpi-warn", label: "False-positive rate",
        value: fmtPct(k.fp.n / k.fp.of),
        note: `${fmtInt(k.fp.n)} of ${fmtInt(k.fp.of)} closed alerts were false positives`,
        tab: "findings",
        what: "Share of closed compliance alerts resolved as false positives.",
        formula: `${fmtInt(k.fp.n)} closed as FP ÷ ${fmtInt(k.fp.of)} closed alerts = <strong>${fmtPct(k.fp.n / k.fp.of, 1)}</strong>`,
        why: "Analyst capacity is being spent clearing noise while real flags (see the escalation gap) go unworked. High FP rates usually mean rule thresholds were never tuned against outcomes.",
      },
      {
        id: "crit", cls: "kpi-risk", label: "Unresolved Critical / High",
        value: String(k.critHigh),
        note: "high-severity alerts still open in the backlog",
        tab: "findings",
        what: "Compliance alerts with Critical or High severity whose status is not Closed (Open, Escalated or Under Review).",
        formula: `Critical/High alerts with status ∉ {Closed…} = <strong>${k.critHigh}</strong>; backlog median age 90 days, max 417`,
        why: "A two-speed operation: fresh alerts get closed fast while the old, severe ones rot. Backlog age on high-severity items is a standard exam finding.",
      },
      {
        id: "nonactive", cls: "kpi-risk", label: "Value through non-active accounts",
        value: fmtMoney(k.nonActive.value, true),
        note: `${fmtInt(k.nonActive.n)} txns through Closed / Dormant / Frozen accounts`,
        tab: "findings",
        what: "Transaction value flowing through accounts whose status should block or restrict activity.",
        formula: `${fmtInt(k.nonActive.n)} txns on Closed+Dormant+Frozen accounts = <strong>${fmtMoney(k.nonActive.value)}</strong>; ${fmtInt(k.nonActive.intlMisclassified)} sanctioned-country txns also marked "domestic"`,
        why: "Either the status field is stale (data governance failure) or the blocking control is not enforced (worse). Both make every downstream control unreliable.",
      },
      {
        id: "struct", cls: "kpi-warn", label: "Structuring-band share",
        value: fmtPct(k.structuring.share, 1),
        note: `${fmtInt(k.structuring.n)} txns in the $9,000–9,999 band — ${k.structuring.ratio}× its neighbors`,
        tab: "findings",
        what: "Share of transactions that sit just under the $10,000 reporting threshold.",
        formula: `${fmtInt(k.structuring.n)} txns in $9,000–9,999 ÷ 1,587 valid-amount txns = <strong>${fmtPct(k.structuring.share, 1)}</strong>, ${k.structuring.ratio}× the neighboring $1k bands`,
        why: "The classic structuring signature: amounts split to stay under the reporting threshold. The band collapses immediately above $10k — this is behavioral, not organic.",
      },
      {
        id: "cb", cls: "kpi-warn", label: "Chargeback growth",
        value: `${k.chargebacks.ratio.toFixed(0)}×`,
        note: `monthly value ${fmtMoney(k.chargebacks.from, true)} → ${fmtMoney(k.chargebacks.to, true)} (${k.chargebacks.fromMonth} → ${k.chargebacks.toMonth})`,
        tab: "findings",
        what: "Growth of monthly chargeback value over the last four months of the dataset.",
        formula: `${fmtMoney(k.chargebacks.to)} (${k.chargebacks.toMonth}) ÷ ${fmtMoney(k.chargebacks.from)} (${k.chargebacks.fromMonth}) = <strong>${k.chargebacks.ratio.toFixed(1)}×</strong>`,
        why: "Chargebacks lag fraud by weeks — an acceleration this sharp usually means a fraud vector opened recently and is still open.",
      },
    ];

    el.innerHTML = `
      <p class="tab-intro">Executive surface of the risk &amp; compliance book. Every tile is computed
      live from the serving layer — click one for its definition, exact formula and why it matters.
      The full reasoning path lives in the other tabs: raw <a href="#data">Data</a>, the
      <a href="#eda">EDA</a> process, deep-dive <a href="#findings">Findings</a>, the
      <a href="#ml">ML model</a> and the <a href="#engine">AI engine</a>.</p>
      <div class="kpi-strip kpi-grid-4">
        ${KPIS.map((x) => `
          <button class="kpi-tile ${x.cls}" data-kpi="${x.id}">
            <span class="kpi-label">${x.label}</span>
            <span class="kpi-value">${x.value}</span>
            <span class="kpi-note">${x.note}</span>
          </button>`).join("")}
      </div>`;

    el.querySelectorAll(".kpi-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const x = KPIS.find((q) => q.id === tile.dataset.kpi);
        openModal(x.label, `
          <p>${escapeHtml(x.what)}</p>
          <div class="modal-formula">${x.formula}</div>
          <p><strong>Why it matters:</strong> ${escapeHtml(x.why)}</p>
          <p><a href="#${x.tab}" class="modal-link" data-tab="${x.tab}">See the full picture in the ${x.tab} tab &rarr;</a></p>`);
        document.querySelector(".modal-link")?.addEventListener("click", (e) => {
          e.preventDefault();
          window.FE.closeModal();
          goTo(x.tab);
        });
      });
    });
  },
};
