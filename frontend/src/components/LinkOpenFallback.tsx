interface LinkOpenFallbackProps {
  link: string
  onOpened: () => void
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
        className="rounded-full bg-white px-6 py-3 font-medium text-black shadow-xl"
      >
        Open link
      </a>
    </div>
  )
}
