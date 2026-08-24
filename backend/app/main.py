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

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .link_validation import InvalidLinkError, validate_link
from .recognition import (
    THRESHOLD,
    DetectorUnavailableError,
    MultipleFacesError,
    NoFaceDetectedError,
    best_distance,
    build_profile,
    represent_face,
    warm_model,
)
from .schemas import FaceBoxOut, ProfileOut, RecognizeResponse, RegisterResponse
from .storage import PoseEmbedding, delete_profile, load_profile, save_profile

# A sweep that yields fewer than this many usable angles isn't worth saving --
# it would recognize about as poorly as the single-frontal-shot version did.
MIN_POSES = 3
MAX_POSES = 24


@asynccontextmanager
async def lifespan(app: FastAPI):
    warm_model()
    yield


app = FastAPI(title="FBS Phase 1 API", lifespan=lifespan)

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
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

    if len(embeddings) < MIN_POSES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {len(embeddings)} usable angle(s) captured (need at least {MIN_POSES}). "
                "Keep your face centered and well lit, and turn your head slowly."
            ),
        )

    # Instant mode is meaningless without something to open.
    save_profile(
        build_profile(name, validated_link, instant and validated_link is not None, embeddings)
    )
    return RegisterResponse(
        ok=True, poses_captured=len(embeddings), frames_rejected=rejected
    )


@app.post("/recognize", response_model=RecognizeResponse)
async def recognize(image: UploadFile = File(...)):
    profile = load_profile()
    if profile is None:
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

    distance = best_distance(probe, profile["embeddings"])
    face = FaceBoxOut(**box)

    if distance <= THRESHOLD:
        return RecognizeResponse(
            status="match",
            name=profile["name"],
            link=profile["link"],
            instant=profile.get("instant", False),
            distance=round(distance, 4),
            face=face,
        )
    return RecognizeResponse(status="no_match", distance=round(distance, 4), face=face)


@app.get("/profile", response_model=Optional[ProfileOut])
async def get_profile():
    profile = load_profile()
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
):
    """Edit the details without re-enrolling the face.

    Changing a link or toggling instant mode shouldn't force the user back
    through the whole capture sweep -- the embeddings are still valid.
    """
    profile = load_profile()
    if profile is None:
        raise HTTPException(status_code=404, detail="No profile registered yet.")

    name = name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")

    try:
        validated_link = validate_link(link)
    except InvalidLinkError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    profile["name"] = name
    profile["link"] = validated_link
    profile["instant"] = instant and validated_link is not None
    save_profile(profile)

    return ProfileOut(
        name=profile["name"],
        link=profile["link"],
        instant=profile["instant"],
        created_at=profile["created_at"],
        pose_count=len(profile["embeddings"]),
    )


@app.delete("/profile")
async def remove_profile():
    delete_profile()
    return {"ok": True}
