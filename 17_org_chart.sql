-- Org chart database objects required by org-chart-widget.js
-- Run once in the Supabase SQL Editor before using the org chart.

create extension if not exists pgcrypto;

create table if not exists public.org_chart_people (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  role text,
  email text,
  description text,
  photo_url text,
  manager_id uuid references public.org_chart_people(id) on delete set null,
  dotted_manager_id uuid references public.org_chart_people(id) on delete set null,
  sort_order integer not null default 0,
  position_x double precision,
  position_y double precision,
  direct_route_x double precision,
  dotted_route_x double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_chart_person_cannot_manage_self check (manager_id is null or manager_id <> id)
);

-- Existing installations need the new column because CREATE TABLE IF NOT
-- EXISTS does not alter an already-created table.
alter table public.org_chart_people
  add column if not exists dotted_manager_id uuid
  references public.org_chart_people(id) on delete set null;
alter table public.org_chart_people
  add column if not exists sort_order integer not null default 0;
alter table public.org_chart_people
  add column if not exists position_x double precision;
alter table public.org_chart_people
  add column if not exists position_y double precision;
alter table public.org_chart_people
  add column if not exists direct_route_x double precision;
alter table public.org_chart_people
  add column if not exists dotted_route_x double precision;

create index if not exists org_chart_people_manager_id_idx
  on public.org_chart_people(manager_id);
create index if not exists org_chart_people_dotted_manager_id_idx
  on public.org_chart_people(dotted_manager_id);

alter table public.org_chart_people enable row level security;

-- Raw SQL table creation requires explicit PostgREST role privileges.
grant select on table public.org_chart_people to anon, authenticated;
grant insert, update, delete on table public.org_chart_people to authenticated;

-- Resolve admin membership through a SECURITY DEFINER helper. Use the
-- immutable Supabase user id to read the canonical Auth email instead of
-- relying on provider-specific JWT claim names.
create or replace function public.is_org_chart_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $org_chart_admin$
  select exists (
    select 1
    from public.admins a
    join auth.users u on u.id = auth.uid()
    where lower(trim(a.email)) = lower(trim(u.email))
  );
$org_chart_admin$;

revoke all on function public.is_org_chart_admin() from public;
grant execute on function public.is_org_chart_admin() to authenticated;

drop policy if exists "org chart public read" on public.org_chart_people;
create policy "org chart public read"
  on public.org_chart_people
  for select
  to anon, authenticated
  using (true);

drop policy if exists "org chart admins insert" on public.org_chart_people;
create policy "org chart admins insert"
  on public.org_chart_people
  for insert
  to authenticated
  with check (
    public.is_org_chart_admin()
  );

drop policy if exists "org chart admins update" on public.org_chart_people;
create policy "org chart admins update"
  on public.org_chart_people
  for update
  to authenticated
  using (
    public.is_org_chart_admin()
  )
  with check (
    public.is_org_chart_admin()
  );

drop policy if exists "org chart admins delete" on public.org_chart_people;
create policy "org chart admins delete"
  on public.org_chart_people
  for delete
  to authenticated
  using (
    public.is_org_chart_admin()
  );

insert into storage.buckets (id, name, public)
values ('org-photos', 'org-photos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "org photos public read" on storage.objects;
create policy "org photos public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'org-photos');

drop policy if exists "org photos admins insert" on storage.objects;
create policy "org photos admins insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'org-photos'
    and public.is_org_chart_admin()
  );

drop policy if exists "org photos admins update" on storage.objects;
create policy "org photos admins update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'org-photos'
    and public.is_org_chart_admin()
  )
  with check (
    bucket_id = 'org-photos'
    and public.is_org_chart_admin()
  );

drop policy if exists "org photos admins delete" on storage.objects;
create policy "org photos admins delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'org-photos'
    and public.is_org_chart_admin()
  );


