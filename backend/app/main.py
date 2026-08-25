import os
import shutil
import sys
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

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

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .auth import require_user
from .db import PoseEmbedding, all_profiles, close_pool, delete_profile
from .db import get_profile as db_get_profile
from .db import open_pool
from .db import update_profile_details as db_update_profile_details
from .db import upsert_profile
from .link_validation import InvalidLinkError, validate_link
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
from .schemas import FaceBoxOut, ProfileOut, RecognizeResponse, RegisterResponse

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


@app.post("/register", response_model=RegisterResponse)
async def register(
    images: List[UploadFile] = File(...),
    name: str = Form(...),
    link: Optional[str] = Form(None),
    instant: bool = Form(False),
    user_id: str = Depends(require_user),
):
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    try:
        validated_link = validate_link(link)
    except InvalidLinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

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
                        "This face is already registered to another account. "
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

    # Instant mode is meaningless without something to open.
    upsert_profile(
        user_id,
        name,
        validated_link,
        instant and validated_link is not None,
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
        link=best_profile["link"],
        instant=best_profile.get("instant", False),
        distance=round(best, 4),
        face=face,
    )


@app.get("/profile", response_model=Optional[ProfileOut])
async def get_profile(user_id: str = Depends(require_user)):
    profile = db_get_profile(user_id)
    if profile is None:
        return None
    return ProfileOut(
        name=profile["name"],
        link=profile["link"],
        instant=profile.get("instant", False),
        created_at=profile["created_at"],
        pose_count=len(profile["embeddings"]),
    )


@app.patch("/profile", response_model=ProfileOut)
async def update_profile(
    name: str = Form(...),
    link: Optional[str] = Form(None),
    instant: bool = Form(False),
    user_id: str = Depends(require_user),
):
    """Edit the details without re-enrolling the face.

    Changing a link or toggling instant mode shouldn't force the user back
    through the whole capture sweep -- the embeddings are still valid.
    """
    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    try:
        validated_link = validate_link(link)
    except InvalidLinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    profile = db_update_profile_details(
        user_id, name, validated_link, instant and validated_link is not None
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="No profile registered yet.")

    return ProfileOut(
        name=profile["name"],
        link=profile["link"],
        instant=profile["instant"],
        created_at=profile["created_at"],
        pose_count=len(profile["embeddings"]),
    )


@app.delete("/profile")
async def remove_profile(user_id: str = Depends(require_user)):
    delete_profile(user_id)
    return {"ok": True}
