-- Footprint favorites: personal filter + signal for public geo landmark promotion

alter table public.user_footprints
  add column if not exists favorited_at timestamptz;

comment on column public.user_footprints.favorited_at is
  '用户收藏时间；NULL 表示未收藏。收藏作为个人筛选，并作为公共节点升格的正向信号（需多用户聚合）。';

create index if not exists user_footprints_favorited_at_idx
  on public.user_footprints (user_id, favorited_at desc)
  where favorited_at is not null;

-- Only touch favorited_at; callers cannot mutate POI content via client JWT.
create or replace function public.set_footprint_favorite(
  p_footprint_id uuid,
  p_favorited boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.jwt_user_id();
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_at := case when p_favorited then now() else null end;

  update public.user_footprints
  set favorited_at = v_at
  where id = p_footprint_id
    and user_id = v_user;

  if not found then
    raise exception 'footprint not found';
  end if;

  return v_at;
end;
$$;

comment on function public.set_footprint_favorite is
  '收藏/取消收藏足迹；升格公共地理节点时 favorited_at 计为正向信号';

grant execute on function public.set_footprint_favorite(uuid, boolean) to authenticated;

-- dev schema mirror
alter table dev.user_footprints
  add column if not exists favorited_at timestamptz;

create index if not exists dev_user_footprints_favorited_at_idx
  on dev.user_footprints (user_id, favorited_at desc)
  where favorited_at is not null;

create or replace function dev.set_footprint_favorite(
  p_footprint_id uuid,
  p_favorited boolean
)
returns timestamptz
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_user uuid := dev.jwt_user_id();
  v_at timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_at := case when p_favorited then now() else null end;

  update dev.user_footprints
  set favorited_at = v_at
  where id = p_footprint_id
    and user_id = v_user;

  if not found then
    raise exception 'footprint not found';
  end if;

  return v_at;
end;
$$;

grant execute on function dev.set_footprint_favorite(uuid, boolean) to authenticated;
