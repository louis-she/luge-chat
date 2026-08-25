-- Persist topic POI for RTC soft-bypass normalize (cross-isolate).

alter table if exists public.voice_chat_session_loc
  add column if not exists topic_poi text;

alter table if exists dev.voice_chat_session_loc
  add column if not exists topic_poi text;

comment on column public.voice_chat_session_loc.topic_poi is
  '最近一次主动讲解锚定的 POI 名，供 normalize_user_utterance 纠错';
comment on column dev.voice_chat_session_loc.topic_poi is
  '最近一次主动讲解锚定的 POI 名，供 normalize_user_utterance 纠错';
