-- Sandbox users for dev login (sandbox-auth edge function)
insert into public.users (
  id,
  email,
  display_name,
  avatar_url,
  platform,
  billing_mode,
  vip_expire_at,
  balance_minutes,
  metadata
)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'sandbox.vip@luge.chat',
    '老张（VIP 会员）',
    null,
    'ios',
    'vip',
    now() + interval '365 days',
    0,
    '{"sandbox_persona":"vip_driver","tagline":"成渝高速老炮，无限畅聊"}'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'sandbox.payg@luge.chat',
    '小李（按量计费）',
    null,
    'android',
    'pay_per_minute',
    null,
    120,
    '{"sandbox_persona":"payg_driver","tagline":"还剩 120 分钟通话额度"}'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'sandbox.new@luge.chat',
    '新手试用',
    null,
    'unknown',
    'pay_per_minute',
    null,
    30,
    '{"sandbox_persona":"new_driver","tagline":"新用户，送 30 分钟体验"}'::jsonb
  )
on conflict (email) do update set
  display_name = excluded.display_name,
  platform = excluded.platform,
  billing_mode = excluded.billing_mode,
  vip_expire_at = excluded.vip_expire_at,
  balance_minutes = excluded.balance_minutes,
  metadata = excluded.metadata,
  updated_at = now();
