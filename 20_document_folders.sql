-- Nested document folders for the Legal Front Door.
-- Existing links remain at subsection root because folder_id defaults to NULL.

create extension if not exists pgcrypto;

create table if not exists public.document_folders (
  id uuid primary key default gen_random_uuid(),
  subsection_id uuid not null references public.subsections(id) on delete cascade,
  parent_folder_id uuid references public.document_folders(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_folders_not_own_parent check (parent_folder_id is null or parent_folder_id <> id)
);

alter table public.links
  add column if not exists folder_id uuid references public.document_folders(id) on delete set null;

create index if not exists document_folders_subsection_idx
  on public.document_folders (subsection_id, parent_folder_id, sort_order);

create index if not exists links_folder_id_idx
  on public.links (folder_id);

-- Admin helper. The app already stores its allowlist in public.admins.
create or replace function public.is_front_door_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admins a
    where lower(trim(a.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  );
$$;

revoke all on function public.is_front_door_admin() from public;
grant execute on function public.is_front_door_admin() to authenticated;

-- Keep folder parents inside the same subsection and prevent cycles.
create or replace function public.validate_document_folder_parent()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_subsection uuid;
begin
  if new.parent_folder_id is null then
    return new;
  end if;

  select subsection_id
    into parent_subsection
  from public.document_folders
  where id = new.parent_folder_id;

  if parent_subsection is null then
    raise exception 'Parent folder does not exist';
  end if;

  if parent_subsection <> new.subsection_id then
    raise exception 'A folder and its parent must belong to the same subsection';
  end if;

  if exists (
    with recursive ancestors as (
      select id, parent_folder_id
      from public.document_folders
      where id = new.parent_folder_id

      union all

      select f.id, f.parent_folder_id
      from public.document_folders f
      join ancestors a on f.id = a.parent_folder_id
      where a.parent_folder_id is not null
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Folder hierarchy cannot contain a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists document_folders_validate_parent on public.document_folders;
create trigger document_folders_validate_parent
before insert or update of subsection_id, parent_folder_id
on public.document_folders
for each row execute function public.validate_document_folder_parent();

-- A link may only point to a folder in its own subsection.
create or replace function public.validate_link_folder_subsection()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  folder_subsection uuid;
begin
  if new.folder_id is null then
    return new;
  end if;

  select subsection_id
    into folder_subsection
  from public.document_folders
  where id = new.folder_id;

  if folder_subsection is null then
    raise exception 'Document folder does not exist';
  end if;

  if folder_subsection <> new.subsection_id then
    raise exception 'A link and its folder must belong to the same subsection';
  end if;

  return new;
end;
$$;

drop trigger if exists links_validate_folder_subsection on public.links;
create trigger links_validate_folder_subsection
before insert or update of subsection_id, folder_id
on public.links
for each row execute function public.validate_link_folder_subsection();

create or replace function public.touch_document_folder_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists document_folders_touch_updated_at on public.document_folders;
create trigger document_folders_touch_updated_at
before update on public.document_folders
for each row execute function public.touch_document_folder_updated_at();

alter table public.document_folders enable row level security;

-- Safe to re-run the migration.
drop policy if exists "document_folders_public_read" on public.document_folders;
drop policy if exists "document_folders_admin_insert" on public.document_folders;
drop policy if exists "document_folders_admin_update" on public.document_folders;
drop policy if exists "document_folders_admin_delete" on public.document_folders;

create policy "document_folders_public_read"
on public.document_folders
for select
to anon, authenticated
using (true);

create policy "document_folders_admin_insert"
on public.document_folders
for insert
to authenticated
with check (public.is_front_door_admin());

create policy "document_folders_admin_update"
on public.document_folders
for update
to authenticated
using (public.is_front_door_admin())
with check (public.is_front_door_admin());

create policy "document_folders_admin_delete"
on public.document_folders
for delete
to authenticated
using (public.is_front_door_admin());

grant select on public.document_folders to anon, authenticated;
grant insert, update, delete on public.document_folders to authenticated;

comment on table public.document_folders is
  'Nested folders within an Operating Unit subsection for downloadable documents and links.';
comment on column public.links.folder_id is
  'Optional document folder. NULL means the link/document sits at the subsection root.';
