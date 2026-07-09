-- Ask-based quota: guest devices + user balance_asks

alter table public.users
  add column if not exists balance_asks integer not null default 0
    check (balance_asks >= 0);

comment on column public.users.balance_asks is '剩余问路次数（按次计费）';

create table if not exists public.guest_devices (
  device_key text primary key,
  asks_used integer not null default 0 check (asks_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.guest_devices is '游客设备问路计数（device_key 为客户端持久化 UUID）';

create trigger guest_devices_set_updated_at
  before update on public.guest_devices
  for each row execute function public.set_updated_at();

grant all on public.guest_devices to service_role;
