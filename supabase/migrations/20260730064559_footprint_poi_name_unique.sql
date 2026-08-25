-- Dedupe + unique (user_id, lower(trim(poi_name))) for footprint cards.
-- Skip missing schemas (some envs only have `dev`).

do $$
begin
  if to_regclass('public.user_footprints') is not null then
    with ranked as (
      select
        id,
        user_id,
        lower(trim(poi_name)) as name_key,
        created_at,
        row_number() over (
          partition by user_id, lower(trim(poi_name))
          order by created_at asc, id asc
        ) as rn
      from public.user_footprints
    ),
    dupes as (
      select r.id as dupe_id, k.id as keep_id
      from ranked r
      join ranked k
        on k.user_id = r.user_id
       and k.name_key = r.name_key
       and k.rn = 1
      where r.rn > 1
    )
    update public.footprint_visits v
    set footprint_id = d.keep_id
    from dupes d
    where v.footprint_id = d.dupe_id;

    with ranked as (
      select
        id,
        row_number() over (
          partition by user_id, lower(trim(poi_name))
          order by created_at asc, id asc
        ) as rn
      from public.user_footprints
    )
    delete from public.user_footprints f
    using ranked r
    where f.id = r.id and r.rn > 1;

    execute $i$
      create unique index if not exists user_footprints_user_poi_name_uidx
        on public.user_footprints (user_id, (lower(trim(poi_name))))
    $i$;
  end if;

  if to_regclass('dev.user_footprints') is not null then
    with ranked as (
      select
        id,
        user_id,
        lower(trim(poi_name)) as name_key,
        created_at,
        row_number() over (
          partition by user_id, lower(trim(poi_name))
          order by created_at asc, id asc
        ) as rn
      from dev.user_footprints
    ),
    dupes as (
      select r.id as dupe_id, k.id as keep_id
      from ranked r
      join ranked k
        on k.user_id = r.user_id
       and k.name_key = r.name_key
       and k.rn = 1
      where r.rn > 1
    )
    update dev.footprint_visits v
    set footprint_id = d.keep_id
    from dupes d
    where v.footprint_id = d.dupe_id;

    with ranked as (
      select
        id,
        row_number() over (
          partition by user_id, lower(trim(poi_name))
          order by created_at asc, id asc
        ) as rn
      from dev.user_footprints
    )
    delete from dev.user_footprints f
    using ranked r
    where f.id = r.id and r.rn > 1;

    execute $i$
      create unique index if not exists dev_user_footprints_user_poi_name_uidx
        on dev.user_footprints (user_id, (lower(trim(poi_name))))
    $i$;
  end if;
end $$;
