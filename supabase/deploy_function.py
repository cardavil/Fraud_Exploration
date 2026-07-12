"""
Deploy the copilot Edge Function through the Supabase Management API
(multipart upload — no Docker, no CLI). Auth: SUPABASE_ACCESS_TOKEN env var.

Run from the repo root: python supabase/deploy_function.py
"""
import json
import os
import sys
import urllib.request
import uuid

REF = os.environ.get("SUPABASE_PROJECT_REF", "tbvuznyawebgrblwlrxy")
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
SLUG = "copilot"
SOURCE = "supabase/functions/copilot/index.ts"
URL = f"https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={SLUG}"

metadata = {"name": SLUG, "entrypoint_path": "index.ts", "verify_jwt": True}
source = open(SOURCE, "rb").read()

boundary = uuid.uuid4().hex
body = b"".join([
    f"--{boundary}\r\n".encode(),
    b'Content-Disposition: form-data; name="metadata"\r\n',
    b"Content-Type: application/json\r\n\r\n",
    json.dumps(metadata).encode(), b"\r\n",
    f"--{boundary}\r\n".encode(),
    b'Content-Disposition: form-data; name="file"; filename="index.ts"\r\n',
    b"Content-Type: application/typescript\r\n\r\n",
    source, b"\r\n",
    f"--{boundary}--\r\n".encode(),
])

req = urllib.request.Request(URL, data=body, method="POST", headers={
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": f"multipart/form-data; boundary={boundary}",
    "User-Agent": "fraud-exploration-deployer/1.0",
})
try:
    with urllib.request.urlopen(req, timeout=120) as resp:
        out = json.loads(resp.read())
        print("HTTP", resp.status, "-", out.get("status"), "version", out.get("version"))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode()[:2000], file=sys.stderr)
    sys.exit(1)
