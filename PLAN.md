# FBS — Phase 1 Build Plan

Source spec: `idea.md`. This doc covers Phase 1 only ("Core Loop"). Stop point at end of this doc — no Phase 2 (accounts, real database) until this loop is reviewed and approved.

---

## Stack

- **Frontend:** React + Vite + TypeScript + Tailwind (v4), `getUserMedia` for camera, mobile-first responsive layout.
- **Backend:** Python + FastAPI, DeepFace with `Facenet512` backend (MIT-licensed, ~99.7% LFW accuracy, no commercial-use restriction).
- **Storage:** single local `profile.json` file next to the backend (embedding + metadata, no raw photos, atomic writes). No database.
- **Dev connectivity:** Vite dev-server proxy (`/api` → `localhost:8000`) — frontend only ever talks to one origin, no CORS/mixed-content issues even when tunneled for phone testing.

No client-side face-detection library (no MediaPipe/ML Kit equivalent): DeepFace's own detector (`opencv` backend, pinned) already rejects faceless frames server-side. A single-in-flight capture loop (capture → POST → render → wait for response → repeat) keeps the UI responsive without a second on-device model.

## API Contract

- `POST /register` — multipart image + `name` + optional `link`. Validates link server-side (http/https only), runs DeepFace `represent()`, overwrites `profile.json`. Errors: no face / multiple faces / invalid link.
- `POST /recognize` — multipart image. Returns `{status: "not_registered" | "no_face_detected" | "no_match" | "match", name?, link?}`.
- `GET /profile` — current profile, for prefilling the edit form.
- `DELETE /profile` — clears the saved profile.

## Loopholes fixed

1. React Native Vision Camera / ML Kit doesn't apply to a web target — dropped, not substituted.
2. Auto-opening a link after an async fetch gets blocked by popup blockers (only synchronous user-gesture `window.open` calls reliably work) — attempt `window.open` on match, fall back to a visible tap-to-open button if blocked.
3. `getUserMedia` needs a secure context — plain http over LAN silently fails on a phone. Tunnel only the frontend (ngrok); the Vite proxy means the backend never needs its own tunnel or CORS config.
4. DeepFace downloads ~90MB Facenet512 weights on first *use* — warmed at FastAPI startup instead of during a user's first request.
5. Embeddings only, never raw photos re-verified against — `represent()` at both register and recognize time, stored vector compared via cosine distance against DeepFace's own threshold.
6. Detector backend pinned (`opencv`), not left to vary per-request — thresholds are tuned per model+detector+metric combo.
7. Three distinct states instead of one generic "no match": `not_registered`, `no_face_detected`, `no_match`.
8. Multiple faces in a registration frame are rejected explicitly, not silently resolved by picking the largest.
9. Link scheme allowlist enforced server-side (`http`/`https` only); client-side check is UX-only.
10. Captured frames downscaled (max 640px) and JPEG-encoded before upload.
11. Atomic `profile.json` writes (temp file + rename).
12. `tf-keras` pinned alongside TensorFlow to avoid the Keras 3 incompatibility DeepFace hits on a fresh install.
13. Stored profile carries provenance (`model_name`, `detector_backend`, `distance_metric`, `schema_version`) for future model swaps / Phase 2 migration.

## Folder Structure

```
FBS/
  idea.md
  PLAN.md
  backend/
    app/
      main.py            # FastAPI app, startup model warm, routes
      recognition.py     # represent() wrapper, cosine distance, threshold
      storage.py         # atomic read/write of profile.json
      schemas.py         # pydantic request/response models
      link_validation.py
    requirements.txt
    profile.json          # gitignored, created at runtime
  frontend/
    src/
      App.tsx
      components/
        CameraView.tsx
        ProfileIcon.tsx
        ProfileModal.tsx
        StatusOverlay.tsx
        LinkOpenFallback.tsx
      lib/
        api.ts
        captureFrame.ts
        linkValidation.ts
      types.ts
    vite.config.ts        # dev proxy '/api' -> localhost:8000
```

## Manual steps needed from you

- Confirm Python 3.10+ and Node 18+ available — already checked: Python 3.12.7, Node 24.12.0.
- OS camera permission for the browser you test in.
- For phone testing: willingness to use `ngrok` (or similar) for the https tunnel.

## Checkpoint

Phase 1 is done when a face can be registered (name + optional link), saved to `profile.json`, and reliably recognized again on a live camera — auto-opening the link (or falling back to a tap-to-open button) or showing just the name if no link was set, with an explicit no-match state when it isn't the registered person.

**Stop here** once verified — no Phase 2 work until reviewed and approved.
