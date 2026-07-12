# CLAUDE.md — Fraud & Compliance Exploration Engine

## Who / why
Carlos Davila is completing a home task for a **Data & Operations Analyst** role at Nuvei
(Global Risk & Compliance Transformation team) AND turning it into a portfolio project.
Two-layer strategy:
- **Layer 1 (mandated deliverable, judged first):** Power BI dashboard + concise executive
  summary with up to 5 insights. Must stand alone. Submission deadline: **14 July 2026**.
- **Layer 2 (differentiator/portfolio):** a live "Fraud & Compliance Exploration Board" —
  static web app + Supabase (read-only Postgres) + Cloudflare Pages + a Gemini-powered
  "Compliance Sentinel" (Supabase Edge Function). Framed in the submission as
  "a prototype of how this analysis could evolve into a self-serve tool."

Tone rule for all written deliverables: concise, business-first, numbers in headlines.
Never oversell; label Layer 2 explicitly as beyond the brief.

## What already exists in this folder (DONE — do not redo)
- `data/Risk_and_compliance_dummy_dataset.db` — original 6-table SQLite (dirty).
- `data/clean.db` — cleaned SQLite produced by `clean.py`.
- `clean.py` — cleaning pipeline; every treatment logged to `outputs/cleaning_log.csv`
  (31 issues: duplicates, whitespace, casing, empty PEP flags recoded 'Unknown', etc.).
- `anomaly.py` — Isolation Forest (300 trees, 8% contamination, account-level behavioral
  features). Outputs `outputs/account_features_scores.csv`, `outputs/anomalous_accounts.csv`.
- `outputs/EDA_FINDINGS.md` — the full analysis. **Read this first.** Contains stats,
  trends, correlations, and the drafted Top-5 insights.
- `outputs/unalerted_highrisk_txns.csv` — 147 sanctioned-country txns with no alert ($4.3M).

## Key findings (memorize — they drive the dashboard and app copy)
1. Escalation gap: 87% of flagged txns (357, $7.66M) never became alerts; incl. 147
   sanctioned-country txns worth $4.32M.
2. 4 confirmed sanctions matches, zero resolved; ~$1.85M moved AFTER matching
   (CUST0079: $1.0M, CUST0035: $844K). 34% of customers never screened, incl.
   Iran/Syria/North Korea nationals and 2 of 3 PEPs.
3. Structuring: 276 txns (17.4%) in the $9,000–9,999 band = 3.2× neighbors; only 9
   structuring alerts.
4. Control failures: $15.3M through Closed ($5.28M) / Dormant ($8.61M) / Frozen ($1.36M)
   accounts. `is_international` flag unreliable (148 sanctioned-country txns marked domestic).
