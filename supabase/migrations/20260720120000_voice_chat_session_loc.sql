-- RTC VoiceChat 会话最新 GPS（供 Function Calling 查周边，不信任模型编经纬度）
-- 线上 apply：dev schema 属 supabase_admin，需用该角色执行 CREATE（postgres 仅有 USAGE）

create table if not exists dev.voice_chat_session_loc (
  room_id text primary key,
  task_id text not null default '',
  user_id text,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  updated_at timestamptz not null default now()
);

create index if not exists dev_voice_chat_session_loc_task_idx
  on dev.voice_chat_session_loc (task_id);

comment on table dev.voice_chat_session_loc is
  '火山 VoiceChat 会话位置：客户端上报，FC get_nearby_landmarks 读取';

grant all on dev.voice_chat_session_loc to service_role;

create table if not exists public.voice_chat_session_loc (
  room_id text primary key,
  task_id text not null default '',
  user_id text,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  updated_at timestamptz not null default now()
);

create index if not exists public_voice_chat_session_loc_task_idx
  on public.voice_chat_session_loc (task_id);

grant all on public.voice_chat_session_loc to service_role;
