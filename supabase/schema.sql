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

insert into public.places (city, district, name, details, capabilities, distance_label, sort_order)
select 'Київ', 'Поділ', 'Хлебний', 'Зарядка · Wi‑Fi · відкрито', array['charge','wifi'], '4 хв', 1
where not exists (select 1 from public.places where city = 'Київ' and district = 'Поділ' and name = 'Хлебний');
insert into public.places (city, district, name, details, capabilities, distance_label, sort_order)
select 'Київ', 'Поділ', 'Бібліотека на Подолі', 'Тепло · вода · 12 місць', array['water','charge'], '7 хв', 2
where not exists (select 1 from public.places where city = 'Київ' and district = 'Поділ' and name = 'Бібліотека на Подолі');
insert into public.places (city, district, name, details, capabilities, distance_label, sort_order)
select 'Київ', 'Поділ', 'Coworking «Підвал»', 'Генератор · стабільний Wi‑Fi', array['wifi','charge'], '9 хв', 3
where not exists (select 1 from public.places where city = 'Київ' and district = 'Поділ' and name = 'Coworking «Підвал»');
