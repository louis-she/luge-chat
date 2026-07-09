-- Expose public schema tables to Supabase API roles (PostgREST)
grant usage on schema public to postgres, anon, authenticated, service_role;

grant all on public.users to service_role;
grant all on public.call_sessions to service_role;
grant all on public.dialog_messages to service_role;
grant all on public.geo_landmarks_cache to service_role;

grant select on public.users to anon, authenticated;
grant select on public.call_sessions to anon, authenticated;
grant select on public.dialog_messages to anon, authenticated;
grant select on public.geo_landmarks_cache to anon, authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant select on tables to anon, authenticated;
