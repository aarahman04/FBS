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

function rowLabel(link: LinkEntry): string {
  if (link.kind === 'custom') return link.label?.trim() || prettyHost(link.url)
  return PLATFORM_LABEL[link.kind]
}

/** The vertical bar anchored under the face for `name_and_links` mode: one
 * glass row per link, tap to open. Positioned every frame off the shared face
 * box, reusing FaceLabel's placement math (placeLabel handles the object-cover
 * crop). */
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
      if (!node || !video || !rect) return

      const box = getBox()
      if (!box) {
        node.style.opacity = '0'
        return
      }

      const p = placeLabel(box, video, { width: rect.width, height: rect.height })
      if (!p) return

      // Sit below where FaceLabel's name would be, offset proportionally to
      // the face size so the gap holds as the face nears or recedes.
      const targetX = p.centerX
      const targetY = p.bottomY + Math.max(28, p.faceWidth * 0.42)

      if (!current.current) {
        current.current = { x: targetX, y: targetY }
      } else {
        const c = current.current
        c.x += (targetX - c.x) * POSITION_SMOOTHING
        c.y += (targetY - c.y) * POSITION_SMOOTHING
      }
      const c = current.current
      node.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) translateX(-50%)`
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
      className="absolute left-0 top-0 z-20 flex w-max max-w-[80vw] flex-col gap-2"
      style={{ opacity: 0, willChange: 'transform', transition: 'opacity 150ms linear' }}
    >
      {links.map((link) => (
        <a
          key={`${link.kind}-${link.url}`}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="glass glass-interactive flex items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-4 text-white"
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
