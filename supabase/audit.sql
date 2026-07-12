-- Per-agent audit trail for the copilot pipeline. Service-role only:
-- RLS enabled with no policies, all privileges revoked from client roles.
-- Applied once through the Management API (same flow as rate_limit.sql).

CREATE TABLE IF NOT EXISTS copilot_audit (
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
CREATE INDEX IF NOT EXISTS copilot_audit_run_idx ON copilot_audit (run_id);
ALTER TABLE copilot_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON copilot_audit FROM anon, authenticated;
