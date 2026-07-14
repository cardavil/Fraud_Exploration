/* EDA: explore the raw source data (as delivered, pre-cleaning) and surface its
   quality issues — the phase that decides what the ETL must fix.
   Step 1 (Database) is the explorer: Rows browses the records with on-demand
   filters and sortable columns; Profile assesses each column (type, completeness,
   uniques, PK, empties). Step 2 (Data quality) summarizes the issues found live
   on the raw tables. FE.openData(table, filters) deep-links here with filters. */
window.FE.tabs.eda = {
  render(el) {
    const { state, fmtInt, fmtMoney, fmtPct, escapeHtml, takeDataPreset } = window.FE;
    const PAGE = 25;
    const NULL_WARN = 0.2;     // empty share above this gets an amber badge
    const TABLE_NOTES = {
      customers: "Customer master (KYC).",
      accounts: "Accounts with status and balance.",
      transactions: "The transaction ledger.",
      compliance_alerts: "Alerts raised by the monitoring rules.",
      sanctions_screening: "Screening events.",
      chargebacks: "Disputes.",
    };
    let current = "transactions", view = "rows", filters = {}, page = 0;
    let activeCols = [], sort = { col: null, dir: 1 };
    const profileCache = new Map();

    /* ---------- data-quality summary: computed live on the raw source ---------- */
    const PKS = { customers: "customer_id", accounts: "account_id", transactions: "transaction_id",
      compliance_alerts: "alert_id", sanctions_screening: "screening_id", chargebacks: "chargeback_id" };
    const rawDupResults = Object.entries(PKS).map(([table, pk]) =>
      ({ table, dupes: state.raw[table].length - new Set(state.raw[table].map((r) => r[pk])).size }));
    const rawNullWarnings = [];
    for (const table of Object.keys(PKS)) {
      const rows = state.raw[table];
      for (const col of Object.keys(rows[0] ?? {})) {
        const empty = rows.filter((r) => r[col] === null || r[col] === undefined || r[col] === "").length;
        if (empty / rows.length > NULL_WARN) {
          rawNullWarnings.push({ label: `${table}.${col}`, share: empty / rows.length, n: empty });
        }
      }
    }
    const rawDupTotal = rawDupResults.reduce((s, x) => s + x.dupes, 0);

    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    // Raw values arrive as text; detect type by parsing so amounts behave as
    // numbers for filtering and sorting even though the column is stored as text.
    const asNum = (v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    };
    const columnKind = (rows, col) => {
      const sample = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined && v !== "");
      if (!sample.length) return "text";
      if (sample.every((v) => asNum(v) !== null)) return "number";
      if (sample.every(isDate)) return "date";
      return new Set(sample).size <= 25 ? "categorical" : "text";
    };

    /* ---------- profile view ---------- */
    function profileFor(table) {
      if (profileCache.has(table)) return profileCache.get(table);
      const rows = state.raw[table];
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
          const nums = present.map(Number).sort((a, b) => a - b);
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
      el.querySelector("#dx-page").textContent =
        `${profile.length} columns · ${fmtInt(state.raw[current].length)} rows`;
      el.querySelector("#dx-prev").disabled = true;
      el.querySelector("#dx-next").disabled = true;
      el.querySelector("#dx-filters").classList.add("hidden");
      el.querySelector("#dx-profile-legend").classList.remove("hidden");
    }

    /* ---------- rows view: on-demand filters + sort + pagination ---------- */
    function filterWidget(col) {
      const rows = state.raw[current];
      const kind = columnKind(rows, col);
      if (kind === "categorical") {
        const values = [...new Set(rows.map((r) => r[col]).filter((v) => v != null && v !== ""))].sort();
        return `<select data-col="${escapeHtml(col)}" data-kind="categorical">
          <option value="">All</option>
          ${values.map((v) => `<option>${escapeHtml(v)}</option>`).join("")}</select>`;
      }
      if (kind === "number") {
        return `<span class="range-pair">
          <input type="number" placeholder="min" data-col="${escapeHtml(col)}" data-kind="min">
          <input type="number" placeholder="max" data-col="${escapeHtml(col)}" data-kind="max"></span>`;
      }
      if (kind === "date") {
        return `<span class="range-pair">
          <input type="date" data-col="${escapeHtml(col)}" data-kind="from">
          <input type="date" data-col="${escapeHtml(col)}" data-kind="to"></span>`;
      }
      return `<input type="search" placeholder="contains…" data-col="${escapeHtml(col)}" data-kind="contains">`;
    }

    // Filters are added on demand: a picker adds a column's filter as a removable
    // chip; only the active filters are shown, never a wall of every column.
    function renderFilters() {
      const cols = Object.keys(state.raw[current][0] ?? {});
      const available = cols.filter((c) => !activeCols.includes(c));
      const dxf = el.querySelector("#dx-filters");
      dxf.innerHTML = `
        ${available.length ? `<select id="dx-add-filter" class="filter-add">
          <option value="">+ Add filter…</option>
          ${available.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("")}
        </select>` : ""}
        ${activeCols.map((col) => `<span class="filter-chip">
          <span class="filter-chip-label">${escapeHtml(col)}</span>
          ${filterWidget(col)}
          <button class="filter-chip-x" type="button" data-remove="${escapeHtml(col)}" aria-label="Remove ${escapeHtml(col)} filter">&times;</button>
        </span>`).join("")}`;
      dxf.querySelectorAll(".filter-chip [data-col]").forEach((input) => {
        const key = `${input.dataset.col}::${input.dataset.kind}`;
        if (filters[key] != null) input.value = filters[key];
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
          filters[key] = input.value;
          page = 0;
          renderRows();
        });
      });
      const adder = dxf.querySelector("#dx-add-filter");
      if (adder) adder.addEventListener("change", (e) => {
        if (e.target.value) { activeCols.push(e.target.value); renderFilters(); }
      });
      dxf.querySelectorAll("[data-remove]").forEach((btn) => btn.addEventListener("click", () => {
        const col = btn.dataset.remove;
        activeCols = activeCols.filter((c) => c !== col);
        Object.keys(filters).forEach((k) => { if (k.startsWith(`${col}::`)) delete filters[k]; });
        page = 0;
        renderFilters();
        renderRows();
      }));
    }

    function applyFilters(rows) {
      return rows.filter((r) => Object.entries(filters).every(([key, val]) => {
        if (val === "" || val === null) return true;
        const [col, kind] = key.split("::");
        const v = r[col];
        if (kind === "categorical") return String(v).toLowerCase() === String(val).toLowerCase();
        if (kind === "min") return asNum(v) != null && asNum(v) >= Number(val);
        if (kind === "max") return asNum(v) != null && asNum(v) <= Number(val);
        if (kind === "from") return v != null && v >= val;
        if (kind === "to") return v != null && v <= val;
        if (kind === "contains") return String(v ?? "").toLowerCase().includes(val.toLowerCase());
        return true;
      }));
    }

    function renderRows() {
      const cols = Object.keys(state.raw[current][0] ?? {});
      let rows = applyFilters(state.raw[current]);
      if (sort.col) {
        rows = [...rows].sort((a, b) => {
          const na = asNum(a[sort.col]), nb = asNum(b[sort.col]);
          const r = (na !== null && nb !== null)
            ? na - nb
            : String(a[sort.col] ?? "").localeCompare(String(b[sort.col] ?? ""));
          return r * sort.dir;
        });
      }
      const numCols = new Set(cols.filter((c) => columnKind(state.raw[current], c) === "number"));
      const start = page * PAGE;
      const slice = rows.slice(start, start + PAGE);
      el.querySelector("#dx-head").innerHTML = `<tr>${cols.map((c) => {
        const ind = sort.col === c ? (sort.dir === 1 ? " ▲" : " ▼") : "";
        return `<th class="sortable ${numCols.has(c) ? "num" : ""}" data-sort="${escapeHtml(c)}">${escapeHtml(c)}${ind}</th>`;
      }).join("")}</tr>`;
      el.querySelector("#dx-body").innerHTML = slice.length ? slice.map((r) =>
        `<tr>${cols.map((c) => {
          const v = r[c];
          return `<td class="${numCols.has(c) ? "num" : ""}">${v == null || v === "" ? "—" : escapeHtml(String(v))}</td>`;
        }).join("")}</tr>`).join("")
        : `<tr><td colspan="${cols.length}" class="loading-cell">No rows match the current filters.</td></tr>`;
      el.querySelectorAll("#dx-head .sortable").forEach((th) => th.addEventListener("click", () => {
        const c = th.dataset.sort;
        if (sort.col === c) sort.dir = -sort.dir; else { sort.col = c; sort.dir = 1; }
        page = 0;
        renderRows();
      }));
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      el.querySelector("#dx-page").textContent =
        `Page ${page + 1} of ${pages} · ${fmtInt(rows.length)} of ${fmtInt(state.raw[current].length)} rows`;
      el.querySelector("#dx-prev").disabled = page === 0;
      el.querySelector("#dx-next").disabled = page >= pages - 1;
      el.querySelector("#dx-filters").classList.remove("hidden");
      el.querySelector("#dx-profile-legend").classList.add("hidden");
    }

    const renderView = () => (view === "profile" ? renderProfile() : renderRows());

    function mountTable() {
      el.querySelector("#dx-note").textContent = TABLE_NOTES[current];
      el.querySelector("#dx-table").value = current;
      filters = {}; activeCols = []; sort = { col: null, dir: 1 }; page = 0;
      renderFilters();
      renderView();
    }

    // Consume a deep-link preset from FE.openData (table + expressible filters).
    function applyPreset() {
      const preset = takeDataPreset();
      if (!preset) return;
      current = (preset.table in TABLE_NOTES) ? preset.table : "transactions";
      view = "rows";
      setViewButtons();
      el.querySelector("#dx-note").textContent = TABLE_NOTES[current];
      el.querySelector("#dx-table").value = current;
      filters = {}; activeCols = []; sort = { col: null, dir: 1 }; page = 0;
      for (const f of preset.filters) {
        if (!activeCols.includes(f.col)) activeCols.push(f.col);
        filters[`${f.col}::${f.kind}`] = String(f.value);
      }
      renderFilters();
      renderRows();
    }
    window.FE.tabs.eda.applyPreset = applyPreset;

    function setViewButtons() {
      el.querySelector("#dx-view-rows").classList.toggle("active", view === "rows");
      el.querySelector("#dx-view-profile").classList.toggle("active", view === "profile");
    }

    const step = (n, title, chip, body) => `
      <div class="eda-step">
        <div class="eda-step-head">
          <span class="eda-step-n">${n}</span><h3>${title}</h3>
          ${chip ? `<span class="eda-chip">${chip}</span>` : ""}
        </div>
        <div class="eda-step-body">${body}</div>
      </div>`;

    el.innerHTML = `
      ${step(1, "Database", "6 raw source tables", `
        <div class="card-head">
          <label class="table-pick">Table
            <select id="dx-table">
              ${Object.keys(TABLE_NOTES).map((t) =>
                `<option value="${t}">${t} (${fmtInt(state.raw[t].length)})</option>`).join("")}
            </select>
          </label>
          <div class="view-toggle" role="group" aria-label="View">
            <button class="btn btn-ghost active" id="dx-view-rows" type="button">Rows</button>
            <button class="btn btn-ghost" id="dx-view-profile" type="button">Profile</button>
          </div>
          <span class="muted" id="dx-note"></span>
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
        </div>`)}

      ${step(2, "Data quality — raw source", `${rawDupTotal} duplicate keys`, `
        <div class="check-row">${Object.keys(PKS).map((t) =>
          `<span class="badge badge-plain">${t}: ${fmtInt(state.raw[t].length)}</span>`).join(" ")}</div>
        <h4 class="integrity-title">Duplicate primary keys</h4>
        <div class="check-row">${rawDupResults.map((x) =>
          `<span class="badge ${x.dupes ? "badge-sanctioned" : "badge-clear"}">${x.table}: ${x.dupes}</span>`).join(" ")}</div>
        ${rawNullWarnings.length ? `<h4 class="integrity-title">Empty columns</h4>
        <div class="check-row">${rawNullWarnings.map((w) =>
          `<span class="badge badge-offshore">${escapeHtml(w.label)}: ${fmtPct(w.share)} empty (${fmtInt(w.n)})</span>`).join(" ")}</div>` : ""}`)}

      <p class="tab-foot">Read live from Supabase — public anon key, row-level security allows
      <code>SELECT</code> only. Browse the raw records (Rows), profile each column (Profile), and
      read the quality issues the cleaning then resolves.</p>`;

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
