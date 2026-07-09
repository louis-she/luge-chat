-- Luge core schema: users, call sessions, dialog history, geo landmark cache
-- Requires PostgreSQL 17 + PostGIS

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.billing_mode as enum ('vip', 'pay_per_minute');

create type public.user_platform as enum ('ios', 'android', 'coolapk', 'unknown');

create type public.call_session_status as enum ('active', 'completed', 'failed', 'interrupted');

create type public.dialog_role as enum ('user', 'assistant', 'system');

create type public.landmark_type as enum ('town', 'river', 'scenery', 'bridge', 'mountain', 'other');

create type public.landmark_cache_source as enum ('amap', 'llm_search', 'user_session', 'manual');

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create table public.users (
  id uuid primary key default gen_random_uuid(),

  email text,
  display_name text,
  avatar_url text,

  apple_user_id text,
  wechat_open_id text,
  wechat_union_id text,

  platform public.user_platform not null default 'unknown',

  billing_mode public.billing_mode not null default 'pay_per_minute',
  vip_expire_at timestamptz,
  balance_minutes numeric(10, 2) not null default 0 check (balance_minutes >= 0),

  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint users_email_unique unique (email),
  constraint users_apple_user_id_unique unique (apple_user_id),
  constraint users_wechat_open_id_unique unique (wechat_open_id),
  constraint users_wechat_union_id_unique unique (wechat_union_id),
  constraint users_has_identity check (
    apple_user_id is not null
    or wechat_open_id is not null
    or wechat_union_id is not null
    or email is not null
  )
);

comment on table public.users is 'App 用户主表：Apple / 微信登录与会员计费';
comment on column public.users.balance_minutes is '按量计费剩余通话分钟数；VIP 模式下可为 0';
comment on column public.users.vip_expire_at is '会员到期时间；NULL 表示非会员或已过期';

create index users_vip_expire_at_idx on public.users (vip_expire_at)
  where vip_expire_at is not null;

create index users_billing_mode_idx on public.users (billing_mode);

-- ---------------------------------------------------------------------------
-- call_sessions
-- ---------------------------------------------------------------------------

create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  status public.call_session_status not null default 'active',

  start_time timestamptz not null default now(),
  end_time timestamptz,

  total_duration_seconds integer check (
    total_duration_seconds is null or total_duration_seconds >= 0
  ),

  start_location geography(Point, 4326),
  end_location geography(Point, 4326),

  llm_tokens_input integer not null default 0 check (llm_tokens_input >= 0),
  llm_tokens_output integer not null default 0 check (llm_tokens_output >= 0),
  billed_minutes numeric(10, 2) not null default 0 check (billed_minutes >= 0),

  client_info jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint call_sessions_time_order check (
    end_time is null or end_time >= start_time
  )
);

comment on table public.call_sessions is '每次「打进电话」到挂断的通话流水，用于计费与自驾足迹';
comment on column public.call_sessions.start_location is '通话起点 GPS（WGS84）';
comment on column public.call_sessions.end_location is '通话终点 GPS（WGS84）';
comment on column public.call_sessions.billed_minutes is '本次实际扣费分钟数';

create index call_sessions_user_id_idx on public.call_sessions (user_id);
create index call_sessions_start_time_idx on public.call_sessions (start_time desc);
create index call_sessions_status_idx on public.call_sessions (status);

create index call_sessions_start_location_gix
  on public.call_sessions using gist (start_location);

create index call_sessions_end_location_gix
  on public.call_sessions using gist (end_location);

-- ---------------------------------------------------------------------------
-- dialog_messages
-- ---------------------------------------------------------------------------

create table public.dialog_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions (id) on delete cascade,

  role public.dialog_role not null,
  content text not null default '',

  -- 用户说话时的精确位置与车头朝向，用于回溯「当时在看哪」
  triggered_location geography(Point, 4326),
  heading_degrees real check (
    heading_degrees is null
    or (heading_degrees >= 0 and heading_degrees < 360)
  ),

  sequence_no integer not null check (sequence_no > 0),

  landmark_cache_id uuid,
  llm_tokens_input integer not null default 0 check (llm_tokens_input >= 0),
  llm_tokens_output integer not null default 0 check (llm_tokens_output >= 0),

  audio_storage_path text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.dialog_messages is '全双工多轮语音对话历史（转写文本 + 触发时 GPS）';
comment on column public.dialog_messages.heading_degrees is '车头航向角，0=北，顺时针，单位度';
comment on column public.dialog_messages.landmark_cache_id is '若本次回答命中地理缓存，关联 geo_landmarks_cache';

create unique index dialog_messages_session_sequence_uidx
  on public.dialog_messages (session_id, sequence_no);

create index dialog_messages_session_id_created_at_idx
  on public.dialog_messages (session_id, created_at);

create index dialog_messages_triggered_location_gix
  on public.dialog_messages using gist (triggered_location);

-- ---------------------------------------------------------------------------
-- geo_landmarks_cache
-- ---------------------------------------------------------------------------

create table public.geo_landmarks_cache (
  id uuid primary key default gen_random_uuid(),

  -- Point（雕塑/桥）/ Polygon（城镇范围）/ LineString（河流）均可
  geom geography(Geometry, 4326) not null,

  landmark_name text not null,
  landmark_type public.landmark_type not null,

  ai_formatted_story text not null default '',

  -- 默认 2km 撞库半径；Polygon/LineString 类型可忽略，由 geom 本身定义范围
  search_radius_m integer not null default 2000 check (search_radius_m > 0),

  source public.landmark_cache_source not null default 'llm_search',
  amap_poi_id text,
  external_ref text,

  valid_until timestamptz not null default (now() + interval '30 days'),
  hit_count integer not null default 0 check (hit_count >= 0),
  last_hit_at timestamptz,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.geo_landmarks_cache is '沿途地理人文知识空间缓存（PostGIS RAG 核心资产）';
comment on column public.geo_landmarks_cache.valid_until is '缓存过期时间；过期后才允许重新联网更新（如房价）';
comment on column public.geo_landmarks_cache.search_radius_m is 'Point 类型地标的空间撞库半径（米）';

create index geo_landmarks_cache_geom_gix
  on public.geo_landmarks_cache using gist (geom);

create index geo_landmarks_cache_landmark_type_idx
  on public.geo_landmarks_cache (landmark_type);

create index geo_landmarks_cache_valid_until_idx
  on public.geo_landmarks_cache (valid_until);

create unique index geo_landmarks_cache_amap_poi_id_uidx
  on public.geo_landmarks_cache (amap_poi_id)
  where amap_poi_id is not null;

-- dialog_messages.landmark_cache_id FK（缓存表创建后再挂）
alter table public.dialog_messages
  add constraint dialog_messages_landmark_cache_id_fkey
  foreign key (landmark_cache_id) references public.geo_landmarks_cache (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create trigger call_sessions_set_updated_at
  before update on public.call_sessions
  for each row execute function public.set_updated_at();

create trigger geo_landmarks_cache_set_updated_at
  before update on public.geo_landmarks_cache
  for each row execute function public.set_updated_at();
