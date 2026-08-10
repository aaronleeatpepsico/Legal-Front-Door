-- Org chart v2: customisable cards + two-axis line routing
-- Run once in the Supabase SQL Editor after 17_org_chart.sql.

alter table public.org_chart_people
  add column if not exists team_color  text,
  add column if not exists department  text,
  add column if not exists location    text,
  add column if not exists direct_route_y  double precision,
  add column if not exists dotted_route_y  double precision;
