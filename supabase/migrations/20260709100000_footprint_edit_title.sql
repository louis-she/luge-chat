-- User-editable footprint title (v1 manual correction)

create or replace function public.set_footprint_title(
  p_footprint_id uuid,
  p_title text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.jwt_user_id();
  v_title text := left(trim(coalesce(p_title, '')), 80);
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if v_title = '' then
    raise exception 'title cannot be empty';
  end if;

  update public.user_footprints
  set title = v_title
  where id = p_footprint_id
    and user_id = v_user;

  if not found then
    raise exception 'footprint not found';
  end if;

  return v_title;
end;
$$;

comment on function public.set_footprint_title is
  '用户手动修正足迹卡片标题；不修改 poi_name / geom';

grant execute on function public.set_footprint_title(uuid, text) to authenticated;

create or replace function dev.set_footprint_title(
  p_footprint_id uuid,
  p_title text
)
returns text
language plpgsql
security definer
set search_path = dev, public
as $$
declare
  v_user uuid := dev.jwt_user_id();
  v_title text := left(trim(coalesce(p_title, '')), 80);
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if v_title = '' then
    raise exception 'title cannot be empty';
  end if;

  update dev.user_footprints
  set title = v_title
  where id = p_footprint_id
    and user_id = v_user;

  if not found then
    raise exception 'footprint not found';
  end if;

  return v_title;
end;
$$;

grant execute on function dev.set_footprint_title(uuid, text) to authenticated;
