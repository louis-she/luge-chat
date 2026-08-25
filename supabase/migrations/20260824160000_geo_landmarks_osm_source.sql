-- OSM 底库：地理知识不再只靠高德命中沉淀，可预先灌入 OpenStreetMap 点位。
-- search_radius_m 按地物可见范围给（雪山 80km、村庄 3km），否则
-- nearby_geo_landmarks 里的 least(p_radius_m, search_radius_m) 会让远处大地物永远撞不上。

-- enum 两个 schema 都在，表目前只有 dev 一张
alter type dev.landmark_cache_source add value if not exists 'osm';
alter type public.landmark_cache_source add value if not exists 'osm';

-- 同一 OSM 对象重复导入时覆盖而非新增
create unique index if not exists dev_geo_landmarks_cache_external_ref_uidx
  on dev.geo_landmarks_cache (external_ref)
  where external_ref is not null;

comment on column dev.geo_landmarks_cache.external_ref is
  '非高德来源的外部标识，如 osm/node/12345、osm/way/678';

-- 高德时代缓存里只有点，st_y(geom) 取经纬度没问题；OSM 把河流存成 LineString、
-- 湖泊保护区存成 MultiPolygon 后 st_y 直接报错，整个 RPC 会挂。
-- 改成取「几何上离用户最近的点」：既能取到经纬度，报出来的方位距离也是岸边而非河段中心。
-- 另外把 st_dwithin 的距离换成常量 p_radius_m 让 GIST 索引吃得上，
-- 每行自己的 search_radius_m 留到粗筛之后再卡。
create or replace function dev.nearby_geo_landmarks(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 3000
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
  limit 8;
$$;

comment on function dev.nearby_geo_landmarks is
  '用户位置附近未过期的地理缓存，供问答 RAG 优先命中；lat/lng 为地物上离用户最近的点';
