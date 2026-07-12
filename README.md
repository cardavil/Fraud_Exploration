# Fraud & Compliance Exploration Board

A portfolio project that turns a risk & compliance dataset into a **live, self-serve
exploration tool**: cleaning pipeline → interpretable ML anomaly detection → read-only
serving layer → web board with an AI copilot grounded on the served data.

**Live board:** https://fraud-exploration.pages.dev
**Executive summary (the 5 headline insights):** [reports/EXECUTIVE_SUMMARY.md](reports/EXECUTIVE_SUMMARY.md)
**Full analysis:** [outputs/EDA_FINDINGS.md](outputs/EDA_FINDINGS.md) ·
**Design docs:** [docs/](docs/)

> **Disclaimer** — Personal portfolio project inspired by a hiring assessment, built
> entirely on a **dummy dataset**. Not affiliated with, or endorsed by, Nuvei or any
> payments company. No real customer data is used anywhere.

## Architecture

```mermaid
flowchart LR
  subgraph Analysis["Analysis (Python)"]
    RAW[(SQLite<br/>raw dataset)] --> CLEAN[clean.py<br/>audited cleaning] --> DB[(clean.db)]
    DB --> ISO[anomaly.py<br/>Isolation Forest]
  end

  subgraph Serving["Serving layer (Supabase)"]
    SEED[generate_seed.py<br/>apply_seed.py] --> PG[(Postgres<br/>RLS: SELECT-only anon)]
    PG --- REST[PostgREST API]
    FN[Edge Function copilot<br/>5-agent pipeline + audit]
  end

  subgraph Front["Frontend (Cloudflare Pages)"]
    APP[Static board<br/>vanilla HTML/JS/CSS]
  end

  DB --> SEED
  ISO --> SEED
  APP -->|anon key, read-only| REST
  APP -->|account_id| FN
  FN -->|service role| REST
  FN -->|grounded prompt +<br/>JSON schema| GEMINI[Gemini API]
  GH[GitHub repo] -->|git integration<br/>auto-deploy| APP
```

## The board — six tabs, one narrative

| Tab | What it shows |
|---|---|
| **Overview** | 8 live KPIs; every tile opens a popup with the definition, the exact formula (live numerator/denominator) and why it matters. |
| **Data** | The serving layer raw: all 8 tables, filterable column by column. |
| **EDA** | The analysis as a six-step process — audited cleaning (live from `cleaning_log`), verified counts, descriptives, distributions, associations. |
| **Findings** | Thematic deep-dives, each with an evidence chart, per-mark tooltips and a "how to read" note. |
| **ML Model** | Why Isolation Forest, the 12 features, a real parameter-sensitivity sweep, and the explained anomaly list. |
| **AI Engine** | The copilot's internals — five-agent pipeline, tools, model wrapper with retry/fallback, anonymization, injection defenses — plus the live runner with a per-agent audit table. |

## Stack rationale

| Choice | Why |
|---|---|
| **Supabase (Postgres + PostgREST)** | A serving layer with real row-level security: the anon key shipped to the browser can only `SELECT`. Write privileges are revoked *and* no write policy exists — defense in depth. |
| **Cloudflare Pages, no build step** | The board is vanilla HTML/JS/CSS; deploys on every push through the GitHub integration. Nothing to compile, nothing to break. |
| **Supabase Edge Function for the copilot** | The Gemini key must never reach the client. Inside, a **five-agent pipeline** (profile → behavior → ML interpretation → synthesis → compliance QA) with one model wrapper (retry, backoff, fallback chain), PII pseudonymization by construction, prompt-injection framing, Postgres-enforced rate limits and a per-agent audit trail. |
| **Isolation Forest at account level** | Unsupervised, fits a no-labels compliance setting, and stays **explainable**: every flagged account shows *which* behavioral features deviate and by how much. |

**Production note:** here Postgres serves both roles for simplicity. In a production
deployment the analytical layer (heavy aggregation, model features, backtesting) would
live in a warehouse such as **BigQuery or Snowflake**, with the operational serving
layer fed from curated marts — and PII would be masked before any of it reaches an
exploration tool or a model.

## Key findings (from the EDA)

1. **$4.3M in transactions to sanctioned jurisdictions were flagged but never alerted**
   (147 of 170); overall, 87% of flagged transactions never became a case. Detection
   works; escalation doesn't.
2. **Confirmed sanctions matches keep transacting** — 4 confirmed matches, zero
   resolved, ~$1.85M moved after matching; 34% of customers were never screened.
3. **A structuring pattern hides in plain sight**: 276 transactions (17%) sit in the
   $9,000–9,999 band — 3.3× the neighboring bands — yet only 9 structuring alerts exist.
4. **Account-status controls are not enforced**: $15.3M flowed through Closed, Dormant
   and Frozen accounts; the `is_international` flag is unreliable.
5. **Monitoring hasn't scaled and is mis-aimed**: volume tripled while alerting stayed
   flat; 77% false-positive rate; the KYC risk rating shows no relationship with actual
   behavior (Cramér's V = 0.05). The Isolation Forest surfaces 5 high-risk accounts the
   rules never caught.

Full statistical detail, methodology and the cleaning audit trail:
[outputs/EDA_FINDINGS.md](outputs/EDA_FINDINGS.md) · [outputs/cleaning_log.csv](outputs/cleaning_log.csv)

## Repository layout

```
analysis/    clean.py, anomaly.py, export_eda_stats.py, model_sensitivity.py
data/        raw + cleaned SQLite (dummy data, safe to commit)
outputs/     EDA findings, cleaning log, model scores
reports/     EXECUTIVE_SUMMARY.md — the 5-insight deliverable
app/         static frontend (Cloudflare Pages root; js/ modules, data/ precomputed stats)
supabase/    seed generator + applier, edge function (5-agent copilot), rate limit, audit
docs/        PRD, TRD, DATABASE, UI, APPFLOW, CONVENTIONS, MOCKUPS
```

## Reproduce

```bash
pip install pandas scikit-learn scipy
python analysis/clean.py                # rebuilds data/clean.db + cleaning log
python analysis/anomaly.py              # rebuilds model scores
python analysis/export_eda_stats.py     # rebuilds app/data/eda_stats.json
python analysis/model_sensitivity.py    # rebuilds app/data/model_sensitivity.json
python supabase/generate_seed.py        # regenerates supabase/seed.sql
SUPABASE_ACCESS_TOKEN=... python supabase/apply_seed.py   # applies it (Management API)
```

Frontend: open `app/index.html` through any static server (`python -m http.server`).
Copilot: `supabase functions deploy copilot` + `supabase secrets set GEMINI_API_KEY=...`.

## Privacy & AI-safety notes

- **Dummy data only.** In production, PII would be masked or tokenized before reaching
  an exploration tool, and models would run in a controlled environment.
- The copilot **reasons only over data served to it** and returns a constrained JSON
  schema (`Escalate / Request documentation / Close as false positive`); account data
  is wrapped as third-party *data*, not instructions, to resist prompt injection.
- The anon key in `app/config.js` is intentionally public: RLS limits it to `SELECT`.
