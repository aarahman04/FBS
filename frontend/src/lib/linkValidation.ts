const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** UX-only mirror of the backend's scheme allowlist -- the backend is the
 * real enforcement point. Returns an error message, or null if valid. */
export function validateLink(link: string): string | null {
  const trimmed = link.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return 'Enter a full URL, e.g. https://example.com'
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return 'Only http:// and https:// links are allowed.'
  }

  return null
}

export function prefersHttps(link: string): boolean {
  try {
    return new URL(link).protocol === 'https:'
  } catch {
    return true
  }
}
