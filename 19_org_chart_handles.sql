-- Org chart v3: free handle routing on all four sides
-- Run once in the Supabase SQL Editor after 18_org_chart_v2.sql.

alter table public.org_chart_people
  add column if not exists manager_source_handle        text,
  add column if not exists manager_target_handle        text,
  add column if not exists dotted_manager_source_handle text,
  add column if not exists dotted_manager_target_handle text;
