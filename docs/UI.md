# UI — Fraud & Compliance Exploration Board

Visual system of the board: the application shell, the tab model and hash router, the design
tokens, the risk color semantics, the components rendered by each tab module, the chart system,
loading/error states, and accessibility. Every class, id, file, route and response field cited
here is verified against the front end (`app/index.html`, `app/config.js`, `app/styles.css`,
`app/js/core.js`, `app/js/charts.js`, `app/js/iforest.js`, and the `app/js/tab-*.js` modules) and
against the Edge Function (`supabase/functions/sentinel/index.ts`).
Sibling docs: [APPFLOW.md](APPFLOW.md) (flows) · [MOCKUPS.md](MOCKUPS.md) (wireframes) ·
[TRD.md](TRD.md) (technical design) · [PRD.md](PRD.md) (product).
Build id in the page header (`index.html:6`): `2026-07-13-r49`.

---

## 1. Application shell

The document is a single static page (`index.html`), light theme, sober-fintech. The shell is
fixed; the tab panels below it are swapped by the router. Structure, top to bottom:

```
+--------------------------------------------------------------------------------+
| .topbar (navy)                                                                 |
|   .topbar-inner  (max-width 1560px)                                            |
|     H1  Fraud & Compliance Exploration Board          .topbar-meta             |
|                                                       [ Dummy data ] (pill)    |
+--------------------------------------------------------------------------------+
| .tabbar (sticky, --surface)                                                    |
|   .tabbar-inner #tabbar                                                        |
|     Power BI  EDA  ETL  DSS  Findings  ML Model  AI Engine   (.tab-btn each)   |
+--------------------------------------------------------------------------------+
| main (max-width 1560px)                                                        |
|   #global-error  (.banner.banner-error, hidden until a boot failure)           |
|   #global-loading (.loading-cell "Loading the serving layer…")                 |
|   <section id="tab-{name}" class="tab-panel hidden">  x7 (one per tab)         |
+--------------------------------------------------------------------------------+
| footer (max-width 1560px)                                                      |
|   by CARDAVIL · Repository                                                      |
+--------------------------------------------------------------------------------+
| #modal-backdrop > #modal  (dialog, hidden until opened)                        |
| #chart-tooltip  (fixed, hidden until a chart mark or "how to read" is hovered) |
```

- **Topbar** (`index.html:12-21`, `styles.css:57-64`): `.topbar` (navy background) wraps
  `.topbar-inner` (`max-width: 1560px`), which holds the `<h1>` "Fraud & Compliance Exploration
  Board" and a `.topbar-meta` group containing a single `.pill.pill-neutral` reading "Dummy data".
  There is no subtitle element; the `.subtitle` rule (`styles.css:63`) is defined but the current
  shell does not render it.
- **Tab bar** (`index.html:23-33`, `styles.css:254-270`): `<nav class="tabbar" aria-label="Sections">`
  wraps `.tabbar-inner#tabbar` with seven `<button class="tab-btn" data-tab="…">` elements. See §2.
- **Main** (`index.html:35-46`): holds `#global-error`, `#global-loading`, and seven
  `<section id="tab-{name}" class="tab-panel hidden" aria-label="…">` panels, one per tab. Only the
  active panel has `.hidden` removed.
- **Footer** (`index.html:48-53`, `styles.css:68-69`): a single line, "by CARDAVIL &middot;"
  followed by a "Repository" link to the GitHub repo.
- **Modal** (`index.html:55-63`, `styles.css:297-318`): `#modal-backdrop.modal-backdrop` (a
  `role="presentation"` overlay) containing `#modal.modal` (`role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="modal-title"`). The modal has a `.modal-head` (`h3#modal-title` +
  `button.modal-close#modal-close` with `aria-label="Close"`) and a `#modal-body`. It is a single
  shared component, opened by `FE.openModal(title, bodyHtml)` (`core.js:89-94`). See §5.
- **Chart tooltip** (`index.html:64`): one global `#chart-tooltip.chart-tooltip`
  (`role="tooltip"`, `position: fixed`, navy background, `pointer-events: none`) shared by every
  chart mark and every "how to read" affordance. See §6.
- **Script load order** (`index.html:66-77`): `config.js`, `js/core.js`, `js/charts.js`,
  `js/iforest.js`, then the seven `js/tab-*.js` modules, then `FE.boot()`. Each tab module registers
  itself in `FE.tabs.<name>` on load; `core.js` owns shared state, Supabase reads, the router and
  the modal.
