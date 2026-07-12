"""
Load the analytical layer into BigQuery: the 6 cleaned tables plus the three
model-score tables, into dataset `fraud_exploration`.

Auth (either):
  - gcloud auth application-default login          (user credentials), or
  - GOOGLE_APPLICATION_CREDENTIALS=<sa.json path>  (service account)

Run from the repo root: python analysis/load_bigquery.py [project_id]
Defaults to project id 'fraud-exploration'.
"""
import sqlite3
import sys

import pandas as pd
import pandas_gbq

PROJECT = sys.argv[1] if len(sys.argv) > 1 else "fraud-exploration"
DATASET = "fraud_exploration"

con = sqlite3.connect("data/clean.db")
tables = {t: pd.read_sql(f"SELECT * FROM {t}", con) for t in [
    "customers", "accounts", "transactions",
    "compliance_alerts", "sanctions_screening", "chargebacks",
]}
tables["transaction_scores"] = pd.read_csv("outputs/transaction_scores.csv")
tables["account_scores"] = pd.read_csv("outputs/account_features_scores.csv")
tables["customer_scores"] = pd.read_csv("outputs/customer_scores.csv")

for name, df in tables.items():
    pandas_gbq.to_gbq(df, f"{DATASET}.{name}", project_id=PROJECT, if_exists="replace")
    print(f"{DATASET}.{name}: {len(df)} rows")

print(f"\nDone — {len(tables)} tables in BigQuery project '{PROJECT}'.")
