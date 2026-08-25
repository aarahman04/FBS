# FBS — Phase 2 Build Plan (Accounts)

Source spec: `idea.md` §6. Follows `PLAN.md` (Phase 1). Replaces the single
`backend/profile.json` with Google sign-in + a real database, per Phase 1's
own checkpoint ("stop here... no Phase 2 work until reviewed and approved" —
reviewed and approved 2026-08-25).

Deploy targets (already live from Phase 1's deploy work): Railway backend,
Vercel frontend, Supabase Postgres + Auth (Google OAuth provider already
configured in the Supabase dashboard).

---

## What's changing and why

**Recognize stays public; register/edit becomes authenticated.** The whole
product is "anyone can point a camera at a registered face." Signing in is
only required to *become* a registered face. `/recognize` takes no auth
header and now searches across every registered profile instead of
comparing against one global file.

**`not_registered` vs `no_match`, redefined.** `not_registered` now means
"zero profiles exist in the system at all" (empty table). `no_match` means
"compared against N ≥ 1 profiles, none matched." Same response shape as
Phase 1, just a different population behind it.

**Embeddings stay a JSONB array on the profile row** — not a separate table,
not pgvector. Phase 1's `Profile.embeddings: list[PoseEmbedding]` maps
directly onto `profiles.embeddings JSONB`, same replace-the-whole-list
semantics as a re-scan today. Recognize loops over every profile in Python
and reuses `recognition.best_distance()` unchanged, once per candidate.
Right-sized for the handful-to-low-hundreds of users this app will
plausibly have before Phase 3 ships — revisit only if profile count and
recognize latency actually become a problem.

**Account recovery is a side effect of auth, not a separate feature.** A
profile row is keyed by the Google-authenticated user's id, not a device —
signing in elsewhere and re-scanning naturally upserts the same row, which
already covers "changed devices." Delete is the existing endpoint, now
scoped to `auth.uid()`. No extra recovery UI needed.

**Backend DB access: raw `psycopg`, hand-written SQL.** Two tables, a
handful of queries — no ORM/migration-tool overhead.

**JWT verification: HS256 with Supabase's shared JWT secret**, via `pyjwt`.
No extra network call per request.

**Explicitly out of scope for Phase 2** (deliberate, not an oversight):
- ~~Enforcing one-face-per-account~~ — **deferred, then reversed.** Shipping
  without it was the wrong call. The same person enrolled under three
  accounts; recognition returned whichever profile was fractionally nearer,
  flip-flopped between names frame to frame, and opened a different
  account's instant link while never showing the right profile at all.
  Now enforced at both ends: `/register` returns 409 for a face another
  account already owns, and recognition returns `ambiguous` instead of
  choosing between candidates it can't separate (`AMBIGUITY_MARGIN` in
  `recognition.py`). `scripts/find_duplicate_faces.py` reports collisions
  enrolled before the guard existed.
- Apple sign-in (per spec, deferred to closer to App Store submission).
- pgvector / similarity indexing.

---

## Database schema (Supabase Postgres)

```sql
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
-- Backend connects via a trusted server-side connection, not the
-- anon/authenticated Supabase client, so RLS isn't load-bearing for it --
-- but it's free defense-in-depth if anything ever queries this table
-- through PostgREST/the JS client directly.
create policy "individuals manage their own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);
```

`pose_count` (used in `ProfileOut`) becomes `jsonb_array_length(embeddings)`,
computed in the query rather than stored.

## Backend (`backend/app/`)

- **`db.py`** (new) — `psycopg_pool.ConnectionPool` opened at startup
  alongside `warm_model()`; plain functions `get_profile(user_id)`,
  `upsert_profile(user_id, ...)`, `delete_profile(user_id)`,
  `all_profiles()`.
- **`auth.py`** (new) — FastAPI dependency `require_user` that verifies the
  bearer JWT with `SUPABASE_JWT_SECRET`, returns the user id (`sub`). 401 on
  missing/invalid/expired.
- **`storage.py`** — removed; replaced by `db.py`. File-based
  `profile.json` handling retired.
- **`recognition.py`** — unchanged.
- **`main.py`** — `POST /register`, `PATCH /profile`, `GET /profile`,
  `DELETE /profile` gain `user_id: str = Depends(require_user)`, scoped to
  that id. `POST /recognize` stays unauthenticated, scans `all_profiles()`.
- **`requirements.txt`** — add `psycopg[binary]`, `psycopg_pool`, `pyjwt`.
- **Railway env vars** — `DATABASE_URL` (Supabase **session pooler**) and
  `SUPABASE_URL` (for JWKS key discovery). Secrets — set via Railway
  dashboard/CLI directly, never pasted into chat.

  Two corrections to what this plan originally said, both found the hard way
  in deployment:
  - *Use the pooler, not the direct connection.* `db.<ref>.supabase.co` is
    IPv6-only and Railway has no IPv6 egress, so direct connections fail with
    "Network is unreachable". Session mode (port 5432) preserves prepared
    statements; transaction mode would need `prepare_threshold=None`.
  - *Tokens are ES256, not HS256.* Current Supabase projects sign
    asymmetrically and publish public keys as JWKS, so verification needs
    `SUPABASE_URL` rather than the shared `SUPABASE_JWT_SECRET`. The backend
    accepts both, choosing the key by algorithm family so a forged token
    can't pick its own verification key.

## Frontend (`frontend/src/`)

- **`lib/supabase.ts`** (new) — `createClient(VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY)`.
- **`lib/api.ts`** — `registerProfile`/`updateProfile`/`getProfile`/
  `deleteProfile` add `Authorization: Bearer <access_token>` from
  `supabase.auth.getSession()`. `recognizeFrame` unchanged.
- **`ProfileModal.tsx`** — no session → "Sign in with Google" button
  (`supabase.auth.signInWithOAuth({provider: 'google'})`) instead of the
  registration form. Signed in → existing flow, plus a sign-out control.
- **`App.tsx`** — no structural change.
- **Vercel env vars** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (public).
- **Google Cloud Console** — already done (JS origins + Supabase's
  `/auth/v1/callback` redirect URI).

## Verification checklist

- [ ] Register signed in as account A → row appears in `profiles`.
- [ ] Register a second face/account B → scanning A returns A, scanning B
      returns B (proves multi-row discrimination, not just match/no-match).
- [ ] `POST /register` / `PATCH /profile` / `DELETE /profile` 401 without a
      bearer token.
- [ ] Account A's token can't touch account B's row.
- [ ] Re-scan as A replaces embeddings, doesn't duplicate the row.
- [ ] Delete as A → `GET /profile` null, `/recognize` no longer matches A.
- [ ] Repeat against live Railway/Vercel URLs after redeploy with new env
      vars set.

## Status: complete

Shipped and confirmed working 2026-08-25. Beyond the plan above, deployment
surfaced four failures worth remembering — all documented in
`DEPLOYMENT.md` and fixed: opencv's X11 dependency in slim containers,
Supabase's IPv6-only direct DB connection, an unencoded `@` in the database
password breaking URL parsing, and Supabase issuing ES256 rather than HS256
JWTs.

A final styling pass added the liquid-glass UI system (`.glass`,
`.glass-interactive` in `frontend/src/index.css`) and cut instant-redirect
latency from ~6-7s to ~3s.

Phase 3 is planned in `PLAN-PHASE3.md` — **not started**.
