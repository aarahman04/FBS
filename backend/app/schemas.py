from typing import Literal, Optional

from pydantic import BaseModel


class FaceBoxOut(BaseModel):
    """Face position in the frame, normalized to 0..1."""

    x: float
    y: float
    w: float
    h: float


class LinkOut(BaseModel):
    kind: str
    url: str
    label: Optional[str] = None


class ProfileOut(BaseModel):
    name: str
    links: list[LinkOut] = []
    display_mode: str = "name_and_links"
    created_at: str
    pose_count: int


class RegisterResponse(BaseModel):
    ok: bool
    poses_captured: int
    frames_rejected: int
    error: Optional[str] = None


class RecognizeResponse(BaseModel):
    status: Literal["not_registered", "no_face_detected", "no_match", "ambiguous", "match"]
    name: Optional[str] = None
    links: list[LinkOut] = []
    display_mode: Optional[str] = None
    distance: Optional[float] = None
    face: Optional[FaceBoxOut] = None
