import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  captureSweep,
  SWEEP_STEPS,
  TOTAL_SWEEP_FRAMES,
  type SweepControl,
  type SweepProgress,
} from '../lib/captureFrame'
import type { HeadPose } from '../lib/headPose'

const IDLE_PROGRESS: SweepProgress = {
  stepIndex: 0,
  captured: 0,
  holding: false,
  poseProgress: 0,
  faceVisible: false,
  stuck: false,
}

interface FaceScanOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** On-device head pose, used to verify each guided angle is actually
   * struck. Null when detection is unavailable -- the sweep then falls back
   * to timed capture. */
  getPose: (() => HeadPose | null) | null
  /** Set by the parent while it uploads, so the overlay stays up rather than
   * flashing the camera between the last frame and the save completing. */
  saving: boolean
  onComplete: (blobs: Blob[]) => void
  onCancel: () => void
}

/** The guided capture sweep. Shared by first-run onboarding and re-scanning
 * from the profile screen -- both need the identical pose-gated flow, so it
 * lives here rather than being duplicated in each.
 *
 * Deliberately translucent: the user has to see themselves to follow the
 * pose instructions.
 */
export function FaceScanOverlay({
  videoRef,
  getPose,
  saving,
  onComplete,
  onCancel,
}: FaceScanOverlayProps) {
  const [sweep, setSweep] = useState<SweepProgress>(IDLE_PROGRESS)
  const controlRef = useRef<SweepControl>({ cancelled: false, skipRequested: false })

  useEffect(() => {
    const control = controlRef.current
    const video = videoRef.current
    if (!video) return

    captureSweep(video, getPose, setSweep, control).then((blobs) => {
      if (!control.cancelled) onComplete(blobs)
    })

    return () => {
      control.cancelled = true
    }
    // Runs once per mount: the sweep owns its own lifecycle and restarting it
    // because a callback identity changed would throw away captured frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = Math.round((sweep.captured / TOTAL_SWEEP_FRAMES) * 100)
  const step = SWEEP_STEPS[sweep.stepIndex]

  // The pose is verified, so progress only moves when the head really does.
  // Say why it's standing still, or it reads as the scan having frozen.
  const hint = !sweep.faceVisible
    ? 'Looking for your face…'
    : sweep.holding
      ? 'Hold it there…'
      : step.axis === 'center'
        ? 'Face the camera straight on'
        : 'Keep going — a bit further'

  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-between bg-black/25">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">
          {saving ? 'Saving…' : `Scanning ${pct}%`}
        </span>
        {!saving && (
          <button
            onClick={() => {
              controlRef.current.cancelled = true
              onCancel()
            }}
            className="rounded-full bg-black/60 px-3 py-1 text-sm text-white"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="mb-24 px-6 text-center">
        <p className="mx-auto max-w-sm rounded-2xl bg-black/70 px-5 py-4 text-xl font-medium text-white">
          {saving ? 'Building your face profile…' : step.label}
        </p>

        {!saving && (
          <>
            <p className="mt-2 text-sm text-white/80 drop-shadow">
              {getPose ? hint : 'Follow each prompt — timing only, movement is not checked'}
            </p>

            {/* How close the head currently is to the angle being asked for.
                Meaningless without pose detection, so it's hidden then rather
                than sitting at zero and looking broken. */}
            {getPose && (
              <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-white/20">
                <div
                  className={`h-full rounded-full ${sweep.holding ? 'bg-white' : 'bg-amber-300'}`}
                  style={{ width: `${Math.round(sweep.poseProgress * 100)}%` }}
                />
              </div>
            )}
          </>
        )}

        <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* A face the detector can't read at some angle shouldn't be a dead
            end -- enrollment works with fewer poses, just less reliably. */}
        {!saving && sweep.stuck && (
          <button
            onClick={() => {
              controlRef.current.skipRequested = true
            }}
            className="mt-4 rounded-full border border-white/40 bg-black/60 px-4 py-2 text-sm text-white"
          >
            Skip this angle
          </button>
        )}
      </div>
    </div>
  )
}
