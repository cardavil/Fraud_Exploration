# MOCKUPS — Fraud & Compliance Exploration Board

ASCII wireframes of the board's screens — one per section — as implemented in
`app/index.html` and `app/js/tab-*.js`. Design tokens, components and color rules live in
[UI.md](UI.md); the logic behind each screen in [APPFLOW.md](APPFLOW.md); the technical design
in [TRD.md](TRD.md).

The board is a single page with seven tabs. Only the active tab's panel is rendered; the router
is hash-based and defaults to Power BI (`core.js:99,164`). Numbers shown in the wireframes are
representative — every tile, table and chart value is computed live from the serving layer or
loaded from the exported analysis JSON, not hard-coded in the page.

Build id in the header: `2026-07-13-r49`. Date: 2026-07-14.

---

## 1. Shell (topbar + tabbar + main + footer)

```
+-----------------------------------------------------------------------------+
| TOPBAR (navy, max-width 1560px, centered)                                   |
|  Fraud & Compliance Exploration Board                      ( Dummy data )   |
|                                            ^-- H1        ^-- neutral pill    |
+-----------------------------------------------------------------------------+
| TABBAR (sticky top:0, white surface, bottom border)                         |
|  Power BI   EDA   ETL   DSS   Findings   ML Model   AI Engine               |
|  ========                                    <- active: blue ink + 3px blue |
|                                                 bottom border               |
+-----------------------------------------------------------------------------+
|                                                                             |
|  MAIN (max-width 1560px, centered)                                          |
|  [ #global-error — hidden unless the serving layer fails to load ]          |
|  [ "Loading the serving layer…" until the reads resolve ]                   |
|  [ active tab-panel — the other six panels carry .hidden ]                  |
|                                                                             |
+-----------------------------------------------------------------------------+
| FOOTER (centered, muted):  by CARDAVIL · Repository                         |
+-----------------------------------------------------------------------------+
```

The tabbar stays pinned on scroll. Two overlays live outside `main`: the modal (backdrop +
dialog, `role="dialog" aria-modal`) used by the KPI and customer popups, and the chart tooltip.
Default tab is Power BI; deep links use the hash (`#eda`, `#ml`, …). Source: `index.html:12-64`,
`styles.css:57-68,254-269`.

## 2. Power BI (embedded report)

```
+-----------------------------------------------------------------------------+
| Fraud & Compliance dashboard                          Open full screen ->   |
|-----------------------------------------------------------------------------|
|                                                                             |
|   +---------------------------------------------------------------------+   |
|   |                                                                     |   |
|   |     [ published Power BI report, embedded in a 16:9 iframe ]        |   |
|   |         src = CFG.POWERBI_URL   (Publish-to-web embed)              |   |
|   |         allowfullscreen · lazy-loaded                               |   |
|   |                                                                     |   |
|   +---------------------------------------------------------------------+   |
|                                                                             |
+-----------------------------------------------------------------------------+
```

A single card: a head with the title and an "Open full screen ->" link (opens `POWERBI_URL` in a
new tab), and a responsive frame embedding the published four-page report. This tab is the
mandated Layer-1 deliverable, surfaced first inside the board. Source: `tab-powerbi.js:6-16`.

## 3. EDA — raw-source explorer + data quality

Two numbered steps (blue circle + title + chip). Step 1 is the explorer over the six raw source
tables (pre-cleaning); step 2 summarizes the quality issues found live on those raw tables.

