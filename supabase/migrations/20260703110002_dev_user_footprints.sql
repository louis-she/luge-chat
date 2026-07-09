-- Dev schema mirror for footprint tables (Expo __DEV__ uses dev schema)

create type dev.footprint_poi_type as enum (
  'city',
  'town',
  'river',
  'scenery',
  'bridge',
  'statue',
  'mountain',
  'other'
);

create type dev.footprint_visit_status as enum ('active', 'archived');

create table dev.user_footprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references dev.users (id) on delete cascade,

  poi_name text not null,
  poi_type dev.footprint_poi_type not null default 'other',
  geom dev.geography(Point, 4326) not null,

  title text not null default '',
  summary text not null default '',
  llm_notes text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dev_user_footprints_user_id_idx on dev.user_footprints (user_id);
create index dev_user_footprints_geom_gix on dev.user_footprints using gist (geom);

create table dev.footprint_visits (
  id uuid primary key default gen_random_uuid(),
  footprint_id uuid not null references dev.user_footprints (id) on delete cascade,

  status dev.footprint_visit_status not null default 'active',
  started_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  archived_at timestamptz,

  visit_summary text not null default '',
  llm_notes text not null default '',
  start_location dev.geography(Point, 4326),

  needs_summary boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dev_footprint_visits_footprint_id_idx on dev.footprint_visits (footprint_id);

create table dev.footprint_messages (
  id uuid primary key default gen_random_uuid(),
  footprint_visit_id uuid not null references dev.footprint_visits (id) on delete cascade,

  role dev.dialog_role not null,
  content text not null default '',

  triggered_location dev.geography(Point, 4326),
  heading_degrees real,

  created_at timestamptz not null default now()
);

create or replace function dev.nearby_user_footprints(
  p_user_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 30000
)
returns table (
  id uuid,
  poi_name text,
  poi_type dev.footprint_poi_type,
  title text,
  summary text,
  llm_notes text,
  distance_m double precision,
  lat double precision,
  lng double precision,
  visit_count bigint,
  last_visit_at timestamptz
)
language sql
stable
as $$
  select
    f.id,
    f.poi_name,
    f.poi_type,
    f.title,
    f.summary,
    f.llm_notes,
    st_distance(
      f.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography
    ) as distance_m,
    dev.st_y(f.geom::dev.geometry) as lat,
    dev.st_x(f.geom::dev.geometry) as lng,
    count(v.id) as visit_count,
    max(v.started_at) as last_visit_at
  from dev.user_footprints f
  left join dev.footprint_visits v on v.footprint_id = f.id
  where f.user_id = p_user_id
    and dev.st_dwithin(
      f.geom,
      dev.st_setsrid(dev.st_makepoint(p_lng, p_lat), 4326)::dev.geography,
      p_radius_m
    )
  group by f.id
  order by distance_m asc
  limit 12;
$$;

create or replace function dev.jwt_user_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'user_id', '')::uuid
  );
$$;

alter table dev.user_footprints enable row level security;
alter table dev.footprint_visits enable row level security;
alter table dev.footprint_messages enable row level security;

create policy dev_user_footprints_select_own
  on dev.user_footprints
  for select
  to authenticated
  using (user_id = dev.jwt_user_id());

create policy dev_footprint_visits_select_own
  on dev.footprint_visits
  for select
  to authenticated
  using (
    exists (
      select 1 from dev.user_footprints f
      where f.id = footprint_id and f.user_id = dev.jwt_user_id()
    )
  );

create policy dev_footprint_messages_select_own
  on dev.footprint_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from dev.footprint_visits v
      join dev.user_footprints f on f.id = v.footprint_id
      where v.id = footprint_visit_id and f.user_id = dev.jwt_user_id()
    )
  );

grant execute on function dev.nearby_user_footprints(uuid, double precision, double precision, integer)
  to service_role, authenticated;
grant select on dev.user_footprints to authenticated, service_role;
grant select on dev.footprint_visits to authenticated, service_role;
grant select on dev.footprint_messages to authenticated, service_role;
grant all on dev.user_footprints to service_role;
grant all on dev.footprint_visits to service_role;
grant all on dev.footprint_messages to service_role;
