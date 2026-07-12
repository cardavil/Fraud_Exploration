"""
Apply supabase/seed.sql to the Supabase project through the Management API.
No database password needed — auth is a personal access token in the
SUPABASE_ACCESS_TOKEN env var (never hardcoded, never committed).

Run from the repo root: python supabase/apply_seed.py
"""
import json
import os
import sys
import urllib.request

REF = os.environ.get("SUPABASE_PROJECT_REF", "tbvuznyawebgrblwlrxy")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
URL = f"https://api.supabase.com/v1/projects/{REF}/database/query"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "fraud-exploration-seeder/1.0",  # Cloudflare WAF rejects urllib's default UA
}

sql = open("supabase/seed.sql", encoding="utf-8").read()
req = urllib.request.Request(
    URL,
    data=json.dumps({"query": sql}).encode(),
    headers=HEADERS,
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        print("HTTP", resp.status)
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:2000], file=sys.stderr)
    sys.exit(1)

TABLES = ["customers", "accounts", "transactions", "compliance_alerts",
          "sanctions_screening", "chargebacks", "account_scores"]
counts = " UNION ALL ".join(
    f"SELECT '{t}' AS tbl, COUNT(*) AS rows, "
    f"(SELECT relrowsecurity FROM pg_class WHERE oid = '{t}'::regclass) AS rls "
    f"FROM {t}" for t in TABLES
)
check = urllib.request.Request(
    URL,
    data=json.dumps({"query": counts}).encode(),
    headers=HEADERS,
    method="POST",
)
with urllib.request.urlopen(check, timeout=60) as resp:
    for row in json.loads(resp.read()):
        print(row)
