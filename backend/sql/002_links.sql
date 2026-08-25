-- Phase 3: replace the single `link` + `instant` columns with a links list
-- (up to 5 per profile) and a 4-way display mode.
--
-- Run this ONCE in the Supabase SQL editor BEFORE deploying the Phase 3
-- backend -- the new code reads `links`/`display_mode`, which don't exist
-- until this runs.

alter table public.profiles
  add column links jsonb not null default '[]'::jsonb,
  add column display_mode text not null default 'name_and_links';

-- Carry each existing single link over as a one-entry list. `kind` is left as
-- 'custom' here; the backend re-infers the real platform on the next save, and
-- the frontend icon falls back to the favicon in the meantime.
update public.profiles
set links = jsonb_build_array(
      jsonb_build_object('kind', 'custom', 'url', link, 'label', null)
    )
where link is not null and link <> '' and links = '[]'::jsonb;

-- Phase 2's `instant` becomes the auto-open display mode.
update public.profiles set display_mode = 'link_only' where instant = true;

alter table public.profiles drop column link, drop column instant;
