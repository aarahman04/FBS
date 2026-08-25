import json
import os
import shutil
import sys
import tempfile
import urllib.request
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse

# DeepFace/gdown log download progress with emoji on stdout; Windows consoles
# default to a cp1252 stdout that can't encode them and crash the download.
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Must run before .auth/.db import -- both read required env vars at import
# time. Railway injects real env vars directly, so this is a no-op in
# production; locally it's what makes backend/.env actually get picked up.
from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_user
from .db import PoseEmbedding, all_profiles, close_pool, delete_profile
from .db import get_profile as db_get_profile
from .db import open_pool
from .db import update_profile_details as db_update_profile_details
from .db import upsert_profile
from .link_validation import InvalidLinkError
from .links import normalize_links, resolve_display_mode
from .recognition import (
    AMBIGUITY_MARGIN,
    DETECTOR_BACKEND,
    DISTANCE_METRIC,
    MODEL_NAME,
    THRESHOLD,
    DetectorUnavailableError,
    MultipleFacesError,
    NoFaceDetectedError,
    best_distance,
    closest_enrolled_distance,
    represent_face,
    warm_model,
)
from .schemas import FaceBoxOut, LinkOut, ProfileOut, RecognizeResponse, RegisterResponse

# A sweep that yields fewer than this many usable angles isn't worth saving --
# it would recognize about as poorly as the single-frontal-shot version did.
MIN_POSES = 3
MAX_POSES = 24


@asynccontextmanager
async def lifespan(app: FastAPI):
    open_pool()
    warm_model()
    yield
    close_pool()


app = FastAPI(title="FBS Phase 2 API", lifespan=lifespan)

# Local dev talks through the Vite proxy so this never matters there. A public
# deploy is a separate origin (Vercel) hitting this API directly, so it has to
# be named explicitly -- credentialless "*" would work too, but an explicit
# allowlist is what stops a scraped API from being pointed at by anyone else's
# frontend. Comma-separated in ALLOWED_ORIGINS; unset falls back to "*" for
# local/dev use.
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS")
allowed_origins = (
    [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
    if _allowed_origins_env
    else ["*"]
)

# Vercel gives every preview deployment its own generated hostname, so an
# exact-match list can't cover them -- and a blocked preflight surfaces in the
# browser only as a generic "Load failed", which is a miserable thing to
# debug. ALLOWED_ORIGIN_REGEX lets those match by pattern while production
# stays an explicit allowlist.
allowed_origin_regex = os.environ.get("ALLOWED_ORIGIN_REGEX") or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=allowed_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def _save_upload_to_temp(image: UploadFile) -> Path:
    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    fd, tmp_path = tempfile.mkstemp(suffix=suffix)
    with open(fd, "wb") as f:
        shutil.copyfileobj(image.file, f)
    return Path(tmp_path)


def _parse_links_field(links_json: str):
    """The links list rides in as a JSON string form field (the request is
    multipart because of the image files, so it can't be a JSON body)."""
    try:
        raw = json.loads(links_json)
    except (json.JSONDecodeError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid links payload.") from exc
    try:
        return normalize_links(raw)
    except InvalidLinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _links_out(raw) -> list[LinkOut]:
    return [LinkOut(kind=item["kind"], url=item["url"], label=item.get("label")) for item in (raw or [])]


@app.post("/register", response_model=RegisterResponse)
async def register(
    images: List[UploadFile] = File(...),
    name: str = Form(...),
    links: str = Form("[]"),
    display_mode: str = Form("name_and_links"),
    user_id: str = Depends(require_user),
):
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    link_entries = _parse_links_field(links)

    embeddings: list[PoseEmbedding] = []
    rejected = 0

    for index, image in enumerate(images[:MAX_POSES]):
        tmp_path = await _save_upload_to_temp(image)
        try:
            vector, _box = represent_face(str(tmp_path))
        except DetectorUnavailableError as exc:
            # Environment fault -- surface it as a server error rather than
            # letting it look like the user's face was the problem.
            raise HTTPException(status_code=500, detail=f"Face detector error: {exc}") from exc
        except (NoFaceDetectedError, MultipleFacesError):
            # One unusable frame in a sweep is normal (mid-turn blur, face out
            # of frame). Skip it and keep the rest.
            rejected += 1
            continue
        finally:
            tmp_path.unlink(missing_ok=True)

        embeddings.append({"pose": f"sweep-{index}", "vector": vector})

    # One face, one account. Without this the same person can enroll under
    # several logins, and recognition then has no principled way to pick
    # between them -- it returns whichever is fractionally nearer, which
    # flips between frames and can open a stranger's link.
    #
    # Checked against everyone *except* the caller, so re-scanning your own
    # face is still allowed.
    if embeddings:
        for other in all_profiles(exclude_user_id=user_id):
            distance = closest_enrolled_distance(embeddings, other["embeddings"])
            if distance <= THRESHOLD:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"This face is already registered to “{other['name']}”. "
                        "Each face can belong to only one account — sign in with "
                        "that account, or delete its profile first."
                    ),
                )

    if len(embeddings) < MIN_POSES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {len(embeddings)} usable angle(s) captured (need at least {MIN_POSES}). "
                "Keep your face centered and well lit, and turn your head slowly."
            ),
        )

    upsert_profile(
        user_id,
        name,
        link_entries,
        resolve_display_mode(display_mode, link_entries),
        embeddings,
        MODEL_NAME,
        DETECTOR_BACKEND,
        DISTANCE_METRIC,
    )
    return RegisterResponse(
        ok=True, poses_captured=len(embeddings), frames_rejected=rejected
    )