```
+==(step 1)===================================================================+
| (1) Database                                        [ 6 raw source tables ] |
|                                                                             |
|  Table [ transactions (1,600) v ]   ( Rows | Profile )   The transaction... |
|                                       ^ view toggle       ^ table note      |
|  [ + Add filter… v ]  [ counterparty_country: (All v) x ] [ amount:(min/max) x ]
|   ^ on-demand picker      ^-- removable filter chip -----^                  |
|-----------------------------------------------------------------------------|
| transaction_id▲ | account_id | amount | transaction_date | ...  (sortable)  |
|-----------------+------------+--------+------------------+------------------ |
| TXN...          | ACC...     |  9,420 | 2026-06-...      | ...               |
| TXN...          | ACC...     | 12,003 | 2026-06-...      | ...               |
|   ... 25 rows per page; empty cells shown as — ...                          |
|-----------------------------------------------------------------------------|
| Page 1 of N · 1,203 of 1,600 rows              [ <- Prev ]   [ Next -> ]     |
+=============================================================================+

 --- Profile view (same step, toggled) ------------------------------------
 | Column | Type | Non-null | Unique | Min / Median / Max | Sample | Flags   |
 |--------+------+----------+--------+--------------------+--------+---------|
 | txn_id | text | 1,600/1,600 (100%) | 1,600 | —      | TXN... | [PK]    |
 | amount | number | 1,587/1,600 (99%) | 1,204 | 5 / 2,310 / 663,004 | … |  |
 | ...    | ...  | ...      | ...    | ...                | ...    | [23% empty]
 |  N columns · 1,600 rows   (Column definitions ▸)                          |

+==(step 2)===================================================================+
| (2) Data quality — raw source                       [ N duplicate keys ]    |
|                                                                             |
|  [customers: 85] [accounts: 108] [transactions: 1,612] [alerts: …] [...]    |
|                                                                             |
|  Duplicate primary keys                                                     |
|  [customers: 2] [accounts: 3] [transactions: 12] [alerts: 0] [...]          |
|    ^ red badge when > 0, green when 0                                       |
|                                                                             |
|  Empty columns                                                              |
|  [customers.pep_flag: 24% empty (20)]  [alerts.resolution_date: …]  (amber) |
+=============================================================================+
```

The explorer reads `state.raw` (raw counts, not the clean 1,600). Filters are added on demand as
removable chips — categorical -> select, number -> min/max, date -> from/to, text -> contains —
never a fixed row of every column. `FE.openData(table, filters)` from the Findings tab deep-links
here with a table and pre-applied filters. All data is read live from Supabase with a public anon
key; row-level security allows `SELECT` only. Source: `tab-eda.js:12-19,140-160,268-325`.

## 4. ETL — audited cleaning (before -> after) + integrity

Two numbered steps: the logged treatments served from the `cleaning_log` table, then a live
integrity panel over the cleaned data.

```
+==(step 1)===================================================================+
| (1) Audited cleaning — every treatment logged   [ 31 treatments · examples ]|
|                                                                             |
|  Every treatment is written to an audit trail, served live from cleaning_log|
|  An empty PEP flag is recoded Unknown, never assumed No; suspicious values  |
|  are retained and flagged rather than deleted. Click a row for its examples.|
|                                                                             |
|    | Table         | Issue                     | Treatment        | Rows |  |
|    |---------------+---------------------------+------------------+------|  |
|  ▸ | customers     | Duplicate rows [rows drop.]| deduplicated    |   2  |  |
|  ▾ | customers     | Empty PEP flag [kept&flag.]| recoded Unknown |  20  |  |
|      +---- expanded examples --------------------------------------+       |
|      | Key      | Column   | Before      | After                   |       |
|      | CUST0007 | pep_flag | (empty)     | Unknown                 |       |
|      |  ... before in red · after in green ...                     |       |
|  ▸ | transactions  | Whitespace / casing …     | normalized       |   … |  |
+=============================================================================+

+==(step 2)===================================================================+
| (2) Validation and integrity        [ counts 6/6 ✓ · FKs 0 violations ]     |
|                                                                             |
|  Row counts verified live against the pipeline's expected output:           |
|  [customers: 83 ✓] [accounts: 105 ✓] [transactions: 1,600 ✓] [alerts: 65 ✓] |
|                                                                             |
|  Integrity panel — computed live on the cleaned data                        |
|  [accounts.customer_id -> customers: 0 violations]  [transactions.account…] |
|  [customers: 0 duplicate keys]  [accounts: 0 duplicate keys]  [...]         |
|  [alerts.resolution_date: 60% empty (39)]  [ every other column < 20% empty]|
|                                                                             |
|  Notes on the amber items ▸  (empty resolution_date = unresolved backlog;   |
|  is_international unreliable — 148 sanctioned-country txns marked domestic)  |
+=============================================================================+
```

Expandable rows reveal real before -> after example tables (`cleaning_examples.json`). The
integrity checks (expected counts, foreign keys, duplicate keys, empty-column shares) are
recomputed in the browser over the clean tables. Source: `tab-etl.js:9-131`.

## 5. DSS — descriptive statistics + distributions + associations