5. Ops: volume tripled while alerting stayed flat; 77% false-positive rate; backlog median
   age 90d (max 417d), 8 open Critical/High, 3 unassigned. KYC risk rating uncorrelated
   with behavior (Cramér's V = 0.05). Chargebacks value ~20× in 4 months. v3 ML = three
   tiers: 80 anomalous txns (17 needles the rules missed), 9 anomalous accounts (3 never
   alerted; incl. $1.9M through a dormant High-risk account), 5 anomalous customers
   (CUST0054: structuring across 4 own accounts, never screened).

High-risk country set used everywhere: Iran, North Korea, Syria, Russia, Myanmar, Afghanistan.
Offshore set: Cayman Islands, British Virgin Islands, Panama, Cyprus, Malta.
"Now" for age calculations: 2026-07-11.

## Build plan — status 2026-07-12 (v2)

Steps 1–4 and 6 are BUILT AND DEPLOYED, plus the v2 iteration: the board is
six tabs (Overview with 8 KPI popups, Data explorer, EDA as a 6-step process,
Findings with evidence charts, ML model card with a real sensitivity sweep,
AI Engine), the sentinel is a **five-agent pipeline** with retry/fallback
wrapper, PII anonymization, injection defenses, Postgres rate limiting
(8/min/IP + 250/day) and a per-agent `sentinel_audit` trail. Model aliases
only (`gemini-flash-latest` / `-lite-` — pinned 2.5 ids 404 for new users).
Design docs live in `docs/` (PRD, TRD, DATABASE, UI, APPFLOW, CONVENTIONS,
MOCKUPS); the 5-insight deliverable in `reports/EXECUTIVE_SUMMARY.md`.
Step 5 (Power BI) EXCLUDED from this build; step 7 (submission email + .pbix)
pending — deadline 2026-07-14.

### 1. Repo skeleton
```
/analysis/        clean.py, anomaly.py, EDA notebook (convert findings to notebook optional)
/data/            original .db + clean.db  (small, fine to commit; it's dummy data)
/outputs/         findings, cleaning log, CSVs
/app/             static frontend (index.html, app.js, styles.css) — Cloudflare Pages root
/supabase/        seed.sql (DDL + data + RLS read-only policies)
/supabase/functions/sentinel/   index.ts — Supabase Edge Function proxying Gemini
/powerbi/         star-schema CSVs, measures.md (DAX), theme.json, layout_spec.md
README.md         architecture diagram, screenshots, methodology, privacy note
```

### 2. Supabase (`supabase/seed.sql`)
- Generate DDL + INSERTs from `data/clean.db` (script it; don't hand-write 1,600 inserts).
- Add derived table `account_scores` from `outputs/account_features_scores.csv`.
- Enable RLS on all tables with a single `SELECT`-only policy for `anon`.
- Env vars (already provisioned by Carlos): `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
  Anon key is public-safe because of RLS; it goes in the frontend config.

### 3. Frontend (`/app`) — "Fraud & Compliance Exploration Board"
Single-page, no framework needed (or minimal). Panels:
- KPI strip: unalerted high-risk value, open Critical/High, screening coverage, FP rate,
  chargeback trend.
- Filterable transactions table (country, flagged, amount band, account status).
- Anomaly view: account list sorted by Isolation Forest score with feature explanation.
- Sentinel panel: pick an account → POST to the `sentinel` Edge Function → structured
  risk narrative + recommended action (Escalate / Request docs / Close as FP).
Design: clean, dark-friendly, risk color semantics (red = sanctioned, amber = offshore).
Keep it read-only. Loading states + graceful errors.

### 4. Sentinel (`/supabase/functions/sentinel/index.ts`)
- Supabase Edge Function (Deno). Reads `GEMINI_API_KEY` from env — stored as a
  Supabase secret (`supabase secrets set GEMINI_API_KEY=...`). NEVER expose the key
  client-side; never commit it.
- CORS: allow the Cloudflare Pages origin; frontend calls the function with the
  anon key (RLS keeps data read-only regardless).
- Input: account_id. Server fetches that account's profile/txns/score from Supabase,
  builds a grounded prompt, calls Gemini (gemini-2.0-flash or newer), returns JSON:
  { risk_summary, key_factors[], recommended_action, confidence }.
- Add a system instruction: compliance-analyst persona, cite only provided data,
  no fabrication.
- README privacy note: dummy data only; in production PII would be masked / model
  on-prem — this note matters for an AML audience.

### 5. Power BI package (`/powerbi`)
- Export star schema from clean.db: FactTransactions, FactAlerts, FactChargebacks,
  FactScreening, DimCustomer, DimAccount, DimDate (generate), plus account_scores.
- `measures.md`: DAX for every KPI above (escalation rate, FP rate, backlog aging,
  screening coverage, structuring-band share, value through non-active accounts,
  MoM chargeback growth).
- `layout_spec.md`: 3 pages — Executive Overview / Risk Deep-Dive / Operations —
  with per-visual field mapping so assembly in PBI Desktop is mechanical.
- `theme.json`: corporate-neutral with risk accent colors.

### 6. Deploy
- Frontend: push to GitHub via MCP `github-fe`; Cloudflare Pages is connected to the
  repo (Git integration) and auto-deploys on push. Build output = `/app`, no build
  command, no wrangler, no Cloudflare credentials needed locally.
- Sentinel: `supabase functions deploy sentinel` + `supabase secrets set GEMINI_API_KEY`.

### 7. Submission package (Layer 1)
- One-page executive summary (the Top-5 from EDA_FINDINGS.md, tightened).
- .pbix built from /powerbi package.
- Closing line linking the live board + repo.

## Access via MCP (`.mcp.json` — tokens in env vars, NEVER in files)
- **GitHub**: MCP server `github-fe`; fine-grained PAT scoped to this repo only,
  read from env var `FE_GITHUB_PAT`. Do NOT use `gh` CLI or ambient git
  credentials (multi-account machine).
- **Supabase**: MCP server `supabase-fe`; personal access token read from env var
  `FE_SUPABASE_PAT`. Once the Supabase project exists, scope the server by adding
  `?project_ref=<ref>` (and `&read_only=true` after seeding) to the URL.
- Open Claude Code IN this folder so `.mcp.json` loads. Token values live only in
  Windows user env vars — never in CLAUDE.md, code, or commits.

## Environment variables expected (provided via MCP / env — never hardcode)
- `FE_GITHUB_PAT` — GitHub fine-grained PAT for this repo (MCP `github-fe`)
- `FE_SUPABASE_PAT` — Supabase personal access token (MCP `supabase-fe`)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (frontend-safe)
- `GEMINI_API_KEY` (server-side only → Supabase Edge Function secret; never local/frontend)

## Conventions
- Python: pandas; keep scripts re-runnable end-to-end (`clean.py` → `anomaly.py`).
- Never "fix" suspicious data silently — log to cleaning_log.csv pattern.
- All counts/values in copy must trace to EDA_FINDINGS.md; if code changes numbers,
  update the findings doc in the same commit.
