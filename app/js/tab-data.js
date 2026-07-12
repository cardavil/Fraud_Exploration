/* Data explorer: every served table, in two views.
   Rows  — the records, filterable column by column (filters derive from the
           data itself: categoricals→select, numerics→min/max, dates→range).
   Profile — one row per COLUMN: detected type, non-null share, uniques,
           min/median/max, sample values, PK badge and a >20%-empty warning.
   FE.openData(table, filters) deep-links here with filters pre-applied. */
window.FE.tabs.data = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, takeDataPreset } = window.FE;
    const PAGE = 25;
    const NULL_WARN = 0.2;     // empty share above this gets an amber badge
    const TABLE_NOTES = {
      customers: "KYC master — one row per customer.",
      accounts: "Accounts with status and balance; FK to customers.",
      transactions: "The transaction ledger (1,600 rows).",
      compliance_alerts: "Alerts raised by the monitoring rules.",
      sanctions_screening: "Screening events; FK to customers.",
      chargebacks: "Disputes; FK to transactions/accounts.",
      account_scores: "Tier 2 — Isolation Forest features + scores per account (16 features).",
      transaction_scores: "Tier 1 — contextual features + score per transaction.",
      customer_scores: "Tier 3 — subject-level features + score per active customer.",
      cleaning_log: "The audit trail of every cleaning treatment applied.",
    };
    let current = "transactions", view = "rows", filters = {}, page = 0;
    const profileCache = new Map();

    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const columnKind = (rows, col) => {
      const sample = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
      if (!sample.length) return "text";
      if (sample.every((v) => typeof v === "number")) return "number";
      if (sample.every(isDate)) return "date";
      const distinct = new Set(sample);
      return distinct.size <= 25 ? "categorical" : "text";
    };

    /* ---------- profile view ---------- */
    function profileFor(table) {
      if (profileCache.has(table)) return profileCache.get(table);
      const rows = state.data[table];
      const cols = Object.keys(rows[0] ?? {});
      const profile = cols.map((col) => {
        const values = rows.map((r) => r[col]);
        const present = values.filter((v) => v !== null && v !== undefined && v !== "");
        const uniques = new Set(present).size;
        const kind = columnKind(rows, col);
        const p = {
          col, kind,
          nonNull: present.length, total: values.length,
          emptyShare: (values.length - present.length) / values.length,
          uniques,
          isPk: uniques === present.length && present.length === values.length && col.endsWith("_id")
            && rows.length > 1 && uniques === rows.length,
          sample: [...new Set(present)].slice(0, 4),
        };
        if (kind === "number") {
          const nums = [...present].sort((a, b) => a - b);
          const mid = Math.floor(nums.length / 2);
          p.min = nums[0];
          p.median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
          p.max = nums[nums.length - 1];
        }
        return p;
      });
      profileCache.set(table, profile);
      return profile;
    }

    const fmtNum = (v) => (Math.abs(v) >= 10000 ? fmtMoney(v, true) : fmtInt(Math.round(v * 100) / 100));

    function renderProfile() {
      const profile = profileFor(current);
      el.querySelector("#dx-summary").textContent =
        `${profile.length} columns · ${fmtInt(state.data[current].length)} rows`;
      el.querySelector("#dx-head").innerHTML = `<tr>
        <th>Column</th><th>Type</th><th class="num">Non-null</th><th class="num">Unique</th>
        <th class="num">Min / Median / Max</th><th>Sample</th><th>Flags</th></tr>`;
      el.querySelector("#dx-body").innerHTML = profile.map((p) => `
        <tr>
          <td><strong>${escapeHtml(p.col)}</strong></td>
          <td><span class="badge badge-plain">${p.kind}</span></td>
          <td class="num">${fmtInt(p.nonNull)}/${fmtInt(p.total)} (${fmtPct(p.nonNull / p.total)})</td>
          <td class="num">${fmtInt(p.uniques)}</td>
          <td class="num">${p.kind === "number" ? `${fmtNum(p.min)} / ${fmtNum(p.median)} / ${fmtNum(p.max)}` : "—"}</td>
          <td class="sample-cell">${p.sample.map((v) => escapeHtml(String(v))).join(" · ")}</td>
          <td>
            ${p.isPk ? '<span class="badge badge-clear">PK</span>' : ""}
            ${p.emptyShare > NULL_WARN ? `<span class="badge badge-offshore">${fmtPct(p.emptyShare)} empty</span>` : ""}
          </td>
        </tr>`).join("");
      el.querySelector("#dx-page").textContent = "";
      el.querySelector("#dx-prev").disabled = true;
      el.querySelector("#dx-next").disabled = true;
      el.querySelector("#dx-filters").classList.add("hidden");
      el.querySelector("#dx-profile-legend").classList.remove("hidden");
    }

    /* ---------- rows view (filters + pagination) ---------- */
    function buildFilters() {
      const rows = state.data[current];
      const cols = Object.keys(rows[0] ?? {});
      filters = {};
      return cols.map((col) => {
        const kind = columnKind(rows, col);
        if (kind === "categorical") {
          const values = [...new Set(rows.map((r) => r[col]).filter((v) => v != null))].sort();
          return `<label>${escapeHtml(col)}
            <select data-col="${escapeHtml(col)}" data-kind="categorical">
              <option value="">All</option>
              ${values.map((v) => `<option>${escapeHtml(v)}</option>`).join("")}
            </select></label>`;
        }
        if (kind === "number") {
          return `<label>${escapeHtml(col)}
            <span class="range-pair">
              <input type="number" placeholder="min" data-col="${escapeHtml(col)}" data-kind="min">
              <input type="number" placeholder="max" data-col="${escapeHtml(col)}" data-kind="max">
            </span></label>`;
        }
        if (kind === "date") {
          return `<label>${escapeHtml(col)}
            <span class="range-pair">
              <input type="date" data-col="${escapeHtml(col)}" data-kind="from">
              <input type="date" data-col="${escapeHtml(col)}" data-kind="to">
            </span></label>`;
        }
        return `<label>${escapeHtml(col)}
          <input type="search" placeholder="contains…" data-col="${escapeHtml(col)}" data-kind="contains"></label>`;
      }).join("");
    }

    function applyFilters(rows) {
      return rows.filter((r) => Object.entries(filters).every(([key, val]) => {
        if (val === "" || val === null) return true;
        const [col, kind] = key.split("::");
        const v = r[col];
        if (kind === "categorical") return String(v) === val;
        if (kind === "min") return v != null && v >= Number(val);
        if (kind === "max") return v != null && v <= Number(val);
        if (kind === "from") return v != null && v >= val;
        if (kind === "to") return v != null && v <= val;
        if (kind === "contains") return String(v ?? "").toLowerCase().includes(val.toLowerCase());
        return true;
      }));
    }

    function renderRows() {
      const rows = applyFilters(state.data[current]);
      const cols = Object.keys(state.data[current][0] ?? {});
      const start = page * PAGE;
      const slice = rows.slice(start, start + PAGE);
      const amountCol = cols.find((c) => c === "amount" || c === "account_balance");
      const value = amountCol ? rows.reduce((s, r) => s + (r[amountCol] || 0), 0) : null;
      el.querySelector("#dx-summary").textContent =
        `${fmtInt(rows.length)} of ${fmtInt(state.data[current].length)} rows` +
        (value !== null ? ` · ${fmtMoney(value, true)} total ${amountCol.replace("_", " ")}` : "");
      el.querySelector("#dx-head").innerHTML =
        `<tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`;
      el.querySelector("#dx-body").innerHTML = slice.length ? slice.map((r) =>
        `<tr>${cols.map((c) => {
          const v = r[c];
          const num = typeof v === "number";
          return `<td class="${num ? "num" : ""}">${v == null ? "—"
            : num ? (Number.isInteger(v) ? fmtInt(v) : v.toFixed(3)) : escapeHtml(v)}</td>`;
        }).join("")}</tr>`).join("")
        : `<tr><td colspan="${cols.length}" class="loading-cell">No rows match the current filters.</td></tr>`;
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      el.querySelector("#dx-page").textContent = `Page ${page + 1} of ${pages}`;
      el.querySelector("#dx-prev").disabled = page === 0;
      el.querySelector("#dx-next").disabled = page >= pages - 1;
      el.querySelector("#dx-filters").classList.remove("hidden");
      el.querySelector("#dx-profile-legend").classList.add("hidden");
    }

    const renderView = () => (view === "profile" ? renderProfile() : renderRows());

    function mountTable() {
      el.querySelector("#dx-note").textContent = TABLE_NOTES[current];
      el.querySelector("#dx-table").value = current;
      el.querySelector("#dx-filters").innerHTML = buildFilters();
      el.querySelectorAll("#dx-filters [data-col]").forEach((input) => {
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
          filters[`${input.dataset.col}::${input.dataset.kind}`] = input.value;
          page = 0;
          renderRows();
        });
      });
      page = 0;
      renderView();
    }

    // Consume a deep-link preset from FE.openData (table + expressible filters).
    function applyPreset() {
      const preset = takeDataPreset();
      if (!preset) return;
      current = preset.table;
      view = "rows";
      setViewButtons();
      mountTable();
      for (const f of preset.filters) {
        const input = el.querySelector(`#dx-filters [data-col="${f.col}"][data-kind="${f.kind}"]`);
        if (!input) continue;
        input.value = f.value;
        filters[`${f.col}::${f.kind}`] = String(f.value);
      }
      renderRows();
    }
    window.FE.tabs.data.applyPreset = applyPreset;

    function setViewButtons() {
      el.querySelector("#dx-view-rows").classList.toggle("active", view === "rows");
      el.querySelector("#dx-view-profile").classList.toggle("active", view === "profile");
    }

    el.innerHTML = `
      <p class="tab-intro">The serving layer, raw. Every table is read live from Supabase with the
      public anon key — row-level security only allows <code>SELECT</code>. <strong>Rows</strong>
      shows the records with filters built from the data itself; <strong>Profile</strong> examines
      the table column by column: type, completeness, cardinality and sample values.</p>
      <div class="card">
        <div class="card-head">
          <label class="table-pick">Table
            <select id="dx-table">
              ${Object.keys(TABLE_NOTES).map((t) =>
                `<option value="${t}">${t} (${fmtInt(state.data[t].length)})</option>`).join("")}
            </select>
          </label>
          <div class="view-toggle" role="group" aria-label="View">
            <button class="btn btn-ghost active" id="dx-view-rows" type="button">Rows</button>
            <button class="btn btn-ghost" id="dx-view-profile" type="button">Profile</button>
          </div>
          <span class="muted" id="dx-note"></span>
          <span class="muted" id="dx-summary"></span>
        </div>
        <div class="filter-row wrap" id="dx-filters"></div>
        <div class="table-wrap">
          <table><thead id="dx-head"></thead><tbody id="dx-body"></tbody></table>
        </div>
        <details class="notes hidden" id="dx-profile-legend">
          <summary>Column definitions</summary>
          <p><strong>Type</strong> — detected from the data: number, date (ISO), categorical
          (25 or fewer distinct values) or text. <strong>Non-null</strong> — populated cells
          out of total rows. <strong>Unique</strong> — distinct values.
          <span class="badge badge-clear">PK</span> — 100% unique identifier column.
          <span class="badge badge-offshore">N% empty</span> — flagged when more than 20% of
          the column is empty.</p>
        </details>
        <div class="table-foot">
          <span id="dx-page" class="muted"></span>
          <div>
            <button class="btn btn-ghost" id="dx-prev" type="button">&larr; Prev</button>
            <button class="btn btn-ghost" id="dx-next" type="button">Next &rarr;</button>
          </div>
        </div>
      </div>`;

    el.querySelector("#dx-table").addEventListener("change", (e) => {
      current = e.target.value;
      mountTable();
    });
    el.querySelector("#dx-view-rows").addEventListener("click", () => { view = "rows"; setViewButtons(); renderView(); });
    el.querySelector("#dx-view-profile").addEventListener("click", () => { view = "profile"; setViewButtons(); renderView(); });
    el.querySelector("#dx-prev").addEventListener("click", () => { page--; renderRows(); });
    el.querySelector("#dx-next").addEventListener("click", () => { page++; renderRows(); });

    if (window.FE.peekDataPreset()) applyPreset();
    else mountTable();
  },
};
