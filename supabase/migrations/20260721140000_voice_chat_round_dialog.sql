-- RTC 字幕按轮持久化（Edge 无内存，answerFinish 常早于 subtitle）

create table if not exists dev.voice_chat_round_dialog (
  task_id text not null,
  round_id text not null,
  user_text text,
  assistant_text text,
  footprint_done_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, round_id)
);

create index if not exists dev_voice_chat_round_dialog_updated_idx
  on dev.voice_chat_round_dialog (updated_at desc);

grant all on dev.voice_chat_round_dialog to service_role;

create index if not exists dev_voice_chat_session_loc_user_idx
  on dev.voice_chat_session_loc (user_id, updated_at desc);

create table if not exists public.voice_chat_round_dialog (
  task_id text not null,
  round_id text not null,
  user_text text,
  assistant_text text,
  footprint_done_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (task_id, round_id)
);

create index if not exists public_voice_chat_round_dialog_updated_idx
  on public.voice_chat_round_dialog (updated_at desc);

grant all on public.voice_chat_round_dialog to service_role;

create index if not exists public_voice_chat_session_loc_user_idx
  on public.voice_chat_session_loc (user_id, updated_at desc);
