import os
from typing import Optional

import jwt
from fastapi import Header, HTTPException

# Supabase issues HS256-signed JWTs with this project-level secret (Dashboard
# -> Settings -> API -> JWT Secret). Verifying locally avoids a network call
# per request that a JWKS lookup would cost.
_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]


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
        payload = jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing subject.")
    return user_id