- **Public config** (`config.js`): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public; every table is
  RLS `SELECT`-only), `SENTINEL_URL` (`/functions/v1/sentinel`), and `POWERBI_URL` (a Power BI
  Publish-to-web embed URL).

## 2. Tab model and hash router

Seven tabs, in this order, each rendered by its own module and lazily on first activation
(`index.html:25-31`, `core.js:98-109`):

| # | `data-tab` | Button label | Module (`app/js/`) | Panel `aria-label` |
|---|---|---|---|---|
| 1 | `powerbi` | Power BI | `tab-powerbi.js` | Power BI report |
| 2 | `eda` | EDA | `tab-eda.js` | Exploratory data analysis |
| 3 | `etl` | ETL | `tab-etl.js` | ETL cleaning |
| 4 | `dss` | DSS | `tab-dss.js` | Descriptive statistics |
| 5 | `findings` | Findings | `tab-findings.js` | Findings |
| 6 | `ml` | ML Model | `tab-ml.js` | ML model |
| 7 | `engine` | AI Engine | `tab-engine.js` | AI engine |

- **Default tab is `powerbi`.** The router falls back to `powerbi` for an unknown name
  (`core.js:99` `if (!tabs[name]) name = "powerbi";`) and boots on `location.hash.slice(1) || "powerbi"`
  (`core.js:164`).
- **Hash routing.** `activateTab(name)` (`core.js:98-109`) toggles `.active` on the matching
  `.tab-btn`, toggles `.hidden` on the `.tab-panel` elements so only `#tab-{name}` shows, renders the
  tab on first activation (guarded by `state.ready` and the per-tab `rendered` flag), and calls
  `history.replaceState(null, "", "#{name}")` so navigation does not accumulate history entries.
  `boot()` wires each `.tab-btn` click to `goTo()` and listens for `hashchange` (`core.js:129-131`).
  Routes are `#powerbi`, `#eda`, `#etl`, `#dss`, `#findings`, `#ml`, `#engine`.
- **Deep links.** `FE.openData(table, presetFilters)` (`core.js:115-119`) navigates to `#eda` and
  hands the EDA explorer a table plus expressible filters; `FE.goTo("engine")` is used by the ML
  tab to preselect a customer in the AI Engine. Both are cross-tab, not new routes.

## 3. Design tokens

Single light theme. All custom properties are declared on `:root` in `styles.css:5-36`; values are
copied exactly below.

### 3.1 Brand

| Token | Value | Use |
|---|---|---|
| `--brand-navy` | `#0A1633` | `.topbar` background, `.chart-tooltip` background, `.pipe-io` node |
| `--brand-blue` | `#2E5BFF` | Primary action: `.btn-primary`, active tab underline, neutral `.kpi-tile` top border, `.anom-score-fill`, `.eda-step-n`, default chart series color |
| `--brand-blue-hover` | `#204AE0` | `.btn-primary:hover`, `.pill-link:hover` |
| `--brand-blue-ink` | `#1E43C9` | Blue "ink" for TEXT on light surfaces: links, active tab label (`.tab-btn.active`), `.how-btn`, `.drill-link`, `.modal-link`, `.sn-stage.pulsing` (AA-contrast where the brand blue is too light for small text) |
| `--brand-blue-disabled` | `#9DB1F2` | `.btn-primary:disabled` |

### 3.2 Surfaces and inks

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F5F7FB` | Page background (`body`) |
| `--surface` | `#FFFFFF` | Cards, tab bar, modal, selects and inputs |
| `--on-brand` | `#FFFFFF` | Text on brand blue (`.btn-primary`, `.pipe-agent.heavy`, `.eda-step-n`) |
| `--on-navy-muted` | `#B9C4DE` | Secondary text on the navy topbar (the `.subtitle` rule; not rendered in the current shell) |
| `--on-navy-soft` | `#D7DEF0` | `.pill-neutral` text on navy |
| `--navy-pill-bg` | `rgba(255, 255, 255, .12)` | `.pill-neutral` background inside the topbar |
| `--text` | `#0A1633` | Primary text ink (equals the brand navy) |
| `--muted` | `#5A6B8C` | Secondary ink: labels, notes, chart axis labels, `th` |
| `--line` | `#E3E8F2` | Borders: table rows, tab bar, inputs, chart gridlines, `.defense-card` |
| `--tint` | `#EEF1F8` | Recessive fill: `.stat-tile`, `.agent-card`, chips, `.modal-formula`, `.anom-score-track`, inactive `.sn-stage` |
| `--tint-hover` | `#F0F3FA` | `.btn-ghost:hover` |
| `--row-hover` | `#F4F7FE` | `tbody tr:hover` |

