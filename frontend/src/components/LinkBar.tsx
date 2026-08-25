import { useEffect, useRef } from 'react'
import { placeLabel } from '../lib/facePosition'
import { PLATFORM_LABEL, prettyHost } from '../lib/links'
import { PlatformIcon } from './PlatformIcon'
import type { FaceBox, LinkEntry } from '../types'

interface LinkBarProps {
  links: LinkEntry[]
  /** Live box from on-device tracking; falls back to the server box. Shared
   * with FaceLabel so the bar and the name track the same face. */
  getBox: () => FaceBox | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

/** Same easing as FaceLabel, so the bar feels attached to the head rather
 * than chasing it. */
const POSITION_SMOOTHING = 0.45
/** Keep the bar this far inside the frame edges when it has to be clamped. */
const EDGE_PAD = 10

function rowLabel(link: LinkEntry): string {
  if (link.kind === 'custom') return link.label?.trim() || prettyHost(link.url)
  return PLATFORM_LABEL[link.kind]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** The link bar for `name_and_links` mode: one glass row per link, tap to
 * open. Mounted to the *side* of the face (not below it), so it stays on
 * screen even when the face fills the frame and the chin is at the bottom
 * edge -- which is exactly when a below-the-face bar would be cut off.
 *
 * Prefers the right of the face; flips to the left when the right doesn't fit;
 * and its vertical position is clamped so it never runs off the top or bottom.
 * Positioned every frame off the shared face box, reusing placeLabel's math
 * (which handles the object-cover crop). */
export function LinkBar({ links, getBox, videoRef, containerRef }: LinkBarProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const current = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let rafId: number
    let cancelled = false

    let rect = containerRef.current?.getBoundingClientRect() ?? null
    const observer = new ResizeObserver(() => {
      rect = containerRef.current?.getBoundingClientRect() ?? null
    })
    if (containerRef.current) observer.observe(containerRef.current)

    const tick = () => {
      if (cancelled) return
      rafId = requestAnimationFrame(tick)

      const node = nodeRef.current
      const video = videoRef.current
      if (!node || !rect) return

      const box = video && getBox()
      if (!box) {
        node.style.opacity = '0'
        return
      }

      const p = placeLabel(box, video, { width: rect.width, height: rect.height })
      if (!p) return

      // Own size: offsetWidth/Height are already laid out, so reading them
      // here is cheap (no forced reflow of the rest of the page).
      const barW = node.offsetWidth
      const barH = node.offsetHeight
      const gap = Math.max(14, p.faceWidth * 0.14)
      const faceRight = p.centerX + p.faceWidth / 2
      const faceLeft = p.centerX - p.faceWidth / 2

      // Right of the face if the bar fits there; otherwise left; otherwise
      // whichever side has more room, clamped inside the frame.
      let left: number
      if (faceRight + gap + barW <= rect.width - EDGE_PAD) {
        left = faceRight + gap
      } else if (faceLeft - gap - barW >= EDGE_PAD) {
        left = faceLeft - gap - barW
      } else if (rect.width - faceRight >= faceLeft) {
        left = rect.width - barW - EDGE_PAD
      } else {
        left = EDGE_PAD
      }
      left = clamp(left, EDGE_PAD, Math.max(EDGE_PAD, rect.width - barW - EDGE_PAD))

      // Vertically centred on the face, then clamped so it never leaves frame.
      const top = clamp(
        p.centerY - barH / 2,
        EDGE_PAD,
        Math.max(EDGE_PAD, rect.height - barH - EDGE_PAD),
      )

      if (!current.current) {
        current.current = { x: left, y: top }
      } else {
        const c = current.current
        c.x += (left - c.x) * POSITION_SMOOTHING
        c.y += (top - c.y) * POSITION_SMOOTHING
      }
      const c = current.current
      node.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`
      node.style.opacity = '1'
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [getBox, videoRef, containerRef])

  return (
    <div
      ref={nodeRef}
      className="absolute left-0 top-0 z-20 flex w-max max-w-[55vw] flex-col gap-2"
      style={{ opacity: 0, willChange: 'transform', transition: 'opacity 150ms linear' }}
    >
      {links.map((link) => (
        <a
          key={`${link.kind}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="glass glass-clear glass-interactive flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-white"
        >
          <PlatformIcon kind={link.kind} url={link.url} className="h-5 w-5 shrink-0" />
          <span className="min-w-0 truncate text-[14px] font-medium tracking-tight">
            {rowLabel(link)}
          </span>
        </a>
      ))}
    </div>
  )
}
