/* Data explorer: every served table, filterable column by column. Filters are
   derived from the data itself — categorical columns become selects, numeric
   columns min/max, ISO dates a range. All client-side (tables are small). */
window.FE.tabs.data = {
  render(el) {
    const { state, fmtInt, fmtMoney, escapeHtml } = window.FE;
    const PAGE = 25;
    const TABLE_NOTES = {
      customers: "KYC master — one row per customer.",
      accounts: "Accounts with status and balance; FK to customers.",
      transactions: "The transaction ledger (1,600 rows).",
      compliance_alerts: "Alerts raised by the monitoring rules.",
      sanctions_screening: "Screening events; FK to customers.",
      chargebacks: "Disputes; FK to transactions/accounts.",
      account_scores: "Isolation Forest features + scores per account.",
      cleaning_log: "The audit trail of every cleaning treatment applied.",
    };
    let current = "transactions", filters = {}, page = 0;

    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const columnKind = (rows, col) => {
      const sample = rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
      if (!sample.length) return "text";
      if (sample.every((v) => typeof v === "number")) return "number";
      if (sample.every(isDate)) return "date";
      const distinct = new Set(sample);
      return distinct.size <= 25 ? "categorical" : "text";
    };

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
    }

    function mountTable() {
      el.querySelector("#dx-note").textContent = TABLE_NOTES[current];
      el.querySelector("#dx-filters").innerHTML = buildFilters();
      el.querySelectorAll("#dx-filters [data-col]").forEach((input) => {
        input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
          filters[`${input.dataset.col}::${input.dataset.kind}`] = input.value;
          page = 0;
          renderRows();
        });
      });
      page = 0;
      renderRows();
    }

    el.innerHTML = `
      <p class="tab-intro">The serving layer, raw. Every table below is read live from Supabase with
      the public anon key — row-level security only allows <code>SELECT</code>. Filters are built
      from the data itself; nothing is precomputed here.</p>
      <div class="card">
        <div class="card-head">
          <label class="table-pick">Table
            <select id="dx-table">
              ${Object.keys(TABLE_NOTES).map((t) =>
                `<option value="${t}" ${t === current ? "selected" : ""}>${t} (${fmtInt(state.data[t].length)})</option>`).join("")}
            </select>
          </label>
          <span class="muted" id="dx-note"></span>
          <span class="muted" id="dx-summary"></span>
        </div>
        <div class="filter-row wrap" id="dx-filters"></div>
        <div class="table-wrap">
          <table><thead id="dx-head"></thead><tbody id="dx-body"></tbody></table>
        </div>
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
    el.querySelector("#dx-prev").addEventListener("click", () => { page--; renderRows(); });
    el.querySelector("#dx-next").addEventListener("click", () => { page++; renderRows(); });
    mountTable();
  },
};
