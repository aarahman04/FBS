import os

import jwt
from fastapi import Header, HTTPException

# Supabase issues HS256-signed JWTs with this project-level secret (Dashboard
# -> Settings -> API -> JWT Secret). Verifying locally avoids a network call
# per request that a JWKS lookup would cost.
_JWT_SECRET = os.environ["SUPABASE_JWT_SECRET"]


def require_user(authorization: str = Header(...)) -> str:
    """FastAPI dependency: verifies the bearer JWT, returns the user id.

    Raises 401 for anything wrong with the token rather than letting a
    verification error surface as a 500 -- an expired/missing/forged token is
    a client problem, not a server fault.
    """
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
