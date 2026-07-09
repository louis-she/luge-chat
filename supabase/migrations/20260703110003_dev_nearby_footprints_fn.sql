create or replace function dev.nearby_user_footprints(
  p_user_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 30000
)
returns table (
  id uuid,
  poi_name text,
  poi_type dev.footprint_poi_type,
  title text,
  summary text,
  llm_notes text,
  distance_m double precision,
  lat double precision,
  lng double precision,
  visit_count bigint,
  last_visit_at timestamptz
)
language sql
stable
as $$
  select
    f.id,
    f.poi_name,
    f.poi_type,
    f.title,
    f.summary,
    f.llm_notes,
    dev.st_distance(
      f.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography
    ) as distance_m,
    dev.st_y(f.geom::dev.geometry) as lat,
    dev.st_x(f.geom::dev.geometry) as lng,
    count(v.id) as visit_count,
    max(v.started_at) as last_visit_at
  from dev.user_footprints f
  left join dev.footprint_visits v on v.footprint_id = f.id
  where f.user_id = p_user_id
    and dev.st_dwithin(
      f.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography,
      p_radius_m
    )
  group by f.id
  order by distance_m asc
  limit 12;
$$;

grant execute on function dev.nearby_user_footprints(uuid, double precision, double precision, integer)
  to service_role, authenticated;
