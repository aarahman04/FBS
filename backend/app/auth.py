import os
from typing import Optional

import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

# Supabase projects now default to asymmetric JWT signing keys (ES256), with
# the public keys published as JWKS; older projects sign symmetrically with a
# shared secret (HS256). Support both, since which one a project uses isn't
# something the backend gets to choose.
_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET")
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")

_ASYMMETRIC_ALGS = ("ES256", "RS256")
_SYMMETRIC_ALGS = ("HS256",)

# PyJWKClient caches fetched keys, so this doesn't hit the network per request.
_jwks_client = (
    PyJWKClient(f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json")
    if _SUPABASE_URL
    else None
)

if not _JWT_SECRET and not _jwks_client:
    raise RuntimeError(
        "Set SUPABASE_URL (for asymmetric ES256/RS256 keys) or "
        "SUPABASE_JWT_SECRET (for legacy HS256), or tokens can't be verified."
    )


def _key_for(token: str, alg: str):
    """Pick the verification key from the algorithm *family*, never from the
    header's algorithm alone.

    Letting a token nominate both its algorithm and key is the classic alg
    confusion attack -- a forged HS256 token signed with the public key would
    otherwise verify. Symmetric algorithms only ever get the shared secret;
    asymmetric ones only ever get a JWKS public key.
    """
    if alg in _SYMMETRIC_ALGS:
        if not _JWT_SECRET:
            raise HTTPException(status_code=401, detail="HS256 tokens are not accepted here.")
        return _JWT_SECRET

    if alg in _ASYMMETRIC_ALGS:
        if _jwks_client is None:
            raise HTTPException(status_code=401, detail="Asymmetric tokens are not accepted here.")
        return _jwks_client.get_signing_key_from_jwt(token).key

    raise HTTPException(status_code=401, detail=f"Unsupported token algorithm '{alg}'.")


def require_user(authorization: Optional[str] = Header(None)) -> str:
    """FastAPI dependency: verifies the bearer JWT, returns the user id.

    Raises 401 for anything wrong with the token rather than letting a
    verification error surface as a 500 -- an expired/missing/forged token is
    a client problem, not a server fault.

    The header is declared Optional so a missing one is handled here as a
    401; making it required would let FastAPI reject it first as a 422
    validation error, which reads as "malformed request" rather than
    "you need to sign in".
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token.")

    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Malformed token: {exc}") from exc

    key = _key_for(token, alg)

    try:
        payload = jwt.decode(
            token,
            key,
            algorithms=[alg],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject.")
    return user_id
