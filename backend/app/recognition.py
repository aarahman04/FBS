from typing import TypedDict

import numpy as np
from deepface import DeepFace
from deepface.modules import verification as dst
from deepface.modules.exceptions import FaceNotDetected
from PIL import Image

from .db import PoseEmbedding


class FaceBox(TypedDict):
    """Face position within the frame, normalized to 0..1."""

    x: float
    y: float
    w: float
    h: float

MODEL_NAME = "Facenet512"
# Pinned once and used for both register and recognize -- the match threshold
# is tuned per model+detector+metric combo, so the detector must not vary.
#
# NOT "opencv": opencv-python 5.x ships an empty cv2/data/ directory (OpenCV 5
# dropped the bundled Haar cascades), so DeepFace's opencv backend raised on
# every single frame -- the bug that made registration always report "no face
# detected". "ssd" is broken by the same OpenCV 5 change.
#
# yunet over retinaface/mtcnn on measured numbers (10 dataset images):
#   yunet      9/10  0.25s/img
#   mtcnn      9/10  1.10s/img
#   retinaface 10/10 7.90s/img
# RetinaFace's extra hit rate isn't worth 32x the latency here: a 10-frame
# enrollment sweep would take 79s and the live recognize loop would lag badly.
# YuNet is also a proper DNN detector, so unlike Haar it handles turned and
# tilted faces.
DETECTOR_BACKEND = "yunet"
DISTANCE_METRIC = "cosine"

THRESHOLD = dst.find_threshold(MODEL_NAME, DISTANCE_METRIC)


class NoFaceDetectedError(Exception):
    """The image was processed fine, but contained no detectable face."""


class MultipleFacesError(Exception):
    """More than one face in a frame that must contain exactly one."""


class DetectorUnavailableError(Exception):
    """The detector itself is broken/missing -- an environment fault, NOT a
    statement about the image. Kept distinct so an install problem can never
    be reported to the user as 'no face detected'."""


# Every DeepFace error subclasses ValueError, so "no face in this image" and
# "the detector itself is broken" arrive as the same catch. FaceNotDetected is
# a dedicated type, so match on that rather than on message text -- wording
# changes between releases, the type does not.
_NO_FACE_TYPES: tuple[type[Exception], ...] = (FaceNotDetected,)

# Fallback only, for a DeepFace build that raises a bare ValueError.
_NO_FACE_MARKERS = ("face could not be detected", "no face detected")


def _classify_value_error(exc: ValueError) -> Exception:
    if isinstance(exc, _NO_FACE_TYPES):
        return NoFaceDetectedError(str(exc))
    if type(exc) is ValueError:
        message = str(exc).lower()
        if any(marker in message for marker in _NO_FACE_MARKERS):
            return NoFaceDetectedError(str(exc))
    # Anything else (ImgNotFound, UnimplementedError, a broken detector build)
    # is an environment fault and must not be reported as a missing face.
    return DetectorUnavailableError(f"{type(exc).__name__}: {exc}")


def warm_model() -> None:
    """Load recognition weights AND prove the detector actually runs.

    Exercising the detector at boot means a broken install fails loudly at
    startup instead of masquerading as 'no face detected' on every request.
    """
    DeepFace.build_model(MODEL_NAME)

    blank = np.zeros((160, 160, 3), dtype=np.uint8)
    try:
        DeepFace.represent(
            img_path=blank,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=False,
        )
    except ValueError as exc:
        raise DetectorUnavailableError(
            f"Detector '{DETECTOR_BACKEND}' failed to initialize: {exc}"
        ) from exc


def represent_face(image_path: str) -> tuple[list[float], FaceBox]:
    """Returns the embedding plus where the face sat in the frame.

    The box is normalized to 0..1 so the browser can place the on-screen name
    over the face without knowing what resolution the frame was uploaded at.
    """
    try:
        results = DeepFace.represent(
            img_path=image_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError as exc:
        raise _classify_value_error(exc) from exc

    if len(results) == 0:
        raise NoFaceDetectedError("No face detected in image.")
    if len(results) > 1:
        raise MultipleFacesError(f"{len(results)} faces detected; expected exactly one.")

    with Image.open(image_path) as img:
        width, height = img.size

    area = results[0]["facial_area"]
    box: FaceBox = {
        "x": area["x"] / width,
        "y": area["y"] / height,
        "w": area["w"] / width,
        "h": area["h"] / height,
    }
    return results[0]["embedding"], box


def best_distance(probe: list[float], stored: list[PoseEmbedding]) -> float:
    """Closest distance between a probe and any enrolled pose.

    Taking the minimum across poses is what lets a profile-angle scan match a
    profile-angle enrollment instead of being compared only to a frontal shot.
    """
    if not stored:
        # min() over an empty sequence would raise. A saved profile always has
        # >= MIN_POSES entries, so this only guards a hand-edited file.
        return float("inf")

    probe_array = np.array(probe)
    return min(
        float(dst.find_cosine_distance(probe_array, np.array(entry["vector"])))
        for entry in stored
    )


def is_match(probe: list[float], stored: list[PoseEmbedding]) -> bool:
    return best_distance(probe, stored) <= THRESHOLD
