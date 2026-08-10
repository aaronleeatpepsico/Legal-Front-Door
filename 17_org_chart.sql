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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_chart_person_cannot_manage_self check (manager_id is null or manager_id <> id)
);

create index if not exists org_chart_people_manager_id_idx
  on public.org_chart_people(manager_id);

alter table public.org_chart_people enable row level security;

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
    exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "org chart admins update" on public.org_chart_people;
create policy "org chart admins update"
  on public.org_chart_people
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  )
  with check (
    exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "org chart admins delete" on public.org_chart_people;
create policy "org chart admins delete"
  on public.org_chart_people
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
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
    and exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "org photos admins update" on storage.objects;
create policy "org photos admins update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'org-photos'
    and exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  )
  with check (
    bucket_id = 'org-photos'
    and exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
  );

drop policy if exists "org photos admins delete" on storage.objects;
create policy "org photos admins delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'org-photos'
    and exists (
      select 1
      from public.admins a
      where lower(a.email) = lower(auth.jwt() ->> 'email')
    )
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
    ('Namit Chawla', 'Sr. Legal Director, GC Asia PO1 — Bangkok', 'Daphne Dai'),

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
    ('Ganesha Bratasena', 'Legal Manager — Indonesia', 'Sonita Sakulerthasuk')
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
