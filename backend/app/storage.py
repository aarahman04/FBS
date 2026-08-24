import json
import os
import tempfile
from pathlib import Path
from typing import Optional, TypedDict

PROFILE_PATH = Path(__file__).resolve().parent.parent / "profile.json"

# v2: multiple pose embeddings per profile instead of a single frontal vector,
# so a face can be recognized from side/tilted angles too.
# v3: adds the `instant` link mode flag.
SCHEMA_VERSION = 3


class PoseEmbedding(TypedDict):
    pose: str
    vector: list[float]


class Profile(TypedDict):
    schema_version: int
    name: str
    link: Optional[str]
    # When true the link opens by itself a moment after recognition, and the
    # manual "Open link" control is suppressed -- the two are alternatives,
    # never both at once.
    instant: bool
    embeddings: list[PoseEmbedding]
    model_name: str
    detector_backend: str
    distance_metric: str
    created_at: str


def load_profile() -> Optional[Profile]:
    if not PROFILE_PATH.exists():
        return None
    with open(PROFILE_PATH, "r", encoding="utf-8") as f:
        profile = json.load(f)

    # A profile written by an older/newer build can't be compared against
    # embeddings from the current model+detector combo -- treat it as absent
    # rather than silently producing meaningless distances.
    if profile.get("schema_version") != SCHEMA_VERSION:
        return None
    return profile


def save_profile(profile: Profile) -> None:
    directory = PROFILE_PATH.parent
    fd, tmp_path = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(profile, f)
        os.replace(tmp_path, PROFILE_PATH)
    except BaseException:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def delete_profile() -> bool:
    if PROFILE_PATH.exists():
        PROFILE_PATH.unlink()
        return True
    return False
