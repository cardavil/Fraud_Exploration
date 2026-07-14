# DATABASE — Fraud & Compliance Exploration Board

Complete Postgres (Supabase) schema: the 10 clean tables emitted by the seed generator
(`supabase/generate_seed.py` → `supabase/seed.sql`), the 6 `raw_*` source tables emitted by
`supabase/generate_raw_seed.py` → `supabase/raw_seed.sql`, and the 3 operational sentinel tables
(`supabase/rate_limit.sql`, `supabase/audit.sql`) — with the real DDL, who writes each object,
integrity rules, and limits.
Sibling docs: [PRD.md](PRD.md) (product and scope) · [TRD.md](TRD.md) (architecture and AI pipeline).
Date: 2026-07-14.

---

## 1. Principles

| Principle | Detail |
|---|---|
| Single-writer | Everything is written by the seed or the system: the seed populates the 10 clean data tables (`generate_seed.py`) and the 6 raw source tables (`generate_raw_seed.py`); the RPC `sentinel_hit` writes the counters; the Edge Function writes the audit trail. The visitor NEVER writes anything |
| RLS everywhere | The 10 clean seed tables and the 6 raw source tables: RLS on + one SELECT-only policy for `anon`/`authenticated`. The 3 operational tables: RLS enabled with NO policies + `REVOKE ALL` — only the service role (which bypasses RLS) touches them |
| Defense in depth | Beyond RLS, `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` on every clean and raw table: even if a write policy appeared by mistake, the privilege does not exist (TRD §3) |
| Naming | `snake_case` for tables and columns; text IDs with prefixes (`CUST...`, `ACC...`, `TXN...`) |
| Generated seed | `seed.sql` is emitted by `generate_seed.py` from `data/clean.db` + the model score CSVs; `raw_seed.sql` is emitted by `generate_raw_seed.py` from the untouched original database — neither file is edited by hand |

RLS pattern applied to every clean seed table and every raw source table
(emitted by `generate_seed.py::rls` and `generate_raw_seed.py::rls`):

```sql
ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {table} FROM anon, authenticated;
CREATE POLICY "{table}_read_only" ON {table} FOR SELECT TO anon, authenticated USING (true);
```

Inventory:

| Table | Rows | Writer | anon access |
|---|---|---|---|
| `customers` | 83 | seed | SELECT |
| `accounts` | 105 | seed | SELECT |
| `transactions` | 1,600 | seed | SELECT |
| `compliance_alerts` | 65 | seed | SELECT |
| `sanctions_screening` | 95 | seed | SELECT |
| `chargebacks` | 70 | seed | SELECT |
| `account_scores` | 105 | seed | SELECT |
| `transaction_scores` | 1,600 | seed | SELECT |
| `customer_scores` | 59 | seed | SELECT |
| `cleaning_log` | 31 | seed | SELECT |
| `raw_customers` | 87 | raw seed | SELECT |
| `raw_accounts` | 110 | raw seed | SELECT |
| `raw_transactions` | 1,618 | raw seed | SELECT |
| `raw_compliance_alerts` | 68 | raw seed | SELECT |
| `raw_sanctions_screening` | 98 | raw seed | SELECT |
| `raw_chargebacks` | 73 | raw seed | SELECT |
| `sentinel_usage` | 1/day | rpc | none |
| `sentinel_ip_usage` | ephemeral | rpc | none |
| `sentinel_audit` | 5/run | sentinel | none |

## 2. customers

Account holders (KYC): identity, type, PEP status, and risk rating. PK `customer_id`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `customer_id` | text | seed | PK, format `CUST####` |
| `full_name` | text | seed | Full name (dummy). NEVER selected to the model (TRD §6) |
| `date_of_birth` | date | seed | Date of birth. NEVER selected to the model (TRD §6) |
| `nationality` | text | seed | Nationality — cross-checked against the sanctioned-country set |
| `occupation` | text | seed | Declared occupation — plausibility vs activity |
| `customer_type` | text | seed | Individual / Business |
| `pep_flag` | text | seed | Politically exposed person; blanks recoded to `Unknown` by `clean.py` |
| `risk_rating` | text | seed | KYC rating (Low/Medium/High) |
| `onboarding_date` | date | seed | Customer onboarding date |
| `onboarding_channel` | text | seed | Onboarding channel |

