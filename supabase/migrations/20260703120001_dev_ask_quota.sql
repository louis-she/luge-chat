alter table dev.users
  add column if not exists balance_asks integer not null default 0
    check (balance_asks >= 0);

create table if not exists dev.guest_devices (
  device_key text primary key,
  asks_used integer not null default 0 check (asks_used >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on dev.guest_devices to service_role;

-- seed balance_asks for sandbox users
update dev.users set balance_asks = 30 where email like 'sandbox.%@luge.chat' and balance_asks = 0;
