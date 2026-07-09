-- Expose dev schema to PostgREST (same role grants as public).
-- Requires PGRST_DB_SCHEMAS to include dev on the API gateway.
--
-- Self-hosted note: dev schema owner is supabase_admin; on production run as:
--   docker exec -i supabase-db psql -U supabase_admin -d postgres < this_file.sql

grant usage on schema dev to postgres, anon, authenticated, service_role;

grant all on all tables in schema dev to service_role;
grant select on all tables in schema dev to anon, authenticated;

grant all on all sequences in schema dev to service_role;
grant usage on all sequences in schema dev to anon, authenticated;

grant execute on all functions in schema dev to service_role;
grant execute on all functions in schema dev to anon, authenticated;

alter default privileges in schema dev
  grant all on tables to service_role;

alter default privileges in schema dev
  grant select on tables to anon, authenticated;

alter default privileges in schema dev
  grant all on sequences to service_role;

alter default privileges in schema dev
  grant usage on sequences to anon, authenticated;

alter default privileges in schema dev
  grant execute on functions to service_role;

alter default privileges in schema dev
  grant execute on functions to anon, authenticated;

grant all on all tables in schema dev to service_role;
grant select on all tables in schema dev to anon, authenticated;

grant all on all sequences in schema dev to service_role;
grant usage on all sequences in schema dev to anon, authenticated;

grant execute on all functions in schema dev to service_role;
grant execute on all functions in schema dev to anon, authenticated;

alter default privileges in schema dev
  grant all on tables to service_role;

alter default privileges in schema dev
  grant select on tables to anon, authenticated;

alter default privileges in schema dev
  grant all on sequences to service_role;

alter default privileges in schema dev
  grant usage on sequences to anon, authenticated;

alter default privileges in schema dev
  grant execute on functions to service_role;

alter default privileges in schema dev
  grant execute on functions to anon, authenticated;
