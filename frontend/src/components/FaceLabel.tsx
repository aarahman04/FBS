import { useEffect, useRef } from 'react'
import { placeLabel } from '../lib/facePosition'
import type { FaceBox } from '../types'

interface FaceLabelProps {
  name: string
  /** Live box from on-device tracking; falls back to the server box. */
  getBox: () => FaceBox | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
}

const MIN_FONT_PX = 26
const MAX_FONT_PX = 86
/** Name width relative to the face -- large enough to read at a glance
 * without swallowing the frame. */
const FONT_TO_FACE_RATIO = 0.34

/** Per-frame easing toward the tracked position. High enough to feel attached
 * to the head (settles in ~5 frames, <100ms) while still absorbing the
 * frame-to-frame jitter of the detector's box. */
const POSITION_SMOOTHING = 0.45

/** Size is eased far more slowly than position, and deliberately so. The
 * detector's box width wobbles a few percent every frame; at the position
 * rate that wobble reads as the name pulsing/zooming. Apparent face size only
 * changes when someone actually moves toward or away from the camera, which
 * is slow, so heavy damping costs nothing perceptually and kills the pulse. */
const FONT_SMOOTHING = 0.06

/** Ignore sub-pixel size changes entirely, so a face holding still produces a
 * completely static size rather than endless tiny corrections. */
const FONT_DEADBAND_PX = 1.5

export function FaceLabel({ name, getBox, videoRef, containerRef }: FaceLabelProps) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  // Smoothed state lives in a ref, not React state: this updates every frame,
  // and re-rendering at 60fps would make the label *less* smooth, not more.
  const current = useRef<{ x: number; y: number; font: number } | null>(null)

  useEffect(() => {
    let rafId: number
    let cancelled = false
    let lastFont = -1

    // Cached instead of read per frame: getBoundingClientRect() forces a
    // layout flush, and doing that 60x/second is pure waste when the box only
    // changes on resize.
    let rect = containerRef.current?.getBoundingClientRect() ?? null
    const observer = new ResizeObserver(() => {
      rect = containerRef.current?.getBoundingClientRect() ?? null
    })
    if (containerRef.current) observer.observe(containerRef.current)

    const tick = () => {
      if (cancelled) return
      rafId = requestAnimationFrame(tick)

      const node = nodeRef.current
      const text = textRef.current
      const video = videoRef.current
      if (!node || !text || !video || !rect) return

      const box = getBox()
      if (!box) {
        node.style.opacity = '0'
        return
      }

      const p = placeLabel(box, video, { width: rect.width, height: rect.height })
      if (!p) return

      const font = Math.min(
        MAX_FONT_PX,
        Math.max(MIN_FONT_PX, p.faceWidth * FONT_TO_FACE_RATIO),
      )
      const targetX = p.centerX
      // Sit just under the chin, offset proportionally to type size so the gap
      // holds as the face moves nearer or further away.
      const targetY = p.bottomY + font * 0.34

      if (!current.current) {
        current.current = { x: targetX, y: targetY, font }
      } else {
        const c = current.current
        c.x += (targetX - c.x) * POSITION_SMOOTHING
        c.y += (targetY - c.y) * POSITION_SMOOTHING
        if (Math.abs(font - c.font) > FONT_DEADBAND_PX) {
          c.font += (font - c.font) * FONT_SMOOTHING
        }
      }

      const c = current.current
      // translate3d keeps this on the compositor; no layout/reflow per frame.
      node.style.transform = `translate3d(${c.x}px, ${c.y}px, 0) translateX(-50%)`
      node.style.opacity = '1'

      // Only touch font styles when the size actually changed. Writing them
      // every frame re-lays-out the text node needlessly.
      const rounded = Math.round(c.font)
      if (rounded !== lastFont) {
        lastFont = rounded
        text.style.fontSize = `${rounded}px`
        text.style.webkitTextStroke = `${Math.max(2, rounded * 0.045)}px #000`
      }
    }

    rafId = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [getBox, videoRef, containerRef])

  // Reset smoothing when the identity changes, so a new name doesn't glide
  // in from wherever the previous one was.
  useEffect(() => {
    current.current = null
  }, [name])

  return (
    <div
      ref={nodeRef}
      className="pointer-events-none absolute left-0 top-0 z-10"
      style={{ opacity: 0, willChange: 'transform', transition: 'opacity 150ms linear' }}
    >
      <span
        ref={textRef}
        className="whitespace-nowrap font-semibold text-white"
        style={{
          fontFamily: "'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif",
          lineHeight: 1,
          letterSpacing: '-0.01em',
          // Stroke behind the fill; without paint-order the outline is drawn
          // over the glyph and eats into the letterforms.
          paintOrder: 'stroke fill',
          textShadow: '0 2px 12px rgba(0,0,0,0.45)',
        }}
      >
        {name}
      </span>
    </div>
  )
}
