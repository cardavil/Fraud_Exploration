# CONVENTIONS — Fraud & Compliance Exploration Board

Canonical terminology and the project's rules for code, documentation, and commits.
Product definition in [PRD.md](PRD.md); the analysis lives in the board's Findings tab and the
README "Key findings" section.
Document date: 2026-07-14.

---

## 1. Canonical terminology

Rule: **one concept = one term**. When a new term enters the code or a doc, this glossary is
updated in the same commit.

| Term | Meaning | Avoid |
|---|---|---|
| **board** | The complete static web app on Cloudflare Pages (`app/`) | "dashboard", "app", "site" |
| **tab** | One of the board's 7 views (Power BI, EDA, ETL, DSS, Findings, ML Model, AI Engine); an `app/js/tab-*.js` module | "page", "section", "panel" |
| **serving layer** | Supabase Postgres + PostgREST with SELECT-only RLS for anon | "backend", "the database", "API" |
| **anon key** | The frontend's public key; safe because RLS limits it to SELECT | "public API key", "token" |
| **finding** | A thematic card + chart in the Findings tab | confusing it with "insight" |
| **insight** | One of the up-to-five insights in the executive summary (surfaced in the README "Key findings" section and the board's Findings tab) — not a UI element | confusing it with "finding" |
| **KPI** | A headline metric tile on the board's Findings tab (there are 8); each opens a popup with its definition, live formula, and "why it matters" | "metric", "indicator", "card" |
| **sentinel** | The complete Edge Function `supabase/functions/sentinel/index.ts` (pipeline v3.1) | "the bot", "the AI", "the assistant" |
| **agent** | One of the sentinel pipeline's 5: profile_analyst, behavior_analyst, anomaly_interpreter, risk_synthesizer, compliance_reviewer | "step", "prompt", "model" |
| **tool** | A deterministic fetcher that feeds an agent (profileFetcher, screeningFetcher, txnAggregator, txnSampler, txnOutlierFetcher, scoreFetcher, alertFetcher) | "helper", "query", "function" |
| **model wrapper** | `callModel`: the single point of call to Gemini, with retry + backoff + fallback chain and the key in the header | "client", "SDK" |
| **fallback chain** | The chain of model aliases: `gemini-flash-latest → gemini-flash-lite-latest → gemini-2.0-flash` | "backup model", "plan B" |
| **audit trail** | The `sentinel_audit` table (one row per agent per run: run_id, model_used, attempts, fallback_used, latency_ms, ok) and its echo in the response | "logs", "history" |
| **structuring band** | Transactions of $9,000–9,999, just under the $10,000 reporting threshold | "smurfing band", "suspicious range" |
| **HR country** | A country in the high-risk set: Iran, North Korea, Syria, Russia, Myanmar, Afghanistan (`HIGH_RISK` in code) | plain "sanctioned country", ad-hoc lists |
| **offshore** | A country in the offshore set: Cayman Islands, British Virgin Islands, Panama, Cyprus, Malta (`OFFSHORE` in code) | "tax haven", ad-hoc lists |
| **cleaning log** | `outputs/cleaning_log.csv` and its served table `cleaning_log`: the 31 issues handled by `clean.py`, one per row | "error log", "changelog" |

## 2. Code

**Vanilla JS, no build**: the board is plain HTML/JS/CSS — no bundler, framework, or compile
step. Cloudflare Pages serves `app/` as-is on every push.

**Per-tab modules**: each tab lives in its own `app/js/tab-*.js` and registers on
`window.FE.tabs`; it renders lazily on first activation. Shared code (state, Supabase fetch,
hash router, modal, formatters) lives only in `app/js/core.js`; charts only in
`app/js/charts.js`.

**CSS tokens in `:root`**: every color, spacing, or radius comes from the `:root` custom
properties — never loose hex values in rules or in JS. Risk semantics are fixed:
red = sanctioned, amber = offshore/warn.

**Descriptive names, never generic**: `summarizeTransactions`, `withinLimits`, `persistAudit`
— not `helper`, `process`, `doStuff`. Applies to functions, variables, tables, and CSS classes.

**Comments = functional constraints, never tasks**: a comment explains why the code is the way
it is ("Fail open: a limiter outage must not take the demo down", "URLs leak into logs"), not
what is left to do. No TODO/FIXME on main.

**Python re-runnable from the repo root**: `python analysis/clean.py` →
`python analysis/anomaly.py` → `python supabase/generate_seed.py` rebuild everything
end-to-end. Never silently "fix" suspicious data: every treatment is recorded in the
cleaning-log pattern (CONVENTIONS §1).

## 3. Documentation

**Code as the source of truth**: on any discrepancy between a doc and the code, the code wins,
and the doc is corrected **in the same commit** that detected or created the discrepancy.

**Numbers always traceable**: every number in the docs or in UI copy traces to
`app/data/eda_stats.json`, the board's Findings tab, and the README "Key findings" section
(PRD §5, RF1). If a script changes a number, the README "Key findings" section is updated in
the same commit.

**House standard**: docs are written in English; opening
`# TITLE — Fraud & Compliance Exploration Board` + a 1–3 line scope with links to sibling docs
+ `---`; numbered sections `## 1.`; tables for anything enumerable; diagrams only as ASCII in
code fences (never mermaid); cross-references in the style `PRD §4`; bold lead-ins
`**RF1 — name**:`; dates as `yyyy-mm-dd`.

**No personal data about the owner**: the docs refer to "the author" or "the owner"; never a
name, email, or personal characterization. The non-affiliation and dummy-data disclaimer stays
in README and PRD.

## 4. Commits

**Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:` with an optional
scope (`feat(engine): ...`). Message in the project's tone: concise, the what and the why
first.

**One logical change per commit**: code plus its updated doc/glossary travel together
(CONVENTIONS §3); unrelated changes are split apart.

**No co-authorship trailers**: no `Co-Authored-By` and no tool signatures. The git history is
part of the portfolio and must read as the author's own work.

**The history is part of the portfolio**: main is never rewritten; the messages tell the
project's evolution (cleaning → model → serving → board → sentinel) and a reviewer must be able
to audit it commit by commit.

---

## 5. UI copy (v3.1, 2026-07-12)

- Professional, declarative tone: facts with numbers, at most one interpretive sentence per
  block. No metaphors, no meta-commentary on the analysis itself, no dramatization, no scripted
  rhetoric.
- Titles = descriptive noun phrases ("Parameter sensitivity", "Account detail").
- The development conversation log NEVER carries over into the product.
- Glossary terms apply in code identifiers too. New rows:

| Term | Meaning | Avoid |
|---|---|---|
| model-only detection | a model detection with no rules-engine flag | needle |
| account detail | the profile + activity + model + controls view of a single account | story, dossier, narrative |
| in-browser verification | local recomputation of scores against the pipeline | live scoring, demo |

| Sentinel | the subject-analysis AI (five-agent pipeline in the Edge Function) | copilot, Compliance Copilot |

- Collapsible note blocks (`details.notes` / `details.criteria-legend`) ALWAYS go at the end of
  the card or section, after the data they annotate — never before.

| evidence strength | evidence strength computed from the signal checklist (strong / moderate / limited) | confidence, model confidence |

## 6. Power BI semantic layer (2026-07-13)

The `.pbix` (the Layer 1 deliverable) imports the 9 warehouse tables from the BigQuery dataset
`fraud_exploration`. Semantic-model rules:

| Object | Convention |
|---|---|
| Physical tables and columns | snake_case identical to the warehouse — 1:1 lineage with BigQuery; never renamed |
| Date columns | the physical ones (ISO text) stay hidden; each has its own calculated date column in sentence case ("Transaction date") |
| Measures | the canonical term from the KPI tile or glossary, verbatim, in sentence case ("Unalerted high-risk value", "Unresolved Critical / High"); a new concept requires its glossary row in the same commit (§1) |
| Formulas | identical to the canonical surface (KPI tile / `eda_stats.json`); every figure reproduces the traceable numbers per §3 |
| Measure table | all measures live in `KPI` (a dummy calculated table whose single column is hidden; glossary term §1 — plain "Measures" is a reserved engine name) |
| Display folders | numbered by the executive summary's insight order: 00 Base, 01 Escalation gap, 02 Sanctions screening, 03 Structuring, 04 Account controls, 05 Operations |
| DATE table | calculated calendar, marked as the date table; the only active date relationship is `transactions[Transaction date] → DATE[Date]`. The Alert-date, Chargeback-date, and Screening-date relationships are all inactive; two are activated per-measure via USERELATIONSHIP — Alert date by [Alerts created] and Chargeback date by [Monthly chargeback value] — while the Screening-date relationship is never activated (measures such as [Post-match value] reach screening dates through `ALL(sanctions_screening)` instead). Model tables (KPI, DATE) are UPPERCASE — instantly distinguishable from the warehouse's snake_case tables |