### 3.3 Risk semantics (red / amber / green)

Each risk color ships as a triplet: series color (charts/borders), `-ink` (text on light fill) and
`-bg` (badge/banner fill).

| Token | Value | Use |
|---|---|---|
| `--risk-red` | `#D64545` | "Critical" chart series; `.kpi-tile.kpi-risk` top border |
| `--risk-red-ink` | `#A83232` | Text of `.badge-sanctioned` / `.badge-flagged`, `.banner-error`, `.anom-alert-gap` ("Never alerted"), `.sn-stage.failed` |
| `--risk-red-bg` | `#FBE7E7` | Fill of `.badge-sanctioned` / `.badge-flagged`, `.banner-error`, `.sn-stage.failed` |
| `--risk-amber` | `#E8A33D` | "Warning" chart series (structuring band, 300-tree sweep line); `.kpi-tile.kpi-warn` top border |
| `--risk-amber-ink` | `#8F6210` | Text of `.badge-offshore` / `.badge-structuring`, status Closed/Frozen/Dormant, `.pipe-guard` |
| `--risk-amber-bg` | `#FBF1DD` | Fill of `.badge-offshore` / `.badge-structuring`, `.pipe-guard` |
| `--risk-green` | `#2FA36B` | Green chart series (500-tree sweep line) |
| `--risk-green-ink` | `#1E7A4D` | Text of `.badge-clear`, status Active, `.sn-stage.done` |
| `--risk-green-bg` | `#E2F3EA` | Fill of `.badge-clear` and `.sn-stage.done` |

### 3.4 Shape

| Token | Value | Use |
|---|---|---|
| `--radius` | `10px` | Radius of cards, KPI tiles, modal, `.eda-step` |
| `--shadow` | `0 1px 2px rgba(10, 22, 51, .06), 0 4px 16px rgba(10, 22, 51, .05)` | Base elevation of cards, tiles, modal and tooltip |

Note: `charts.js` mirrors three tokens as SVG constants (`INK #0A1633`, `MUTED #5A6B8C`,
`LINE #E3E8F2`, `charts.js:8`) because SVG attributes cannot read CSS custom properties. If a token
value changes in CSS, the mirror in `charts.js` must be updated to match.

## 4. Color rules

1. **Fixed semantics across the board.** Red = sanctioned / critical / failure; amber = offshore /
   warning / structuring / fallback; green = clear / done / active. The same convention governs
   badges, KPI-tile borders, chart series, and sentinel stages.
2. **A status color never appears without a text label.** The canonical component is the badge
   (`styles.css:87-99`): a 7px dot (`.badge::before`, `background: currentColor`) plus text
   ("Sanctioned", "Never alerted", "fallback", "failed", …). The dot reinforces the label; it is not
   the message.
3. **Text always wears an ink token, never a series color.** On light fill, use the `-ink` variant
   (darker, AA contrast); the series colors (`--risk-red`, `--brand-blue`, …) are reserved for chart
   marks and borders. In charts, axis labels use `MUTED` and direct labels use `INK` (`charts.js`).
4. **CVD-conscious palette.** Blue / red / amber / green are separated in luminance, and no decision
   depends on hue alone: every status carries text (rule 2), charts carry a per-mark tooltip plus a
   "how to read" affordance (§6), and emphasized marks carry a direct label.
5. **Blue distinction.** `--brand-blue` for surfaces and chart marks; `--brand-blue-ink` for blue
   text (links, active tab). `--brand-blue` is never used for small text.

## 5. Components by tab

