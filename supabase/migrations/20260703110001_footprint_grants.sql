grant execute on function public.nearby_user_footprints(uuid, double precision, double precision, integer)
  to service_role, authenticated;

grant select on public.user_footprints to authenticated, service_role;
grant select on public.footprint_visits to authenticated, service_role;
grant select on public.footprint_messages to authenticated, service_role;

grant all on public.user_footprints to service_role;
grant all on public.footprint_visits to service_role;
grant all on public.footprint_messages to service_role;

grant usage on all sequences in schema public to service_role;
