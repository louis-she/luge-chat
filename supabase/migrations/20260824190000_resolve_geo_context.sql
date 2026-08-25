-- 一次调用拿齐「我在哪 + 什么场景」，替代高德 regeo。
--
-- 场景为什么不用行政区判：实测 L8（乡镇/街道）在 OSM 里只覆盖 65.7% 的点，
-- 而且缺得没规律 —— 可可西里无人区有「索加乡」，康定城区反而没有街道。
-- 改用 place 点的距离，实测靠谱：成都天府广场 380m 有 city，昌都城区 404m 有 city，
-- 318 国道折多山最近的村也在 9km 外。
-- 行政区（L5/L6 覆盖 98.2%）只用来告诉模型「你在甘孜州康定市」。

create or replace function dev.resolve_geo_context(
  p_lat double precision,
  p_lng double precision
)
returns table (
  province text,
  city text,
  county text,
  township text,
  scene text,
  nearest_place_name text,
  nearest_place_kind text,
  nearest_place_m integer
)
language sql
stable
security definer
set search_path = dev, public
as $$
  with probe as (
    select
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326) as pt,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography as gpt
  ),
  adm as (
    select
      (select a.area_name from dev.geo_admin_areas a, probe
        where a.admin_level = 4 and dev.st_covers(a.geom, probe.pt)
        order by dev.st_area(a.geom) limit 1) as province,
      (select a.area_name from dev.geo_admin_areas a, probe
        where a.admin_level = 5 and dev.st_covers(a.geom, probe.pt)
        order by dev.st_area(a.geom) limit 1) as city,
      (select a.area_name from dev.geo_admin_areas a, probe
        where a.admin_level in (6, 7) and dev.st_covers(a.geom, probe.pt)
        order by dev.st_area(a.geom) limit 1) as county,
      (select a.area_name from dev.geo_admin_areas a, probe
        where a.admin_level in (8, 9) and dev.st_covers(a.geom, probe.pt)
        order by dev.st_area(a.geom) limit 1) as township
  ),
  near as (
    select
      (select min(dev.st_distance(g.geom, probe.gpt))
        from dev.geo_landmarks_cache g, probe
        where g.metadata->>'place' = 'city'
          and dev.st_dwithin(g.geom, probe.gpt, 5000)) as d_city,
      (select min(dev.st_distance(g.geom, probe.gpt))
        from dev.geo_landmarks_cache g, probe
        where g.metadata->>'place' = 'town'
          and dev.st_dwithin(g.geom, probe.gpt, 3000)) as d_town,
      (select min(dev.st_distance(g.geom, probe.gpt))
        from dev.geo_landmarks_cache g, probe
        where g.metadata->>'place' = 'village'
          and dev.st_dwithin(g.geom, probe.gpt, 2000)) as d_village
  ),
  -- 行政区缺失时至少能说「XX镇附近」，别让模型只拿到一串经纬度
  spot as (
    select g.landmark_name, g.metadata->>'place' as kind,
           dev.st_distance(g.geom, probe.gpt) as d
    from dev.geo_landmarks_cache g, probe
    where g.metadata->>'place' in ('city', 'town', 'village')
      and dev.st_dwithin(g.geom, probe.gpt, 25000)
    order by d
    limit 1
  )
  select
    adm.province,
    adm.city,
    adm.county,
    adm.township,
    case
      when near.d_city <= 3000 then 'urban'
      when adm.township like '%街道' then 'urban'
      when near.d_town <= 1500 then 'town'
      when near.d_village <= 1000 then 'town'
      else 'wild'
    end as scene,
    spot.landmark_name,
    spot.kind,
    round(spot.d)::integer
  from adm, near
  left join spot on true;
$$;

comment on function dev.resolve_geo_context is
  '坐标 → 行政区 + 城/镇/野场景 + 最近聚落，取代高德 regeo';
