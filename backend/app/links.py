"""Link-list validation and platform detection for Phase 3.

Kept out of main.py: a profile now holds up to five links, each tagged with
the platform it points at (for a built-in icon) or 'custom' (favicon). The
list is normalized on every save so recognition can rely on a canonical
order -- which is also what makes "open the first link" deterministic.
"""

from typing import Optional, TypedDict
from urllib.parse import urlparse

from .link_validation import InvalidLinkError, validate_link


class LinkEntry(TypedDict):
    kind: str
    url: str
    label: Optional[str]


MAX_LINKS = 5

DISPLAY_MODES = {"link_only", "name_only", "name_then_open", "name_and_links"}
DEFAULT_DISPLAY_MODE = "name_and_links"
# Modes that auto-open a link are meaningless without one.
LINK_DEPENDENT_MODES = {"link_only", "name_then_open"}

# host suffix -> kind. Suffix match, so "m.youtube.com" and "www.instagram.com"
# both resolve. Anything unmatched is 'custom' and uses the site favicon.
PLATFORM_HOSTS: list[tuple[str, str]] = [
    ("instagram.com", "instagram"),
    ("facebook.com", "facebook"),
    ("fb.com", "facebook"),
    ("linkedin.com", "linkedin"),
    ("github.com", "github"),
    ("x.com", "x"),
    ("twitter.com", "x"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
]

# Fixed display order (idea.md §7 / user decision: not user-draggable). Customs
# all share the last slot and keep their input order via a stable sort.
CANONICAL_ORDER = ["instagram", "facebook", "linkedin", "github", "x", "youtube", "custom"]


def infer_kind(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    for suffix, kind in PLATFORM_HOSTS:
        if host == suffix or host.endswith("." + suffix):
            return kind
    return "custom"


def normalize_links(raw: object) -> list[LinkEntry]:
    """Validate, tag, de-duplicate, and canonically order a raw links array.

    - at most MAX_LINKS entries
    - each URL through validate_link() (the same http/https allowlist the
      single-link model used -- idea.md §10)
    - empty rows are dropped, not errors: the editor sends blank rows
    - the same *platform* can't appear twice; multiple customs are fine
    - result is sorted into CANONICAL_ORDER so the bar order and "first link"
      are deterministic regardless of input order
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidLinkError("Links must be a list.")
    if len(raw) > MAX_LINKS:
        raise InvalidLinkError(f"At most {MAX_LINKS} links allowed.")

    entries: list[tuple[int, LinkEntry]] = []
    seen_platforms: set[str] = set()
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise InvalidLinkError("Each link must be an object.")
        url = validate_link(item.get("url"))
        if url is None:
            continue
        kind = infer_kind(url)
        if kind != "custom":
            if kind in seen_platforms:
                raise InvalidLinkError(f"You've added more than one {kind} link.")
            seen_platforms.add(kind)
        # Labels are only meaningful for custom links; a platform link is
        # already named by its icon.
        label = item.get("label")
        label = str(label).strip() or None if label is not None else None
        if kind != "custom":
            label = None
        entries.append((index, {"kind": kind, "url": url, "label": label}))

    entries.sort(key=lambda pair: (CANONICAL_ORDER.index(pair[1]["kind"]), pair[0]))
    return [entry for _, entry in entries]


def resolve_display_mode(mode: str, links: list[LinkEntry]) -> str:
    """An auto-open mode with no link to open silently becomes name-only,
    rather than leaving a mode that can never do anything."""
    if mode not in DISPLAY_MODES:
        mode = DEFAULT_DISPLAY_MODE
    if not links and mode in LINK_DEPENDENT_MODES:
        return "name_only"
    return mode
