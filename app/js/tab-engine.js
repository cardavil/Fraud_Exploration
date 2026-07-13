/* AI Engine: the sentinel's internals made visible — agent pipeline, tools,
   model wrapper, defenses — plus the live runner with its per-agent audit. */
window.FE.tabs.engine = {
  render(el) {
    const { CFG, state, fmtPct, escapeHtml } = window.FE;

    const AGENTS = [
      { name: "profile_analyst", tier: "fast", tools: ["profileFetcher", "screeningFetcher"],
        out: "profile_risk", role: "KYC & sanctions-screening posture: nationality, PEP, occupation plausibility, screening history." },
      { name: "behavior_analyst", tier: "fast", tools: ["txnAggregator", "txnSampler", "txnOutlierFetcher", "alertFetcher"],
        out: "behavior_risk", role: "Transactional patterns across every account the customer holds: structuring band, single-day bursts, sanctioned/offshore exposure, the tier-1 outlier transactions, alert history." },
      { name: "anomaly_interpreter", tier: "fast", tools: ["scoreFetcher"],
        out: "ml_reading", role: "Reads all three detection tiers: the customer model (structuring days, screening state, post-match activity) and each account model, noting what the rules engine missed." },
      { name: "risk_synthesizer", tier: "heavy", tools: ["(analyst notes)"],
        out: "draft", role: "Merges the three notes into one quantified narrative with a candidate action and confidence." },
      { name: "compliance_reviewer", tier: "heavy", tools: ["(draft + notes)"],
        out: "final", role: "QA gate: verifies every figure traces to the notes, enforces the action enum, calibrates confidence." },
    ];

    const DEFENSES = [
      ["Model wrapper", "One wrapper for every call: retry with backoff on the primary model, then a fallback chain across model aliases (<code>gemini-flash-latest → flash-lite → 2.0-flash</code>). Aliases, not pinned ids — pinned Gemini versions get retired for new API users."],
      ["Data anonymization", "Customer PII never reaches a prompt: <code>full_name</code> and <code>date_of_birth</code> are never selected from the database, and the model sees a pseudonym (<code>Customer CUST0000</code>). The dataset is synthetic; the anonymization step follows production practice regardless."],
      ["Prompt-injection defenses", "All account data is framed as <code>&lt;data&gt;</code> = third-party DATA, not instructions; every string is sanitized (control chars, code fences, length caps); output is forced through a JSON schema; the reviewer agent drops anything not traceable to the provided figures."],
      ["Per-agent audit trail", "Every run writes one row per agent to <code>sentinel_audit</code> (service-role only): model used, attempts, fallback, latency. The same audit returns in the response — rendered below after each analysis."],
      ["Abuse controls", "The endpoint is public by design (the anon key ships with this page), so limits are enforced in Postgres, not in-process: 8 requests/min per IP and a global daily cap via one atomic RPC."],
      ["Graceful degradation", "A failed analyst note is replaced with a neutral placeholder and the pipeline continues; if the reviewer fails, the synthesizer's draft ships flagged in the audit; only a failed synthesis aborts the run. Every fallback is visible in the per-agent audit."],
    ];

    el.innerHTML = `
      <p class="tab-intro">The Compliance Sentinel is a five-agent pipeline in a Supabase Edge
      Function: retry and fallback handling, data anonymization, prompt-injection defenses and a
      per-agent audit trail. The runner at the bottom executes a live analysis.</p>

      <div class="card">
        <h3>Pipeline</h3>
        <div class="pipeline">
          <div class="pipe-node pipe-io">POST<br>{customer_id}</div>
          <div class="pipe-arrow">&rarr;</div>
          <div class="pipe-node pipe-guard">rate limiter<br><span class="muted">Postgres RPC</span></div>
          <div class="pipe-arrow">&rarr;</div>
          <div class="pipe-node pipe-guard">anonymizer +<br>sanitizer</div>
          <div class="pipe-arrow">&rarr;</div>
          ${AGENTS.map((a) => `
            <div class="pipe-node pipe-agent ${a.tier}" data-agent="${a.name}">
              ${a.name.replace("_", "<br>")}
              <span class="muted">${a.tier === "fast" ? "flash-lite" : "flash-latest"}</span>
            </div>
            <div class="pipe-arrow">&rarr;</div>`).join("")}
          <div class="pipe-node pipe-io">JSON verdict<br>+ audit[]</div>
        </div>
        <div class="agent-cards">
          ${AGENTS.map((a) => `
            <div class="agent-card">
              <div class="agent-card-head">
                <strong>${a.name}</strong>
                <span class="pill pill-neutral">${a.tier === "fast" ? "fast tier" : "heavy tier"}</span>
              </div>
              <p>${a.role}</p>
              <p class="muted">tools: ${a.tools.map((t) => `<code>${t}</code>`).join(" ")}
                 &nbsp;·&nbsp; output: <code>${a.out}</code></p>
            </div>`).join("")}
        </div>
      </div>

      <div class="card">
        <h3>Guardrails</h3>
        <div class="defense-grid">
          ${DEFENSES.map(([t, d]) => `<div class="defense-card"><strong>${t}</strong><p>${d}</p></div>`).join("")}
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h3>Run an analysis — grounded risk narrative for one customer</h3>
          <span class="muted">~30 s: five sequential model calls over every account the customer holds</span>
        </div>
        <div class="sentinel-controls">
          <select id="sn-account" aria-label="Customer to analyze"><option value="">Select a customer…</option></select>
          <button class="btn btn-primary" id="sn-run" type="button">Analyze</button>
        </div>
        <div id="sn-progress" class="sn-progress hidden">
          ${AGENTS.map((a) => `<span class="sn-stage" data-stage="${a.name}">${a.name}</span>`).join("<span class='pipe-arrow'>&rarr;</span>")}
        </div>
        <div id="sn-output" class="sentinel-output hidden"></div>
        <div id="sn-error" class="banner banner-error hidden" role="alert"></div>
      </div>`;

    /* runner */
    const $q = (sel) => el.querySelector(sel);
    const customerOption = (s) =>
      `<option value="${escapeHtml(s.customer_id)}">${escapeHtml(s.customer_id)} · ${s.n_accounts} account${s.n_accounts > 1 ? "s" : ""}${s.never_screened ? " · never screened" : ""}</option>`;
    const sorted = [...state.data.customer_scores].sort((a, b) => a.customer_id.localeCompare(b.customer_id));
    $q("#sn-account").insertAdjacentHTML("beforeend", `
      <optgroup label="Anomalous customers">${sorted.filter((s) => s.anomaly === -1).map(customerOption).join("")}</optgroup>
      <optgroup label="Other customers">${sorted.filter((s) => s.anomaly !== -1).map(customerOption).join("")}</optgroup>`);

    const ACTION_BADGE = {
      "Close as false positive": "badge-clear",
      "Continue standard monitoring": "badge-plain",
      "Enhanced monitoring": "badge-offshore",
      "Initiate sanctions screening": "badge-offshore",
      "Request KYC refresh / documentation": "badge-offshore",
      "Escalate to compliance review": "badge-sanctioned",
    };

    $q("#sn-run").addEventListener("click", async () => {
      const accountId = $q("#sn-account").value;
      if (!accountId) return;
      $q("#sn-error").classList.add("hidden");
      $q("#sn-output").classList.add("hidden");
      $q("#sn-progress").classList.remove("hidden");
      el.querySelectorAll(".sn-stage").forEach((s) => s.classList.add("pulsing"));
      $q("#sn-run").disabled = true;
      try {
        const res = await fetch(CFG.SENTINEL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ customer_id: accountId }),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(`Sentinel request failed (${res.status}). ${detail.slice(0, 200)}`);
        }
        const r = await res.json();
        (r.audit ?? []).forEach((a) => {
          const stage = el.querySelector(`.sn-stage[data-stage="${a.agent}"]`);
          if (stage) {
            stage.classList.remove("pulsing");
            stage.classList.add(a.ok ? "done" : "failed");
            stage.innerHTML += ` <span class="muted">${(a.latency_ms / 1000).toFixed(1)}s</span>`;
          }
        });
        $q("#sn-output").innerHTML = `
          <p>${escapeHtml(r.risk_summary)}</p>
          <div class="sn-action">Recommended action:
            <span class="badge ${ACTION_BADGE[r.recommended_action] || "badge-plain"}">${escapeHtml(r.recommended_action)}</span>
            <span class="muted">· evidence ${escapeHtml(r.evidence_strength ?? "?")} —
            ${r.signal_families ? `${r.signal_families.present} of ${r.signal_families.total} signal families` : ""}</span>
          </div>
          <strong>Key factors</strong>
          <ul class="sn-factors">${(r.key_factors || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>
          <strong>Next steps</strong>
          <ul class="sn-factors">${(r.next_steps || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          ${r.signal_families?.list?.length ? `<p class="muted">Signals present: ${r.signal_families.list.map(escapeHtml).join(" · ")}</p>` : ""}
          <strong>Per-agent audit (run ${escapeHtml(r.run_id ?? "")})</strong>
          <div class="table-wrap"><table>
            <thead><tr><th>Agent</th><th>Model used</th><th class="num">Attempts</th><th>Fallback</th><th class="num">Latency</th><th>OK</th></tr></thead>
            <tbody>${(r.audit ?? []).map((a) => `
              <tr><td>${escapeHtml(a.agent)}</td><td><code>${escapeHtml(a.model_used ?? "—")}</code></td>
              <td class="num">${a.attempts}</td><td>${a.fallback_used ? '<span class="badge badge-offshore">fallback</span>' : "no"}</td>
              <td class="num">${(a.latency_ms / 1000).toFixed(1)}s</td>
              <td>${a.ok ? "✓" : '<span class="badge badge-sanctioned">failed</span>'}</td></tr>`).join("")}
            </tbody>
          </table></div>
          <details class="notes">
            <summary>Audit column definitions</summary>
            <p><strong>Model used</strong> — the model that actually answered (differs from the
            requested one when the fallback chain engaged). <strong>Attempts</strong> — calls
            made including retries. <strong>Fallback</strong> — whether a backup model rescued
            the step. <strong>Latency</strong> — wall time for the agent including retries.
            The same audit row is persisted server-side in <code>sentinel_audit</code>.</p>
          </details>`;
        $q("#sn-output").classList.remove("hidden");
      } catch (err) {
        $q("#sn-error").textContent = err.message;
        $q("#sn-error").classList.remove("hidden");
        el.querySelectorAll(".sn-stage").forEach((s) => s.classList.remove("pulsing"));
      } finally {
        $q("#sn-run").disabled = false;
      }
    });
  },
};