-- Initial APAC / Greater China team chart.
-- IDs are deterministic, so rerunning this file will not duplicate people.
-- Existing seeded rows are left untouched so later admin edits are preserved.
with seed(name, role, manager_name) as (
  values
    ('Daphne Dai', 'APAC / China GC — Shanghai', null),
    ('Claire Zhang', 'Executive Assistant — Shanghai', 'Daphne Dai'),
    ('Zhao Wen', 'Sr Legal Director, China Foods Marketing & Commercial — Shanghai', 'Daphne Dai'),
    ('Steve Liang', 'Legal Director, China Region Directors / B&C Director', 'Daphne Dai'),
    ('Leila Golchin', 'Senior Legal Director, GC APAC PO1 & Asia Foods — Sydney', 'Daphne Dai'),
    ('Lili Dent', 'Sr. Legal Director, GC Australia / New Zealand PO1 — Sydney', 'Daphne Dai'),
    ('Namit Chawla', 'Sr. Legal Director, GC Asia PO1 — Bangkok', null),

    ('Jing Jie Xiao', 'Legal Counsel, China — Shanghai', 'Zhao Wen'),
    ('Julia Feng', 'Legal Associate Counsel — Shanghai', 'Zhao Wen'),
    ('Donna Ye', 'Governance Sr Analyst — Shanghai', 'Zhao Wen'),
    ('Mu Fei Li', 'Legal Counsel, China — Shanghai', 'Zhao Wen'),

    ('Stanley Chen', 'Legal Sr. Counsel, China — Shanghai', 'Steve Liang'),
    ('Amanda Gao', 'Legal Analyst, China — Shanghai', 'Steve Liang'),
    ('Sophia Kong', 'Legal Counsel, China — Shanghai', 'Steve Liang'),
    ('Dora Liang', 'Legal Specialist — Shanghai', 'Steve Liang'),

    ('Dannica Alston', 'Sr. Legal Counsel — Sydney', 'Leila Golchin'),
    ('Aaron Lee', 'Paralegal, APAC / ANZ — Sydney', 'Leila Golchin'),
    ('Holly Leaton', 'Legal Counsel, APAC, Asia Foods / ANZ — Sydney', 'Leila Golchin'),
    ('Danielle Walsh', 'Sr. Legal Counsel — Sydney', 'Leila Golchin'),
    ('Theeravorn (Tune) Prayoonhong', 'Legal Counsel, Asia Foods — Bangkok', 'Danielle Walsh'),

    ('Prithasha Kumar', 'Legal Sr. Counsel — Sydney', 'Lili Dent'),
    ('Rosie Thomas', 'Counsel — Sydney', 'Prithasha Kumar'),
    ('Mark Coorey', 'Legal Counsel — Sydney', 'Lili Dent'),
    ('Julie Mehrdawi', 'Legal Counsel — Sydney', 'Lili Dent'),

    ('Punjaree (Aum) Siwaprasitkul', 'Executive Assistant / Legal Coordinator — Bangkok', 'Namit Chawla'),
    ('La Quang Vuong', 'Legal Sr. Counsel, Vietnam Foods — Vietnam', 'Namit Chawla'),
    ('Viet Nguyen', 'Legal Attorney — Vietnam', 'La Quang Vuong'),
    ('An Le Van', 'Legal Associate Counsel — Vietnam', 'La Quang Vuong'),
    ('Ngan Nguyen', 'Legal Associate Analyst — Vietnam', 'La Quang Vuong'),
    ('Apisist Sirintitong', 'Legal Attorney — Bangkok', 'Namit Chawla'),
    ('Oranee Kanoksophit', 'Legal Sr. Attorney — Bangkok', 'Apisist Sirintitong'),
    ('Chainipath Loywattanokul', 'Legal Coordinator — Bangkok', 'Oranee Kanoksophit'),
    ('Sonita Sakulerthasuk', 'Legal Director, Thailand / Indonesia PO1', 'Namit Chawla'),
    ('Yesi Natasya', 'Legal Associate Counsel — Indonesia', 'Sonita Sakulerthasuk'),
    ('Sarah Simarmata', 'Legal Coordinator — Indonesia', 'Sonita Sakulerthasuk'),
    ('Aina Nur', 'Legal Intern — Indonesia', 'Sonita Sakulerthasuk'),
    ('Ganesha Bratasena', 'Legal Manager — Indonesia', 'Namit Chawla')
)
insert into public.org_chart_people (id, name, role, manager_id)
select
  md5('apac-org-chart:' || name)::uuid,
  name,
  role,
  case
    when manager_name is null then null
    else md5('apac-org-chart:' || manager_name)::uuid
  end
from seed
on conflict (id) do nothing;

