-- Geo landmark promotion: candidates accumulate signals; shared cache only after threshold.

create table if not exists dev.geo_landmark_candidates (
  id uuid primary key default gen_random_uuid(),

  geom dev.geography(Point, 4326) not null,
  landmark_name text not null,
  landmark_type dev.landmark_type not null default 'other',

  amap_poi_id text,
  best_story text not null default '',
  metadata jsonb not null default '{}'::jsonb,

  promoted_at timestamptz,
  promoted_cache_id uuid references dev.geo_landmarks_cache (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table dev.geo_landmark_candidates is
  '地理节点候选：问答/收藏信号聚合，达门槛后升格 geo_landmarks_cache';

create unique index if not exists dev_geo_landmark_candidates_amap_poi_id_uidx
  on dev.geo_landmark_candidates (amap_poi_id)
  where amap_poi_id is not null;

create index if not exists dev_geo_landmark_candidates_geom_gix
  on dev.geo_landmark_candidates using gist (geom);

create index if not exists dev_geo_landmark_candidates_promoted_at_idx
  on dev.geo_landmark_candidates (promoted_at)
  where promoted_at is null;

drop trigger if exists dev_geo_landmark_candidates_set_updated_at on dev.geo_landmark_candidates;
create trigger dev_geo_landmark_candidates_set_updated_at
  before update on dev.geo_landmark_candidates
  for each row execute function dev.set_updated_at();

create table if not exists dev.geo_landmark_candidate_signals (
  candidate_id uuid not null references dev.geo_landmark_candidates (id) on delete cascade,
  user_id uuid not null references dev.users (id) on delete cascade,
  signal_type text not null check (signal_type in ('ask', 'favorite')),
  created_at timestamptz not null default now(),
  primary key (candidate_id, user_id, signal_type)
);

comment on table dev.geo_landmark_candidate_signals is
  '候选节点贡献信号：每用户每种类型最多计一次';

create or replace function dev.footprint_poi_to_landmark_type(p_type dev.footprint_poi_type)
returns dev.landmark_type
language sql
immutable
as $$
  select case p_type
    when 'city' then 'town'::dev.landmark_type
    when 'town' then 'town'::dev.landmark_type
    when 'river' then 'river'::dev.landmark_type
    when 'scenery' then 'scenery'::dev.landmark_type
    when 'bridge' then 'bridge'::dev.landmark_type
    when 'mountain' then 'mountain'::dev.landmark_type
    else 'other'::dev.landmark_type
  end;
$$;

create or replace function dev.promote_geo_landmark_candidate(p_candidate_id uuid)
returns uuid
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_candidate dev.geo_landmark_candidates%rowtype;
  v_cache_id uuid;
  v_story text;
begin
  select * into v_candidate
  from dev.geo_landmark_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'candidate not found';
  end if;

  if v_candidate.promoted_cache_id is not null then
    return v_candidate.promoted_cache_id;
  end if;

  v_story := left(trim(coalesce(v_candidate.best_story, '')), 4000);

  if v_candidate.amap_poi_id is not null then
    v_cache_id := dev.upsert_geo_landmark_amap(
      v_candidate.amap_poi_id,
      v_candidate.landmark_name,
      v_candidate.landmark_type,
      dev.st_y(v_candidate.geom::dev.geometry),
      dev.st_x(v_candidate.geom::dev.geometry),
      v_story,
      v_candidate.metadata || jsonb_build_object('promoted_from_candidate', p_candidate_id::text)
    );
  else
    insert into dev.geo_landmarks_cache (
      geom,
      landmark_name,
      landmark_type,
      ai_formatted_story,
      source,
      metadata,
      hit_count,
      last_hit_at,
      valid_until
    )
    values (
      v_candidate.geom::dev.geography,
      v_candidate.landmark_name,
      v_candidate.landmark_type,
      v_story,
      'user_session',
      v_candidate.metadata || jsonb_build_object('promoted_from_candidate', p_candidate_id::text),
      1,
      now(),
      now() + interval '30 days'
    )
    returning id into v_cache_id;
  end if;

  update dev.geo_landmark_candidates
  set promoted_at = now(),
      promoted_cache_id = v_cache_id,
      updated_at = now()
  where id = p_candidate_id;

  return v_cache_id;
end;
$$;

create or replace function dev.record_geo_landmark_signal(
  p_user_id uuid,
  p_signal_type text,
  p_landmark_name text,
  p_landmark_type dev.landmark_type,
  p_lat double precision,
  p_lng double precision,
  p_ai_story text default '',
  p_amap_poi_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_candidate_id uuid;
  v_story text := left(trim(coalesce(p_ai_story, '')), 4000);
  v_ask_users integer := 0;
  v_favorite_users integer := 0;
  v_cache_id uuid;
  v_promoted boolean := false;
  v_point dev.geography;
begin
  if p_signal_type not in ('ask', 'favorite') then
    raise exception 'invalid signal_type';
  end if;

  v_point := dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography;

  if p_amap_poi_id is not null and trim(p_amap_poi_id) <> '' then
    select id into v_candidate_id
    from dev.geo_landmark_candidates
    where amap_poi_id = trim(p_amap_poi_id)
    limit 1;
  end if;

  if v_candidate_id is null then
    select c.id into v_candidate_id
    from dev.geo_landmark_candidates c
    where c.promoted_at is null
      and dev.st_dwithin(c.geom, v_point, 200)
    order by dev.st_distance(c.geom, v_point)
    limit 1;
  end if;

  if v_candidate_id is null then
    insert into dev.geo_landmark_candidates (
      geom,
      landmark_name,
      landmark_type,
      amap_poi_id,
      best_story,
      metadata
    )
    values (
      v_point,
      trim(p_landmark_name),
      p_landmark_type,
      nullif(trim(coalesce(p_amap_poi_id, '')), ''),
      v_story,
      coalesce(p_metadata, '{}'::jsonb)
    )
    returning id into v_candidate_id;
  else
    update dev.geo_landmark_candidates
    set
      landmark_name = trim(p_landmark_name),
      landmark_type = p_landmark_type,
      geom = v_point,
      amap_poi_id = coalesce(nullif(trim(coalesce(p_amap_poi_id, '')), ''), amap_poi_id),
      best_story = case
        when length(v_story) >= length(best_story) then v_story
        else best_story
      end,
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
    where id = v_candidate_id;
  end if;

  if p_user_id is not null then
    insert into dev.geo_landmark_candidate_signals (candidate_id, user_id, signal_type)
    values (v_candidate_id, p_user_id, p_signal_type)
    on conflict do nothing;
  end if;

  select
    count(*) filter (where signal_type = 'ask'),
    count(*) filter (where signal_type = 'favorite')
  into v_ask_users, v_favorite_users
  from dev.geo_landmark_candidate_signals
  where candidate_id = v_candidate_id;

  select promoted_cache_id into v_cache_id
  from dev.geo_landmark_candidates
  where id = v_candidate_id;

  if v_cache_id is not null then
    v_promoted := true;
    if p_amap_poi_id is not null and trim(p_amap_poi_id) <> '' then
      v_cache_id := dev.upsert_geo_landmark_amap(
        trim(p_amap_poi_id),
        trim(p_landmark_name),
        p_landmark_type,
        p_lat,
        p_lng,
        v_story,
        coalesce(p_metadata, '{}'::jsonb)
      );
    end if;
  elsif v_ask_users >= 2 or v_favorite_users >= 2 then
    v_cache_id := dev.promote_geo_landmark_candidate(v_candidate_id);
    v_promoted := true;
  end if;

  return jsonb_build_object(
    'candidate_id', v_candidate_id,
    'cache_id', v_cache_id,
    'promoted', v_promoted,
    'ask_users', v_ask_users,
    'favorite_users', v_favorite_users,
    'promotion_pending', not v_promoted
  );
end;
$$;

comment on function dev.record_geo_landmark_signal is
  '记录问答/收藏信号；≥2 不同用户提问或 ≥2 不同用户收藏时升格共享缓存';

-- Favorite → candidate signal (spatial match within 200m)
create or replace function dev.set_footprint_favorite(
  p_footprint_id uuid,
  p_favorited boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_user uuid := dev.jwt_user_id();
  v_at timestamptz;
  v_fp dev.user_footprints%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_at := case when p_favorited then now() else null end;

  update dev.user_footprints
  set favorited_at = v_at
  where id = p_footprint_id
    and user_id = v_user;

  if not found then
    raise exception 'footprint not found';
  end if;

  if p_favorited then
    select * into v_fp
    from dev.user_footprints
    where id = p_footprint_id;

    perform dev.record_geo_landmark_signal(
      v_user,
      'favorite',
      v_fp.poi_name,
      dev.footprint_poi_to_landmark_type(v_fp.poi_type),
      dev.st_y(v_fp.geom::dev.geometry),
      dev.st_x(v_fp.geom::dev.geometry),
      coalesce(nullif(trim(v_fp.summary), ''), v_fp.title, v_fp.poi_name),
      null,
      jsonb_build_object('footprint_id', p_footprint_id::text, 'source', 'footprint_favorite')
    );
  end if;

  return v_at;
end;
$$;

grant all on dev.geo_landmark_candidates to service_role;
grant all on dev.geo_landmark_candidate_signals to service_role;
grant execute on function dev.record_geo_landmark_signal(
  uuid, text, text, dev.landmark_type, double precision, double precision, text, text, jsonb
) to service_role;
grant execute on function dev.promote_geo_landmark_candidate(uuid) to service_role;
