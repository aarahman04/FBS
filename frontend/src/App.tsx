import { useEffect, useRef, useState } from 'react'
import { CameraView } from './components/CameraView'
import { FaceLabel } from './components/FaceLabel'
import { LinkOpenFallback } from './components/LinkOpenFallback'
import { ProfileIcon } from './components/ProfileIcon'
import { ProfileModal } from './components/ProfileModal'
import { StatusOverlay } from './components/StatusOverlay'
import { captureFrame } from './lib/captureFrame'
import { FaceTracker } from './lib/faceTracker'
import { recognizeFrame } from './lib/api'
import type { FaceBox, RecognizeStatus } from './types'

const POLL_DELAY_MS = 400
/** Beat between the name appearing and the redirect, so the person is
 * actually seen before the page navigates away. */
const INSTANT_REDIRECT_MS = 2000
/** Quiet period after the profile closes before instant links can fire again,
 * so the user gets a chance to act instead of being navigated away at once. */
const REDIRECT_GRACE_MS = 4000

type DisplayStatus = RecognizeStatus | 'idle' | 'camera_error'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [hasProfile, setHasProfile] = useState(false)

  const [status, setStatus] = useState<DisplayStatus>('idle')
  const [matchName, setMatchName] = useState<string | null>(null)
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const [redirectingTo, setRedirectingTo] = useState<string | null>(null)

  const redirectTimerRef = useRef<number | undefined>(undefined)
  const redirectFiredRef = useRef(false)
  /** Instant redirects stay disarmed until this time. Set when the profile
   * closes, so returning to the camera doesn't immediately navigate away
   * before the user can do anything else. */
  const suppressRedirectUntilRef = useRef(0)

  const trackerRef = useRef<FaceTracker | null>(null)
  const serverBoxRef = useRef<FaceBox | null>(null)
  const [poseAvailable, setPoseAvailable] = useState(false)

  /** Head pose for enrollment gating. Passed as null while MediaPipe is
   * unavailable, so the sweep falls back instead of waiting on a pose that can
   * never arrive. */
  const getPose = useRef(() => trackerRef.current?.pose ?? null).current

  // Position comes from on-device tracking (runs every frame). The server box
  // is only a fallback for when MediaPipe can't load -- it arrives ~1x/sec,
  // which visibly lags a moving head.
  const getBox = useRef(() => {
    const tracked = trackerRef.current
    if (tracked?.available && tracked.box) return tracked.box
    if (tracked?.available) return null
    return serverBoxRef.current
  }).current

  useEffect(() => {
    const tracker = new FaceTracker()
    trackerRef.current = tracker
    let disposed = false

    tracker.init().then((ok) => {
      if (disposed) {
        tracker.close()
        return
      }
      const video = videoRef.current
      if (ok && video) {
        tracker.start(video)
        setPoseAvailable(true)
      }
    })

    return () => {
      disposed = true
      tracker.close()
      trackerRef.current = null
    }
  }, [])

  function cancelRedirect() {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current)
      redirectTimerRef.current = undefined
    }
    setRedirectingTo(null)
  }

  // Opening the profile must disarm a redirect that is already counting down.
  // Pausing the recognition loop alone is not enough -- the timer was armed
  // before the modal opened and would still navigate out from under it.
  useEffect(() => {
    if (showProfile) {
      cancelRedirect()
    } else {
      suppressRedirectUntilRef.current = Date.now() + REDIRECT_GRACE_MS
    }
  }, [showProfile])

  // Single-in-flight recognition loop: capture -> POST -> render -> wait -> repeat.
  useEffect(() => {
    if (showProfile || cameraError) return

    let cancelled = false

    async function tick() {
      const video = videoRef.current
      if (!video || cancelled) return scheduleNext()

      const blob = await captureFrame(video)
      if (!blob || cancelled) return scheduleNext()

      try {
        const result = await recognizeFrame(blob)
        if (cancelled) return

        setStatus(result.status)
        setHasProfile(result.status !== 'not_registered')
        serverBoxRef.current = result.face ?? null
        setFaceBox(result.face ?? null)

        if (result.status === 'match') {
          setMatchName(result.name ?? null)

          if (result.link && result.instant) {
            // Instant mode: same-tab navigation. Unlike window.open this is
            // never blocked, so no manual fallback is needed -- and the
            // manual control stays hidden, since the two modes are exclusive.
            setManualLink(null)
            const suppressed = Date.now() < suppressRedirectUntilRef.current
            if (!suppressed && !redirectFiredRef.current && !redirectTimerRef.current) {
              setRedirectingTo(result.link)
              const target = result.link
              redirectTimerRef.current = window.setTimeout(() => {
                redirectFiredRef.current = true
                window.location.href = target
              }, INSTANT_REDIRECT_MS)
            }
          } else if (result.link) {
            setManualLink(result.link)
          } else {
            setManualLink(null)
          }
        } else {
          // Face left the frame before the countdown finished -- don't yank
          // the page out from under someone who is no longer being seen.
          setMatchName(null)
          setManualLink(null)
          cancelRedirect()
        }
      } catch {
        // Transient network/backend error -- keep looping.
      }

      scheduleNext()
    }

    function scheduleNext() {
      if (!cancelled) window.setTimeout(tick, POLL_DELAY_MS)
    }

    tick()
    return () => {
      cancelled = true
    }
  }, [showProfile, cameraError])

  useEffect(() => () => cancelRedirect(), [])

  // Everything driven by the live camera hides while the profile is open --
  // otherwise the previous match's name shows through the transparent
  // scanning overlay, and the manual link button (z-30) floats above the
  // modal (z-20).
  const showLabel = !showProfile && status === 'match' && matchName && faceBox

  return (
    <div ref={containerRef} className="relative h-dvh w-dvw overflow-hidden bg-black">
      <CameraView ref={videoRef} facingMode={facingMode} onError={setCameraError} />

      <ProfileIcon onClick={() => setShowProfile(true)} registered={hasProfile} />

      <button
        onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
        aria-label="Flip camera"
        className="absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 border-white/70 bg-black/40 text-white shadow-lg backdrop-blur"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <path d="M20 5h-3.17L15 3H9L7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-8 13a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" />
        </svg>
      </button>

      {showLabel && (
        <FaceLabel
          name={matchName}
          getBox={getBox}
          videoRef={videoRef}
          containerRef={containerRef}
        />
      )}

      {redirectingTo && !showProfile && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-4">
          <span className="rounded-full bg-black/70 px-4 py-2 text-sm text-white">
            Opening link…
          </span>
        </div>
      )}

      {/* Only ever one of the two link modes is live at a time. */}
      {manualLink && !redirectingTo && !showProfile && (
        <LinkOpenFallback link={manualLink} onOpened={() => setManualLink(null)} />
      )}

      {!cameraError && !showLabel && !showProfile && <StatusOverlay status={status} />}
      {cameraError && <StatusOverlay status="camera_error" errorMessage={cameraError} />}

      {showProfile && (
        <ProfileModal
          videoRef={videoRef}
          getPose={poseAvailable ? getPose : null}
          onClose={() => setShowProfile(false)}
          onSaved={() => {
            setHasProfile(true)
            redirectFiredRef.current = false
          }}
        />
      )}
    </div>
  )
}

export default App
