"""
Generate supabase/seed.sql from data/clean.db + outputs/account_features_scores.csv.

Emits, for the 6 cleaned tables plus the derived account_scores table:
  - DROP/CREATE with primary and foreign keys (dependency order)
  - full INSERTs in batches
  - RLS enabled on every table, one SELECT-only policy for anon/authenticated,
    explicit REVOKE of all write privileges (defense in depth on top of RLS)

Run from the repo root: python supabase/generate_seed.py
"""
import sqlite3
import math
import pandas as pd

OUT = "supabase/seed.sql"
BATCH = 200

DDL = {
    "customers": """CREATE TABLE customers (
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
);""",
    "accounts": """CREATE TABLE accounts (
  account_id      text PRIMARY KEY,
  customer_id     text REFERENCES customers(customer_id),
  account_type    text,
  currency        text,
  open_date       date,
  status          text,
  branch_country  text,
  account_balance numeric(14,2)
);""",
    "transactions": """CREATE TABLE transactions (
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
);""",
    "compliance_alerts": """CREATE TABLE compliance_alerts (
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
);""",
    "sanctions_screening": """CREATE TABLE sanctions_screening (
  screening_id   text PRIMARY KEY,
  customer_id    text REFERENCES customers(customer_id),
  screening_date date,
  list_checked   text,
  match_result   text,
  reviewed_by    text,
  review_status  text
);""",
    "chargebacks": """CREATE TABLE chargebacks (
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
);""",
    "transaction_scores": """CREATE TABLE transaction_scores (
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
);""",
    "customer_scores": """CREATE TABLE customer_scores (
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
);""",
    "cleaning_log": """CREATE TABLE cleaning_log (
  step_id       integer PRIMARY KEY,
  table_name    text,
  issue         text,
  treatment     text,
  rows_affected integer
);""",
    "account_scores": """CREATE TABLE account_scores (
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
);""",
}

ORDER = ["customers", "accounts", "transactions", "compliance_alerts",
         "sanctions_screening", "chargebacks", "account_scores",
         "transaction_scores", "customer_scores", "cleaning_log"]


def sql_literal(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    s = str(v)
    if s in ("", "None", "NaT", "nan"):
        return "NULL"
    if s in ("True", "False"):  # has_alert comes through the CSV as text
        return s.upper()
    return "'" + s.replace("'", "''") + "'"


def inserts(table, df):
    cols = ", ".join(df.columns)
    out = []
    for start in range(0, len(df), BATCH):
        rows = df.iloc[start:start + BATCH]
        values = ",\n".join(
            "(" + ", ".join(sql_literal(v) for v in row) + ")"
            for row in rows.itertuples(index=False, name=None)
        )
        out.append(f"INSERT INTO {table} ({cols}) VALUES\n{values};")
    return out


def rls(table):
    return [
        f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;",
        f"REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON {table} FROM anon, authenticated;",
        f'CREATE POLICY "{table}_read_only" ON {table} '
        "FOR SELECT TO anon, authenticated USING (true);",
    ]


con = sqlite3.connect("data/clean.db")
frames = {t: pd.read_sql(f"SELECT * FROM {t}", con) for t in ORDER[:6]}
frames["transaction_scores"] = pd.read_csv("outputs/transaction_scores.csv")
frames["customer_scores"] = pd.read_csv("outputs/customer_scores.csv")
frames["cleaning_log"] = (
    pd.read_csv("outputs/cleaning_log.csv").rename(columns={"table": "table_name"})
)
frames["cleaning_log"].insert(0, "step_id", range(1, len(frames["cleaning_log"]) + 1))
frames["account_scores"] = pd.read_csv("outputs/account_features_scores.csv")[
    [c.strip() for c in
     "account_id,n_tx,avg_amt,std_amt,max_amt,total,pct_hr,pct_off,pct_cash,"
     "pct_struct,pct_intl,tx_per_month,velocity_value,"
     "pct_txn_anomalous,max_txn_score,max_day_share,recent_intensity,"
     "anomaly,score,customer_id,"
     "status,branch_country,full_name,risk_rating,pep_flag,has_alert".split(",")]
]

parts = ["-- Generated by supabase/generate_seed.py — do not edit by hand.",
         "-- Read-only serving layer: RLS on, SELECT-only for anon, no write policies.",
         ""]
for t in reversed(ORDER):
    parts.append(f"DROP TABLE IF EXISTS {t} CASCADE;")
parts.append("")
for t in ORDER:
    parts += [DDL[t], ""]
    parts += inserts(t, frames[t]) + [""]
    parts += rls(t) + [""]

with open(OUT, "w", encoding="utf-8") as f:
    f.write("\n".join(parts))

print(f"Wrote {OUT}: " + ", ".join(f"{t}={len(frames[t])}" for t in ORDER))