```sql
CREATE TABLE customers (
  customer_id        text PRIMARY KEY,
  full_name          text,
  date_of_birth      date,
  nationality        text,
  occupation         text,
  customer_type      text,
  pep_flag           text,
  risk_rating        text,
  onboarding_date    date,
  onboarding_channel text
);
```

## 3. accounts

Accounts per customer with status and balance. PK `account_id`, FK to `customers`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `account_id` | text | seed | PK, format `ACC#####` (validated `^ACC\d{5}$` in the sentinel) |
| `customer_id` | text | seed | FK → `customers.customer_id` |
| `account_type` | text | seed | Account type |
| `currency` | text | seed | Currency |
| `open_date` | date | seed | Opening date |
| `status` | text | seed | Active / Closed / Dormant / Frozen — key to the control-failure finding |
| `branch_country` | text | seed | Branch country |
| `account_balance` | numeric(14,2) | seed | Balance |

```sql
CREATE TABLE accounts (
  account_id      text PRIMARY KEY,
  customer_id     text REFERENCES customers(customer_id),
  account_type    text,
  currency        text,
  open_date       date,
  status          text,
  branch_country  text,
  account_balance numeric(14,2)
);
```

## 4. transactions

Movements: the largest table and the core of the analysis. PK `transaction_id`, FK to `accounts`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `transaction_id` | text | seed | PK — also the pagination tiebreaker (TRD §3) |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `transaction_date` | date | seed | Date |
| `amount` | numeric(14,2) | seed | Amount; the 9,000–9,999 band is the structuring zone |
| `transaction_type` | text | seed | Type (Cash..., Wire, etc.) |
| `channel` | text | seed | Channel |
| `counterparty_name` | text | seed | Counterparty |
| `counterparty_country` | text | seed | Counterparty country — cross-checked against the sanctioned/offshore sets |
| `is_international` | text | seed | Yes/No — a flag known to be UNRELIABLE (148 sanctioned-country txns marked domestic) |
| `flagged_for_review` | text | seed | Yes/No — the source system's flag |

```sql
CREATE TABLE transactions (
  transaction_id       text PRIMARY KEY,
  account_id           text REFERENCES accounts(account_id),
  transaction_date     date,
  amount               numeric(14,2),
  transaction_type     text,
  channel              text,
  counterparty_name    text,
  counterparty_country text,
  is_international     text,
  flagged_for_review   text
);
```

## 5. compliance_alerts

Rules-engine alerts and their lifecycle. PK `alert_id`, FKs to `accounts` and `transactions`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `alert_id` | text | seed | PK |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `transaction_id` | text | seed | FK → `transactions.transaction_id` (nullable — not every alert points to a txn) |
| `alert_date` | date | seed | Alert creation date |
| `alert_type` | text | seed | Type (structuring, sanctions, etc.) |
| `severity` | text | seed | Critical / High / Medium / Low |
| `status` | text | seed | Open or `Closed - ...` (includes `Closed - False Positive`) |
| `assigned_analyst` | text | seed | Assigned analyst (nullable — unassigned backlog) |
| `resolution_date` | date | seed | Closure date |
| `sar_filed` | text | seed | Whether a SAR was filed |

```sql
CREATE TABLE compliance_alerts (
  alert_id         text PRIMARY KEY,
  account_id       text REFERENCES accounts(account_id),
  transaction_id   text REFERENCES transactions(transaction_id),
  alert_date       date,
  alert_type       text,
  severity         text,
  status           text,
  assigned_analyst text,
  resolution_date  date,
  sar_filed        text
);
```

## 6. sanctions_screening

Screening history against sanctions lists. PK `screening_id`, FK to `customers`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `screening_id` | text | seed | PK |
| `customer_id` | text | seed | FK → `customers.customer_id`; customers with NO row here were never screened (34%) |
| `screening_date` | date | seed | Screening date |
| `list_checked` | text | seed | List checked |
| `match_result` | text | seed | Result (Confirmed Match / No Match / ...) |
| `reviewed_by` | text | seed | Reviewer |
| `review_status` | text | seed | Review status |

