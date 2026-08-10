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
