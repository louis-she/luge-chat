-- 问路 FC：客户端高级设置里的场景/语意半径参数，随 GPS 上报写入会话

alter table dev.voice_chat_session_loc
  add column if not exists geo_radius_prefs jsonb;

alter table public.voice_chat_session_loc
  add column if not exists geo_radius_prefs jsonb;

comment on column dev.voice_chat_session_loc.geo_radius_prefs is
  '问路半径偏好：baseUrbanKm/baseTownKm/baseWildKm + multNearby/Water/Mountain/Distant/Landmark';
comment on column public.voice_chat_session_loc.geo_radius_prefs is
  '问路半径偏好：baseUrbanKm/baseTownKm/baseWildKm + multNearby/Water/Mountain/Distant/Landmark';
