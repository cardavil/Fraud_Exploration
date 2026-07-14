# APPFLOW — Fraud & Compliance Exploration Board

This document describes the four runtime flows of the system: the visitor's path through the
board, the data pipeline that carries the dummy dataset from raw SQLite to Supabase and
Cloudflare Pages, the Compliance Sentinel request end to end (including its degradation paths),
and the deploy flow. Sources: `app/index.html`, `app/config.js`, `app/js/core.js`,
`app/js/tab-*.js`, `supabase/functions/sentinel/index.ts`, `supabase/deploy_function.py`,
`supabase/rate_limit.sql`, `supabase/audit.sql`, `wrangler.toml`.
Related documents: [PRD.md](PRD.md) (product), [TRD.md](TRD.md) (technical design),
[DATABASE.md](DATABASE.md) (schema), [UI.md](UI.md) (visual system),
[MOCKUPS.md](MOCKUPS.md) (wireframes), [CONVENTIONS.md](CONVENTIONS.md) (terminology and rules).
Date: 2026-07-14. Application build: `2026-07-13-r49` (`index.html:6`).

---

## 1. Visitor flow

The board is a single-page application served as static files from Cloudflare Pages. It presents
**seven tabs** in a fixed order, led by the embedded Power BI report. Navigation is hash-based:
every tab is directly linkable (`#powerbi` … `#engine`) and each tab module renders lazily on its
first activation. The tab set and default are declared in `index.html:25-31` and `core.js:99,164`.

| # | Hash / `data-tab` | Button label | Panel and module |
|---|---|---|---|
| 1 | `powerbi`  | Power BI  | `#tab-powerbi`, `tab-powerbi.js` — default tab |
| 2 | `eda`      | EDA       | `#tab-eda`, `tab-eda.js` — the raw-data explorer |
| 3 | `etl`      | ETL       | `#tab-etl`, `tab-etl.js` |
| 4 | `dss`      | DSS       | `#tab-dss`, `tab-dss.js` |
| 5 | `findings` | Findings  | `#tab-findings`, `tab-findings.js` — the KPI surface |
| 6 | `ml`       | ML Model  | `#tab-ml`, `tab-ml.js` |
| 7 | `engine`   | AI Engine | `#tab-engine`, `tab-engine.js` — the Sentinel runner |

There is no Overview tab and no Data tab. The former data explorer is now the **EDA** tab, and
the KPI grid lives in the **Findings** tab rather than a standalone overview.

### Boot sequence (`core.js:128-171`)

```
Visitor loads the page (Cloudflare Pages serves /app)
        |
        v
FE.boot()
  1. Wire UI: tab-button clicks -> goTo(tab); window 'hashchange' -> activateTab;
     modal close button, backdrop click and Escape key.
  2. Fetch six precomputed JSON artifacts from /app/data in parallel:
       eda_stats.json, model_sensitivity.json, cleaning_examples.json,
       model_validation.json, tier1_validation.json, tier3_validation.json
     -> state.stats / sensitivity / examples / validation / tier1 / tier3
  3. Fetch the 10 clean tables from Supabase (PostgREST) in parallel, each
     paginated with Range headers (1,000 rows per page, supabaseFetchAll):
       customers, accounts, transactions, compliance_alerts, sanctions_screening,
       chargebacks, account_scores, transaction_scores, customer_scores, cleaning_log
     (transactions ordered transaction_date desc, transaction_id asc) -> state.data
  4. Fetch the 6 raw source tables in parallel (raw_customers … raw_chargebacks)
     -> state.raw  (exploration-only; analysis always reads state.data)
  5. computeKpis() -> state.kpis  (one derived-number source for the Findings
     tiles and their popups; reads state.data plus state.stats)
  6. state.ready = true; hide #global-loading;
     activateTab(location.hash.slice(1) || "powerbi")
        |
        |  on any failure in steps 2-5:
        v
  hide #global-loading; show #global-error banner with a retry link (reload)
```