Three numbered steps over the cleaned data. Figures come from `eda_stats.json`; charts render via
`FE.charts` with per-mark tooltips and an "ⓘ how to read" note.

```
+==(step 1)===================================================================+
| (1) Descriptive statistics — transaction amounts                            |
|                                                                             |
|  +--------------+--------------+--------------+---------------+             |
|  | n (VALID)    | MEAN         | MEDIAN       | STD DEV       |  stat-tiles |
|  | 1,587        | $11,412      | $2,310       | $28,940       |             |
|  +--------------+--------------+--------------+---------------+             |
|  | CV           | SKEWNESS     | KURTOSIS     | P95 / MAX     |             |
|  | 2.54         | +6.1         | +48.2        | $52K / $663K  |             |
|  +--------------+--------------+--------------+---------------+             |
|  The mean is ~5x the median: thresholds should key off the MEDIAN.          |
+=============================================================================+

+==(step 2)===================================================================+
| (2) Distributions and trends                              [ 4 figures ]     |
|  +-----------------------------+  +----------------------------------+      |
|  | Txns per $1,000 band        |  | Monthly txn count vs alerts      |      |
|  |  (amber spike just under    |  |  (txns triple; alerts stay flat) |      |
|  |   $10k = structuring)       |  |                                  |      |
|  +-----------------------------+  +----------------------------------+      |
|  | Monthly transaction value   |  | Monthly chargeback value         |      |
|  +-----------------------------+  +----------------------------------+      |
+=============================================================================+

+==(step 3)===================================================================+
| (3) Association and correlation             [ 5 pairs · 1 null result ]     |
|  | Variable pair                 | Cramér's V | p      | Reading           ||
|  |-------------------------------+------------+--------+-------------------||
|  | risk_rating × flagged         |   0.052    | 0.41   | KYC rating has no ||
|  |                               |            |        | association       ||
|  | counterparty_country × flagged|   0.31...  | <0.001 | Strong driver     ||
|  Risk here is categorical and geographic; the static KYC rating is          |
|  disconnected from observed behavior.  (Definitions ▸)                      |
+=============================================================================+
```

Source: `tab-dss.js:19-107`.

## 6. Findings — KPI grid + thematic deep-dives

An 8-tile KPI surface (`kpi-grid-4`, 4 columns; collapses to 2 at <=1080px, 1 at <=560px), then a
grid of seven finding cards (2 columns; 1 at <=1180px), each with an evidence chart.

```
+----------------+----------------+----------------+----------------+
|=== red ========|=== red ========|== amber =======|== amber =======|
| UNALERTED      | ESCALATION     | SCREENING      | FALSE-POSITIVE |
| HIGH-RISK VALUE| GAP            | COVERAGE       | RATE           |
| $4.32M         | 87%            | 66%            | 77%            |
| 147 sanctioned-| 357 of 409     | 28 of 83 cust. | closed alerts  |
| country txns…  | flagged txns…  | never screened | resolved as FP |
+----------------+----------------+----------------+----------------+
|=== red ========|=== red ========|== amber =======|== amber =======|
| UNRESOLVED     | VALUE THROUGH  | STRUCTURING-   | CHARGEBACK     |
| CRITICAL/HIGH  | NON-ACTIVE ACCT| BAND SHARE     | GROWTH         |
| 8              | $15.3M         | 17.4%          | 20x            |
| high-severity  | txns thru Clsd/| 276 txns in    | monthly value  |
| alerts open    | Dorm/Frozen    | $9,000–9,999   | over the window|
+----------------+----------------+----------------+----------------+

  Each tile is a <button> with a semantic top border (red .kpi-risk, amber
  .kpi-warn) and opens the KPI popup (§6a). Tile order fills row by row:
  hr, gap, screening, fp, crit, nonactive, struct, cb.

+---------------------------------+---------------------------------+
| Flagged transactions rarely     | Confirmed sanctions matches     |
| become cases                    | keep transacting                |
|  lead + "See the flagged        |  lead (post-match value moved)  |
|  transactions ->" drill link    |                                 |
|  [ hBar: escalation funnel ]    |  [ hBar: value AFTER a match ]  |
+---------------------------------+---------------------------------+
| Concentration under the $10,000 | Account-status controls are not |
| reporting threshold             | enforced                        |
|  [ bar: $9k–10k spike ]         |  drill: Dormant · Closed · Frozen
|                                 |  [ hBar: value that shouldn't   |
|                                 |    transact ]                   |
+---------------------------------+---------------------------------+
| Monitoring never scaled — and   | Detections outside single-level |
| is mis-aimed                    | monitoring                      |
|  drill: "See the open Critical  |  [ hBar: largest model-only     |
|  alerts ->"                     |    transaction detections ]     |
|  [ line: txns vs alerts ]       |                                 |
+---------------------------------+---------------------------------+
| Chargebacks are accelerating    |
|  [ line: monthly chargeback val]|
+---------------------------------+
```