@app.post("/recognize", response_model=RecognizeResponse)
async def recognize(image: UploadFile = File(...)):
    profiles = all_profiles()
    if not profiles:
        return RecognizeResponse(status="not_registered")

    tmp_path = await _save_upload_to_temp(image)
    try:
        probe, box = represent_face(str(tmp_path))
    except DetectorUnavailableError as exc:
        raise HTTPException(status_code=500, detail=f"Face detector error: {exc}") from exc
    except (NoFaceDetectedError, MultipleFacesError):
        return RecognizeResponse(status="no_face_detected")
    finally:
        tmp_path.unlink(missing_ok=True)

    # Closest profile across everyone registered, not just a yes/no against
    # one -- this is what "multi-user" actually means for recognition.
    scored = sorted(
        ((best_distance(probe, p["embeddings"]), p) for p in profiles),
        key=lambda pair: pair[0],
    )
    best, best_profile = scored[0]
    face = FaceBoxOut(**box)

    if best > THRESHOLD:
        return RecognizeResponse(status="no_match", distance=round(best, 4), face=face)

    # Refuse to guess between candidates the embedder can't separate. Naming
    # the fractionally-nearer one flips between frames and can open the wrong
    # person's link -- far worse than admitting we don't know.
    if len(scored) > 1:
        runner_up = scored[1][0]
        if runner_up <= THRESHOLD and (runner_up - best) < AMBIGUITY_MARGIN:
            return RecognizeResponse(
                status="ambiguous", distance=round(best, 4), face=face
            )

    return RecognizeResponse(
        status="match",
        name=best_profile["name"],
        links=_links_out(best_profile.get("links")),
        display_mode=best_profile.get("display_mode", "name_and_links"),
        distance=round(best, 4),
        face=face,
    )


# Favicons for custom links. Fetched server-side so a viewer's browser never
# hits a third party directly -- hotlinking google/duckduckgo from the client
# would leak every viewer's IP and the domains they see (idea.md §10).
_favicon_cache: dict[str, bytes] = {}
# Neutral 1x1 transparent GIF: a positive-but-blank answer when a host has no
# icon, so the client shows its own glyph instead of a broken image.
_BLANK_ICON = bytes.fromhex(
    "47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b"
)


def _profile_link_hosts() -> set[str]:
    """Hosts that appear in some stored profile's links. Restricting the proxy
    to these stops it from being used to fetch arbitrary URLs."""
    hosts: set[str] = set()
    for profile in all_profiles():
        for entry in profile.get("links", []):
            host = (urlparse(entry["url"]).hostname or "").lower()
            if host:
                hosts.add(host)
    return hosts


@app.get("/favicon")
def favicon(host: str) -> Response:
    host = host.strip().lower()
    if not host or host not in _profile_link_hosts():
        raise HTTPException(status_code=404, detail="Unknown host.")

    if host not in _favicon_cache:
        source = f"https://icons.duckduckgo.com/ip3/{host}.ico"
        try:
            request = urllib.request.Request(source, headers={"User-Agent": "FBS"})
            with urllib.request.urlopen(request, timeout=5) as response:
                _favicon_cache[host] = response.read()
        except Exception:
            _favicon_cache[host] = _BLANK_ICON

    data = _favicon_cache[host]
    media_type = "image/gif" if data is _BLANK_ICON else "image/x-icon"
    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@app.get("/profile", response_model=Optional[ProfileOut])
async def get_profile(user_id: str = Depends(require_user)):
    profile = db_get_profile(user_id)
    if profile is None:
        return None
    return ProfileOut(
        name=profile["name"],
        links=_links_out(profile.get("links")),
        display_mode=profile.get("display_mode", "name_and_links"),
        created_at=profile["created_at"],
        pose_count=len(profile["embeddings"]),
    )


@app.patch("/profile", response_model=ProfileOut)
async def update_profile(
    name: str = Form(...),
    links: str = Form("[]"),
    display_mode: str = Form("name_and_links"),
    user_id: str = Depends(require_user),
):
    """Edit the details without re-enrolling the face.

    Changing links or the display mode shouldn't force the user back through
    the whole capture sweep -- the embeddings are still valid.
    """
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    link_entries = _parse_links_field(links)

    profile = db_update_profile_details(
        user_id, name, link_entries, resolve_display_mode(display_mode, link_entries)
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="No profile registered yet.")

    return ProfileOut(
        name=profile["name"],
        links=_links_out(profile.get("links")),
        display_mode=profile.get("display_mode", "name_and_links"),
        created_at=profile["created_at"],
        pose_count=len(profile["embeddings"]),
    )


@app.delete("/profile")
async def remove_profile(user_id: str = Depends(require_user)):
    delete_profile(user_id)
    return {"ok": True}
