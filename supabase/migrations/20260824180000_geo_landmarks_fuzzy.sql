-- ASR 把地名听错一两个字时的模糊撞库。
-- 以前靠高德宽搜 50 条再用近音规则过滤；换本地库后先用空间圈定候选（几百条），
-- 再按 trigram 相似度排序 —— 候选集本来就小，不需要 GIN 索引，走顺序扫更省空间。

create extension if not exists pg_trgm with schema dev;

create or replace function dev.fuzzy_geo_landmarks(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_name text,
  p_limit integer default 20
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
  similarity double precision,
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
      dev.st_closestpoint(g.geom::dev.geometry, probe.pt) as near_pt,
      dev.similarity(g.landmark_name, p_name) as sim
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
    h.sim::double precision as similarity,
    h.metadata
  from hit h
  -- 不设相似度阈值：三字地名首字听错时（「澜沧江」→「兰沧江」）只共享一个
  -- trigram，相似度仅 0.14，任何有意义的阈值都会把它挡掉 —— 而首字恰是 ASR
  -- 最常错的位置。这里只负责宽召回并按相似度排序，最终由调用方的近音规则
  -- （isLikelySameGeoName）挑真身。
  where h.sim > 0 or h.landmark_name like '%' || p_name || '%'
  order by h.sim desc, h.distance_m
  limit p_limit;
$$;

comment on function dev.fuzzy_geo_landmarks is
  'ASR 听错地名时的近音救援：空间圈定候选后按 trigram 相似度排序';
