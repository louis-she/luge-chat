-- V4：VoiceChat 会话绑定路鸽用户/设备，answerFinish 按 Round 扣次去重

alter table dev.voice_chat_session_loc
  add column if not exists luge_user_id uuid,
  add column if not exists device_key text;

alter table public.voice_chat_session_loc
  add column if not exists luge_user_id uuid,
  add column if not exists device_key text;

create table if not exists dev.voice_chat_round_charges (
  task_id text not null,
  round_id text not null,
  room_id text,
  charged_at timestamptz not null default now(),
  tier text,
  primary key (task_id, round_id)
);

create index if not exists dev_voice_chat_round_charges_charged_at_idx
  on dev.voice_chat_round_charges (charged_at desc);

comment on table dev.voice_chat_round_charges is
  '火山 VoiceChat answerFinish 扣次去重（task_id + round_id）';

grant all on dev.voice_chat_round_charges to service_role;

create table if not exists public.voice_chat_round_charges (
  task_id text not null,
  round_id text not null,
  room_id text,
  charged_at timestamptz not null default now(),
  tier text,
  primary key (task_id, round_id)
);

create index if not exists public_voice_chat_round_charges_charged_at_idx
  on public.voice_chat_round_charges (charged_at desc);

grant all on public.voice_chat_round_charges to service_role;
