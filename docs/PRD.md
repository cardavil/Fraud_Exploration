# PRD — Fraud & Compliance Exploration Board

Product definition for the public fraud-and-compliance exploration board.
Canonical terminology and code/documentation rules are in [CONVENTIONS.md](CONVENTIONS.md);
the technical design is in [TRD.md](TRD.md).
Document date: 2026-07-14. The code is the source of truth (CONVENTIONS §3): every claim
below is written to match the deployed frontend (`app/`) and Edge Function
(`supabase/functions/sentinel/index.ts`).

---

## 1. Product context and goals

A dummy risk-and-compliance dataset (six source tables, delivered dirty: duplicate keys,
whitespace, inconsistent casing, empty PEP flags) conceals material findings — an escalation
gap, unresolved sanctions matches, structuring under the reporting threshold, unenforced
account-status controls, and mis-calibrated monitoring. The classic deliverable (a dashboard
plus an executive summary) shows the result but not the process.

This product is a **two-layer portfolio project**:

- **Layer 1 — the mandated deliverable.** A Power BI report (four pages) plus a concise
  executive summary of the headline insights. It must stand alone.
- **Layer 2 — the differentiator.** A live "Fraud & Compliance Exploration Board": a static
  frontend on Cloudflare Pages over a read-only Supabase Postgres serving layer, plus a
  Gemini-backed "Compliance Sentinel" Edge Function. The Power BI report is **embedded as the
  board's first tab**, so both layers are reachable from one surface.

**Goals**

- Make the full analytical path inspectable end to end: raw data → audited cleaning →
  descriptive statistics → interpretable anomaly detection → a grounded AI risk narrative.
- Keep every published figure reproducible and traceable to the code that computes it.
- Serve everything read-only from a public serving layer that is safe to expose.
- Demonstrate a production-shaped AI pipeline (least-privilege tools, PII anonymization,
  injection defenses, deterministic evidence scoring, audit trail) on synthetic data.

**Standing disclaimer.** No affiliation with any payments company; the dataset is 100% dummy;
no real customer data is present. The headline insights live in the README "Key findings"
section and in the board's Findings tab (there is no separate findings document).

### Architecture

```
analysis/clean.py ──► clean data ──► analysis/anomaly.py + account_features.py ──► three-tier scores
        │  (every treatment audited to cleaning_log)                                       │
        └──────────────────────────► supabase/seed.sql ◄──────────────────────────────────┘
                                             │
                                             ▼
                         Supabase Postgres  (RLS: SELECT-only for anon)
                            │                                     ▲
                  anon key  │ (SELECT only)                       │ service role
                            ▼                                     │
          Board — static frontend (Cloudflare Pages)      sentinel Edge Function ──► Gemini API
                            │                                     ▲
                            └──── POST { customer_id | account_id } ┘
```

## 2. Functional model — who sees what, who does what

| Actor | Sees | Does | Does NOT |
|---|---|---|---|
| **Visitor** | All seven tabs; the embedded Power BI report; the live KPI surface; the raw source tables and the cleaned/scored tables; charts; the ML model tiers; the Sentinel pipeline | Navigates by hash; explores and filters the raw source tables; opens KPI popups; drills from a finding into the explorer; runs the Sentinel on a customer | Writes nothing; does not authenticate; never sees PII (data is dummy and the Sentinel additionally pseudonymizes the customer) |
| **Board / frontend** | The 10 cleaned tables plus the 6 raw source tables via PostgREST, and the static analysis JSON files in `app/data/` | Reads through the public anon key under RLS SELECT-only; computes the KPIs client-side; renders SVG charts and, for the account model, recomputes every score in-browser | Does not write to Postgres (no write policy, privileges revoked); does not call Gemini directly |
| **Compliance Sentinel** (Edge Function) | The profile, screening, transactions, alerts and three-tier scores for every account a customer holds, via the service role | Runs the five-agent pipeline; computes the evidence checklist; writes ONLY to `sentinel_audit` and the rate-limit counters (RPC `sentinel_hit`) | Does not write to data tables; does not expose the API key (server-side header only); does not decide — it recommends |
| **Author / operator** | The full repository, the Supabase console and Cloudflare Pages | Maintains the Python pipeline, the seed, secrets and deploys; corrects docs in the same commit as the code | Does not commit tokens or personal data; does not hand-edit served data |

## 3. The seven tabs and their purpose

The board renders seven tabs, in this order. The default landing tab is **Power BI**; each tab
is addressable by hash and rendered lazily on first activation.

