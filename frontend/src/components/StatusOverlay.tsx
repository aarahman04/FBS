import type { RecognizeStatus } from '../types'

interface StatusOverlayProps {
  status: RecognizeStatus | 'idle' | 'camera_error'
  errorMessage?: string | null
}

const COPY: Record<string, { text: string; tone: string }> = {
  idle: { text: 'Starting camera…', tone: 'bg-black/50 text-white' },
  not_registered: {
    text: 'No profile registered yet — tap the icon top-left to register your face.',
    tone: 'bg-black/50 text-white',
  },
  no_face_detected: {
    text: 'No face detected — center a face in frame.',
    tone: 'bg-black/50 text-white',
  },
  no_match: { text: 'No match found.', tone: 'bg-black/50 text-white' },
  camera_error: { text: 'Camera error.', tone: 'bg-red-500/80 text-white' },
}

/** Status messages only. A recognized name is drawn by FaceLabel, anchored to
 * the face itself rather than pinned to the bottom of the screen. */
export function StatusOverlay({ status, errorMessage }: StatusOverlayProps) {
  const copy = COPY[status]
  if (!copy) return null

  const text = status === 'camera_error' && errorMessage ? errorMessage : copy.text

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center px-4">
      <div className={`rounded-full px-4 py-2 text-center text-sm ${copy.tone}`}>{text}</div>
    </div>
  )
}
