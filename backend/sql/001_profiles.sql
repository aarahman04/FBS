-- Phase 2: replaces backend/profile.json with a real, per-user table.
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor).

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  link text,
  instant boolean not null default false,
  embeddings jsonb not null,        -- [{pose, vector}, ...], same shape as profile.json
  model_name text not null,
  detector_backend text not null,
  distance_metric text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- The backend connects with a trusted server-side connection (not the
-- anon/authenticated Supabase client), so RLS isn't load-bearing for it --
-- but it's free defense-in-depth if this table is ever queried through
-- PostgREST/the JS client directly.
create policy "individuals manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