| Component | Tab | Key CSS | Source module |
|---|---|---|---|
| Sticky tab bar | all | `.tabbar`, `.tab-btn`, `.tab-btn.active` | `core.js` (router) |
| Power BI embed | Power BI | `.pbi-frame` | `tab-powerbi.js` |
| Raw-data explorer (Rows / Profile) | EDA | `.table-pick`, `.filter-chip`, `th.sortable` | `tab-eda.js` |
| Live raw data-quality panel | EDA | `.check-row`, `.badge-*` | `tab-eda.js` |
| Audited cleaning log (expandable) | ETL | `.eda-step`, `.log-row.expandable`, `.example-table` | `tab-etl.js` |
| Integrity panel (cleaned data) | ETL | `.check-row`, `.integrity-title` | `tab-etl.js` |
| Descriptive stat tiles | DSS | `.stat-row`, `.stat-tile` | `tab-dss.js` |
| Distribution/trend charts + association table | DSS | `.chart-grid`, `table` | `tab-dss.js` |
| KPI tile + popup | Findings | `.kpi-tile`, `.modal` | `tab-findings.js` |
| Finding cards | Findings | `.findings-grid`, `.finding-card`, `.chart-slot` | `tab-findings.js` |
| Tier headings | ML Model | `.tier-heading` | `tab-ml.js` |
| Anomaly items with score track | ML Model | `.anom-item`, `.anom-score-track` | `tab-ml.js` |
| In-browser verification + account detail | ML Model | `#ml-live`, `.detail-card` | `tab-ml.js` |
| Customer overview modal | ML Model | `.modal`, `.modal-formula` | `tab-ml.js` |
| Pipeline nodes | AI Engine | `.pipeline`, `.pipe-node` | `tab-engine.js` |
| Agent cards | AI Engine | `.agent-cards`, `.agent-card` | `tab-engine.js` |
| Guardrail cards | AI Engine | `.defense-grid`, `.defense-card` | `tab-engine.js` |
| Sentinel runner + progress | AI Engine | `.sentinel-controls`, `.sn-progress`, `.sn-stage` | `tab-engine.js` |

### 5.1 Sticky tab bar with hash routing

`position: sticky; top: 0; z-index: 30` over `--surface` with a `--line` bottom border
(`styles.css:254-270`). Seven `.tab-btn` buttons; the active one carries
`border-bottom: 3px solid var(--brand-blue)` and `--brand-blue-ink` text. The router in `core.js`
keeps the active button, the visible panel and the URL hash in sync (§2). Full flow in APPFLOW §1.

### 5.2 Power BI tab (`tab-powerbi.js`)

