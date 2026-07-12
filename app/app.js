/* Fraud & Compliance Exploration Board.
   All reads go through PostgREST with the anon key (RLS: SELECT-only).
   Data volumes are small (1.6k txns), so filtering happens client-side. */
(() => {
  const CFG = window.FE_CONFIG;
  const HIGH_RISK = new Set(["Iran", "North Korea", "Syria", "Russia", "Myanmar", "Afghanistan"]);
  const OFFSHORE = new Set(["Cayman Islands", "British Virgin Islands", "Panama", "Cyprus", "Malta"]);
  const PAGE_SIZE = 50;

  const state = {
    txns: [], accounts: new Map(), alerts: [], scores: [],
    screenedCustomers: new Set(), totalCustomers: 0,
    filtered: [], page: 0,
  };

  const $ = (id) => document.getElementById(id);
  const fmtMoney = (v, compact) => new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: compact ? 2 : 0,
    ...(compact ? { notation: "compact" } : {}),
  }).format(v);
  const fmtPct = (v) => `${Math.round(v * 100)}%`;
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function supabaseFetch(path, { range } = {}) {
    const headers = {
      apikey: CFG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
    };
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

  function showGlobalError(err) {
    const el = $("global-error");
    el.innerHTML = `${escapeHtml(err.message)} — <a href="javascript:location.reload()">retry</a>`;
    el.classList.remove("hidden");
  }

  /* ---------- KPIs ---------- */
  function amountBand(a) {
    if (a == null) return "";
    if (a < 1000) return "lt1k";
    if (a < 5000) return "1to5k";
    if (a < 9000) return "5to9k";
    if (a < 10000) return "9to10k";
    if (a < 50000) return "10to50k";
    return "gte50k";
  }

  function renderKpis() {
    const alertedTx = new Set(state.alerts.map((a) => a.transaction_id).filter(Boolean));
    const hr = state.txns.filter((t) => HIGH_RISK.has(t.counterparty_country));
    const hrUnalerted = hr.filter((t) => !alertedTx.has(t.transaction_id));
    const hrValue = hrUnalerted.reduce((s, t) => s + (t.amount || 0), 0);

    const flagged = state.txns.filter((t) => t.flagged_for_review === "Yes");
    const flaggedUnalerted = flagged.filter((t) => !alertedTx.has(t.transaction_id));
    const gap = flagged.length ? flaggedUnalerted.length / flagged.length : 0;

    const coverage = state.totalCustomers
      ? state.screenedCustomers.size / state.totalCustomers : 0;

    const closed = state.alerts.filter((a) => (a.status || "").startsWith("Closed"));
    const fps = closed.filter((a) => a.status === "Closed - False Positive");
    const fpRate = closed.length ? fps.length / closed.length : 0;

    // "unresolved" = anything not Closed (Open, Escalated, Under Review)
    const openCritHigh = state.alerts.filter((a) => !(a.status || "").startsWith("Closed")
      && (a.severity === "Critical" || a.severity === "High"));

    const tiles = {
      unalerted: {
        cls: "kpi-risk", label: "Unalerted high-risk value",
        value: fmtMoney(hrValue, true),
        note: `${hrUnalerted.length} sanctioned-country txns without an alert`,
      },
      gap: {
        cls: "kpi-risk", label: "Escalation gap",
        value: fmtPct(gap),
        note: `${flaggedUnalerted.length} of ${flagged.length} flagged txns never became a case`,
      },
      screening: {
        cls: "kpi-warn", label: "Screening coverage",
        value: fmtPct(coverage),
        note: `${state.totalCustomers - state.screenedCustomers.size} of ${state.totalCustomers} customers never screened`,
      },
      fp: {
        cls: "kpi-warn", label: "False-positive rate",
        value: fmtPct(fpRate),
        note: `${fps.length} of ${closed.length} closed alerts were false positives`,
      },
      open: {
        cls: "kpi-risk", label: "Unresolved Critical / High",
        value: String(openCritHigh.length),
        note: "unresolved high-severity alerts in the backlog",
      },
    };

    for (const [key, t] of Object.entries(tiles)) {
      const el = document.querySelector(`[data-kpi="${key}"]`);
      el.classList.remove("skeleton");
      el.classList.add(t.cls);
      el.innerHTML = `<span class="kpi-label">${t.label}</span>
        <span class="kpi-value">${t.value}</span>
        <span class="kpi-note">${t.note}</span>`;
    }
  }

  /* ---------- transactions table ---------- */
  function populateFilters() {
    const countries = [...new Set(state.txns.map((t) => t.counterparty_country))].sort();
    $("f-country").insertAdjacentHTML("beforeend",
      countries.map((c) => `<option>${escapeHtml(c)}</option>`).join(""));
    const statuses = [...new Set([...state.accounts.values()].map((a) => a.status))].sort();
    $("f-status").insertAdjacentHTML("beforeend",
      statuses.map((s) => `<option>${escapeHtml(s)}</option>`).join(""));
  }

  function applyFilters() {
    const country = $("f-country").value;
    const flaggedV = $("f-flagged").value;
    const band = $("f-band").value;
    const status = $("f-status").value;
    state.filtered = state.txns.filter((t) => {
      if (country && t.counterparty_country !== country) return false;
      if (flaggedV && t.flagged_for_review !== flaggedV) return false;
      if (band && amountBand(t.amount) !== band) return false;
      if (status && (state.accounts.get(t.account_id)?.status || "") !== status) return false;
      return true;
    });
    state.page = 0;
    renderTable();
  }

  function riskBadges(t) {
    const out = [];
    if (HIGH_RISK.has(t.counterparty_country)) out.push('<span class="badge badge-sanctioned">Sanctioned</span>');
    else if (OFFSHORE.has(t.counterparty_country)) out.push('<span class="badge badge-offshore">Offshore</span>');
    if (amountBand(t.amount) === "9to10k") out.push('<span class="badge badge-structuring">9&ndash;10k band</span>');
    if (!out.length) out.push('<span class="badge badge-plain">&mdash;</span>');
    return out.join(" ");
  }

  function renderTable() {
    const rows = state.filtered;
    const start = state.page * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);
    const value = rows.reduce((s, t) => s + (t.amount || 0), 0);

    $("tx-summary").textContent =
      `${rows.length.toLocaleString()} transactions · ${fmtMoney(value, true)} total value`;

    $("tx-body").innerHTML = pageRows.length ? pageRows.map((t) => {
      const acc = state.accounts.get(t.account_id);
      return `<tr>
        <td>${escapeHtml(t.transaction_date)}</td>
        <td>${escapeHtml(t.transaction_id)}</td>
        <td>${escapeHtml(t.account_id)}</td>
        <td class="status-${escapeHtml(acc?.status)}">${escapeHtml(acc?.status ?? "?")}</td>
        <td class="num">${t.amount == null ? "—" : fmtMoney(t.amount)}</td>
        <td>${escapeHtml(t.transaction_type)}</td>
        <td>${escapeHtml(t.counterparty_country)}</td>
        <td>${riskBadges(t)}</td>
        <td>${t.flagged_for_review === "Yes"
          ? '<span class="badge badge-flagged">Flagged</span>'
          : '<span class="badge badge-plain">No</span>'}</td>
      </tr>`;
    }).join("") : '<tr><td colspan="9" class="loading-cell">No transactions match the current filters.</td></tr>';

    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    $("tx-page-info").textContent = `Page ${state.page + 1} of ${pages}`;
    $("tx-prev").disabled = state.page === 0;
    $("tx-next").disabled = state.page >= pages - 1;
  }

  /* ---------- anomalies ---------- */
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

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function explainDeviations(acc, medians) {
    const reasons = [];
    for (const [key, [label, fmt]] of Object.entries(FEATURE_LABELS)) {
      const v = acc[key]; const med = medians[key];
      if (v == null) continue;
      const score = med > 0 ? v / med : (v > 0 ? Infinity : 0);
      if (score >= 2.5 || (med === 0 && v >= 0.1)) {
        const vs = med > 0 && Number.isFinite(score)
          ? `${score >= 10 ? Math.round(score) : score.toFixed(1)}× median`
          : `median ${fmt(med)}`;
        reasons.push({ score: Number.isFinite(score) ? score : 1000 + v, html: `<span class="why-chip">${label}: ${fmt(v)} (${vs})</span>` });
      }
    }
    return reasons.sort((a, b) => b.score - a.score).slice(0, 4).map((r) => r.html).join("");
  }

  function renderAnomalies() {
    const anoms = state.scores.filter((s) => s.anomaly === -1)
      .sort((a, b) => b.score - a.score);
    const medians = {};
    for (const key of Object.keys(FEATURE_LABELS)) {
      medians[key] = median(state.scores.map((s) => s[key] ?? 0));
    }
    const maxScore = Math.max(...anoms.map((a) => a.score));

    $("anom-list").innerHTML = anoms.map((a) => `
      <div class="anom-item">
        <div class="anom-top">
          <div>
            <span class="anom-id">${escapeHtml(a.account_id)}</span>
            <span class="anom-meta"> · ${escapeHtml(a.risk_rating)} risk · ${escapeHtml(a.status)} ·
              ${a.n_tx} txns · ${fmtMoney(a.total, true)}</span>
          </div>
          ${a.has_alert
            ? '<span class="badge badge-plain">Has alert history</span>'
            : '<span class="anom-alert-gap">Never alerted</span>'}
        </div>
        <div class="anom-score-track" role="img"
             aria-label="Anomaly score ${a.score.toFixed(2)}">
          <div class="anom-score-fill" style="width:${(a.score / maxScore) * 100}%"></div>
        </div>
        <div class="anom-why">Why: ${explainDeviations(a, medians) || "broad multi-feature deviation"}</div>
      </div>`).join("");
  }

  /* ---------- copilot ---------- */
  function populateCopilotAccounts() {
    const anomIds = new Set(state.scores.filter((s) => s.anomaly === -1).map((s) => s.account_id));
    const opts = state.scores
      .sort((a, b) => (anomIds.has(b.account_id) - anomIds.has(a.account_id)) || b.score - a.score)
      .map((s) => `<option value="${escapeHtml(s.account_id)}">${escapeHtml(s.account_id)}${anomIds.has(s.account_id) ? " ⚠ anomalous" : ""} · ${escapeHtml(s.risk_rating)} risk</option>`);
    $("cop-account").insertAdjacentHTML("beforeend", opts.join(""));
  }

  const ACTION_BADGE = {
    "Escalate": "badge-sanctioned",
    "Request documentation": "badge-offshore",
    "Close as false positive": "badge-clear",
  };

  async function runCopilot() {
    const accountId = $("cop-account").value;
    if (!accountId) return;
    $("cop-error").classList.add("hidden");
    $("cop-output").classList.add("hidden");
    $("cop-loading").classList.remove("hidden");
    $("cop-run").disabled = true;
    try {
      const res = await fetch(CFG.COPILOT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ account_id: accountId }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Copilot request failed (${res.status}). ${detail.slice(0, 200)}`);
      }
      const r = await res.json();
      $("cop-output").innerHTML = `
        <p>${escapeHtml(r.risk_summary)}</p>
        <div class="cop-action">Recommended action:
          <span class="badge ${ACTION_BADGE[r.recommended_action] || "badge-plain"}">${escapeHtml(r.recommended_action)}</span>
        </div>
        <strong>Key factors</strong>
        <ul class="cop-factors">${(r.key_factors || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
        <div class="cop-confidence">Model confidence: ${fmtPct(r.confidence ?? 0)} ·
          grounded exclusively on this account's served data</div>`;
      $("cop-output").classList.remove("hidden");
    } catch (err) {
      $("cop-error").textContent = err.message;
      $("cop-error").classList.remove("hidden");
    } finally {
      $("cop-loading").classList.add("hidden");
      $("cop-run").disabled = false;
    }
  }

  /* ---------- boot ---------- */
  async function initBoard() {
    try {
      const [txns, accounts, alerts, screenings, customers, scores] = await Promise.all([
        // transaction_id tiebreaker keeps the 2-page Range fetch stable across queries
        supabaseFetchAll("transactions?select=transaction_id,account_id,transaction_date,amount,transaction_type,counterparty_country,flagged_for_review&order=transaction_date.desc,transaction_id.asc"),
        supabaseFetchAll("accounts?select=account_id,customer_id,status"),
        supabaseFetchAll("compliance_alerts?select=alert_id,transaction_id,severity,status"),
        supabaseFetchAll("sanctions_screening?select=customer_id"),
        supabaseFetchAll("customers?select=customer_id"),
        supabaseFetchAll("account_scores?select=*"),
      ]);
      state.txns = txns;
      state.accounts = new Map(accounts.map((a) => [a.account_id, a]));
      state.alerts = alerts;
      state.screenedCustomers = new Set(screenings.map((s) => s.customer_id));
      state.totalCustomers = customers.length;
      state.scores = scores;

      renderKpis();
      populateFilters();
      applyFilters();
      renderAnomalies();
      populateCopilotAccounts();
    } catch (err) {
      showGlobalError(err);
      $("tx-body").innerHTML = '<tr><td colspan="9" class="loading-cell">Could not load data.</td></tr>';
      $("anom-list").innerHTML = '<div class="loading-cell">Could not load anomaly scores.</div>';
    }
  }

  ["f-country", "f-flagged", "f-band", "f-status"].forEach((id) => $(id).addEventListener("change", applyFilters));
  $("f-reset").addEventListener("click", () => {
    ["f-country", "f-flagged", "f-band", "f-status"].forEach((id) => { $(id).value = ""; });
    applyFilters();
  });
  $("tx-prev").addEventListener("click", () => { state.page--; renderTable(); });
  $("tx-next").addEventListener("click", () => { state.page++; renderTable(); });
  $("cop-run").addEventListener("click", runCopilot);

  initBoard();
})();