The three network waves are awaited in sequence (JSON, then clean tables, then raw tables); the
requests within each wave run concurrently. Until `state.ready` is true no tab renders its body,
so a boot failure surfaces the global error banner rather than a half-populated tab.

### Tab router and lazy rendering (`core.js:97-119`)

`activateTab(name)` resolves an unknown or empty hash to `powerbi`, toggles the `active` class on
the tab buttons and the `hidden` class on the panels, and — only when `state.ready` is true and the
tab has not rendered before — calls `tabs[name].render(panel)` once and marks it `rendered`. It then
syncs the URL hash with `history.replaceState`. `goTo(name)` activates the tab and scrolls to the
top. A `hashchange` listener routes back-and-forward navigation and pasted `#hash` URLs through the
same `activateTab`.

### What each tab renders

- **Power BI** (`tab-powerbi.js`) — embeds the published report (`CFG.POWERBI_URL`, a Power BI
  "Publish to web" link) in a responsive 16:9 iframe with an "Open full screen" link.
- **EDA** (`tab-eda.js`) — the explorer over the six `raw_*` source tables (as delivered,
  pre-cleaning). Step 1 (Database) offers a table picker and two views: **Rows** (25 per page,
  sortable columns, and on-demand removable filter chips whose widget is derived from the detected
  column kind — categorical, number, date or free text) and **Profile** (per column: detected type,
  non-null share, distinct count, primary-key detection, an amber flag when more than 20% is empty,
  and min/median/max for numeric columns). Step 2 (Data quality — raw source) computes duplicate
  primary keys and empty-column warnings live on the raw tables. This tab is the deep-link target
  described below.
- **ETL** (`tab-etl.js`) — the cleaning applied in response to what EDA surfaced. Step 1 serves the
  audit trail live from the `cleaning_log` table (31 logged treatments); each treatment with
  captured examples expands to before→after rows from `cleaning_examples.json`. Step 2 validates the
  cleaned data live: row counts against the pipeline's expected totals (customers 83, accounts 105,
  transactions 1,600, compliance_alerts 65, sanctions_screening 95, chargebacks 70), foreign-key
  integrity, duplicate primary keys and empty-column warnings.
