-- 行政区边界：替代高德 regeo 的 addressComponent。
-- 点在多边形内即可得到「省 / 地级市 / 县 / 乡镇街道」，喂给讲解模型当位置上下文，
-- 同时用「落在街道 vs 镇 vs 什么都不落」直接判场景，比正则匹配地址串靠谱。
--
-- 中国 OSM 层级约定：L4 省·直辖市·自治区，L5 地级市·自治州，L6 县·县级市·区，
-- L7 功能区，L8 镇·乡·街道，L9 更细的街道。

create table if not exists dev.geo_admin_areas (
  id uuid primary key default gen_random_uuid(),
  osm_ref text not null,
  area_name text not null,
  admin_level smallint not null,
  -- 只做点在多边形，平面几何足够且比 geography 快
  geom dev.geometry(Geometry, 4326) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table dev.geo_admin_areas is
  'OSM 行政区边界，供逆地理与场景判定使用（取代高德 regeo）';

create unique index if not exists dev_geo_admin_areas_osm_ref_uidx
  on dev.geo_admin_areas (osm_ref);

create index if not exists dev_geo_admin_areas_geom_gix
  on dev.geo_admin_areas using gist (geom);

create index if not exists dev_geo_admin_areas_level_idx
  on dev.geo_admin_areas (admin_level);

/** 当前坐标命中的行政区，由粗到细 */
create or replace function dev.resolve_geo_admin(
  p_lat double precision,
  p_lng double precision
)
returns table (
  admin_level smallint,
  area_name text
)
language sql
stable
security definer
set search_path = dev, public
as $$
  select a.admin_level, a.area_name
  from dev.geo_admin_areas a
  where dev.st_covers(
    a.geom,
    dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)
  )
  order by a.admin_level, length(a.area_name)
  limit 12;
$$;

comment on function dev.resolve_geo_admin is
  '坐标落在哪些行政区内，由省到乡镇；替代高德 regeo 的 addressComponent';
