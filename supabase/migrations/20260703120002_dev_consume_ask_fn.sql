create or replace function dev.consume_user_ask(p_user_id uuid)
returns boolean
language plpgsql
as $$
declare
  affected integer;
begin
  update dev.users
  set balance_asks = balance_asks - 1
  where id = p_user_id
    and balance_asks > 0
    and not (
      billing_mode = 'vip'
      and (vip_expire_at is null or vip_expire_at > now())
    );
  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

grant execute on function dev.consume_user_ask(uuid) to service_role;
