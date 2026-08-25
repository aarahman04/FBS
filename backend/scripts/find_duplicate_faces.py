"""Report profiles whose faces the recognizer can't tell apart.

Registration now refuses a face that already belongs to another account, but
that guard only applies going forward -- profiles enrolled before it existed
can still collide. Those are exactly the rows that make recognition flip
between names, so find them and decide which to keep.

Read-only: prints what it finds and changes nothing.

    cd backend
    .venv/Scripts/python -m scripts.find_duplicate_faces
"""

import os
import sys
from itertools import combinations

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

from app.db import all_profiles, close_pool, open_pool  # noqa: E402
from app.recognition import (  # noqa: E402
    AMBIGUITY_MARGIN,
    THRESHOLD,
    closest_enrolled_distance,
)


def main() -> int:
    open_pool()
    try:
        profiles = all_profiles()
    finally:
        close_pool()

    print(f"{len(profiles)} profile(s); match threshold {THRESHOLD}\n")
    if len(profiles) < 2:
        print("Nothing to compare.")
        return 0

    collisions = []
    for a, b in combinations(profiles, 2):
        distance = closest_enrolled_distance(a["embeddings"], b["embeddings"])
        if distance <= THRESHOLD:
            collisions.append((distance, a, b))

    if not collisions:
        print("No collisions: every profile is distinguishable.")
        return 0

    print(f"{len(collisions)} colliding pair(s) -- these read as the same face:\n")
    for distance, a, b in sorted(collisions, key=lambda row: row[0]):
        print(f"  distance {distance:.4f}  (threshold {THRESHOLD})")
        print(f"    {a['name']!r}  id={a['id']}  created {a['created_at'][:19]}")
        print(f"    {b['name']!r}  id={b['id']}  created {b['created_at'][:19]}")
        print()

    print(
        "Recognition now returns 'ambiguous' rather than naming one of these at\n"
        "random. To resolve: sign in as the accounts you don't want and delete\n"
        "their profiles from the profile screen, leaving one per face.\n"
        f"(Pairs closer than {AMBIGUITY_MARGIN} apart are the ones that flip.)"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