```sql
CREATE TABLE sanctions_screening (
  screening_id   text PRIMARY KEY,
  customer_id    text REFERENCES customers(customer_id),
  screening_date date,
  list_checked   text,
  match_result   text,
  reviewed_by    text,
  review_status  text
);
```

## 7. chargebacks

Card chargebacks with network, merchant, and liability. PK `chargeback_id`, FKs to `transactions` and `accounts`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `chargeback_id` | text | seed | PK |
| `transaction_id` | text | seed | FK → `transactions.transaction_id` |
| `account_id` | text | seed | FK → `accounts.account_id` |
| `chargeback_date` | date | seed | Chargeback date |
| `amount` | numeric(14,2) | seed | Disputed amount |
| `card_network` | text | seed | Card network |
| `merchant_name` | text | seed | Merchant |
| `reason_category` | text | seed | Reason category |
| `filed_by` | text | seed | Who filed |
| `status` | text | seed | Status |
| `resolution_date` | date | seed | Resolution date |
| `liability_party` | text | seed | Liable party |

```sql
CREATE TABLE chargebacks (
  chargeback_id   text PRIMARY KEY,
  transaction_id  text REFERENCES transactions(transaction_id),
  account_id      text REFERENCES accounts(account_id),
  chargeback_date date,
  amount          numeric(14,2),
  card_network    text,
  merchant_name   text,
  reason_category text,
  filed_by        text,
  status          text,
  resolution_date date,
  liability_party text
);
```

## 8. account_scores

Derived table (Tier 2): per-account behavioral features + Isolation Forest output
(`analysis/account_features.py` + `analysis/anomaly.py` → `outputs/account_features_scores.csv`;
300 trees, 8% contamination). PK `account_id` (1:1 with `accounts`); written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `account_id` | text | seed | PK and FK → `accounts.account_id` |
| `n_tx` | integer | seed | Number of transactions |
| `avg_amt` | double precision | seed | Mean amount |
| `std_amt` | double precision | seed | Standard deviation of amount |
| `max_amt` | double precision | seed | Maximum amount |
| `total` | double precision | seed | Total value moved |
| `pct_hr` | double precision | seed | Share of transactions to sanctioned/high-risk countries |
| `pct_off` | double precision | seed | Share of transactions to offshore countries |
| `pct_cash` | double precision | seed | Share of cash transactions |
| `pct_struct` | double precision | seed | Share in the 9,000–9,999 band |
| `pct_intl` | double precision | seed | Share of international transactions |
| `tx_per_month` | double precision | seed | Velocity (txns/month) |
| `velocity_value` | double precision | seed | Value/month |
| `pct_txn_anomalous` | double precision | seed | Share of the account's transactions flagged anomalous by the Tier-1 model |
| `max_txn_score` | double precision | seed | Highest Tier-1 transaction anomaly score among the account's transactions |
| `max_day_share` | double precision | seed | Burstiness — the account's largest single-day value as a share of total value (0–1) |
| `recent_intensity` | double precision | seed | Share of the account's total value moved in the last 90 days (0–1) |
| `anomaly` | integer | seed | -1 = anomalous, 1 = normal (Isolation Forest) |
| `score` | double precision | seed | Higher = more anomalous |
| `customer_id` | text | seed | FK → `customers.customer_id` (denormalized for the board) |
| `status` | text | seed | Copy of `accounts.status` (denormalized) |
| `branch_country` | text | seed | Denormalized copy |
| `full_name` | text | seed | Denormalized copy — the sentinel NEVER selects it (TRD §6) |
| `risk_rating` | text | seed | Denormalized copy of the KYC rating |
| `pep_flag` | text | seed | Denormalized copy |
| `has_alert` | boolean | seed | The account has at least one alert; false + anomaly=-1 = the rules engine missed it |

```sql
CREATE TABLE account_scores (
  account_id     text PRIMARY KEY REFERENCES accounts(account_id),
  n_tx           integer,
  avg_amt        double precision,
  std_amt        double precision,
  max_amt        double precision,
  total          double precision,
  pct_hr         double precision,
  pct_off        double precision,
  pct_cash       double precision,
  pct_struct     double precision,
  pct_intl       double precision,
  tx_per_month   double precision,
  velocity_value double precision,
  pct_txn_anomalous double precision,
  max_txn_score     double precision,
  max_day_share     double precision,
  recent_intensity  double precision,
  anomaly        integer,
  score          double precision,
  customer_id    text REFERENCES customers(customer_id),
  status         text,
  branch_country text,
  full_name      text,
  risk_rating    text,
  pep_flag       text,
  has_alert      boolean
);
```