- **DSS** (`tab-dss.js`) — descriptive and sampling statistics over the cleaned data, drawn from
  `eda_stats.json`: transaction-amount descriptives, four distribution/trend charts, and a
  categorical association table (Cramér's V) with a Spearman note.
- **Findings** (`tab-findings.js`) — the live KPI surface: **eight KPI tiles**, each opening a modal
  with its definition, its exact live formula and why it matters, followed by thematic deep-dive
  cards each carrying an evidence chart. Several cards expose drill links into the EDA explorer.
  Join/filter figures are computed live via `computeKpis`; statistical figures come from
  `eda_stats.json`.
- **ML Model** (`tab-ml.js`) — the three-tier detection model. Tier 1 (transaction level) shows the
  method and a table of the highest-scored anomalous transactions with driver chips and a
  rules-engine comparison. Tier 2 (account level) documents the Isolation Forest
  (`n_estimators=300, contamination=0.08, random_state=42`, 16 features), a parameter-sensitivity
  sweep, validation checks (generalization, seed stability, convergent validity, score distribution,
  feature ablation), the ranked anomalous accounts with bootstrap confidence and never-alerted flags,
  and an in-browser verification that recomputes every account score client-side (`iforest.js`) and
  matches it against the pipeline, plus a per-account detail view. Tier 3 (customer level) ranks
  customers and opens a customer-overview modal with the full cross-table record; that modal links
  to the AI Engine tab, preselecting the customer for analysis.
- **AI Engine** (`tab-engine.js`) — the Sentinel made visible: the pipeline diagram, the five agent
  cards with their tools and outputs, the guardrail grid, and the live runner (see section 3).

### Deep-linking into the EDA explorer (`core.js:112-119`, `tab-eda.js:244-261`)

Findings deep-dive cards call `FE.openData(table, presetFilters)`. This stashes a pending preset
(`{ table, filters }`), routes to the EDA tab with `goTo("eda")`, and applies the preset. Each
filter is `{ col, kind, value }`, where `kind` is one of `categorical`, `min`, `max`, `from`, `to`
or `contains`. If the EDA tab has already rendered, `applyPreset()` runs immediately; otherwise the
tab consumes the pending preset (`peekDataPreset` / `takeDataPreset`) on its first render. The
explorer selects the target table, adds the requested filter chips and shows the filtered rows.

---

## 2. Data flow

The pipeline is reproducible end to end: each step is a re-runnable script and no number is edited
by hand. One branch produces the data served from Supabase; a second branch produces the precomputed
statistics and validation artifacts that ship as static JSON with the frontend; a third branch loads
the warehouse tables into BigQuery for the Power BI report (Layer 1).

```
data/Risk_and_compliance_dummy_dataset.db      (raw SQLite; 6 dirty source tables)
        |
        v
analysis/clean.py  --------------------------> outputs/cleaning_log.csv
        |                                       (audit trail; no silent fixes)
        v
data/clean.db      (cleaned SQLite)
        |
        +-------------------+-----------------------------+
        |                   |                             |
        v                   v                             v
THREE-TIER MODEL     STATIC ARTIFACTS               POWER BI (Layer 1)
tier1_transactions.py  export_eda_stats.py          analysis/load_bigquery.py
account_features.py    model_sensitivity.py           imports the 9 warehouse
  + anomaly.py         model_validation.py             tables into BigQuery;
tier3_customers.py     export_cleaning_examples.py     the .pbix model reads them
  |                    export_model.py                  (published, embedded in
  |  transaction /       |                               the Power BI tab)
  |  account /           v
  |  customer          app/data/*.json  (six files loaded at boot,
  |  score tables        plus the exported Isolation Forest for
  |                      in-browser verification via iforest.js)
  v                       |
SERVING LAYER             |
supabase/generate_seed.py         supabase/generate_raw_seed.py
        |                                 |
        v                                 v
supabase/seed.sql                 supabase/raw_seed.sql
  (10 clean tables incl. score       (6 raw_* source tables, pre-cleaning,
   tables + cleaning_log;             for the EDA explorer + integrity panel)
   RLS SELECT-only for anon)          |
        |                             |
        +--------------+--------------+
                       v
              supabase/apply_seed.py -> Supabase Postgres
                       |
                       v
              PostgREST /rest/v1
                       |
                       v            +--- Cloudflare Pages serves /app (static JSON branch)
              browser: FE.boot() <--+
                (merges both branches into window.FE.state)
```

Notes:

- The 10 clean tables served into `state.data` (`core.js:7-9`) are `customers`, `accounts`,
  `transactions`, `compliance_alerts`, `sanctions_screening`, `chargebacks`, `account_scores`,
  `transaction_scores`, `customer_scores` and `cleaning_log`. The three score tables are the
  outputs of the three-tier model; `cleaning_log` is the cleaning audit trail served as data.
- The 6 raw source tables served into `state.raw` (`core.js:13-14,158-160`) are `raw_customers`,
  `raw_accounts`, `raw_transactions`, `raw_compliance_alerts`, `raw_sanctions_screening` and
  `raw_chargebacks`. They exist so the EDA explorer and the ETL integrity panel can identify the
  original quality issues live.
- Row-level security allows the public `anon` role `SELECT` only, which is why the anon key ships
  safely in `app/config.js`.
- Division of responsibility: anything that is a join or filter is computed live in the browser
  (`computeKpis`, `tab-findings.js`, the ETL and EDA integrity checks); anything statistical
  (descriptives, associations, the model sensitivity sweep and validation) is precomputed and
  travels as JSON, so every figure traces back to a script.

---

## 3. Compliance Sentinel flow (end to end)

A single POST drives a five-agent pipeline inside the Supabase Edge Function
(`supabase/functions/sentinel/index.ts`, pipeline `v3.1`). The subject of the analysis is always
the **customer**: an `account_id` input resolves to its holder, and the pipeline then sees all of
that holder's accounts. The in-app runner (`tab-engine.js`) posts `{ customer_id }` with the anon
key as the bearer token.

```
POST /functions/v1/sentinel   body: { customer_id } (CUST0000) OR { account_id } (ACC00000)
  |
  |   OPTIONS ------------------> 200 (CORS: fraud-exploration.pages.dev,
  |                                    *.fraud-exploration.pages.dev, localhost:8000)
  |   method != POST -----------> 405
  |   GEMINI_API_KEY missing ---> 503
  v
VALIDATION (index.ts:443-453)
  |   body is not JSON ---------> 400
  |   matches neither
  |   ^CUST\d{4}$ nor ^ACC\d{5}$ > 400
  v
RATE LIMITER (index.ts:455-459)  RPC sentinel_hit(ip, 8/min, 250/day)  [atomic, in Postgres]
  |   over the limit -----------> 429
  |   RPC outage ---------------> FAIL OPEN (a limiter outage must not take the demo down)
  v
RESOLVE SUBJECT TO THE CUSTOMER (index.ts:461-477)
  |   account_id given -> look up holder; unknown account -> 404
  |   fetch ALL of the customer's accounts; no accounts (KYC-only record) -> 404
  v
run_id = crypto.randomUUID()
  v
BUILD SIGNAL CHECKLIST (buildSignalChecklist, index.ts:288-311)  [deterministic, in code]
  |   7 families over transaction_scores / account_scores / customer_scores:
  |     tier-1 outlier transactions · anomalous accounts (hard) ·
  |     anomalous customer model · cross-account structuring days (hard) ·
  |     never screened · post-match activity (hard) · sanctioned or non-active flows
  |   evidence_strength = strong (>=3 present incl. >=1 hard)
  |                     / moderate (>=2) / limited (else)
  v
FIVE AGENTS, SEQUENTIAL (AGENTS, index.ts:324-370)
  |   profile_analyst   (fast)  tools: profileFetcher, screeningFetcher
  |   behavior_analyst  (fast)  tools: txnAggregator, txnSampler, txnOutlierFetcher, alertFetcher
  |   anomaly_interpreter(fast) tools: scoreFetcher
  |   risk_synthesizer  (heavy) no tools; sees the three notes + the signal checklist -> draft
  |   compliance_reviewer(heavy)no tools; QA-checks the draft against the notes  -> final
  |
  |  per agent:
  |   1. run the agent's declared tools only (least privilege). The 7 deterministic tools
  |      never select full_name or date_of_birth; the customer is pseudonymized as
  |      "Customer CUST0000".
  |   2. sanitizeDeep(): strip control chars, replace code fences, cap strings to 300 chars,
  |      applied recursively to every tool payload.
  |   3. build the prompt: PERSONA + DATA_FRAME + task instruction + <data>JSON</data>
  |      (all account data framed as third-party DATA, never as instructions).
  |   4. callModel(): preferred model then fallback chain, max 3 models
  |        [gemini-flash-latest, gemini-flash-lite-latest, gemini-2.0-flash];
  |      preferred retried twice, fallbacks once; backoff 500ms * attempts;
  |      25s timeout; responseSchema JSON; temperature 0.2;
  |      API key in the x-goog-api-key header, never in the URL.
  |      (heavy tier = gemini-flash-latest, fast tier = gemini-flash-lite-latest;
  |       both overridable via the GEMINI_MODEL / GEMINI_MODEL_FAST secrets.)
  |
  |  DEGRADATION (index.ts:400-410):
  |   - an analyst note (fast) returns null -> placeholder
  |     { risk_level: "medium", assessment: "unavailable", key_points: [] };
  |     the pipeline continues and the synthesizer sees whatever exists
  |   - the reviewer returns null but a draft exists -> ship the synthesizer's draft,
  |     flagged in the audit (ok: false on its row)
  |   - the synthesizer (draft) returns null -> throw -> 500
  v
PERSIST AUDIT (persistAudit, index.ts:415-428)  INSERT into sentinel_audit (service-role only):
  |   run_id, account_id (the customer id), agent, model_used, attempts,
  |   fallback_used, latency_ms, ok — a failure here is logged, never fatal
  v
200 JSON (index.ts:483-497):
  { ...final (risk_summary, key_factors[], recommended_action, next_steps[]),
    evidence_strength,                 // code-computed value overrides the model's echo
    signal_families { present, total, list[] },
    run_id, subject, pipeline: "v3.1",
    audit[] (per agent: agent, model_used, attempts, fallback_used, latency_ms, ok) }
  (There is no `confidence` field.)
        |
        v
frontend (tab-engine.js): stages marked done/failed with latencies; the verdict renders the
recommended-action badge, evidence strength with "N of M signal families", key factors, next
steps, the signals present, and the per-agent audit table.
```

Additional detail:

- **Recommended action** is one of a fixed six-step ladder (`ACTIONS`, `index.ts:251-258`): Close as
  false positive · Continue standard monitoring · Enhanced monitoring · Initiate sanctions screening
  · Request KYC refresh / documentation · Escalate to compliance review. The `ACTION_RUBRIC`
  (`index.ts:260-271`) caps severity by evidence strength: `limited` allows only Close/Continue/
  Initiate screening; `moderate` additionally allows Enhanced monitoring and KYC refresh; Escalate
  requires `strong`. The handler overwrites the model's `evidence_strength` with the checklist's
  computed value, so the cap is deterministic.
- **The seven tools** (`TOOLS`, `index.ts:133-175`): `profileFetcher`, `screeningFetcher`,
  `txnAggregator`, `txnSampler`, `txnOutlierFetcher`, `scoreFetcher`, `alertFetcher`.
- **CORS** (`corsHeaders`, `index.ts:38-48`): the allow-list is `fraud-exploration.pages.dev`,
  any `*.fraud-exploration.pages.dev` subdomain, `localhost:8000` and `127.0.0.1:8000`; other
  origins fall back to the first allowed origin.
- **Rate limiting** is enforced in Postgres, not in-process, because edge isolates do not share
  memory. `sentinel_hit` (`supabase/rate_limit.sql`) atomically increments a per-IP minute counter
  and a global daily counter and returns whether both are within limits; the tables are
  service-role only.

---

## 4. Deploy flow

There are two independently deployed artifacts. The data serving layer is provisioned once and is
not part of either deploy.

```
FRONTEND (static site)                    SENTINEL (Edge Function)
----------------------                    ------------------------
git push to main (GitHub)                 change functions/sentinel/index.ts
        |                                         |
        v                                         v
Cloudflare Pages (Git integration)        supabase functions deploy sentinel
  builds on every push; reads               (or the repo's Management-API path:
  wrangler.toml:                             python supabase/deploy_function.py —
    name = "fraud-exploration"               multipart upload, no Docker, no CLI;
    pages_build_output_dir = "app"           auth via SUPABASE_ACCESS_TOKEN;
    (no build command)                        metadata entrypoint index.ts,
        |                                      verify_jwt: true)
        v                                         |
https://fraud-exploration.pages.dev              v
  (serves /app as-is)                     Edge Function 'sentinel' live
                                            secrets set separately:
                                              GEMINI_API_KEY (required),
                                              optional GEMINI_MODEL /
                                              GEMINI_MODEL_FAST overrides
```

Notes:

- The frontend has no build step. `wrangler.toml` only declares that the publishable root is
  `app/`; Cloudflare Pages serves those files directly and needs no local Cloudflare credentials.
- `GEMINI_API_KEY` is server-side only. It is stored as a Supabase secret and is never exposed to
  the client or committed to the repository.
- The data serving layer is provisioned once and stays fixed for the board: `apply_seed.py` loads
  `seed.sql` (the 10 clean tables with SELECT-only RLS) and `raw_seed.sql` (the 6 `raw_*` tables),
  and the guard tables are applied through the Management API — `rate_limit.sql` (the `sentinel_hit`
  RPC and its usage tables) and `audit.sql` (the `sentinel_audit` table).
