-- Run once in Supabase Dashboard → SQL Editor.
-- The app stores only an approximate city/district, never exact user coordinates.
create extension if not exists pgcrypto;

create table if not exists public.status_reports (
  id uuid primary key default gen_random_uuid(),
  city text not null check (char_length(city) between 2 and 60),
  district text not null check (char_length(district) between 2 and 60),
  service text not null check (service in ('electricity', 'water', 'internet')),
  status text not null check (status in ('available', 'unavailable', 'unstable')),
  reporter_id uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists status_reports_area_recent_idx on public.status_reports (city, district, created_at desc);
alter table public.status_reports enable row level security;
create policy "Anyone can read area reports" on public.status_reports for select to anon, authenticated using (true);
create policy "Anonymous users can create only own reports" on public.status_reports for insert to authenticated with check (reporter_id = auth.uid());

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  district text not null,
  name text not null,
  details text not null,
  capabilities text[] not null default '{}',
  distance_label text,
  is_open boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table public.places enable row level security;
create policy "Anyone can read verified places" on public.places for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.status_reports;

-- One anonymous account can send one status per service every two minutes.
-- This reduces accidental double taps and basic spam without storing personal data.
create or replace function public.submit_status_report(
  p_city text,
  p_district text,
  p_service text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.status_reports
    where reporter_id = auth.uid()
      and service = p_service
      and created_at > now() - interval '2 minutes'
  ) then
    raise exception 'Please wait before sending another report for this service';
  end if;

  insert into public.status_reports (city, district, service, status, reporter_id)
  values (p_city, p_district, p_service, p_status, auth.uid());
end;
$$;

revoke all on function public.submit_status_report(text, text, text, text) from public;
grant execute on function public.submit_status_report(text, text, text, text) to authenticated;