## 9. transaction_scores

Derived table (Tier 1): per-transaction contextual features + Isolation Forest output
(`analysis/tier1_transactions.py` → `outputs/transaction_scores.csv`; 300 trees, 5% contamination).
Each feature doubles as a human-readable reason code. PK and FK `transaction_id` (1:1 with
`transactions`), FK `account_id`; written by the seed.

| Column | Type | Writer | Description |
|---|---|---|---|
| `transaction_id` | text | seed | PK and FK → `transactions.transaction_id` |
| `log_amount` | double precision | seed | `log1p` of the amount |
| `rel_amount` | double precision | seed | Amount relative to the account's median amount (clipped to 50) — how unusual for its own account |
| `band_9k` | integer | seed | 1 if amount in the 9,000–9,999 structuring band, else 0 |
| `hr_country` | integer | seed | 1 if the counterparty country is in the high-risk set, else 0 |
| `offshore` | integer | seed | 1 if the counterparty country is in the offshore set, else 0 |
| `cash` | integer | seed | 1 if a cash transaction type, else 0 |
| `nonactive_status` | integer | seed | 1 if the account status is Closed/Dormant/Frozen, else 0 |
| `days_since_prev_txn` | double precision | seed | Days since the account's previous transaction (clipped to 90) |
| `same_day_txns` | integer | seed | Count of the account's transactions on the same calendar day |
| `counterparty_novelty` | integer | seed | 1 the first time the account transacts with this counterparty, else 0 |
| `intl_mismatch` | integer | seed | 1 if the counterparty is high-risk but `is_international` = "No" (flag disagreement), else 0 |
| `score` | double precision | seed | Isolation Forest anomaly score; higher = more anomalous |
| `anomaly` | integer | seed | -1 = anomalous, 1 = normal |
| `account_id` | text | seed | FK → `accounts.account_id` (denormalized) |
| `amount` | numeric(14,2) | seed | Transaction amount (denormalized copy) |
| `flagged_by_rules` | integer | seed | 1 if `flagged_for_review` = "Yes" in the source, else 0 |

```sql
CREATE TABLE transaction_scores (
  transaction_id       text PRIMARY KEY REFERENCES transactions(transaction_id),
  log_amount           double precision,
  rel_amount           double precision,
  band_9k              integer,
  hr_country           integer,
  offshore             integer,
  cash                 integer,
  nonactive_status     integer,
  days_since_prev_txn  double precision,
  same_day_txns        integer,
  counterparty_novelty integer,
  intl_mismatch        integer,
  score                double precision,
  anomaly              integer,
  account_id           text REFERENCES accounts(account_id),
  amount               numeric(14,2),
  flagged_by_rules     integer
);
```

## 10. customer_scores

Derived table (Tier 3): per-customer features + Isolation Forest output
(`analysis/tier3_customers.py` → `outputs/customer_scores.csv`; 300 trees, 8% contamination).
The customer is the legal subject and the only level where cross-account schemes are visible.
PK and FK `customer_id`; written by the seed. Only the 59 customers with at least one account are
scored; the 24 KYC-only customers (no accounts) have NO row here — they are excluded from scoring by
design and surfaced as a data-governance finding instead.

