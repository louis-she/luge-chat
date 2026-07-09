-- Dev schema: bump updated_at on footprint tables (mirror public triggers)

create or replace function dev.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dev_user_footprints_set_updated_at on dev.user_footprints;
create trigger dev_user_footprints_set_updated_at
  before update on dev.user_footprints
  for each row execute function dev.set_updated_at();

drop trigger if exists dev_footprint_visits_set_updated_at on dev.footprint_visits;
create trigger dev_footprint_visits_set_updated_at
  before update on dev.footprint_visits
  for each row execute function dev.set_updated_at();
