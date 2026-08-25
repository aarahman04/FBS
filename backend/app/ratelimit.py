"""Small in-memory, per-client rate limiter.

Deliberately dependency-free: a single Railway container doesn't need a Redis
round trip per request, and adding a limiter library is one more thing that
can fail to install (see the opencv-headless story). A sliding window keyed by
client IP is enough to stop the public /recognize endpoint -- which runs a CPU
face model per call -- from being hammered into a cost/DoS problem, and to
throttle the heavy /register write.

Not a security boundary on its own: X-Forwarded-For can be spoofed, so a
determined attacker can rotate keys past a per-IP limit. It caps honest clients
and casual abuse, which is the actual threat here. Auth (require_user) is the
real gate on the write endpoints.
"""

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


def client_ip(request: Request) -> str:
    """Best-effort caller IP. Railway (and most proxies) put the real client
    first in X-Forwarded-For; fall back to the socket peer for local dev."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """Fixed set of timestamps per key inside a sliding window. Thread-safe
    because uvicorn runs sync endpoints on a threadpool."""

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            bucket = self._hits[key]
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.max_requests:
                return False
            bucket.append(now)
            return True

    def prune(self) -> None:
        """Drop empty buckets. Cheap; called opportunistically."""
        now = time.monotonic()
        cutoff = now - self.window
        with self._lock:
            for key in list(self._hits.keys()):
                bucket = self._hits[key]
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()
                if not bucket:
                    del self._hits[key]


def limiter_dependency(limiter: RateLimiter):
    """Build a FastAPI dependency that enforces `limiter`, keyed by client IP.

    A 429 with Retry-After tells a well-behaved client to back off rather than
    retry-storming."""

    async def _dependency(request: Request) -> None:
        if not limiter.allow(client_ip(request)):
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please slow down and try again in a moment.",
                headers={"Retry-After": str(int(limiter.window))},
            )

    return _dependency