The seven cards are: escalation gap, confirmed sanctions matches, structuring, account-status
controls, monitoring, cross-tier detections, chargebacks. Drill links call `FE.openData(...)` to
jump into the EDA explorer with the relevant table pre-filtered. Every card chart has hover
tooltips and an "ⓘ how to read" note. Source: `tab-findings.js:37-166,186-273`.

### 6a. KPI popup (modal)

```
        (backdrop — click outside, Esc, or [x] closes)
   +---------------------------------------------------------+
   |  Unalerted high-risk value                        [ x ] |
   |---------------------------------------------------------|
   |  Total value of transactions with counterparties in     |
   |  sanctioned or high-risk jurisdictions that never        |
   |  generated a compliance alert.                           |
   |                                                          |
   |  +-----------------------------------------------------+ |  <- live
   |  | 147 sanctioned-country txns − 0 with an alert       | |     formula
   |  | = 147 unalerted worth $4,323,306                    | |     (.modal-
   |  +-----------------------------------------------------+ |      formula)
   |                                                          |
   |  Why it matters: these are the highest-inherent-risk     |
   |  flows in the portfolio; every one was detected and       |
   |  none was escalated.                                     |
   +---------------------------------------------------------+
```

Body has exactly three parts — definition (`what`), the live formula box (same numbers as the
tile), and "Why it matters" (`why`). There is no navigation link. Source:
`tab-findings.js:168-176`.

## 7. ML Model — three tiers + validation + in-browser verification

The tab is organized into three tier headings. Between tiers 2 and 3 sit the validation card and
the in-browser verification / account-detail card.

