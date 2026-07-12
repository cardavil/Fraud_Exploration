"""
Extract before/after examples for every step in outputs/cleaning_log.csv by
diffing the raw SQLite against clean.db, aligned per primary key (keep-first
for duplicates, mirroring analysis/clean.py). Powers the expandable rows of
the board's EDA step 2.

Output: app/data/cleaning_examples.json
  { "<step_id>": { "kind": "fixed" | "kept" | "dropped",
                   "examples": [ { "key", "column", "before", "after" } ] } }

Run from the repo root: python analysis/export_cleaning_examples.py
"""
import json
import re
import sqlite3

import pandas as pd

RAW = "data/Risk_and_compliance_dummy_dataset.db"
CLEAN = "data/clean.db"
OUT = "app/data/cleaning_examples.json"
MAX_EXAMPLES = 3

PKS = {
    "customers": "customer_id",
    "accounts": "account_id",
    "transactions": "transaction_id",
    "compliance_alerts": "alert_id",
    "sanctions_screening": "screening_id",
    "chargebacks": "chargeback_id",
}

raw_con = sqlite3.connect(RAW)
clean_con = sqlite3.connect(CLEAN)
raw = {}
clean = {}
for table, pk in PKS.items():
    r = pd.read_sql(f"SELECT * FROM {table}", raw_con)
    raw[table] = r.drop_duplicates(subset=pk, keep="first").set_index(pk, drop=False)
    clean[table] = pd.read_sql(f"SELECT * FROM {table}", clean_con).set_index(pk, drop=False)


def show(v):
    """Render a cell the way the analyst should see it (visible whitespace, explicit NULL)."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "∅ (null)"
    if isinstance(v, str):
        return f"'{v}'" if v != v.strip() or v == "" else v
    return v


def pair(table, key, column, before, after):
    return {"key": str(key), "column": column, "before": show(before), "after": show(after)}


def whitespace_examples(table):
    out = []
    r, c = raw[table], clean[table]
    for col in r.select_dtypes("object"):
        for key, v in r[col].items():
            if isinstance(v, str) and v != v.strip() and key in c.index:
                out.append(pair(table, key, col, v, c.at[key, col]))
                if len(out) >= MAX_EXAMPLES:
                    return out
    return out


def diff_examples(table, column):
    """Value changed between raw (stripped) and clean — casing, recodes, renames."""
    out = []
    r, c = raw[table], clean[table]
    for key, v in r[column].items():
        if key not in c.index:
            continue
        stripped = v.strip() if isinstance(v, str) else v
        after = c.at[key, column]
        if pd.notna(v) and stripped != after and str(stripped) != str(after):
            out.append(pair(table, key, column, stripped, after))
            if len(out) >= MAX_EXAMPLES:
                return out
    return out


def recode_examples(table, column, empty_string=False):
    """NULL (or '') in raw recoded to a sentinel in clean."""
    out = []
    r, c = raw[table], clean[table]
    mask = (r[column] == "") if empty_string else r[column].isna()
    for key in r.index[mask]:
        if key in c.index:
            out.append(pair(table, key, column, "" if empty_string else None, c.at[key, column]))
            if len(out) >= MAX_EXAMPLES:
                break
    return out


def dropped_examples(table, pk):
    full = pd.read_sql(f"SELECT {pk} FROM {table}", raw_con)[pk]
    dupes = full.value_counts()
    return [{"key": str(k), "column": pk, "before": f"{n} copies", "after": "1 kept"}
            for k, n in dupes[dupes > 1].head(MAX_EXAMPLES).items()]


def kept_examples(table, column, condition):
    out = []
    c = clean[table]
    for key, row in c[condition(c)].head(MAX_EXAMPLES).iterrows():
        v = row[column]
        out.append(pair(table, key, column, v, v))
    return out


# (issue regex, kind, extractor) — checked in order against each log row.
RULES = [
    (r"whitespace", "fixed", lambda t, m: whitespace_examples(t)),
    (r"casing in (\w+)", "fixed", lambda t, m: diff_examples(t, m.group(1))),
    (r"severity casing", "fixed", lambda t, m: diff_examples(t, "severity")),
    (r"status casing", "fixed", lambda t, m: diff_examples(t, "status")),
    (r"match_result casing", "fixed", lambda t, m: diff_examples(t, "match_result")),
    (r"Empty pep_flag", "fixed", lambda t, m: recode_examples(t, "pep_flag", empty_string=True)),
    (r"Missing nationality", "fixed", lambda t, m: recode_examples(t, "nationality")),
    (r"Missing occupation", "fixed", lambda t, m: recode_examples(t, "occupation")),
    (r"Missing currency", "fixed", lambda t, m: recode_examples(t, "currency")),
    (r"Missing counterparty_country", "fixed", lambda t, m: recode_examples(t, "counterparty_country")),
    (r"no assigned analyst", "fixed", lambda t, m: recode_examples(t, "assigned_analyst")),
    (r"no reviewer", "fixed", lambda t, m: recode_examples(t, "reviewed_by")),
    (r"Duplicate (\w+) values", "dropped", lambda t, m: dropped_examples(t, m.group(1))),
    (r"Zero/negative amounts", "kept", lambda t, m: kept_examples(t, "amount", lambda d: d.amount <= 0)),
    (r"Negative account balances", "kept", lambda t, m: kept_examples(t, "account_balance", lambda d: d.account_balance < 0)),
    (r"Missing account_balance", "kept", lambda t, m: kept_examples(t, "account_balance", lambda d: d.account_balance.isna())),
    (r"Missing amounts", "kept", lambda t, m: kept_examples(t, "amount", lambda d: d.amount.isna())),
]

log = pd.read_csv("outputs/cleaning_log.csv").rename(columns={"table": "table_name"})
result = {}
for step_id, row in enumerate(log.itertuples(index=False), start=1):
    entry = {"kind": "fixed", "examples": []}
    for pattern, kind, extractor in RULES:
        m = re.search(pattern, row.issue)
        if m:
            entry = {"kind": kind, "examples": extractor(row.table_name, m)}
            break
    result[str(step_id)] = entry

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=1, ensure_ascii=False)

covered = sum(1 for v in result.values() if v["examples"])
print(f"Wrote {OUT}: {covered}/{len(result)} steps with examples")
for sid, v in result.items():
    issue = log.iloc[int(sid) - 1]
    print(f"  {sid:>2} [{v['kind']:^7}] {issue.table_name}/{issue.issue[:48]:<48} -> {len(v['examples'])} ej.")
