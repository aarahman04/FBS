import { forwardRef, useEffect, useState } from 'react'

interface CameraViewProps {
  facingMode: 'user' | 'environment'
  onError?: (message: string) => void
  /** The requested camera doesn't exist on this device. Distinct from
   * onError: the previous camera is still fine, so the caller should revert
   * rather than tear the whole view down. */
  onFacingModeUnavailable?: (mode: 'user' | 'environment') => void
}

/** Raw getUserMedia messages ("Permission denied") don't tell someone what to
 * actually do about it. */
function describeCameraError(err: Error): string {
  switch (err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow camera access in your browser settings, then reload.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera found on this device.'
    case 'NotReadableError':
      return 'The camera is already in use by another app. Close it and reload.'
    default:
      return err.message || 'Could not access camera.'
  }
}

/** Owns the getUserMedia stream and renders it into a <video> element.
 * The capture loop reads frames off the forwarded video ref. */
export const CameraView = forwardRef<HTMLVideoElement, CameraViewProps>(
  ({ facingMode, onError, onFacingModeUnavailable }, videoRef) => {
    const [stream, setStream] = useState<MediaStream | null>(null)

    useEffect(() => {
      let cancelled = false
      let activeStream: MediaStream | null = null

      // On an insecure origin (plain http on a LAN IP, say) mediaDevices is
      // undefined entirely, so calling getUserMedia throws synchronously and
      // never reaches .catch() -- which would blank the screen with no
      // explanation. Check before touching it.
      if (!navigator.mediaDevices?.getUserMedia) {
        onError?.(
          window.isSecureContext
            ? 'This browser does not support camera access.'
            : 'Camera needs a secure connection. Open this page over HTTPS or on localhost.',
        )
        return
      }

      async function open() {
        // A bare `facingMode: 'environment'` is only a *hint* -- phone
        // browsers are free to ignore it and hand back the selfie camera,
        // which is why flipping appeared to do nothing. `exact` pins the
        // physical camera and fails loudly instead, so fall back to the hint
        // only when the device genuinely has no such camera (a laptop with
        // one webcam).
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { exact: facingMode } },
            audio: false,
          })
        } catch (err) {
          const name = (err as Error).name
          if (name !== 'OverconstrainedError' && name !== 'NotFoundError') throw err
          onFacingModeUnavailable?.(facingMode)
          return await navigator.mediaDevices.getUserMedia({
            video: { facingMode },
            audio: false,
          })
        }
      }

      open()
        .then((s) => {
          if (cancelled) {
            s.getTracks().forEach((t) => t.stop())
            return
          }
          activeStream = s
          setStream(s)
        })
        .catch((err: Error) => {
          onError?.(describeCameraError(err))
        })

      return () => {
        cancelled = true
        activeStream?.getTracks().forEach((t) => t.stop())
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [facingMode])

    useEffect(() => {
      const video = typeof videoRef === 'function' ? null : videoRef?.current
      if (video && stream) {
        video.srcObject = stream
      }
    }, [stream, videoRef])

    return (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
      />
    )
  },
)

CameraView.displayName = 'CameraView'
