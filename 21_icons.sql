-- Icons storage bucket (public read, admin write)
insert into storage.buckets (id, name, public)
values ('icons', 'icons', true)
on conflict (id) do nothing;

drop policy if exists "icons_public_read"   on storage.objects;
drop policy if exists "icons_admin_insert"  on storage.objects;
drop policy if exists "icons_admin_update"  on storage.objects;
drop policy if exists "icons_admin_delete"  on storage.objects;

create policy "icons_public_read"
  on storage.objects for select
  using (bucket_id = 'icons');

create policy "icons_admin_insert"
  on storage.objects for insert
  with check (bucket_id = 'icons' and public.is_org_chart_admin());

create policy "icons_admin_update"
  on storage.objects for update
  using (bucket_id = 'icons' and public.is_org_chart_admin());

create policy "icons_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'icons' and public.is_org_chart_admin());

-- Add icon column to training_items (links and tools already have one)
alter table public.training_items
  add column if not exists icon text;