| Column | Type | Writer | Description |
|---|---|---|---|
| `customer_id` | text | seed | PK and FK → `customers.customer_id` |
| `n_accounts` | integer | seed | Number of accounts the customer holds |
| `n_anomalous_accounts` | integer | seed | Number of the customer's accounts flagged anomalous by the account tier |
| `max_account_score` | double precision | seed | Highest account-tier anomaly score among the customer's accounts |
| `total_value` | double precision | seed | Total transaction value across all the customer's accounts |
| `pct_txn_anomalous` | double precision | seed | Share of the customer's transactions flagged anomalous by the transaction tier |
| `max_txn_score` | double precision | seed | Highest transaction-tier anomaly score among the customer's transactions |
| `structuring_days` | integer | seed | Customer-days where same-day activity across >1 of the customer's own accounts sums to ≥ $10,000 with every individual txn under $10,000 (cross-account structuring) |
| `hr_value_share` | double precision | seed | Share of the customer's value going to high-risk countries |
| `nonactive_value_share` | double precision | seed | Share of value moved through non-active (Closed/Dormant/Frozen) accounts |
| `risk_ordinal` | double precision | seed | KYC rating mapped to an ordinal (Low=1, Medium=2, High=3) |
| `pep` | double precision | seed | PEP flag mapped (Yes=1, Unknown=0.5, No=0) |
| `never_screened` | integer | seed | 1 if the customer has no `sanctions_screening` row, else 0 |
| `post_match_value` | double precision | seed | Transaction value moved after the customer's first confirmed sanctions match |
| `anomaly` | integer | seed | -1 = anomalous, 1 = normal |
| `score` | double precision | seed | Isolation Forest anomaly score; higher = more anomalous |
| `full_name` | text | seed | Denormalized copy — the sentinel NEVER selects it (TRD §6) |
| `nationality` | text | seed | Denormalized copy |

```sql
CREATE TABLE customer_scores (
  customer_id           text PRIMARY KEY REFERENCES customers(customer_id),
  n_accounts            integer,
  n_anomalous_accounts  integer,
  max_account_score     double precision,
  total_value           double precision,
  pct_txn_anomalous     double precision,
  max_txn_score         double precision,
  structuring_days      integer,
  hr_value_share        double precision,
  nonactive_value_share double precision,
  risk_ordinal          double precision,
  pep                   double precision,
  never_screened        integer,
  post_match_value      double precision,
  anomaly               integer,
  score                 double precision,
  full_name             text,
  nationality           text
);
```

## 11. cleaning_log

Log of the 31 cleaning treatments applied by `clean.py` (methodological transparency for the board).
PK `step_id`; written by the seed from `outputs/cleaning_log.csv`.

