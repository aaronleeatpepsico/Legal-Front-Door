-- 20_documents.sql
-- Template / document file management: unlimited nested folders per subsection
-- Supabase Storage bucket: templates (public read)

create table if not exists public.documents (
  id            uuid        primary key default gen_random_uuid(),
  name          text        not null,
  type          text        not null check (type in ('folder', 'file')),
  subsection_id uuid        not null references public.subsections(id) on delete cascade,
  parent_id     uuid        references public.documents(id) on delete cascade,
  storage_path  text,
  mime_type     text,
  size          bigint,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_subsection_idx on public.documents(subsection_id);
create index if not exists documents_parent_idx     on public.documents(parent_id);

alter table public.documents enable row level security;

drop policy if exists "documents_public_read"  on public.documents;
create policy "documents_public_read" on public.documents
  for select to anon, authenticated using (true);

drop policy if exists "documents_admin_insert" on public.documents;
create policy "documents_admin_insert" on public.documents
  for insert to authenticated
  with check (public.is_org_chart_admin());

drop policy if exists "documents_admin_update" on public.documents;
create policy "documents_admin_update" on public.documents
  for update to authenticated
  using  (public.is_org_chart_admin())
  with check (public.is_org_chart_admin());

drop policy if exists "documents_admin_delete" on public.documents;
create policy "documents_admin_delete" on public.documents
  for delete to authenticated
  using (public.is_org_chart_admin());

-- Storage bucket (public read, admin write)
insert into storage.buckets (id, name, public)
  values ('templates', 'templates', true)
  on conflict (id) do update set public = true;

drop policy if exists "templates_public_select" on storage.objects;
create policy "templates_public_select" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'templates');

drop policy if exists "templates_admin_insert" on storage.objects;
create policy "templates_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'templates' and public.is_org_chart_admin());

drop policy if exists "templates_admin_update" on storage.objects;
create policy "templates_admin_update" on storage.objects
  for update to authenticated
  using  (bucket_id = 'templates' and public.is_org_chart_admin())
  with check (bucket_id = 'templates' and public.is_org_chart_admin());

drop policy if exists "templates_admin_delete" on storage.objects;
create policy "templates_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'templates' and public.is_org_chart_admin());
