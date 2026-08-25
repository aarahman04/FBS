# FBS — Phase 3 Build Plan (Multiple Links & Recognition Modes)

Source spec: `idea.md` §7. Follows `PLAN.md` (Phase 1) and `PLAN-PHASE2.md`
(Phase 2). **Not started** — this document is the plan, written at the end of
Phase 2 so a fresh session can pick it up without re-deriving anything.

---

## Where Phase 2 left off

Working and deployed:

- Google sign-in (Supabase Auth, **ES256** tokens verified via JWKS).
- One profile per signed-in user in Supabase Postgres (`public.profiles`),
  embeddings as a JSONB array.
- `/recognize` is public and scans every profile; register/edit/delete are
  auth-scoped to `auth.uid()`.
- Onboarding: sign-in → name (prefilled from Google) + one optional link +
  instant toggle → guided pose-gated face scan → camera.
- Liquid-glass UI system (`.glass`, `.glass-interactive` in `index.css`),
  already applied to the open-link button, status pill, and the two circular
  camera controls.

**The single-link model is what Phase 3 replaces.**

---

## Scope (from `idea.md` §7)

1. Up to **five links** per profile instead of one.
2. On recognition, show links as a **vertical glass bar anchored under the
   face** — icon per row, tap to open. Not a full-screen menu.
3. **Known platforms get built-in icons** (Instagram, Facebook, LinkedIn,
   GitHub, X, YouTube). Custom URLs use the site's **favicon**, falling back
   to a neutral glyph when there isn't one.
4. Reintroduce the **four recognition modes**: link-only (auto-open),
   name-only, name + delayed auto-open, name + link dropdown.
5. **Confidence threshold with an explicit "no match" state** — already
   satisfied by Phase 1's `THRESHOLD` / `no_match`, plus the `ambiguous`
   state added at the end of Phase 2 (recognition refuses to choose between
   two profiles it can't tell apart). Phase 3 just surfaces these in the UI.

**Carried in from Phase 2:** one face may belong to only one account.
`/register` returns 409 otherwise. Phase 3 must not weaken this — the link
list is per-profile, so a duplicated face would mean two competing link sets
for the same person.

---

## Data model

Replace `profiles.link TEXT` + `profiles.instant BOOLEAN` with a links list.
Keep it as **JSONB on the profile row**, consistent with how `embeddings` is
stored — five rows per user doesn't justify a join table.

```sql
alter table public.profiles
  add column links jsonb not null default '[]'::jsonb,
  add column display_mode text not null default 'name_and_links';

-- One-time migration of existing single links, before dropping the columns.
update public.profiles
set links = jsonb_build_array(
      jsonb_build_object('kind', 'custom', 'url', link, 'label', null)
    )
where link is not null and links = '[]'::jsonb;

update public.profiles set display_mode = 'link_only' where instant = true;

alter table public.profiles drop column link, drop column instant;
```

Link entry shape (validate server-side, max 5):

```json
{ "kind": "instagram" | "facebook" | "linkedin" | "github" | "x" | "youtube" | "custom",
  "url": "https://…",
  "label": "optional, custom only" }
```

`display_mode` ∈ `link_only` | `name_only` | `name_then_open` |
`name_and_links`. Maps onto `idea.md`'s four modes; `link_only` and
`name_then_open` are what Phase 2's `instant` boolean becomes.

**Migration note:** write it as `backend/sql/002_links.sql` and run it in the
Supabase SQL editor, same as `001_profiles.sql`. Deploy the backend *after*
the migration — the new code reads columns that don't exist until then.

---

## Backend

- **`app/links.py`** (new) — the link list's validation and platform
  detection, kept out of `main.py`:
  - `normalize_links(raw) -> list[LinkEntry]`: at most 5, each URL through the
    existing `link_validation.validate_link()` (**reuse it — it already
    enforces the http/https allowlist required by `idea.md` §10**), infer
    `kind` from the host, reject duplicates of the same kind.
  - `PLATFORM_HOSTS`: host-suffix → kind mapping.
- **`app/schemas.py`** — `LinkOut { kind, url, label, icon_url }`;
  `RecognizeResponse.link`/`instant` become `links: list[LinkOut]` and
  `display_mode: str`. **This is a breaking response change** — the frontend
  must ship together with it.
- **`app/main.py`** — `/register` and `PATCH /profile` accept a JSON
  `links` array plus `display_mode` instead of `link` + `instant`.
- **Favicons:** do **not** hotlink `google.com/s2/favicons` from the client —
  that leaks every viewer's IP and the visited domain to a third party, which
  contradicts `idea.md` §10. Add `GET /favicon?host=…` that fetches
  server-side, caches, and returns the icon (or 404 → client uses the neutral
  glyph). Restrict to hosts that appear in a stored profile so it can't be
  used as an open proxy.

## Frontend

- **`components/LinkBar.tsx`** (new) — the vertical glass bar anchored under
  the face. Reuse `FaceLabel`'s existing placement math (`lib/facePosition.ts`
  `placeLabel()` already maps a normalized box onto the on-screen video and
  handles the `object-cover` crop) rather than writing new positioning.
  Each row: `.glass .glass-interactive`, icon left, tap opens the link.
- **`components/PlatformIcon.tsx`** (new) — inline SVGs for the known
  platforms; `<img>` from `/favicon?host=` for custom; neutral link glyph on
  error.
- **`components/ProfileFields.tsx`** — replace the single link input with a
  per-platform list (Instagram / Facebook / LinkedIn / GitHub rows, each
  optional) plus "add custom link". An empty row is simply not saved, and its
  icon never appears. Replace the instant toggle with a 4-way `display_mode`
  picker.
- **`App.tsx`** — the redirect logic keys off `display_mode` instead of
  `instant`; `name_and_links` renders `LinkBar` instead of auto-navigating.
  `LinkOpenFallback` stays for the single-link auto-open modes.

## Verification

- [ ] Migration runs; an existing single-link profile becomes a one-entry
      `links` array with the right `kind`, and its `instant` becomes
      `link_only`.
- [ ] Save 4 platform links + 1 custom; only the filled ones render icons.
- [ ] A 6th link is rejected server-side, not just hidden in the UI.
- [ ] `javascript:` and other non-http(s) URLs still rejected (regression on
      `link_validation`).
- [ ] Custom link with a favicon shows it; one without falls back to the
      neutral glyph and doesn't render a broken image.
- [ ] `/favicon` refuses a host that isn't in any stored profile.
- [ ] Each of the four `display_mode`s behaves as specified.
- [ ] LinkBar tracks the face while the head moves (it shares FaceLabel's
      per-frame positioning).

## Open questions for the user

1. **Link order** — fixed platform order, or user-draggable?
2. **Custom links** — one, or several within the 5-link budget?
3. **Modes vs. links** — is `link_only` meaningful with multiple links (open
   the first?), or should it force exactly one?

---

**Stop at the end of Phase 3** and review before Phase 4 (multiple faces in
frame, recognition from static images), same phase-gate as Phases 1 and 2.