-- Reconcile the supplied reference chart once the seeded people exist.
-- Solid connectors become manager_id; dotted connectors become
-- dotted_manager_id. Initial canvas coordinates reproduce the supplied chart,
-- while COALESCE preserves positions that an admin has already moved.
with structure(name, manager_name, dotted_manager_name, sort_order, position_x, position_y) as (
  values
    ('Daphne Dai', null, null, 0, 540, 90),
    ('Claire Zhang', 'Daphne Dai', null, 1, 400, 150),
    ('Zhao Wen', 'Daphne Dai', null, 10, 25, 225),
    ('Steve Liang', 'Daphne Dai', null, 20, 225, 225),
    ('Leila Golchin', 'Daphne Dai', null, 30, 405, 225),
    ('Lili Dent', 'Daphne Dai', null, 40, 640, 225),
    ('Namit Chawla', null, 'Daphne Dai', 50, 1025, 225),

    ('Jing Jie Xiao', 'Zhao Wen', null, 11, 70, 315),
    ('Julia Feng', 'Zhao Wen', null, 12, 70, 385),
    ('Donna Ye', 'Zhao Wen', null, 13, 70, 455),
    ('Mu Fei Li', 'Zhao Wen', null, 14, 70, 525),

    ('Stanley Chen', 'Steve Liang', null, 21, 260, 315),
    ('Amanda Gao', 'Steve Liang', null, 22, 260, 385),
    ('Sophia Kong', 'Steve Liang', 'Leila Golchin', 23, 260, 455),
    ('Dora Liang', 'Steve Liang', null, 24, 195, 525),

    ('Dannica Alston', 'Leila Golchin', null, 31, 440, 315),
    ('Aaron Lee', 'Leila Golchin', null, 32, 470, 385),
    ('Holly Leaton', 'Leila Golchin', 'Lili Dent', 33, 440, 455),
    ('Danielle Walsh', 'Leila Golchin', null, 34, 440, 525),
    ('Theeravorn (Tune) Prayoonhong', 'Danielle Walsh', null, 35, 485, 595),

    ('Prithasha Kumar', 'Lili Dent', null, 41, 670, 305),
    ('Rosie Thomas', 'Prithasha Kumar', null, 42, 700, 375),
    ('Mark Coorey', 'Lili Dent', null, 43, 670, 445),
    ('Julie Mehrdawi', 'Lili Dent', null, 44, 670, 515),

    ('Punjaree (Aum) Siwaprasitkul', 'Namit Chawla', null, 51, 895, 295),
    ('La Quang Vuong', 'Namit Chawla', null, 52, 945, 385),
    ('Viet Nguyen', 'La Quang Vuong', null, 53, 825, 475),
    ('An Le Van', 'La Quang Vuong', null, 54, 825, 545),
    ('Ngan Nguyen', 'La Quang Vuong', null, 55, 825, 615),
    ('Apisist Sirintitong', 'Namit Chawla', null, 56, 1035, 455),
    ('Oranee Kanoksophit', 'Apisist Sirintitong', null, 57, 1035, 525),
    ('Chainipath Loywattanokul', 'Oranee Kanoksophit', null, 58, 1060, 595),
    ('Sonita Sakulerthasuk', 'Namit Chawla', null, 59, 1130, 335),
    ('Yesi Natasya', 'Sonita Sakulerthasuk', null, 60, 1200, 405),
    ('Sarah Simarmata', 'Sonita Sakulerthasuk', null, 61, 1200, 475),
    ('Aina Nur', 'Sonita Sakulerthasuk', null, 62, 1200, 545),
    ('Ganesha Bratasena', 'Namit Chawla', null, 63, 1200, 615)
)
update public.org_chart_people person
set
  manager_id = case
    when structure.manager_name is null then null
    else md5('apac-org-chart:' || structure.manager_name)::uuid
  end,
  dotted_manager_id = case
    when structure.dotted_manager_name is null then null
    else md5('apac-org-chart:' || structure.dotted_manager_name)::uuid
  end,
  sort_order = structure.sort_order,
  position_x = coalesce(person.position_x, structure.position_x),
  position_y = coalesce(person.position_y, structure.position_y),
  updated_at = now()
from structure
where person.id = md5('apac-org-chart:' || structure.name)::uuid;
