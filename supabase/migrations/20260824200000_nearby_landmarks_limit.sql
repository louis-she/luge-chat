-- 主动讲解要一次取 40 条候选交给模型挑，问路只要 8 条；原函数把 limit 写死成 8。
-- 另外主动讲解不该播报村庄 —— 库里 28 万个 place=village，自动讲「前方 800 米
-- 是张庄村」毫无价值；问路时用户主动问「这是什么村」仍然需要，所以做成开关。

drop function if exists dev.nearby_geo_landmarks(double precision, double precision, integer);

create or replace function dev.nearby_geo_landmarks(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 3000,
  p_limit integer default 8,
  p_skip_village boolean default false
)
returns table (
  id uuid,
  landmark_name text,
  landmark_type dev.landmark_type,
  ai_formatted_story text,
  distance_m double precision,
  lat double precision,
  lng double precision,
  source dev.landmark_cache_source,
  amap_poi_id text,
  valid_until timestamptz,
  hit_count integer,
  metadata jsonb
)
language sql
stable
security definer
set search_path = dev, public
as $$
  with probe as (
    select dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326) as pt
  ),
  hit as (
    select
      g.*,
      dev.st_distance(g.geom, probe.pt::dev.geography) as distance_m,
      dev.st_closestpoint(g.geom::dev.geometry, probe.pt) as near_pt
    from dev.geo_landmarks_cache g, probe
    where g.valid_until > now()
      and dev.st_dwithin(
        g.geom,
        probe.pt::dev.geography,
        p_radius_m::double precision
      )
      and (
        not p_skip_village
        or coalesce(g.metadata->>'place', '') not in ('village', 'hamlet')
      )
  )
  select
    h.id,
    h.landmark_name,
    h.landmark_type,
    h.ai_formatted_story,
    h.distance_m,
    dev.st_y(h.near_pt) as lat,
    dev.st_x(h.near_pt) as lng,
    h.source,
    h.amap_poi_id,
    h.valid_until,
    h.hit_count,
    h.metadata
  from hit h
  where h.distance_m <= least(p_radius_m, h.search_radius_m)::double precision
  order by h.distance_m
  limit greatest(p_limit, 1);
$$;

comment on function dev.nearby_geo_landmarks is
  '用户位置附近未过期的地理缓存；lat/lng 为地物上离用户最近的点';
