// Public client configuration. The anon key is safe to ship: every table is
// RLS-protected with SELECT-only policies (see supabase/seed.sql).
window.FE_CONFIG = {
  SUPABASE_URL: "https://tbvuznyawebgrblwlrxy.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRidnV6bnlhd2ViZ3JibHdscnh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4Mjk2NTgsImV4cCI6MjA5OTQwNTY1OH0.fVVnUtvfwAn-P6V_V_bhCLpbikF3kW8qWlBh4JOJrZo",
  SENTINEL_URL: "https://tbvuznyawebgrblwlrxy.supabase.co/functions/v1/sentinel",
  // Power BI "Publish to web" (public) embed for the Layer-1 report. Public by
  // design — dummy dataset only, same privacy note as the rest of the board.
  POWERBI_URL:
    "https://app.powerbi.com/view?r=eyJrIjoiYWM1ZjY0ZWUtZjljZS00ZWExLWFmMTctNmYwYmNlODY4Nzk1IiwidCI6ImVkNWJkY2VkLTY5OGYtNDg0MS04ZjA3LTE4ZTFkODgwMGRjMSIsImMiOjR9",
};
