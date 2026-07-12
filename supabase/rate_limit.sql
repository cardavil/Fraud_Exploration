-- Sentinel usage guard: per-IP minute window + global daily cap, enforced in
-- Postgres (edge isolates don't share memory, so in-process counters can't
-- enforce anything). Service-role only. Applied through the Management API.

DROP FUNCTION IF EXISTS sentinel_hit(integer);

CREATE TABLE IF NOT EXISTS sentinel_usage (
  day  date PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sentinel_ip_usage (
  ip     text NOT NULL,
  minute timestamptz NOT NULL,
  hits   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, minute)
);
ALTER TABLE sentinel_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel_ip_usage ENABLE ROW LEVEL SECURITY;
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