| Tab | Hash | Purpose | Data source |
|---|---|---|---|
| **Power BI** | `#powerbi` | Default tab. Embeds the published Layer-1 report (Publish-to-web) in a responsive frame, with an "open full screen" link | `POWERBI_URL` embed (`app/config.js`) |
| **EDA** | `#eda` | The data explorer. Step 1 (Database) browses the six raw source tables with on-demand filters and sortable columns (Rows view) and profiles each column — type, completeness, uniques, primary key, empties (Profile view). Step 2 summarizes the data-quality issues computed live on the raw source. Drill-downs from Findings land here | Raw source tables in `state.raw` |
| **ETL** | `#etl` | The audited cleaning, applied in response to what the EDA surfaced. The treatment log is served live from the `cleaning_log` table; each treatment expands into real before/after examples; the tab closes with an integrity panel (counts, foreign keys, duplicate keys, empties) computed live over the cleaned data | `cleaning_log` + cleaned tables + `app/data/cleaning_examples.json` |
| **DSS** | `#dss` | Descriptive and sampling statistics over the cleaned data: transaction-amount descriptives, distributions and monthly trends, and categorical association / rank correlation (Cramér's V, Spearman) | `app/data/eda_stats.json` |
| **Findings** | `#findings` | The KPI surface — eight live tiles, each opening a popup with its definition, the exact formula interpolated with live values, and why it matters — followed by thematic finding cards, each with an evidence chart and a "how to read" note and, where applicable, a drill-down into the EDA explorer | Cleaned tables (client-computed KPIs) + `eda_stats.json` |
| **ML Model** | `#ml` | Three-tier anomaly detection: Tier 1 (transaction level), Tier 2 (account level, with method, parameter sensitivity, validation, results, and in-browser verification and account detail), and Tier 3 (customer level, with the customer ranking). A "Customer overview" modal is the single customer-level view, opened from the account detail and from the Tier-3 ranking | Score tables + `app/data/model_sensitivity.json`, `model_validation.json`, `tier1_validation.json`, `tier3_validation.json` |
| **AI Engine** | `#engine` | The Compliance Sentinel made visible: the agent pipeline, tools, model wrapper and guardrails, plus the live runner that analyzes a selected customer and renders the verdict with its per-agent audit table | Edge Function `sentinel` + `customer_scores` for the selector |

There is no "Overview" tab and no "Data" tab; the KPI surface lives at the top of Findings, and
the table explorer lives inside EDA.

The **eight KPI tiles** on Findings are: unalerted high-risk value, escalation gap, screening
coverage, false-positive rate, unresolved Critical/High, value through non-active accounts,
structuring-band share, and chargeback growth.

The **embedded Power BI report** (Layer 1) is built as four pages: Overview, Risk deep-dive,
Controls & operations, and Detection layers. Every page carries a reporting-period date slicer,
a banner and a page navigator.

## 4. Compliance Sentinel — output contract

The Edge Function (`supabase/functions/sentinel/index.ts`) forces its output schema through
Gemini's `responseSchema`; `recommended_action` is a closed enum. The pipeline identifier in the
response is `v3.1`.

**Input.** `POST { customer_id }` (`CUST0000`, matched against `^CUST\d{4}$`) OR
`{ account_id }` (`ACC00000`, matched against `^ACC\d{5}$`). The subject of the analysis is
always the **customer**: an `account_id` resolves to its holder, and the pipeline then sees all
of that holder's accounts. An account with no holder returns 404; a KYC-only customer with no
accounts returns 404.

**Response JSON.**

```json
{
  "risk_summary": "2-4 sentences, most material facts first, quantified",
  "key_factors": ["one quantified bullet per distinct risk"],
  "recommended_action": "one of the six-action ladder (enum)",
  "next_steps": ["2-4 concrete steps citing specific transactions, dates or gaps"],
  "evidence_strength": "strong | moderate | limited",
  "signal_families": { "present": 3, "total": 7, "list": ["family (detail)", "..."] },
  "run_id": "uuid of the run",
  "subject": "CUST0000",
  "pipeline": "v3.1",
  "audit": [
    {
      "agent": "profile_analyst",
      "model_used": "gemini-flash-lite-latest",
      "attempts": 1,
      "fallback_used": false,
      "latency_ms": 2100,
      "ok": true
    }
  ]
}
```

There is **no `confidence`** field. Evidence is expressed as `evidence_strength`, computed in
code (not self-reported by the model) and forced to win over the model's echo in the response.

**Six-action ladder** (`recommended_action` enum), least-to-most severe:

1. Close as false positive
2. Continue standard monitoring
3. Enhanced monitoring
4. Initiate sanctions screening
5. Request KYC refresh / documentation
6. Escalate to compliance review

The rubric instructs the model to choose the least severe action that manages the risk, and the
computed `evidence_strength` **caps** the severity: `limited` evidence permits only actions
1, 2, or 4 (the last only when never-screened is a present signal); `moderate` evidence
additionally permits actions 3 and 5; "Escalate to compliance review" requires `strong` evidence.

**Evidence strength** is derived from a deterministic seven-family signal checklist over the
subject's data: tier-1 outlier transactions, anomalous accounts (Tier 2), anomalous customer
model (Tier 3), cross-account structuring days, never-screened, post-match activity, and
sanctioned or non-active flows. `strong` = at least three families present including at least one
hard signal (anomalous accounts, structuring days, or post-match activity); `moderate` = at least
two; `limited` otherwise.

**Five-agent pipeline** (sequential): `profile_analyst` → `behavior_analyst` →
`anomaly_interpreter` → `risk_synthesizer` → `compliance_reviewer`. The first three run on the
fast tier (`gemini-flash-lite-latest`); the synthesizer and reviewer run on the heavy tier
(`gemini-flash-latest`). Both tiers are overridable via secrets.

```
POST { customer_id | account_id }
  -> resolve subject to the customer and all of its accounts
  -> rate limiter (Postgres RPC sentinel_hit)
  -> deterministic tool fetchers (anonymized + sanitized) + signal checklist
  -> profile_analyst -> behavior_analyst -> anomaly_interpreter          (fast tier)
  -> risk_synthesizer -> compliance_reviewer                             (heavy tier)
  -> JSON verdict + signal_families + audit[]
```

**Seven deterministic tools** feed the agents under least privilege: `profileFetcher`,
`screeningFetcher`, `txnAggregator`, `txnSampler`, `txnOutlierFetcher`, `scoreFetcher`,
`alertFetcher`. Each agent receives only the output of its declared tools.

**Graceful degradation.** If one analyst note fails, it is replaced with a neutral placeholder
and the pipeline continues; if the reviewer fails, the synthesizer's draft is shipped, flagged in
the audit; if the synthesizer fails, the run aborts with an error.

## 5. Functional requirements

**FR1 — Embedded Power BI report.** The Power BI tab is the default landing tab and embeds the
published report from `POWERBI_URL` in a responsive frame, with a full-screen link. The report is
the Layer-1 deliverable and is public by design (dummy data only).

**FR2 — Read-only serving layer.** RLS is enabled on every served table with a single SELECT
policy for `anon`; write privileges are revoked in addition to the absence of a write policy
(defense in depth). The anon key is public by design and ships in `app/config.js`.

**FR3 — Raw-source EDA explorer.** The EDA tab browses the six raw source tables (`raw_*`) with
on-demand, removable filter chips derived from the data (categorical / numeric range / date range
/ contains), sortable columns and pagination, plus a Profile view (type, completeness, uniques,
primary-key detection, empty-share badge above 20%). A data-quality summary (duplicate keys and
empty columns) is computed live on the raw source.

**FR4 — Audited ETL trail.** The ETL tab renders the cleaning log live from the `cleaning_log`
table; every treatment with recorded examples expands into a before/after table. Compliance-
relevant decisions are explicit (an empty PEP flag is recoded `Unknown`, never assumed `No`;
suspicious values are retained and flagged, not deleted). An integrity panel computed live over
the cleaned data verifies row counts against expected output and checks foreign keys, duplicate
keys and empty columns.

**FR5 — Descriptive and association statistics.** The DSS tab presents transaction-amount
descriptives, distribution and trend charts, and categorical association (Cramér's V) with rank
correlation (Spearman) for the KYC rating against behavior, each with a "how to read" note.

**FR6 — Live KPI surface with formula popups.** Each of the eight Findings tiles opens a modal
with its definition, the exact formula interpolated with the live serving-layer values, and why
it matters. Tiles and finding cards are computed client-side from the served tables.

**FR7 — Findings drill-down.** Finding cards deep-link into the EDA explorer with a target table
and pre-applied filters via `FE.openData(table, filters)`.

**FR8 — Three-tier ML model surface.** The ML tab documents and demonstrates three unsupervised
Isolation Forests (transaction, account, customer). The account model (300 trees, 8%
contamination, fixed seed, 16 features, StandardScaler) is additionally recomputed in the browser
from the served data and verified against the pipeline's served scores. A Customer overview modal
consolidates the customer-level view and offers a jump to the Sentinel.

**FR9 — Sentinel runner.** The AI Engine tab lets a visitor select a customer, run the Sentinel,
and see the risk summary, the recommended action (enum), evidence strength and signal-family
count, key factors, next steps, and the per-agent audit table (model used, attempts, fallback,
latency, ok).

**FR10 — Sentinel input validation and subject resolution.** The Edge Function accepts POST only;
the body must be `{ customer_id }` (`^CUST\d{4}$`) or `{ account_id }` (`^ACC\d{5}$`); the subject
resolves to the customer and all of the customer's accounts; unknown account or KYC-only customer
returns 404.

**FR11 — Deterministic evidence discipline.** `evidence_strength` and `signal_families` are
computed in code from the seven-family checklist and returned authoritatively, overriding the
model's echo; the action rubric caps severity by evidence strength.

**FR12 — PII anonymization.** `full_name` and `date_of_birth` are never selected from the
database; the model sees the pseudonym `Customer <id>`. The dataset is synthetic, but the pipeline
is built as though it were not.

**FR13 — Prompt-injection defenses.** All account data is wrapped as `<data>` (third-party DATA,
not instructions); every string is sanitized (control characters and code fences stripped, length
capped at 300 characters); output is forced through a JSON schema; the reviewer drops figures not
traceable to the analyst notes.

**FR14 — Rate limiting and audit persistence.** The public endpoint enforces 8 requests/min per
IP and a 250/day global cap through the atomic Postgres RPC `sentinel_hit` (not in-process); the
limiter fails open so an outage does not take the demo down. Every run writes one row per agent to
`sentinel_audit` (service role only); the same audit returns in the response.

**FR15 — Hash navigation.** Each tab is addressable by hash (`#powerbi`, `#eda`, `#etl`, `#dss`,
`#findings`, `#ml`, `#engine`); internal links and modals navigate via the hash router, and an
unknown hash falls back to the Power BI tab.

**FR16 — Figure traceability.** Every figure shown in the UI traces to the code that computes it
or to the static analysis JSON in `app/data/`. When the code changes a number, the affected doc is
corrected in the same commit (CONVENTIONS §3).

## 6. Non-goals

| Non-goal | Reason |
|---|---|
| No authentication or user management | The board is public by design; RLS makes the anon key safe |
| No writes from the UI | The system's only writes are `sentinel_audit` and the rate-limit counters, both server-side |
| No real data | The dataset is always dummy; the disclaimer is permanent |
| The Sentinel does not decide | It recommends one action from a closed enum; the decision is human |
| No self-reported model confidence | Removed in favor of code-computed `evidence_strength`; the model does not grade its own certainty |
| No hypothetical "what-if" scoring in the ML tab | The in-browser model verifies the served scores; it does not offer speculative re-scoring |

## 7. Success criteria

| Criterion | Target | How it is verified |
|---|---|---|
| Board loads from the serving layer without errors | All seven tabs render with live data; the Power BI embed loads | Manual smoke test on the Pages deploy |
| KPIs reproducible and traceable | The eight tile values match the live serving-layer computation | FR16: figure traceability |
| Writes impossible via the anon key | INSERT/UPDATE/DELETE rejected | RLS verification after seeding |
| In-browser model matches the pipeline | Every account score recomputed client-side equals the served score | ML tab in-browser verification badge |
| Sentinel completes a run | About 30 s, five agents, verdict plus per-agent audit rendered | AI Engine runner |
| Abuse contained | 429 returned past 8/min/IP or the daily cap | RPC `sentinel_hit` |
| Portfolio narrative legible | A reviewer follows the full analytical path without the repository | Walkthrough Power BI → EDA → ETL → DSS → Findings → ML Model → AI Engine |

## 8. Future evolution

| Evolution | Description |
|---|---|
| Analytical warehouse | Move heavy aggregation, feature engineering and backtesting to a dedicated warehouse (for example BigQuery or Snowflake); keep Postgres as the operational serving layer fed by curated marts |
| Fresh data | Replace the static seed with periodic ingestion so "now" is no longer fixed to the dataset's reference date |
| More connectors | Add deterministic tool fetchers for the agents (external sanctions lists, adverse media, device data) without changing the output contract (PRD §4) |
| Real PII | Masking / tokenization before both the serving layer and the model, in a controlled environment, as noted in the README |

---

## Decision record

The following decisions produced the current product and are reflected in the deployed code.
Entries describe the verified end state, not intermediate drafts.

- **Three-tier detection.** Anomaly detection runs at the transaction, account and customer
  levels with roll-up. The Sentinel's subject is the customer (aggregating all of the customer's
  accounts). KYC-only records with no accounts are excluded from scoring and reported as a
  data-governance finding.
- **Sentinel naming.** The AI agent is the "Compliance Sentinel". The Edge Function slug
  (`/functions/v1/sentinel`), the `sentinel_audit` table and the `sentinel_hit` RPC all use the
  `sentinel` name.
- **Output contract (v3.1).** `recommended_action` is a six-action ladder with an explicit rubric
  (least severe action that manages the risk; escalation gated on strong evidence). `next_steps`
  requires concrete, traceable steps. The model's self-reported `confidence` was removed and
  replaced by `evidence_strength` (strong/moderate/limited) computed in code from a deterministic
  seven-family signal checklist, with `signal_families` returned in the response.
- **Embedded Layer 1.** The Power BI report is embedded as the board's first tab, making the
  mandated deliverable and the exploration board reachable from a single surface.
