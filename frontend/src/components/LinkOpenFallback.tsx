interface LinkOpenFallbackProps {
  link: string
  onOpened: () => void
}

/** Strips the scheme and any trailing slash so the button can show where it
 * actually goes -- "instagram.com/you" is far more reassuring to tap than a
 * generic "Open link". Falls back to the raw string if it won't parse. */
function prettyHost(link: string): string {
  try {
    const url = new URL(link)
    return (url.host + url.pathname).replace(/\/$/, '').replace(/^www\./, '')
  } catch {
    return link
  }
}

/** Shown when window.open() was blocked by the browser's popup blocker
 * (only a synchronous, user-gesture-triggered call reliably succeeds).
 * Tapping this button IS the user gesture, so it always works. */
export function LinkOpenFallback({ link, onOpened }: LinkOpenFallbackProps) {
  return (
    <div className="absolute inset-x-0 bottom-8 z-30 flex justify-center px-4">
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onOpened}
        className="glass glass-interactive flex max-w-[85vw] items-center gap-3 rounded-full py-3.5 pl-5 pr-4 text-white"
      >
        <span className="min-w-0 truncate text-[15px] font-medium tracking-tight">
          {prettyHost(link)}
        </span>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/30">
          <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
            <path
              d="M7 17 17 7M17 7H9M17 7v8"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </a>
    </div>
  )
}
