from urllib.parse import urlparse

ALLOWED_SCHEMES = {"http", "https"}


class InvalidLinkError(ValueError):
    pass


def validate_link(link: str | None) -> str | None:
    """Raises InvalidLinkError for dangerous or malformed schemes.

    Returns the link unchanged (https is preferred but not enforced) or
    None if no link was given.
    """
    if link is None or link.strip() == "":
        return None

    link = link.strip()
    parsed = urlparse(link)

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise InvalidLinkError(
            f"Unsupported link scheme '{parsed.scheme or '(none)'}'. Only http/https allowed."
        )
    if not parsed.netloc:
        raise InvalidLinkError("Link is missing a host.")

    return link