A single `.card` with a `.card-head` (`<h3>` "Fraud & Compliance dashboard" plus an "Open full
screen" link to `CFG.POWERBI_URL`) and a `.pbi-frame` — a responsive 16:9 container
(`aspect-ratio: 16 / 9`, `styles.css:288-292`) holding an `<iframe loading="lazy" allowfullscreen>`
that embeds the published report. This tab is the embed of the Layer-1 Power BI report; it is not a
KPI overview.

### 5.3 EDA tab — raw-data explorer and live quality panel (`tab-eda.js`)

The EDA tab explores the raw source data as delivered (pre-cleaning) and surfaces its quality
issues. It reads `state.raw` (the six `raw_*` tables served into `state.raw`, `core.js:13-14,158-160`),
never the cleaned tables. Two steps, each an `.eda-step`:

**Step 1 — "Database"** (chip "6 raw source tables"). A `.table-pick` `<select>` (`#dx-table`) lists
the six raw source tables with their raw row counts, a `.view-toggle` switches between **Rows** and
**Profile**, and `#dx-note` shows the table description.

- *Rows view.* Filters are added on demand: a "+ Add filter…" picker (`#dx-add-filter.filter-add`)
  adds a column's filter as a removable `.filter-chip` (with `.filter-chip-x`); only active filters
  are shown, never a wall of every column (`tab-eda.js:140-155`). The widget is chosen from the
  column type detected by `columnKind()` on the real values:

  | Detected type | Detection rule | Generated control |
  |---|---|---|
  | Categorical | 25 or fewer distinct values | `<select>` with "All" + sorted values |
  | Number | every value parses as a number | `min` / `max` input pair (`.range-pair`) |
  | Date | every value matches `^\d{4}-\d{2}-\d{2}$` | `from` / `to` `<input type="date">` pair |
  | Text | otherwise | `<input type="search">` "contains…" |

  Filtering is entirely client-side, headers are sortable (`th.sortable`), and pagination is 25 rows
  per page. The footer (`#dx-page`) reads "Page X of Y · N of M rows"; `#dx-prev` / `#dx-next`
  disable at the extremes.
- *Profile view.* One row per column: detected type (a `.badge-plain`), non-null count (n / total
  and %), unique count, min / median / max for numeric columns, a sample of up to four values, and
  flag badges — a `.badge-clear` "PK" for a 100%-unique `_id` column and a `.badge-offshore`
  "N% empty" when more than 20% of the column is empty. The footer reads "N columns · M rows".

**Step 2 — "Data quality — raw source"** (chip "N duplicate keys"). Computed live over the raw
tables: row-count badges per table, duplicate-primary-key badges (`.badge-sanctioned` when any,
`.badge-clear` when none), and `.badge-offshore` "N% empty" badges for columns above the 20% empty
threshold.

Deep links: `FE.openData(table, presetFilters)` opens this tab with the table selected and the
expressible filters pre-applied (categorical value, min/max, from/to, contains) via `applyPreset()`
(`tab-eda.js:245-261`); multi-value selections are not linkable.

### 5.4 ETL tab — audited cleaning and integrity (`tab-etl.js`)

Two `.eda-step` cards describing the cleaning applied in response to what the EDA surfaced.

**Step 1 — "Audited cleaning — every treatment logged"** (chip "31 treatments · expandable
examples"). The audit trail is served live from the `cleaning_log` table into a table (columns:
chevron, Table, Issue, Treatment, Rows). Rows with examples are `.log-row.expandable`; clicking one
expands an `.example-table` of real before/after values (from `cleaning_examples.json`) with
`.ex-before` / `.ex-after` cells. Each treatment carries a kind badge: `.badge-offshore`
"kept & flagged" or `.badge-plain` "rows dropped".

**Step 2 — "Validation and integrity"** (chip "counts N/6 ✓ · FKs N violations"). Clean row counts
are verified live against expected output (`.badge-clear` on match, `.badge-sanctioned` otherwise),
followed by an integrity panel computed live on the cleaned data: seven foreign-key checks, duplicate
primary-key checks per table, and `.badge-offshore` empty-column warnings, with a `details.notes`
explaining the amber items (structurally-empty `resolution_date`, and the unreliable
`is_international` flag).

### 5.5 DSS tab — descriptive and sampling statistics (`tab-dss.js`)

Three `.eda-step` cards over the cleaned data; figures come from `eda_stats.json`, charts render via
`window.FE.charts`.

**Step 1 — "Descriptive statistics — transaction amounts."** A `.stat-row` of eight `.stat-tile`
elements (n valid amounts, mean, median, std dev, CV, skewness, excess kurtosis, P95 / max).

**Step 2 — "Distributions and trends"** (chip "4 figures"). A `.chart-grid#dss-charts` with four
charts: a `barChart` of the $1,000 amount bands around the reporting threshold, and three
`lineChart`s (monthly transaction count vs alerts created, monthly transaction value, monthly
chargeback value).

**Step 3 — "Association and correlation"** (chip "5 pairs · 1 null result"). A table of variable
pairs (Cramér's V, p, reading) with a `details.notes` defining Cramér's V and Spearman's ρ.

### 5.6 Findings tab — KPI surface and thematic cards (`tab-findings.js`)

**KPI surface.** A `.kpi-strip.kpi-grid-4` (four columns; `styles.css:293-295`) of eight
`<button class="kpi-tile …">` tiles. Each tile is a real, focusable button with a 3px semantic top
border (`.kpi-risk` red, `.kpi-warn` amber, neutral blue), an uppercase `.kpi-label`, a
`.kpi-value` at 1.9rem with `font-variant-numeric: tabular-nums`, and a `.kpi-note`. The eight
tiles are: Unalerted high-risk value (risk), Escalation gap (risk), Screening coverage (warn),
False-positive rate (warn), Unresolved Critical / High (risk), Value through non-active accounts
(risk), Structuring-band share (warn), Chargeback growth (warn).

**KPI popup.** Clicking a tile opens the shared modal (`openModal`) with three blocks and no
navigation link (`tab-findings.js:168-176`): a definition paragraph (`what`), a live formula in
`.modal-formula` (computed from the same `computeKpis()` numbers that render the tile — a single
source), and a "Why it matters" paragraph.

**Finding cards.** A `.findings-grid` (`repeat(2, minmax(0, 1fr))`, collapsing to one column at
1180px) of seven `.finding-card` cards: gap, sanctions, structuring, controls, monitoring,
crosstier, chargebacks. Each has an `<h3>`, a lead paragraph with the key numbers in `<strong>`, an
optional `.drill-row` of `.drill-link` deep links into the EDA explorer, and a `.chart-slot`
(`#fc-{id}`) holding its evidence chart (§6).

### 5.7 ML Model tab — three tiers, validation and live scoring (`tab-ml.js`)

Sections are separated by `.tier-heading` bars.

- **Tier 1 — Transaction-level detection.** A `.card` with method and results and a table of the
  ten highest-scored transactions (transaction, account, amount, score, driver `.why-chip`s,
  rules-engine badge), with a `details.criteria-legend` documenting the driver criteria.
- **Tier 2 — Account-level detection.** An `.ml-grid` of two cards (the Isolation Forest model and
  its 16-feature method; parameter sensitivity with a sweep `lineChart` at `#ml-sweep`), a
  validation card (generalization, stability, comparison with rule alerts; charts at `#ml-scoredist`
  and `#ml-ablation`), a results card listing anomalous accounts, and an in-browser verification
  card (`#ml-live`).
  - *Anomaly items* (`.anom-item`): a top row with the account id (`.anom-id`, bold), `.anom-meta`,
    and on the right a bootstrap-confidence badge plus either a `.badge-plain` "Has alert history"
    or a `.anom-alert-gap` "Never alerted" (red ink). Below, `.anom-score-track` is a 6px bar over
    `--tint` whose `.anom-score-fill` (`--brand-blue`) width is proportional to `score / maxScore`,
    with `role="img"` and an `aria-label` carrying the score (§8). A "Why:" line follows with
    `.why-chip`s naming the features that deviate most from the population median.
  - *In-browser verification* (`#ml-live`, `tab-ml.js:488-598`): the exported forest
    (`data/isolation_forest.json`, loaded by `iforest.js`) recomputes every account score in the
    browser and reports how many match the served pipeline scores, plus an account-detail panel with
    a `#detail-account` select and a `.detail-card` narrative.
- **Tier 3 — Customer-level detection.** A `.card` with a ranking table of the top customers;
  the customer id is a `.drill-link.cust-open` that opens the customer overview modal.

**Customer overview modal** (`openCustomerOverview`, `tab-ml.js:327-445`). The single customer-level
view, reusing the shared modal component. Opened from (a) the "Customer overview" link in the Tier-2
account detail and (b) a customer id in the Tier-3 ranking. Contents: identity and KYC, all of the
customer's accounts as status badges (with an anomalous marker) and total value, the Tier-3 customer
model in a `.modal-formula` (score, structuring days, tier-1 share, sanctioned-value share,
non-active-value share, post-match value), a screening summary, collapsible per-table record
sections (accounts, transactions, compliance alerts, sanctions screening, chargebacks), and a
`.modal-link` "Run Sentinel on this customer" CTA that closes the modal, navigates to the AI Engine
tab, and preselects the customer in `#sn-account`.

### 5.8 AI Engine tab — the Compliance Sentinel (`tab-engine.js`)

Three cards plus a live runner.

**Pipeline** (`.pipeline`, a flex row of `.pipe-node` boxes joined by `.pipe-arrow` "→"):

| Class | Fill | Role |
|---|---|---|
| `.pipe-io` | navy / white | input `POST {customer_id}` and output `JSON verdict + audit[]` |
| `.pipe-guard` | `--risk-amber-bg` / `-ink` | rate limiter (Postgres RPC) and anonymizer + sanitizer |
| `.pipe-agent.fast` | `--tint` / `--text` | the three analysts (flash-lite tier) |
| `.pipe-agent.heavy` | `--brand-blue` / `--on-brand` | synthesizer and reviewer (flash-latest tier) |

The five agent nodes, in order, mirror the Edge Function pipeline (`index.ts:324-370`):
`profile_analyst` → `behavior_analyst` → `anomaly_interpreter` (fast tier) →
`risk_synthesizer` → `compliance_reviewer` (heavy tier).

**Agent cards** (`.agent-cards`, `repeat(auto-fit, minmax(230px, 1fr))`): one `.agent-card` per agent
with an `.agent-card-head` (name + a `.pill.pill-neutral` "fast tier" / "heavy tier"), the role in
prose, and a muted line listing `tools:` and `output:` in `<code>`.

**Guardrail cards** (`.defense-grid` of six `.defense-card`): model wrapper, data anonymization,
prompt-injection defenses, per-agent audit trail, abuse controls, graceful degradation.

**Runner** ("Run an analysis — grounded risk narrative for one customer"). A `.sentinel-controls`
row with a `#sn-account` `<select>` (`aria-label="Customer to analyze"`, an "Anomalous customers" and
an "Other customers" optgroup, options `CUST… · N account(s)[· never screened]`) and a
`.btn.btn-primary#sn-run` "Analyze". Below: `#sn-progress.sn-progress` (one `.sn-stage` pill per
agent, joined by arrows), `#sn-output.sentinel-output`, and `#sn-error.banner.banner-error`.

- *Request.* On "Analyze", the page POSTs to `SENTINEL_URL` with body `{ customer_id }`
  (`tab-engine.js:117`) — the selected id is a customer id. The Edge Function accepts either
  `{ customer_id }` (`CUST0000`) or `{ account_id }` (`ACC00000`); an `account_id` resolves to its
  holder and the pipeline then analyzes all of the holder's accounts (`index.ts:443-477`).
- *Response fields rendered* (`index.ts:483-497`, `tab-engine.js:132-161`): `risk_summary`
  (paragraph); `recommended_action` in a `.sn-action` badge mapped by `ACTION_BADGE` over the
  six-action ladder — Close as false positive (`.badge-clear`), Continue standard monitoring
  (`.badge-plain`), Enhanced monitoring / Initiate sanctions screening / Request KYC refresh /
  documentation (`.badge-offshore`), Escalate to compliance review (`.badge-sanctioned`); a muted
  line "evidence {evidence_strength} — {present} of {total} signal families"; `key_factors[]` and
  `next_steps[]` as `.sn-factors` lists; the `signal_families.list[]` as a "Signals present:" line;
  and a per-agent audit table from `audit[]` (agent, `model_used`, attempts, fallback, latency, OK)
  labelled with the `run_id`. There is no `confidence` field; `evidence_strength`
  (strong / moderate / limited) is computed in the Edge Function from a seven-family signal checklist
  and overwrites the model's echo (`index.ts:485-486`).
- *Progress.* On run, every `.sn-stage` gains `.pulsing`; as `audit[]` returns, each stage drops
  `.pulsing` and gains `.done` (green) or `.failed` (red) per its `ok` flag, with the per-agent
  latency appended.

## 6. Charts (`app/js/charts.js`)

Hand-rolled SVG, no libraries (CSP-safe). Three shapes, one interaction system. `window.FE.charts`
exposes `barChart`, `hBarChart`, `lineChart`, `showTip`, `hideTip`.

### 6.1 Common rules

- **Fine marks.** Rects use `rx=3`; vertical bars are capped at 46px wide (`min(46, slot*0.66)`);
  horizontal bars are 18px tall; lines use `stroke-width: 2`.
- **Recessive gridlines.** Horizontal only, base plus three divisions, `stroke #E3E8F2` at 1px, with
  a value label in `MUTED` (11px) on the left. No drawn axes or ticks.
- **Per-mark hover tooltip.** Each mark listens for `mousemove` / `mouseleave` and uses the single
  global `#chart-tooltip` (`position: fixed`, navy, white text, `role="tooltip"`,
  `pointer-events: none`), positioned +14px from the cursor and flipped near the viewport edges
  (`charts.js:10-22`).
- **"How to read" affordance.** `figure()` mounts a `figcaption` with the title and a `.how-btn`
  ("ⓘ how to read", `aria-label="How to read this chart"`) on every chart; clicking it shows the
  explanation in the same tooltip, dismissed by the next document click (`charts.js:25-41`).
- **Legend only with 2+ series** (applies to `lineChart`): 10px `rx 3` chips plus name.
- **Selective direct labels.** Only marks with `emphasize: true` carry the value directly (above the
  vertical bar in bold `INK`; at the end of the horizontal bar in bold `INK` vs normal `MUTED` for
  the rest).

### 6.2 `barChart` — vertical bars (`charts.js:56-91`)

| Spec | Value |
|---|---|
| ViewBox | 640 × 260; margins t14 r10 b40 l54 |
| Y scale | 0 → max(values) × 1.08 |
| Bar | width `min(46, slot × 0.66)`, `rx 3`, minimum height 1px, fill `d.color \|\| #2E5BFF` |
| X label | under each bar, `MUTED` 11px |
| Use | structuring band ($9k band amber + emphasize), model score distribution, feature ablation |

### 6.3 `hBarChart` — horizontal bars (`charts.js:94-117`)

| Spec | Value |
|---|---|
| Geometry | 640 wide, 34px per row; margins l150 (labels) r70 (values) |
| Bar | height 18, `rx 3`, width proportional to max, minimum 2px |
| Labels | category at left in `INK` 12px; value at the right of the bar |
| Use | escalation funnel, post-match value per customer, value by account status, largest model-only transactions |

### 6.4 `lineChart` — multi-series, single axis (`charts.js:120-164`)

| Spec | Value |
|---|---|
| ViewBox | 640 × 260; margins t14 r12 b40 l54 |
| Y scale | one shared axis for every series: global max × 1.1 (never dual axis) |
| X labels | sampled every `ceil(n/8)` points, `MUTED` 10.5px |
| Points | visible dot r2.5 in the series color + an invisible r8 hit circle for comfortable hover |
| Legend | only when `series.length >= 2` |
| Use | transactions vs alerts (blue/red), monthly value, chargebacks, the model sweep (three lines blue/amber/green) |

## 7. States

| State | Trigger | Presentation |
|---|---|---|
| Global loading | `boot()` fetching the data JSON + Supabase tables | `#global-loading` (`.loading-cell`) "Loading the serving layer…"; the tab panels stay hidden |
| Global error with retry | any `boot()` failure | `#global-error` (`.banner.banner-error`, `role="alert"`) with the escaped message and a "retry" link that reloads the page (`core.js:167-169`) |
| Skeleton | utility available | `.skeleton::after` shimmer (1.4s translucent gradient), defined in `styles.css` for surfaces mid-load |
| Empty table | filters match no rows | a single `.loading-cell` cell spanning all columns: "No rows match the current filters." (`tab-eda.js:218`) |
| Sentinel running | "Analyze" clicked | `#sn-run` disabled (`--brand-blue-disabled`), stages `.pulsing` (§5.8); the `.spinner` utility is available for inline loads |
| Sentinel failure | non-OK response or exception | `#sn-error` (`.banner.banner-error`) with the status and detail truncated to 200 chars; stages stop pulsing (`tab-engine.js:119-121,163-166`) |
| Pagination extremes | first / last page | `#dx-prev` / `#dx-next` disabled (ghost, `tab-eda.js:228-229`) |

## 8. Accessibility

- **Visible focus.** `:focus-visible` on `.kpi-tile` gives `outline: 2px solid var(--brand-blue)`
  with offset (`styles.css:121`); selects and inputs get a blue outline on `:focus`
  (`styles.css:151, 429`).
- **Modal.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-title"`; on open, focus
  moves to the close button (`aria-label="Close"`, `core.js:93`); it closes on **Esc** (global
  keydown listener, `core.js:136`) and on a **click outside** (only when the target is the backdrop,
  `core.js:133-134`).
- **Score tracks.** `role="img"` + `aria-label="Anomaly score N.NN"` (`tab-ml.js:239`): the visual
  bar has a text equivalent for screen readers.
- **ARIA labels.** `nav aria-label="Sections"`; each tab `section` has an `aria-label`; the
  how-to-read button uses `aria-label="How to read this chart"`; the sentinel select uses
  `aria-label="Customer to analyze"` and the ML account-detail select uses
  `aria-label="Account to inspect"`; `#chart-tooltip` has `role="tooltip"`; error banners use
  `role="alert"`. A `.visually-hidden` utility is available.
- **Native semantics.** Tiles and tabs are real `<button>` elements; tables use `thead` / `th`.
- **Full-width usage.** `max-width: 1560px` on the topbar inner, tab bar inner, `main` and footer —
  content uses wide screens, and grids collapse by breakpoint (1180px findings/ml → 1 column;
  1080px KPI grids → 2 columns and two-col/chart grids → 1 column; 900px stat rows and defense grid
  → 2 columns; 560px KPI grids and defense grid → 1 column). Wide tables scroll inside `.table-wrap`
  (`overflow-x: auto`), never the page.
- **Comparable numbers.** `tabular-nums` on KPI values, stat tiles, numeric table cells, and the
  formula box (`styles.css:125, 366, 174, 316`).
