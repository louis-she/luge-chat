-- Geo landmarks cache: grow from Gaode POI hits + LLM answers (not pre-built).
-- Dev schema is active on api.luge.chat; public mirror for future production.

-- ---------------------------------------------------------------------------
-- dev schema (Expo __DEV__ / edge AUTH_DB_SCHEMA=dev)
-- ---------------------------------------------------------------------------

do $$
begin
  create type dev.landmark_type as enum (
    'town', 'river', 'scenery', 'bridge', 'mountain', 'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type dev.landmark_cache_source as enum (
    'amap', 'llm_search', 'user_session', 'manual'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists dev.geo_landmarks_cache (
  id uuid primary key default gen_random_uuid(),

  geom dev.geography(Geometry, 4326) not null,

  landmark_name text not null,
  landmark_type dev.landmark_type not null,

  ai_formatted_story text not null default '',

  search_radius_m integer not null default 2000 check (search_radius_m > 0),

  source dev.landmark_cache_source not null default 'amap',
  amap_poi_id text,
  external_ref text,

  valid_until timestamptz not null default (now() + interval '30 days'),
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dev.geo_landmarks_cache is
  '沿途地理人文知识空间缓存：高德 POI 命中 + 用户问答沉淀，非预建库';

create index if not exists dev_geo_landmarks_cache_geom_gix
  on dev.geo_landmarks_cache using gist (geom);

create index if not exists dev_geo_landmarks_cache_valid_until_idx
  on dev.geo_landmarks_cache (valid_until);

create unique index if not exists dev_geo_landmarks_cache_amap_poi_id_uidx
  on dev.geo_landmarks_cache (amap_poi_id)
  where amap_poi_id is not null;

drop trigger if exists dev_geo_landmarks_cache_set_updated_at on dev.geo_landmarks_cache;
create trigger dev_geo_landmarks_cache_set_updated_at
  before update on dev.geo_landmarks_cache
  for each row execute function dev.set_updated_at();

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
  select
    g.id,
    g.landmark_name,
    g.landmark_type,
    g.ai_formatted_story,
    dev.st_distance(
      g.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography
    ) as distance_m,
    dev.st_y(g.geom::dev.geometry) as lat,
    dev.st_x(g.geom::dev.geometry) as lng,
    g.source,
    g.amap_poi_id,
    g.valid_until,
    g.hit_count,
    g.metadata
  from dev.geo_landmarks_cache g
  where g.valid_until > now()
    and dev.st_dwithin(
      g.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography,
      least(p_radius_m, g.search_radius_m)::double precision
    )
  order by distance_m
  limit 8;
$$;

comment on function dev.nearby_geo_landmarks is
  '用户位置附近未过期的地理缓存，供问答 RAG 优先命中';

create or replace function dev.upsert_geo_landmark_amap(
  p_amap_poi_id text,
  p_landmark_name text,
  p_landmark_type dev.landmark_type,
  p_lat double precision,
  p_lng double precision,
  p_ai_story text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_id uuid;
  v_story text := left(trim(coalesce(p_ai_story, '')), 4000);
begin
  if p_amap_poi_id is null or trim(p_amap_poi_id) = '' then
    raise exception 'amap_poi_id required';
  end if;

  insert into dev.geo_landmarks_cache (
    geom,
    landmark_name,
    landmark_type,
    ai_formatted_story,
    source,
    amap_poi_id,
    metadata,
    hit_count,
    last_hit_at,
    valid_until
  )
  values (
    dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography,
    trim(p_landmark_name),
    p_landmark_type,
    v_story,
    'amap',
    trim(p_amap_poi_id),
    coalesce(p_metadata, '{}'::jsonb),
    1,
    now(),
    now() + interval '30 days'
  )
  on conflict (amap_poi_id) where amap_poi_id is not null
  do update set
    landmark_name = excluded.landmark_name,
    landmark_type = excluded.landmark_type,
    geom = excluded.geom,
    ai_formatted_story = case
      when length(excluded.ai_formatted_story) >= length(dev.geo_landmarks_cache.ai_formatted_story)
        then excluded.ai_formatted_story
      else dev.geo_landmarks_cache.ai_formatted_story
    end,
    metadata = dev.geo_landmarks_cache.metadata || excluded.metadata,
    hit_count = dev.geo_landmarks_cache.hit_count + 1,
    last_hit_at = now(),
    valid_until = now() + interval '30 days',
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function dev.upsert_geo_landmark_amap is
  '高德 POI 问答后写入/更新地理缓存；同 amap_poi_id 聚合';

grant all on dev.geo_landmarks_cache to service_role;
grant select on dev.geo_landmarks_cache to authenticated;
grant execute on function dev.nearby_geo_landmarks(double precision, double precision, integer)
  to service_role;
grant execute on function dev.upsert_geo_landmark_amap(
  text, text, dev.landmark_type, double precision, double precision, text, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- public schema mirror (apply when public core schema is live)
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.landmark_type as enum (
    'town', 'river', 'scenery', 'bridge', 'mountain', 'other'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.landmark_cache_source as enum (
    'amap', 'llm_search', 'user_session', 'manual'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.geo_landmarks_cache (
  id uuid primary key default gen_random_uuid(),
  geom geography(Geometry, 4326) not null,
  landmark_name text not null,
  landmark_type public.landmark_type not null,
  ai_formatted_story text not null default '',
  search_radius_m integer not null default 2000 check (search_radius_m > 0),
  source public.landmark_cache_source not null default 'amap',
  amap_poi_id text,
  external_ref text,
  valid_until timestamptz not null default (now() + interval '30 days'),
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists geo_landmarks_cache_geom_gix
  on public.geo_landmarks_cache using gist (geom);

create unique index if not exists geo_landmarks_cache_amap_poi_id_uidx
  on public.geo_landmarks_cache (amap_poi_id)
  where amap_poi_id is not null;

grant all on public.geo_landmarks_cache to service_role;
grant select on public.geo_landmarks_cache to authenticated;
