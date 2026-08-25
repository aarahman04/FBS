import { useState, type ReactElement } from 'react'
import { faviconUrl } from '../lib/api'
import { prettyHost } from '../lib/links'
import type { LinkKind } from '../types'

/** Neutral link glyph -- the fallback when a custom host has no favicon, and
 * the icon for anything we don't have a brand mark for. */
function LinkGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.5-1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Brand marks, monochrome (currentColor) so they sit on the glass like the
// rest of the UI. Simplified silhouettes, not full logos.
const BRAND: Partial<Record<LinkKind, ReactElement>> = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="17.2" cy="6.8" r="1.3" fill="currentColor" />
    </>
  ),
  facebook: (
    <path
      fill="currentColor"
      d="M13.5 21v-7h2.3l.4-2.8h-2.7V9.4c0-.8.2-1.4 1.4-1.4h1.4V5.6c-.3 0-1.2-.1-2.2-.1-2.2 0-3.7 1.3-3.7 3.8v2H8v2.8h2.3V21h3.2Z"
    />
  ),
  linkedin: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        fill="currentColor"
        d="M8 10v7M8 7.2v.02M12 17v-4a2 2 0 0 1 4 0v4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </>
  ),
  github: (
    <path
      fill="currentColor"
      d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
    />
  ),
  x: (
    <path
      fill="currentColor"
      d="M17.5 3h3l-6.55 7.49L21.7 21h-6.03l-4.72-6.17L5.55 21H2.53l7-8.01L2.3 3h6.18l4.27 5.64L17.5 3Zm-1.06 16.2h1.67L7.64 4.71H5.85l10.59 14.49Z"
    />
  ),
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path fill="currentColor" d="M10 9.2v5.6l5-2.8-5-2.8Z" />
    </>
  ),
}

interface PlatformIconProps {
  kind: LinkKind
  /** The link URL -- used to derive the host for a custom link's favicon. */
  url: string
  className?: string
}

/** Icon for one link: a built-in brand mark for a known platform, the site's
 * own favicon (fetched through our backend) for a custom link, and the neutral
 * link glyph when a custom host has no icon. */
export function PlatformIcon({ kind, url, className = 'h-5 w-5' }: PlatformIconProps) {
  const [failed, setFailed] = useState(false)

  if (kind !== 'custom') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        {BRAND[kind] ?? <LinkGlyph />}
      </svg>
    )
  }

  const host = prettyHost(url).split('/')[0]
  if (failed || !host) return <LinkGlyph className={className} />

  return (
    <img
      src={faviconUrl(host)}
      alt=""
      onError={() => setFailed(true)}
      className={`${className} rounded-[4px] object-contain`}
    />
  )
}