| Column | Type | Writer | Description |
|---|---|---|---|
| `step_id` | integer | seed | Sequential PK (1..31, generated while building the seed) |
| `table_name` | text | seed | Affected table (renamed from the CSV's `table`) |
| `issue` | text | seed | Detected problem |
| `treatment` | text | seed | Applied treatment |
| `rows_affected` | integer | seed | Rows affected |

```sql
CREATE TABLE cleaning_log (
  step_id       integer PRIMARY KEY,
  table_name    text,
  issue         text,
  treatment     text,
  rows_affected integer
);
```

## 12. Raw source tables (`raw_*`)

The 6 original source tables, served verbatim as `raw_<table>` so the EDA explorer and the integrity
panel can identify the data-quality issues live rather than trusting the cleaning log. Emitted by
`supabase/generate_raw_seed.py` → `supabase/raw_seed.sql` from the untouched original database
(`data/Risk_and_compliance_dummy_dataset.db`). The board fetches them into `state.raw`
(`app/js/core.js:13-14,158-160`); all analysis reads the clean tables in `state.data`, and
`state.raw` is exploration-only.

Characteristics of every `raw_*` table:

- **Every column is typed `text`** and there are **NO primary or foreign keys** — the raw data has
  duplicate IDs and untyped values, so the raw layer reflects the pre-cleaning state.
- **Values are preserved exactly** (empty strings, whitespace, mixed casing) so the quality issues
  are surfaced live.
- **Same RLS policy as the clean layer**: RLS on, write privileges revoked, one SELECT-only policy
  for `anon`/`authenticated`.

| Raw table | Rows | Columns |
|---|---|---|
| `raw_customers` | 87 | same 10 columns as `customers`, all `text` |
| `raw_accounts` | 110 | same 8 columns as `accounts`, all `text` |
| `raw_transactions` | 1,618 | same 10 columns as `transactions`, all `text` |
| `raw_compliance_alerts` | 68 | same 10 columns as `compliance_alerts`, all `text` |
| `raw_sanctions_screening` | 98 | same 7 columns as `sanctions_screening`, all `text` |
| `raw_chargebacks` | 73 | same 12 columns as `chargebacks`, all `text` |

The raw row counts are higher than the clean counts because cleaning removed duplicates and dropped
invalid rows; the delta is exactly what the ETL/integrity panel visualizes. Column definitions mirror
the source tables (§2–§7) with every type widened to `text`, for example:

```sql
CREATE TABLE raw_transactions (
  transaction_id       text,
  account_id           text,
  transaction_date     text,
  amount               text,
  transaction_type     text,
  channel              text,
  counterparty_name    text,
  counterparty_country text,
  is_international      text,
  flagged_for_review   text
);
```

## 13. sentinel_usage

Global daily counter for the sentinel (cap 250/day, TRD §7). PK `day`; written ONLY by the RPC
`sentinel_hit`.

| Column | Type | Writer | Description |
|---|---|---|---|
| `day` | date | rpc | PK — one record per day (`CURRENT_DATE`) |
| `hits` | integer | rpc | Runs accumulated for the day; compared against `max_per_day` |

DDL and writer function, copied from `supabase/rate_limit.sql`:

```sql
CREATE TABLE IF NOT EXISTS sentinel_usage (
  day  date PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0
);
ALTER TABLE sentinel_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel_usage, sentinel_ip_usage FROM anon, authenticated;
-- No policies on purpose: only the service role (bypasses RLS) touches them.

CREATE OR REPLACE FUNCTION sentinel_hit(client_ip text, max_per_min integer, max_per_day integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ip_ok boolean;
  day_ok boolean;
BEGIN
  INSERT INTO sentinel_ip_usage AS i (ip, minute, hits)
  VALUES (client_ip, date_trunc('minute', now()), 1)
  ON CONFLICT (ip, minute) DO UPDATE SET hits = i.hits + 1
  RETURNING i.hits <= max_per_min INTO ip_ok;

  INSERT INTO sentinel_usage AS u (day, hits)
  VALUES (CURRENT_DATE, 1)
  ON CONFLICT (day) DO UPDATE SET hits = u.hits + 1
  RETURNING u.hits <= max_per_day INTO day_ok;

  -- Opportunistic cleanup; the table stays tiny.
  DELETE FROM sentinel_ip_usage WHERE minute < now() - interval '1 day';

  RETURN ip_ok AND day_ok;
END;
$$;
REVOKE EXECUTE ON FUNCTION sentinel_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
```

## 14. sentinel_ip_usage

Per-IP, per-minute counter (limit 8/min/IP, TRD §7). Composite PK `(ip, minute)`; written ONLY by the
RPC `sentinel_hit`, which also deletes rows older than 1 day on each call — a self-cleaning table.

| Column | Type | Writer | Description |
|---|---|---|---|
| `ip` | text | rpc | Client IP (first value of `x-forwarded-for`, or `unknown`) |
| `minute` | timestamptz | rpc | Window `date_trunc('minute', now())` — part of the PK |
| `hits` | integer | rpc | Requests from that IP in that minute; compared against `max_per_min` |

```sql
CREATE TABLE IF NOT EXISTS sentinel_ip_usage (
  ip     text NOT NULL,
  minute timestamptz NOT NULL,
  hits   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, minute)
);
ALTER TABLE sentinel_ip_usage ENABLE ROW LEVEL SECURITY;
```

## 15. sentinel_audit

Per-agent, per-run trace of the pipeline (TRD §8): 5 rows per run. PK `id` (identity); written ONLY by
the Edge Function `sentinel` (service role) via `persistAudit`.

| Column | Type | Writer | Description |
|---|---|---|---|
| `id` | bigint identity | sentinel | Auto-generated PK |
| `run_id` | uuid | sentinel | Groups the 5 rows of a run (`crypto.randomUUID()`); indexed |
| `account_id` | text | sentinel | The subject ID submitted for the run — the board sends a customer ID (`CUST####`); the function also accepts an account ID (`ACC#####`), which resolves to its holder. Stored as received |
| `agent` | text | sentinel | One of the 5 agents (TRD §4) |
| `model_used` | text | sentinel | Model that responded; NULL if all 3 in the chain failed |
| `attempts` | integer | sentinel | Attempts accumulated in the wrapper (retries + fallbacks) |
| `fallback_used` | boolean | sentinel | true if a model other than the preferred one responded (or total failure) |
| `latency_ms` | integer | sentinel | Total wrapper latency for that agent |
| `ok` | boolean | sentinel | The agent produced valid output; the reviewer with ok=false marks a degraded outcome (TRD §4) |
| `ts` | timestamptz | sentinel | DEFAULT now() |

DDL copied from `supabase/audit.sql`:

```sql
CREATE TABLE IF NOT EXISTS sentinel_audit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id        uuid NOT NULL,
  account_id    text,
  agent         text NOT NULL,
  model_used    text,
  attempts      integer,
  fallback_used boolean,
  latency_ms    integer,
  ok            boolean,
  ts            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sentinel_audit_run_idx ON sentinel_audit (run_id);
ALTER TABLE sentinel_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON sentinel_audit FROM anon, authenticated;
```

## 16. Integrity rules

FK graph (all declared in the seed DDL; verified with 0 violations after the seed):

```
customers --1:N--> accounts --1:N--> transactions
    |                 |                  |
    |                 |                  +--1:1--> transaction_scores (transaction_id PK+FK; account_id FK)
    |                 +--1:N--> compliance_alerts (account_id; transaction_id N:1 nullable to transactions)
    |                 +--1:N--> chargebacks       (account_id; transaction_id N:1 to transactions)
    |                 +--1:1--> account_scores    (account_id PK+FK; customer_id FK, denormalized)
    +--1:N--> sanctions_screening (customer_id)
    +--1:0..1--> customer_scores  (customer_id PK+FK; only the 59 scored customers have a row)

cleaning_log: no FKs — cleaning-pipeline metadata
raw_* tables: no keys or FKs — all-text pre-cleaning layer, isolated from the clean schema
sentinel_usage / sentinel_ip_usage / sentinel_audit: no FKs — operational, isolated from the dataset
```

Row counts printed by each generator (verified against the source data):

| Table | Rows | Table | Rows |
|---|---|---|---|
| `customers` | 83 | `account_scores` | 105 |
| `accounts` | 105 | `transaction_scores` | 1,600 |
| `transactions` | 1,600 | `customer_scores` | 59 |
| `compliance_alerts` | 65 | `cleaning_log` | 31 |
| `sanctions_screening` | 95 | `raw_transactions` | 1,618 |
| `chargebacks` | 70 | (raw layer, see §12) | |

RLS / privilege matrix:

| Group | RLS | Policy | anon/authenticated privileges |
|---|---|---|---|
| 10 clean seed tables + 6 raw source tables | ON | `{table}_read_only` — SELECT for anon and authenticated | SELECT only; INSERT/UPDATE/DELETE/TRUNCATE revoked |
| 3 operational tables | ON | NONE (on purpose) | `REVOKE ALL` — nothing; only the service role touches them. `EXECUTE` on `sentinel_hit` is also revoked from PUBLIC/anon/authenticated |

## 17. Limits and scale

- **Supabase free tier**: the full dataset (~5.9k rows across the clean seed and raw source layers,
  plus tiny operational tables) is orders of magnitude below any storage or bandwidth limit; the only
  real operational limit is the project's inactivity pause (TRD §1).
- **Static dataset**: at runtime nobody writes the clean seed tables or the raw tables; only
  `sentinel_audit` (5 rows per run, effective cap 250 runs/day from the rate limit) and the counters
  grow (`sentinel_ip_usage` self-cleans to 1 day inside the RPC itself; `sentinel_usage` is 1 row per
  day).
- **Idempotent re-seed via DROP CASCADE**: `seed.sql` opens with `DROP TABLE IF EXISTS {table} CASCADE`
  in reverse dependency order and recreates everything (DDL + data + RLS) in a single pass;
  `raw_seed.sql` does the same for the `raw_*` tables. Re-running the generators + `apply_seed.py`
  leaves the database identical with no manual steps. The operational tables live outside the seed and
  survive a re-seed.
- **Growth path**: if the dataset grew, the INSERTs already run in batches of 200 and the board's reads
  already paginate with Range + tiebreaker (TRD §3); the change needed would be to move the client-side
  aggregates into read-only views or RPCs.
