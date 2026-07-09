-- Promotion scoring: 1 ask = 1pt, 1 favorite = 2pt, promote at >= 5pts

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
  v_promotion_score integer := 0;
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

  v_promotion_score := v_ask_users + v_favorite_users * 2;

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
  elsif v_promotion_score >= 5 then
    v_cache_id := dev.promote_geo_landmark_candidate(v_candidate_id);
    v_promoted := true;
  end if;

  return jsonb_build_object(
    'candidate_id', v_candidate_id,
    'cache_id', v_cache_id,
    'promoted', v_promoted,
    'ask_users', v_ask_users,
    'favorite_users', v_favorite_users,
    'promotion_score', v_promotion_score,
    'promotion_pending', not v_promoted
  );
end;
$$;

comment on function dev.record_geo_landmark_signal is
  '记录问答/收藏信号；升格分数 = 提问数×1 + 收藏数×2，≥5 分进入 geo_landmarks_cache';