```
=== Tier 1 — Transaction-level detection ===================================
+-----------------------------------------------------------------------------+
| Method and results        N flagged ($…) · M model-only · P% bootstrap-stable
|  Each transaction scored in context: amount vs its own account's history,   |
|  threshold band, geography, cash, status, burst timing, counterparty novelty|
|  | Transaction | Account | Amount | Score | Drivers            | Rules eng. ||
|  |-------------+---------+--------+-------+--------------------+-----------  ||
|  | TXN...      | ACC...  | $663K  | 0.71  | [50+× median][…]   |[model only]||
|  | TXN...      | ACC...  | $9,900 | 0.66  | [9–10k band][…]    |[also flag.]||
|  |  ... 10 highest-scored of the flagged transactions ...                    |
|  (Table notes — selection, driver criteria, rules-engine definitions ▸)     |
+-----------------------------------------------------------------------------+

=== Tier 2 — Account-level detection =======================================
+---------------------------------+---------------------------------+
| Model                           | Parameter sensitivity           |
|  Isolation Forest: no labels,   |  refit over contamination       |
|  mixed-scale features, every    |  {4%…12%} × trees {100,300,500} |
|  flag explainable.              |  [ line: anomalies vs contam.,  |
| Method                          |    by forest size ]             |
|  transactions + tier-1 -> 16    |  Chosen: 8% ≈ 9 of 105 accounts,|
|  features -> StandardScaler ->  |  300 trees, fixed seed.         |
|  IsolationForest(300, 0.08, 42) |                                 |
|  (Feature definitions ▸)        |                                 |
+---------------------------------+---------------------------------+
+-----------------------------------------------------------------------------+
| Validation   unsupervised: no labels, no accuracy — stability/generalization|
|  +------------------------------------+  +-------------------------------+  |
|  | Generalization (train/held-out)    |  | [ bar: score distribution     |  |
|  | Stability (Jaccard across seeds)   |  |   with the model's cutoff ]   |  |
|  | Comparison vs rule-based alerts    |  | [ hBar: feature ablation ]    |  |
|  +------------------------------------+  +-------------------------------+  |
+-----------------------------------------------------------------------------+
+-----------------------------------------------------------------------------+
| Results — 9 anomalous accounts, 5 never alerted    bootstrap: share of refits
|  ACC...  · High risk · Dormant · 12 txns · $663K   [90% of refits][Never alr.]
|  [==================________]  <- anom-score-track (fill = score / max)     |
|  Why: [value/month: $663K (14× median)] [txns/month …] [sanctioned-share …] |
|  ACC...  · Low risk · Active · 45 txns · $412K      [Has alert history]      |
|  [============____________]                                                 |
|  (Badge definitions ▸)                                                      |
+-----------------------------------------------------------------------------+
+-----------------------------------------------------------------------------+
| In-browser verification and account detail                                  |
|  [ N/M account scores recomputed in your browser match the pipeline ✓ ]     |
|  Account detail   [ ACC... (anomalous / other accounts) v ]                 |
|   <account_type> account ACC... — opened … · status … · branch …            |
|   Activity: across N days moved $… in K txns (…/month) — incl. $… on <day>.  |
|   Model assessment: score … vs cutoff … -> [anomalous] [recomputed ✓]       |
|   Alerts: the rules engine never raised an alert on this account.           |
|   (A full narrative with a recommended action is in the AI Engine tab.)     |
+-----------------------------------------------------------------------------+

=== Tier 3 — Customer-level detection ======================================
+-----------------------------------------------------------------------------+
| Method and ranking   N anomalous of M active customers · KYC-only excluded  |
|  | # | Customer      | Score | Accts | Anom | Struct | Screening    | Value ||
|  |---+---------------+-------+-------+------+--------+--------------+------- ||
|  | 1 | CUST0054 (…)  | 0.68  |   4   |  0   | [2]    |[never scrn.] | $3.9M ||
|  | 2 | CUST0079 (…)  | 0.61  |   2   | [1]  |  0     |[screened]    | $…    ||
|  |  ... top 15 ; Customer id links open the customer overview (§7a) ...      |
|  (Column definitions, method and cross-tier consistency ▸)                  |
+-----------------------------------------------------------------------------+
```

Three unsupervised Isolation Forests score risk at the transaction, account and customer level.
The account model is re-implemented in dependency-free JS and every score is recomputed in the
browser to verify it matches the pipeline. Source: `tab-ml.js:98-323,455-486`.

### 7a. Customer overview (modal)

```
   +---------------------------------------------------------------+
   |  Customer overview — CUST0054                           [ x ] |
   |---------------------------------------------------------------|
   |  <name> · <occupation> · <nationality> · <customer_type>      |
   |  KYC rating High  · PEP status unknown · onboarded … (…)      |
   |  Accounts (4) — $3.9M across all of them:                     |
   |  [ACC… · Active · anomalous] [ACC… · Active] [ACC… · Dormant] |
   |  +-----------------------------------------------------------+ |
   |  | Customer model (tier 3): score 0.68  [anomalous]          | |
   |  | structuring days: 2 · tier-1 share: … · sanctioned-value  | |
   |  | share: … · non-active-value share: …                      | |
   |  +-----------------------------------------------------------+ |
   |  Screening — never screened                                   |
   |  Accounts (4) ▸   Transactions (…) ▸   Compliance alerts (…) ▸ |
   |  Sanctions screening (…) ▸   Chargebacks (…) ▸                 |
   |  Run Sentinel on this customer ->                             |
   +---------------------------------------------------------------+
```

Opened from the tier-3 ranking and from the account-detail card. Expandable sections list every
related record (accounts, transactions, alerts, screening, chargebacks). The closing link
switches to the AI Engine tab with this customer pre-selected. Source: `tab-ml.js:327-445`.

## 8. AI Engine — pipeline + guardrails + live runner

