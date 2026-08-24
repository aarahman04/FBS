from typing import Literal, Optional

from pydantic import BaseModel


class FaceBoxOut(BaseModel):
    """Face position in the frame, normalized to 0..1."""

    x: float
    y: float
    w: float
    h: float


class ProfileOut(BaseModel):
    name: str
    link: Optional[str] = None
    instant: bool = False
    created_at: str
    pose_count: int


class RegisterResponse(BaseModel):
    ok: bool
    poses_captured: int
    frames_rejected: int
    error: Optional[str] = None


class RecognizeResponse(BaseModel):
    status: Literal["not_registered", "no_face_detected", "no_match", "match"]
    name: Optional[str] = None
    link: Optional[str] = None
    instant: bool = False
    distance: Optional[float] = None
    face: Optional[FaceBoxOut] = None
