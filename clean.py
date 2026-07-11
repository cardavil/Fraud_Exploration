"""
Data cleaning pipeline — Risk & Compliance dummy dataset.
Every treatment is logged to outputs/cleaning_log.csv (audit trail).
"""
import sqlite3
import pandas as pd
import numpy as np

SRC = "data/Risk_and_compliance_dummy_dataset.db"
OUT_DB = "data/clean.db"
LOG = []

def log(table, issue, treatment, rows):
    LOG.append({"table": table, "issue": issue, "treatment": treatment, "rows_affected": int(rows)})

con = sqlite3.connect(SRC)
tables = ["customers", "accounts", "transactions", "compliance_alerts",
          "sanctions_screening", "chargebacks"]
T = {t: pd.read_sql(f"SELECT * FROM {t}", con) for t in tables}

# ---------- generic treatments ----------
def strip_whitespace(df, name):
    n = 0
    for col in df.select_dtypes("object"):
        changed = df[col].notna() & (df[col] != df[col].str.strip())
        n += changed.sum()
        df[col] = df[col].str.strip()
    log(name, "Leading/trailing whitespace in text fields", "str.strip() on all text columns", n)

def title_case(df, name, cols):
    for col in cols:
        changed = (df[col].notna() & (df[col] != df[col].str.title())).sum()
        if changed:
            df[col] = df[col].str.title()
            log(name, f"Inconsistent casing in {col}", "Normalized to Title Case", changed)

def drop_pk_dupes(df, name, pk):
    n = df.duplicated(subset=pk).sum()
    if n:
        df.drop_duplicates(subset=pk, keep="first", inplace=True)
        log(name, f"Duplicate {pk} values", "Kept first occurrence, dropped rest", n)
    return df

# ---------- customers ----------
c = T["customers"]
strip_whitespace(c, "customers")
title_case(c, "customers", ["nationality"])
c["nationality"] = c["nationality"].replace({"United Kingdom": "United Kingdom"})
n = (c["pep_flag"] == "").sum()
c["pep_flag"] = c["pep_flag"].replace("", "Unknown")
log("customers", "Empty pep_flag values", "Recoded as 'Unknown' (not assumed 'No')", n)
n = c["nationality"].isna().sum()
c["nationality"] = c["nationality"].fillna("Unknown")
log("customers", "Missing nationality", "Recoded as 'Unknown'", n)
n = c["occupation"].isna().sum()
c["occupation"] = c["occupation"].fillna("Unknown")
log("customers", "Missing occupation", "Recoded as 'Unknown'", n)
c = drop_pk_dupes(c, "customers", "customer_id")
T["customers"] = c

# ---------- accounts ----------
a = T["accounts"]
strip_whitespace(a, "accounts")
title_case(a, "accounts", ["status", "branch_country"])
n = a["currency"].isna().sum()
a["currency"] = a["currency"].fillna("Unknown")
log("accounts", "Missing currency", "Recoded as 'Unknown'", n)
neg = (a["account_balance"] < 0).sum()
log("accounts", "Negative account balances", "Kept — flagged as data-quality/overdraft finding, not altered", neg)
n = a["account_balance"].isna().sum()
log("accounts", "Missing account_balance", "Kept as NULL — excluded from balance aggregations", n)
a = drop_pk_dupes(a, "accounts", "account_id")
T["accounts"] = a

# ---------- transactions ----------
tx = T["transactions"]
strip_whitespace(tx, "transactions")
title_case(tx, "transactions", ["transaction_type"])
tx["transaction_type"] = tx["transaction_type"].replace({"Ach Transfer": "ACH Transfer"})
n = (tx["amount"] <= 0).sum()
log("transactions", "Zero/negative amounts", "Kept — flagged for review (possible reversals/errors)", n)
n = tx["amount"].isna().sum()
log("transactions", "Missing amounts", "Kept as NULL — excluded from value aggregations", n)
n = tx["counterparty_country"].isna().sum()
tx["counterparty_country"] = tx["counterparty_country"].fillna("Unknown")
log("transactions", "Missing counterparty_country", "Recoded as 'Unknown' — treated as elevated risk (KYC gap)", n)
tx = drop_pk_dupes(tx, "transactions", "transaction_id")
T["transactions"] = tx

# ---------- compliance_alerts ----------
al = T["compliance_alerts"]
strip_whitespace(al, "compliance_alerts")
n = (al["severity"] != al["severity"].str.title()).sum()
al["severity"] = al["severity"].str.title()
log("compliance_alerts", "Inconsistent severity casing", "Normalized to Title Case", n)
al["status"] = al["status"].str.title().replace({
    "Closed - Sar Filed": "Closed - SAR Filed",
    "Closed - False Positive": "Closed - False Positive",
})
log("compliance_alerts", "Inconsistent status casing", "Normalized", 0)
n = al["assigned_analyst"].isna().sum()
al["assigned_analyst"] = al["assigned_analyst"].fillna("Unassigned")
log("compliance_alerts", "Alerts with no assigned analyst", "Recoded 'Unassigned' — operational finding", n)
al = drop_pk_dupes(al, "compliance_alerts", "alert_id")
T["compliance_alerts"] = al

# ---------- sanctions_screening ----------
sc = T["sanctions_screening"]
strip_whitespace(sc, "sanctions_screening")
sc["match_result"] = sc["match_result"].str.title()
log("sanctions_screening", "Inconsistent match_result casing", "Normalized to Title Case", 0)
n = sc["reviewed_by"].isna().sum()
sc["reviewed_by"] = sc["reviewed_by"].fillna("Unreviewed")
log("sanctions_screening", "Screenings with no reviewer", "Recoded 'Unreviewed' — control finding", n)
sc = drop_pk_dupes(sc, "sanctions_screening", "screening_id")
T["sanctions_screening"] = sc

# ---------- chargebacks ----------
cb = T["chargebacks"]
strip_whitespace(cb, "chargebacks")
title_case(cb, "chargebacks", ["merchant_name"])
cb["merchant_name"] = cb["merchant_name"].replace({
    "Technest Electronics": "TechNest Electronics",
    "Skyway Airlines": "SkyWay Airlines",
    "Quickmart Online": "QuickMart Online",
    "Greenleaf Grocers": "GreenLeaf Grocers",
    "Urbanfit Gear": "UrbanFit Gear",
    "Streamflix Media": "StreamFlix Media",
})
cb = drop_pk_dupes(cb, "chargebacks", "chargeback_id")
T["chargebacks"] = cb

# ---------- date typing ----------
DATE_COLS = {
    "customers": ["date_of_birth", "onboarding_date"],
    "accounts": ["open_date"],
    "transactions": ["transaction_date"],
    "compliance_alerts": ["alert_date", "resolution_date"],
    "sanctions_screening": ["screening_date"],
    "chargebacks": ["chargeback_date", "resolution_date"],
}
for t, cols in DATE_COLS.items():
    for col in cols:
        T[t][col] = pd.to_datetime(T[t][col], errors="coerce").dt.date.astype("str").replace("NaT", None)

# ---------- write ----------
out = sqlite3.connect(OUT_DB)
for t in tables:
    T[t].to_sql(t, out, if_exists="replace", index=False)
out.close()

logdf = pd.DataFrame(LOG)
logdf.to_csv("outputs/cleaning_log.csv", index=False)
print(logdf.to_string(index=False))
print("\nClean row counts:", {t: len(T[t]) for t in tables})
