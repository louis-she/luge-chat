-- User footprints: POI-level memories + visit timeline + messages
-- Run on public; mirror to dev schema on server if needed.

create type public.footprint_poi_type as enum (
  'city',
  'town',
  'river',
  'scenery',
  'bridge',
  'statue',
  'mountain',
  'other'
);

create type public.footprint_visit_status as enum ('active', 'archived');

-- ---------------------------------------------------------------------------
-- user_footprints — one row per user + POI (memory card)
-- ---------------------------------------------------------------------------

create table public.user_footprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  poi_name text not null,
  poi_type public.footprint_poi_type not null default 'other',
  geom geography(Point, 4326) not null,

  title text not null default '',
  summary text not null default '',
  llm_notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_footprints is '用户足迹：以 POI 为单位的旅途回忆卡片';
comment on column public.user_footprints.geom is '地标本身坐标（非提问时 GPS）';
comment on column public.user_footprints.llm_notes is '隐藏非结构化笔记，供后续 LLM 上下文';

create index user_footprints_user_id_idx on public.user_footprints (user_id);
create index user_footprints_updated_at_idx on public.user_footprints (user_id, updated_at desc);
create index user_footprints_geom_gix on public.user_footprints using gist (geom);

-- ---------------------------------------------------------------------------
-- footprint_visits — 24h sliding window per conversation burst
-- ---------------------------------------------------------------------------

create table public.footprint_visits (
  id uuid primary key default gen_random_uuid(),
  footprint_id uuid not null references public.user_footprints (id) on delete cascade,

  status public.footprint_visit_status not null default 'active',
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  archived_at timestamptz,

  visit_summary text not null default '',
  llm_notes text not null default '',
  start_location geography(Point, 4326),

  needs_summary boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.footprint_visits is '单次到访时间线；24h 内追问合并为同一条';
comment on column public.footprint_visits.needs_summary is '10min debounce：待 LLM 总结 visit + footprint';

create index footprint_visits_footprint_id_idx on public.footprint_visits (footprint_id);
create index footprint_visits_active_window_idx
  on public.footprint_visits (footprint_id, last_active_at desc)
  where status = 'active';

create index footprint_visits_summary_pending_idx
  on public.footprint_visits (last_active_at)
  where needs_summary = true and status = 'active';

create index footprint_visits_archive_due_idx
  on public.footprint_visits (last_active_at)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- footprint_messages — Q&A within a visit (no call_session required)
-- ---------------------------------------------------------------------------

create table public.footprint_messages (
  id uuid primary key default gen_random_uuid(),
  footprint_visit_id uuid not null references public.footprint_visits (id) on delete cascade,

  role public.dialog_role not null,
  content text not null default '',

  triggered_location geography(Point, 4326),
  heading_degrees real check (
    heading_degrees is null
    or (heading_degrees >= 0 and heading_degrees < 360)
  ),

  created_at timestamptz not null default now()
);

create index footprint_messages_visit_id_idx
  on public.footprint_messages (footprint_visit_id, created_at);

-- ---------------------------------------------------------------------------
-- Nearby footprint candidates for LLM matching (30 km)
-- ---------------------------------------------------------------------------

create or replace function public.nearby_user_footprints(
  p_user_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 30000
)
returns table (
  id uuid,
  poi_name text,
  poi_type public.footprint_poi_type,
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
    st_distance(
      f.geom,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
    ) as distance_m,
    st_y(f.geom::geometry) as lat,
    st_x(f.geom::geometry) as lng,
    count(v.id) as visit_count,
    max(v.started_at) as last_visit_at
  from public.user_footprints f
  left join public.footprint_visits v on v.footprint_id = f.id
  where f.user_id = p_user_id
    and st_dwithin(
      f.geom,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
      p_radius_m
    )
  group by f.id
  order by distance_m asc
  limit 12;
$$;

comment on function public.nearby_user_footprints is '用户当前位置 30km 内历史足迹候选，供 LLM 匹配';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.user_footprints enable row level security;
alter table public.footprint_visits enable row level security;
alter table public.footprint_messages enable row level security;

create or replace function public.jwt_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'user_id', '')::uuid
  );
$$;

create policy user_footprints_select_own
  on public.user_footprints
  for select
  to authenticated
  using (user_id = public.jwt_user_id());

create policy footprint_visits_select_own
  on public.footprint_visits
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_footprints f
      where f.id = footprint_id and f.user_id = public.jwt_user_id()
    )
  );

create policy footprint_messages_select_own
  on public.footprint_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.footprint_visits v
      join public.user_footprints f on f.id = v.footprint_id
      where v.id = footprint_visit_id and f.user_id = public.jwt_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger user_footprints_set_updated_at
  before update on public.user_footprints
  for each row execute function public.set_updated_at();

create trigger footprint_visits_set_updated_at
  before update on public.footprint_visits
  for each row execute function public.set_updated_at();
