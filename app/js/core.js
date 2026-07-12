/* Core: shared state, Supabase reads, tab router, modal. Every tab module
   registers itself in FE.tabs and renders lazily on first activation. */
window.FE = (() => {
  const CFG = window.FE_CONFIG;
  const HIGH_RISK = new Set(["Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"]);
  const OFFSHORE = new Set(["Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"]);
  const TABLES = ["customers", "accounts", "transactions", "compliance_alerts",
    "sanctions_screening", "chargebacks", "account_scores", "cleaning_log"];

  const state = { data: {}, stats: null, sensitivity: null, examples: null, kpis: null, ready: false };
  const tabs = {};          // name -> { render(el), rendered }
  const $ = (id) => document.getElementById(id);

  /* ---------- formatters ---------- */
  const fmtMoney = (v, compact) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: compact ? 2 : 0,
    ...(compact ? { notation: "compact" } : {}),
  }).format(v);
  const fmtInt = (v) => Number(v).toLocaleString("en-US");
  const fmtPct = (v, dec = 0) => `${(v * 100).toFixed(dec)}%`;
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- data access ---------- */
  async function supabaseFetch(path, { range } = {}) {
    const headers = { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}` };
    if (range) headers.Range = range;
    const res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`Supabase read failed (${res.status}) on ${path.split("?")[0]}`);
    return res.json();
  }

  // PostgREST caps responses at 1,000 rows — page with Range headers.
  async function supabaseFetchAll(path) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const chunk = await supabaseFetch(path, { range: `${from}-${from + 999}` });
      out.push(...chunk);
      if (chunk.length < 1000) return out;
    }
  }

  /* ---------- shared derived numbers (single source for tiles & popups) ---------- */
  function computeKpis() {
    const d = state.data;
    const alertedTx = new Set(d.compliance_alerts.map((a) => a.transaction_id).filter(Boolean));
    const hr = d.transactions.filter((t) => HIGH_RISK.has(t.counterparty_country));
    const hrUnalerted = hr.filter((t) => !alertedTx.has(t.transaction_id));
    const flagged = d.transactions.filter((t) => t.flagged_for_review === "Yes");
    const flaggedUnalerted = flagged.filter((t) => !alertedTx.has(t.transaction_id));
    const screened = new Set(d.sanctions_screening.map((s) => s.customer_id));
    const closedAlerts = d.compliance_alerts.filter((a) => (a.status || "").startsWith("Closed"));
    const fps = closedAlerts.filter((a) => a.status === "Closed - False Positive");
    const critHigh = d.compliance_alerts.filter((a) => !(a.status || "").startsWith("Closed")
      && (a.severity === "Critical" || a.severity === "High"));
    const statusMap = new Map(d.accounts.map((a) => [a.account_id, a.status]));
    const nonActive = d.transactions.filter((t) =>
      ["Closed", "Dormant", "Frozen"].includes(statusMap.get(t.account_id)));
    const intlMisclassified = hr.filter((t) => t.is_international === "No");
    const cbMonthly = state.stats.monthly.chargebacks;
    const cbFirst = cbMonthly.find((m) => m.month === "2026-03");
    const cbLast = cbMonthly[cbMonthly.length - 1];
    const band = state.stats.structuring;

    state.kpis = {
      hrUnalerted: { n: hrUnalerted.length, value: hrUnalerted.reduce((s, t) => s + (t.amount || 0), 0), total: hr.length },
      gap: { n: flaggedUnalerted.length, of: flagged.length,
             value: flaggedUnalerted.reduce((s, t) => s + (t.amount || 0), 0) },
      screening: { done: screened.size, total: state.data.customers.length },
      fp: { n: fps.length, of: closedAlerts.length },
      critHigh: critHigh.length,
      nonActive: { n: nonActive.length, value: nonActive.reduce((s, t) => s + (t.amount || 0), 0),
                   intlMisclassified: intlMisclassified.length },
      structuring: { n: band.band_9k_count, share: band.band_9k_share, ratio: band.ratio_vs_neighbors },
      chargebacks: { from: cbFirst?.value ?? 0, to: cbLast?.value ?? 0,
                     ratio: cbFirst && cbFirst.value ? cbLast.value / cbFirst.value : 0,
                     fromMonth: cbFirst?.month, toMonth: cbLast?.month },
    };
  }

  /* ---------- modal ---------- */
  function openModal(title, bodyHtml) {
    $("modal-title").textContent = title;
    $("modal-body").innerHTML = bodyHtml;
    $("modal-backdrop").classList.remove("hidden");
    $("modal-close").focus();
  }
  function closeModal() { $("modal-backdrop").classList.add("hidden"); }

  /* ---------- tab router (hash based: #eda, #ml, ...) ---------- */
  function activateTab(name) {
    if (!tabs[name]) name = "overview";
    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) =>
      p.classList.toggle("hidden", p.id !== `tab-${name}`));
    if (state.ready && !tabs[name].rendered) {
      tabs[name].render($(`tab-${name}`));
      tabs[name].rendered = true;
    }
    if (location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
  }
  const goTo = (name) => { activateTab(name); window.scrollTo({ top: 0 }); };

  // Deep-link into the Data tab with a table and pre-applied filters.
  // presetFilters: [{ col, kind: "categorical"|"min"|"max"|"from"|"to"|"contains", value }]
  let pendingDataPreset = null;
  function openData(table, presetFilters) {
    pendingDataPreset = { table, filters: presetFilters ?? [] };
    goTo("data");
    if (tabs.data.rendered) tabs.data.applyPreset?.();
  }
  const takeDataPreset = () => {
    const p = pendingDataPreset;
    pendingDataPreset = null;
    return p;
  };
  const peekDataPreset = () => pendingDataPreset;

  /* ---------- boot ---------- */
  async function boot() {
    document.querySelectorAll(".tab-btn").forEach((b) =>
      b.addEventListener("click", () => goTo(b.dataset.tab)));
    window.addEventListener("hashchange", () => activateTab(location.hash.slice(1)));
    $("modal-close").addEventListener("click", closeModal);
    $("modal-backdrop").addEventListener("click", (e) => {
      if (e.target === $("modal-backdrop")) closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

    try {
      const [stats, sensitivity, examples] = await Promise.all([
        fetch("data/eda_stats.json").then((r) => r.json()),
        fetch("data/model_sensitivity.json").then((r) => r.json()),
        fetch("data/cleaning_examples.json").then((r) => r.json()),
      ]);
      state.stats = stats;
      state.sensitivity = sensitivity;
      state.examples = examples;
      const results = await Promise.all(TABLES.map((t) => supabaseFetchAll(
        t === "transactions"
          ? "transactions?select=*&order=transaction_date.desc,transaction_id.asc"
          : `${t}?select=*`)));
      TABLES.forEach((t, i) => { state.data[t] = results[i]; });
      computeKpis();
      state.ready = true;
      $("global-loading").classList.add("hidden");
      activateTab(location.hash.slice(1) || "overview");
    } catch (err) {
      $("global-loading").classList.add("hidden");
      const el = $("global-error");
      el.innerHTML = `${escapeHtml(err.message)} — <a href="javascript:location.reload()">retry</a>`;
      el.classList.remove("hidden");
    }
  }

  return { CFG, HIGH_RISK, OFFSHORE, state, tabs, $, fmtMoney, fmtInt, fmtPct,
           escapeHtml, supabaseFetch, supabaseFetchAll, openModal, closeModal, goTo,
           openData, takeDataPreset, peekDataPreset, boot };
})();
