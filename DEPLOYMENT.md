# Deploying FBS

## Short answer on Vercel

**The frontend deploys to Vercel. The backend cannot.** And for Phase 1 as
specified, a public deployment of the whole thing is not yet meaningful — see
"The blocker" below before you spend time on it.

---

## Why the backend can't run on Vercel

Vercel runs serverless functions, not long-lived servers. This backend breaks
three of its assumptions at once:

| Requirement | Vercel's limit | Ours |
|---|---|---|
| Function bundle size | 250 MB unzipped | TensorFlow + DeepFace ≈ 500 MB+ installed |
| Filesystem | Ephemeral per invocation | `profile.json` must persist between requests |
| Startup cost | Billed per invocation, cold starts | 95 MB Facenet512 loaded into memory at boot |

Even ignoring size, the storage model is fatal: every serverless invocation
gets a fresh filesystem, so a profile registered by one request would not
exist for the next. There is no configuration that fixes this — it needs a
process that stays alive with a disk attached.

**Backends that do work:** Render, Railway, Fly.io, or Hugging Face Spaces —
all run persistent containers with a writable volume. Point the frontend at
one via `VITE_API_BASE`.

---

## The blocker: one global profile

This matters more than the hosting question.

Phase 1 stores **a single profile in one local file**, by design (`idea.md`
§5 explicitly rules out a database until Phase 2). On your machine that's
exactly right — it's the cheapest way to prove the core loop.

Deployed publicly, that same design means:

- Every visitor shares **one** profile slot.
- Whoever registers last **overwrites everyone else**.
- Every visitor sees that one person's name and gets sent to their link.

That isn't a bug to patch — it's the Phase 1 storage model meeting a
multi-user context it was never scoped for. `idea.md` §5 calls Phase 1 "a
feasibility test, not a product" and says to revisit the plan before adding
accounts or a database. **Phase 2 (accounts + real database) is the thing
that makes a public deploy coherent.**

There is also a privacy dimension: a public endpoint accepting arbitrary
uploaded images and running face recognition on them is a different thing
from a local prototype, and `idea.md` §10 commits to opt-in-only recognition.

**Recommendation:** don't launch publicly yet. If you want to show it to
someone now, deploy it privately (Vercel password protection, or a preview
URL you don't share) and treat it as a demo with one registered face.

---

## The actual deployment (Railway backend + Vercel frontend)

### 1. Backend on Railway

Railway builds `backend/Dockerfile`. **Set the service's Root Directory to
`backend`** — pointed at the repo root, the builder sees only `backend/` and
`frontend/` and fails with "could not determine how to build the app".

The Dockerfile exists because neither Nixpacks nor Railpack could produce a
working image. DeepFace depends on `opencv-python` — the Qt/X11-linked build —
so `import cv2` dies on a missing `libxcb.so.1` in a container with no X11.
Pinning `opencv-python-headless` doesn't help: pip installs deepface's
dependency *after* it, and both ship the same `cv2/` directory, so the GUI
binary wins. Uninstalling it afterwards leaves `cv2/` inconsistent, because
the file it deletes is one headless also owns. Installing the GUI shared
libraries directly is the only deterministic fix, and that needs a Dockerfile.

Environment variables:
- `ALLOWED_ORIGINS` — comma-separated list of frontend origins. Unset falls
  back to `*`, which is fine locally and wrong in production.
- `PORT` is injected by Railway; the Dockerfile's `CMD` reads it.

Notes:
- First boot downloads ~95 MB of Facenet512 weights and ~119 MB RetinaFace
  (unused but fetched by the package) into `DEEPFACE_HOME` (`/app/.deepface`).
  Mount a Railway volume there or it re-downloads on every cold start.
- Needs ~1 GB RAM for TensorFlow. 512 MB plans will OOM.
- `backend/profile.json` also needs a volume, or the registration disappears
  on redeploy.

### 2. Frontend on Vercel

- **Root Directory:** `frontend`
- **Environment variable:** `VITE_API_BASE` = the Railway service's public
  HTTPS URL. Without it the app calls `/api`, which only exists via the local
  Vite dev proxy. It is baked in at build time, so changing it requires a
  redeploy, not just a restart.
- `vercel.json` is already configured (SPA rewrites, long-cache headers for
  the MediaPipe assets).
- Camera access requires HTTPS — Vercel provides this automatically.
- Whatever domain Vercel serves has to appear in the backend's
  `ALLOWED_ORIGINS`, or every API call fails CORS.

### 3. MediaPipe assets

`npm run build` runs `scripts/copy-mediapipe.mjs`, which copies the WASM
runtime out of `node_modules` into `public/mediapipe/wasm`. Those ~35 MB are
gitignored and regenerated on every build, so Vercel produces them during its
own install+build. The 224 KB `.tflite` detector model **is** committed, since
it comes from Google's model host rather than npm.

---

## Local development

```bash
# terminal 1
cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000

# terminal 2
cd frontend && npm run dev     # http://localhost:5173
```

The Vite dev server proxies `/api` to `localhost:8000`, so the browser sees a
single origin and neither CORS nor mixed-content applies.

### Testing on a phone

`getUserMedia` requires a secure context, so a LAN IP over plain HTTP will
silently fail to get camera permission. Tunnel the **frontend only** —
the proxy carries the API with it:

```bash
ngrok http 5173
```
