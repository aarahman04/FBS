import os
from typing import Optional, TypedDict

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool


class PoseEmbedding(TypedDict):
    pose: str
    vector: list[float]


class LinkEntry(TypedDict):
    kind: str
    url: str
    label: Optional[str]


class Profile(TypedDict):
    id: str
    name: str
    links: list[LinkEntry]
    display_mode: str
    embeddings: list[PoseEmbedding]
    model_name: str
    detector_backend: str
    distance_metric: str
    created_at: str


_pool: Optional[ConnectionPool] = None


def open_pool() -> None:
    """Called once at FastAPI startup, alongside warm_model()."""
    global _pool
    # A single Railway container with a handful of concurrent requests
    # doesn't need pgbouncer -- a small direct-connection pool is simpler and
    # avoids pgbouncer transaction-mode caveats.
    _pool = ConnectionPool(os.environ["DATABASE_URL"], min_size=1, max_size=5, open=True)


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _pool_or_raise() -> ConnectionPool:
    if _pool is None:
        raise RuntimeError("db.open_pool() was not called at startup.")
    return _pool


def get_profile(user_id: str) -> Optional[Profile]:
    with _pool_or_raise().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select id, name, links, display_mode, embeddings, model_name,
                       detector_backend, distance_metric, created_at
                from profiles where id = %s
                """,
                (user_id,),
            )
            row = cur.fetchone()
    if row is None:
        return None
    row["created_at"] = row["created_at"].isoformat()
    return row  # type: ignore[return-value]


def all_profiles(exclude_user_id: Optional[str] = None) -> list[Profile]:
    """Every registered profile, for recognize's scan-and-find-best-match.

    `exclude_user_id` skips one row, so registration can ask "does anyone
    *else* already own this face" without matching the caller's own existing
    profile when they re-scan.
    """
    with _pool_or_raise().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                select id, name, links, display_mode, embeddings, model_name,
                       detector_backend, distance_metric, created_at
                from profiles
                where %s::uuid is null or id <> %s::uuid
                """,
                (exclude_user_id, exclude_user_id),
            )
            rows = cur.fetchall()
    for row in rows:
        row["created_at"] = row["created_at"].isoformat()
    return rows  # type: ignore[return-value]


def upsert_profile(
    user_id: str,
    name: str,
    links: list[LinkEntry],
    display_mode: str,
    embeddings: list[PoseEmbedding],
    model_name: str,
    detector_backend: str,
    distance_metric: str,
) -> Profile:
    """Full replace: used by /register, including re-scans -- the whole
    embeddings list is swapped out, matching Phase 1's re-register semantics.
    """
    with _pool_or_raise().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                insert into profiles
                    (id, name, links, display_mode, embeddings, model_name,
                     detector_backend, distance_metric)
                values (%s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                    name = excluded.name,
                    links = excluded.links,
                    display_mode = excluded.display_mode,
                    embeddings = excluded.embeddings,
                    model_name = excluded.model_name,
                    detector_backend = excluded.detector_backend,
                    distance_metric = excluded.distance_metric,
                    updated_at = now()
                returning id, name, links, display_mode, embeddings, model_name,
                          detector_backend, distance_metric, created_at
                """,
                (
                    user_id,
                    name,
                    Jsonb(links),
                    display_mode,
                    Jsonb(embeddings),
                    model_name,
                    detector_backend,
                    distance_metric,
                ),
            )
            row = cur.fetchone()
    row["created_at"] = row["created_at"].isoformat()
    return row  # type: ignore[return-value]


def update_profile_details(
    user_id: str, name: str, links: list[LinkEntry], display_mode: str
) -> Optional[Profile]:
    """Edits name/links/display_mode without touching embeddings -- for PATCH
    /profile, where the face doesn't need re-enrolling."""
    with _pool_or_raise().connection() as conn:
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(
                """
                update profiles
                set name = %s, links = %s, display_mode = %s, updated_at = now()
                where id = %s
                returning id, name, links, display_mode, embeddings, model_name,
                          detector_backend, distance_metric, created_at
                """,
                (name, Jsonb(links), display_mode, user_id),
            )
            row = cur.fetchone()
    if row is None:
        return None
    row["created_at"] = row["created_at"].isoformat()
    return row  # type: ignore[return-value]


def delete_profile(user_id: str) -> bool:
    with _pool_or_raise().connection() as conn:
        with conn.cursor() as cur:
            cur.execute("delete from profiles where id = %s", (user_id,))
            return cur.rowcount > 0
