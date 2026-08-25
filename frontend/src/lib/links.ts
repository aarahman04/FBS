import { validateLink } from './linkValidation'
import type { LinkEntry, LinkKind } from '../types'

/** Fixed display order (matches the backend's CANONICAL_ORDER). Not
 * user-draggable -- the bar always reads in this order. */
export const PLATFORM_ORDER: LinkKind[] = [
  'instagram',
  'facebook',
  'linkedin',
  'github',
  'x',
  'youtube',
  'custom',
]

export const PLATFORM_LABEL: Record<LinkKind, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  x: 'X',
  youtube: 'YouTube',
  custom: 'Link',
}

const HOSTS: [string, LinkKind][] = [
  ['instagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['fb.com', 'facebook'],
  ['linkedin.com', 'linkedin'],
  ['github.com', 'github'],
  ['x.com', 'x'],
  ['twitter.com', 'x'],
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
]

/** Mirror of the backend's infer_kind -- lets the editor show the right icon
 * live as you type, before the round trip. The server re-infers on save, so
 * this only needs to be right for the UI. */
export function inferKind(url: string): LinkKind {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'custom'
  }
  if (host.startsWith('www.')) host = host.slice(4)
  for (const [suffix, kind] of HOSTS) {
    if (host === suffix || host.endsWith('.' + suffix)) return kind
  }
  return 'custom'
}

/** First invalid link among the editor rows (blanks skipped), or null if they
 * all pass. Client-side scheme check only -- the backend re-validates. */
export function firstLinkError(links: string[]): string | null {
  for (const link of links) {
    if (!link.trim()) continue
    const err = validateLink(link)
    if (err) return err
  }
  return null
}

/** Editor rows (raw URL strings, blanks and all) into the tagged entries the
 * API takes. Blank rows are dropped; kind is inferred (the server re-infers,
 * so this only has to satisfy the request shape). */
export function toLinkEntries(urls: string[]): LinkEntry[] {
  return urls
    .map((u) => u.trim())
    .filter(Boolean)
    .map((url) => ({ kind: inferKind(url), url }))
}

/** "instagram.com/you" -- scheme and www stripped, for the link bar row and
 * the fallback button. Raw string if it won't parse. */
export function prettyHost(url: string): string {
  try {
    const u = new URL(url)
    return (u.host + u.pathname).replace(/\/$/, '').replace(/^www\./, '')
  } catch {
    return url
  }
}
