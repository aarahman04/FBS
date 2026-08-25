import type { RecognizeStatus } from '../types'

interface StatusOverlayProps {
  status: RecognizeStatus | 'idle' | 'camera_error'
  errorMessage?: string | null
}

const GLASS = 'glass text-white/90'

const COPY: Record<string, { text: string; tone: string }> = {
  idle: { text: 'Starting camera…', tone: GLASS },
  not_registered: {
    text: 'No faces registered yet.',
    tone: GLASS,
  },
  no_face_detected: {
    text: 'Point the camera at a face',
    tone: GLASS,
  },
  no_match: { text: 'Not a registered face', tone: GLASS },
  camera_error: {
    text: 'Camera error.',
    tone: 'bg-red-500/85 text-white backdrop-blur-xl',
  },
}

/** Status messages only. A recognized name is drawn by FaceLabel, anchored to
 * the face itself rather than pinned to the bottom of the screen. */
export function StatusOverlay({ status, errorMessage }: StatusOverlayProps) {
  const copy = COPY[status]
  if (!copy) return null

  const text = status === 'camera_error' && errorMessage ? errorMessage : copy.text

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4">
      <div className={`rounded-full px-5 py-2.5 text-center text-sm tracking-tight ${copy.tone}`}>
        {text}
      </div>
    </div>
  )
}