```
+-----------------------------------------------------------------------------+
| Pipeline                                                                    |
|                                                                             |
| [POST         ] [rate limiter] [anonymizer +] [profile ] [behavior] [anomaly]
| [{customer_id}]->[Postgres RPC]->[sanitizer  ]->[analyst]->[analyst]->[interp.]
|   io (navy)      guard (amber)   guard (amber)  flash-lite flash-lite flash-lite
|                                                 (fast tier — light tint)     |
|                                                                             |
|            [risk       ] [compliance ] [JSON verdict]                       |
|         -> [synthesizer]->[reviewer   ]->[+ audit[]   ]                      |
|            flash-latest   flash-latest   io (navy)                          |
|            (heavy tier — blue)                                              |
+-----------------------------------------------------------------------------+
| profile_analyst (fast)  | behavior_analyst (fast) | anomaly_interpreter(fast)|
|  KYC & sanctions-screen. |  Transactional patterns  |  Reads all three        |
|  posture.                |  across every account.   |  detection tiers.       |
|  tools: profileFetcher,  |  tools: txnAggregator,   |  tools: scoreFetcher     |
|  screeningFetcher        |  txnSampler,             |  · output: ml_reading   |
|  · output: profile_risk  |  txnOutlierFetcher,      |                         |
|                          |  alertFetcher            |                         |
|                          |  · output: behavior_risk |                         |
| risk_synthesizer (heavy) | compliance_reviewer(heavy)                         |
|  Merges the three notes  |  QA gate: verifies every                           |
|  into one narrative +    |  figure traces to the notes,                       |
|  candidate action.       |  enforces the action enum.                         |
|  tools: (analyst notes)  |  tools: (draft + notes)                            |
|  · output: draft         |  · output: final                                   |
+-----------------------------------------------------------------------------+
| Guardrails (defense-grid, 6 cards)                                          |
|  [Model wrapper] [Data anonymization] [Prompt-injection defenses]           |
|  [Per-agent audit trail] [Abuse controls] [Graceful degradation]            |
+-----------------------------------------------------------------------------+
| Run an analysis — grounded risk narrative for one customer                  |
|   ~30 s: five sequential model calls over every account the customer holds  |
|                                                                             |
|  [ Select a customer…  (anomalous / other; "CUST… · N accounts …") v ] [Analyze]
|                                                                             |
|  profile_analyst -> behavior_analyst -> anomaly_interpreter ->              |
|      done 2.1s          done 1.8s          pulsing…                         |
|   risk_synthesizer -> compliance_reviewer                                   |
|      (pills go pulsing -> done/failed with each agent's real latency)       |
|                                                                             |
|  Risk summary: <2–4 quantified sentences>                                   |
|  Recommended action: ( Escalate to compliance review )  <- red badge        |
|      · evidence strong — 4 of 7 signal families                             |
|  Key factors:  • …  • …                                                     |
|  Next steps:   • …  • …                                                     |
|  Signals present: anomalous accounts (tier 2) · cross-account structuring…  |
|                                                                             |
|  Per-agent audit (run <uuid>)                                               |
|  | Agent              | Model used            | Attempts | Fallback | Lat | OK|
|  |--------------------+-----------------------+----------+----------+-----+--|
|  | profile_analyst    | gemini-flash-lite-lat.|    1     | no       | 2.1s| ✓|
|  | risk_synthesizer   | gemini-flash-latest   |    1     | no       | 6.4s| ✓|
|  | compliance_reviewer| gemini-flash-latest   |    2     | fallback | 9.0s| ✓|
|  (Audit column definitions ▸)                                               |
+-----------------------------------------------------------------------------+
```

The pipeline nodes mirror the Edge Function: I/O nodes in navy, the two guards (rate limiter,
anonymizer + sanitizer) in amber, the three fast agents in light tint (`flash-lite`) and the two
heavy agents in blue (`flash-latest`). The input is `POST { customer_id }`; the analysis subject
is always the customer, and the pipeline sees every account the customer holds.

The recommended-action badge uses a fixed six-step ladder — **Close as false positive**
(green) · **Continue standard monitoring** (grey) · **Enhanced monitoring**,
**Initiate sanctions screening**, **Request KYC refresh / documentation** (amber) ·
**Escalate to compliance review** (red). The output reports `evidence_strength`
(strong / moderate / limited) and the count of signal families present out of seven — not a
confidence percentage. Evidence strength is computed in code from a deterministic seven-family
checklist and caps how severe the action may be (Escalate requires `strong`). Source:
`tab-engine.js:7-27,32-103,132-161`; `supabase/functions/sentinel/index.ts:251-311,324-369,483-497`.
