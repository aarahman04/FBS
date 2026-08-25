import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraView } from './components/CameraView'
import { FaceLabel } from './components/FaceLabel'
import { LinkBar } from './components/LinkBar'
import { OnboardingFlow } from './components/OnboardingFlow'
import { ProfileIcon } from './components/ProfileIcon'
import { ProfileModal } from './components/ProfileModal'
import { SignInScreen } from './components/SignInScreen'
import { StatusOverlay } from './components/StatusOverlay'
import { captureFrame } from './lib/captureFrame'
import { FaceTracker } from './lib/faceTracker'
import { getProfile, recognizeFrame } from './lib/api'
import { supabase } from './lib/supabase'
import { useSession } from './lib/useSession'
import type { DisplayMode, FaceBox, LinkEntry, RecognizeStatus } from './types'

// End-to-end an instant redirect costs: this poll gap + one /recognize round
// trip (~1-2s, DeepFace on CPU) + the countdown below. The two constants that
// follow used to add ~6s on top of the round trip, which felt broken rather
// than deliberate.
const POLL_DELAY_MS = 250
/** Beat before a link_only redirect fires. Short -- no name is shown in this
 * mode, so there's nothing to read first. */
const INSTANT_REDIRECT_MS = 900
/** Longer beat for name_then_open: the name is meant to be seen before the
 * page navigates away, so hold it noticeably longer than link_only. */
const NAME_THEN_OPEN_MS = 1800
/** Quiet period after the profile closes before instant links can fire again,
 * so the user gets a chance to act instead of being navigated away at once.
 * Only has to outlast the closing animation and the first poll. */
const REDIRECT_GRACE_MS = 1200

type DisplayStatus = RecognizeStatus | 'idle' | 'camera_error'

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { session, loading: authLoading } = useSession()
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  /** null while unknown -- distinguishes "still checking" from "definitely
   * has no profile", which is what decides whether onboarding takes over. */
  const [hasProfile, setHasProfile] = useState<boolean | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [flipNote, setFlipNote] = useState<string | null>(null)

  const [status, setStatus] = useState<DisplayStatus>('idle')
  const [matchName, setMatchName] = useState<string | null>(null)
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null)
  const [activeLinks, setActiveLinks] = useState<LinkEntry[]>([])
  const [activeMode, setActiveMode] = useState<DisplayMode | null>(null)
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

  // Whether the *signed-in visitor* has their own profile -- not whether
  // anyone at all is registered. Re-derived from the server rather than
  // tracked as a local boolean, so register/edit/delete/sign-out all
  // self-correct through the same path.
  const refreshHasProfile = useCallback(async () => {
    if (!session) {
      setHasProfile(null)
      return
    }
    try {
      const profile = await getProfile()
      setHasProfile(profile !== null)
      setProfileError(null)
    } catch (e) {
      // A failed lookup is NOT "this user has no profile" -- treating it as
      // one silently drops an already-registered user into onboarding and
      // makes a backend outage look like lost data.
      setProfileError(e instanceof Error ? e.message : 'Could not reach the server.')
    }
  }, [session])

  useEffect(() => {
    refreshHasProfile()
  }, [refreshHasProfile])

  // The camera only mounts once the user is signed in and the profile lookup
  // has resolved -- before that there is no <video> for the tracker to read.
  const cameraMounted = session !== null && hasProfile !== null

  useEffect(() => {
    if (!cameraMounted) return

    const tracker = new FaceTracker()
    trackerRef.current = tracker
    let disposed = false
    let rafId: number | undefined

    tracker.init().then((ok) => {
      if (disposed) {
        tracker.close()
        return
      }
      if (!ok) return

      // init() resolves on its own schedule, which can land before React has
      // attached the <video> ref. Starting against a null element silently
      // left pose detection off, and the enrollment sweep then fell back to
      // timed capture -- advancing through "turn your head" prompts whether
      // or not the head actually turned. Wait for the element instead.
      const startWhenVideoReady = () => {
        if (disposed) return
        const video = videoRef.current
        if (!video) {
          rafId = requestAnimationFrame(startWhenVideoReady)
          return
        }
        tracker.start(video)
        setPoseAvailable(true)
      }
      startWhenVideoReady()
    })

    return () => {
      disposed = true
      if (rafId !== undefined) cancelAnimationFrame(rafId)
      tracker.close()
      trackerRef.current = null
      setPoseAvailable(false)
    }
  }, [cameraMounted])

  // Only worth offering a flip control if there's a second camera to flip to.
  // Runs once the stream is open (via CameraView's onReady), because only then
  // does enumerateDevices() report real camera counts rather than a
  // permission-gated placeholder -- so a single-webcam laptop hides the button
  // instead of showing one that just says "only one camera".
  const refreshCameraCount = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devices) => {
        const cameras = devices.filter((d) => d.kind === 'videoinput').length
        setHasMultipleCameras(cameras > 1)
      })
      .catch(() => {})
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

  const needsOnboarding = session !== null && hasProfile === false

  // Single-in-flight recognition loop: capture -> POST -> render -> wait -> repeat.
  // Paused during onboarding: the camera is busy running the capture sweep,
  // and recognizing bystanders mid-setup would fight it for frames.
  useEffect(() => {
    if (showProfile || cameraError || needsOnboarding || !session) return

    let cancelled = false

    async function tick() {
      const video = videoRef.current
      if (!video || cancelled) return scheduleNext()

      // Don't capture or upload while the tab is backgrounded (app switched,
      // screen locked). The video is frozen anyway, and on mobile a frame POST
      // every ~1.5s in the background is a needless battery and data drain.
      if (document.hidden) return scheduleNext()

      const blob = await captureFrame(video)
      if (!blob || cancelled) return scheduleNext()

      try {
        const result = await recognizeFrame(blob)
        if (cancelled) return

        setStatus(result.status)
        serverBoxRef.current = result.face ?? null
        setFaceBox(result.face ?? null)

        if (result.status === 'match') {
          setMatchName(result.name ?? null)
          const mode = (result.display_mode ?? 'name_and_links') as DisplayMode
          const links = result.links ?? []
          setActiveMode(mode)
          setActiveLinks(links)

          const firstUrl = links[0]?.url ?? null
          // link_only and name_then_open both auto-open the first link via
          // same-tab navigation (never window.open, so never popup-blocked).
          // They differ only in whether a name shows first and how long we
          // wait. name_and_links / name_only never navigate on their own.
          if (firstUrl && (mode === 'link_only' || mode === 'name_then_open')) {
            const target = firstUrl
            const suppressed = Date.now() < suppressRedirectUntilRef.current
            if (!suppressed && !redirectFiredRef.current && !redirectTimerRef.current) {
              setRedirectingTo(target)
              const delay = mode === 'link_only' ? INSTANT_REDIRECT_MS : NAME_THEN_OPEN_MS
              redirectTimerRef.current = window.setTimeout(() => {
                redirectFiredRef.current = true
                window.location.href = target
              }, delay)
            }
          }
        } else {
          // Face left the frame before the countdown finished -- don't yank
          // the page out from under someone who is no longer being seen.
          setMatchName(null)
          setActiveLinks([])
          setActiveMode(null)
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
  }, [showProfile, cameraError, needsOnboarding, session])

  useEffect(() => () => cancelRedirect(), [])

  // Everything driven by the live camera hides while the profile is open --
  // otherwise the previous match's name shows through the transparent
  // scanning overlay, and the manual link button (z-30) floats above the
  // modal (z-20).
  // Every mode except link_only shows the name; link_only opens straight to
  // the link with no name at all.
  const showLabel =
    !showProfile &&
    !needsOnboarding &&
    status === 'match' &&
    matchName &&
    faceBox &&
    activeMode !== 'link_only'

  const showLinkBar =
    !showProfile &&
    !needsOnboarding &&
    status === 'match' &&
    activeMode === 'name_and_links' &&
    activeLinks.length > 0 &&
    faceBox

  if (authLoading) {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    )
  }

  // The camera stays unmounted until sign-in, so the browser doesn't ask for
  // camera permission before the user knows what the app is.
  if (!session) return <SignInScreen />

  // Say the server is unreachable rather than pretending the user has no
  // profile -- otherwise an outage looks like their registration vanished.
  if (profileError) {
    return (
      <div className="flex h-dvh w-dvw flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="max-w-xs text-white/70">Couldn't load your profile.</p>
        <p className="max-w-xs text-sm text-white/40">{profileError}</p>
        <button
          onClick={() => {
            setProfileError(null)
            refreshHasProfile()
          }}
          className="rounded-full bg-white px-6 py-3 font-medium text-black"
        >
          Try again
        </button>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-white/40 underline"
        >
          Sign out
        </button>
      </div>
    )
  }

  // Waiting on the profile lookup. Without this the onboarding screen would
  // flash for a moment on every load for an already-registered user.
  if (hasProfile === null) {
    return (
      <div className="flex h-dvh w-dvw items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative h-dvh w-dvw overflow-hidden bg-black">
      <CameraView
        ref={videoRef}
        facingMode={facingMode}
        onReady={refreshCameraCount}
        onError={setCameraError}
        onFacingModeUnavailable={() => {
          // Single-camera device: revert so the button doesn't sit in a
          // state the hardware can't honour.
          setFacingMode('user')
          setFlipNote('Only one camera on this device')
          window.setTimeout(() => setFlipNote(null), 2500)
        }}
      />

      {needsOnboarding && (
        <OnboardingFlow
          session={session}
          videoRef={videoRef}
          getPose={poseAvailable ? getPose : null}
          onDone={refreshHasProfile}
        />
      )}

      {!needsOnboarding && (
        <ProfileIcon onClick={() => setShowProfile(true)} registered={hasProfile} />
      )}

      {!needsOnboarding && hasMultipleCameras && (
        <button
          onClick={() => setFacingMode((m) => (m === 'user' ? 'environment' : 'user'))}
          aria-label="Flip camera"
          className="glass glass-interactive absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] z-10 flex h-11 w-11 items-center justify-center rounded-full text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M20 5h-3.17L15 3H9L7.17 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm-8 13a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" />
          </svg>
        </button>
      )}

      {showLabel && (
        <FaceLabel
          name={matchName}
          getBox={getBox}
          videoRef={videoRef}
          containerRef={containerRef}
        />
      )}

      {showLinkBar && (
        <LinkBar
          links={activeLinks}
          getBox={getBox}
          videoRef={videoRef}
          containerRef={containerRef}
        />
      )}

      {redirectingTo && !showProfile && !needsOnboarding && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex justify-center px-4">
          <span className="glass flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm tracking-tight text-white">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-white/30 border-t-white" />
            Opening link…
          </span>
        </div>
      )}

      {flipNote && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+4.5rem)] z-20 flex justify-center px-4">
          <span className="glass rounded-full px-4 py-2 text-sm text-white/90">{flipNote}</span>
        </div>
      )}

      {!cameraError && !showLabel && !showProfile && !needsOnboarding && (
        <StatusOverlay status={status} />
      )}
      {cameraError && <StatusOverlay status="camera_error" errorMessage={cameraError} />}

      {showProfile && (
        <ProfileModal
          session={session}
          videoRef={videoRef}
          getPose={poseAvailable ? getPose : null}
          onClose={() => setShowProfile(false)}
          onSaved={() => {
            refreshHasProfile()
            redirectFiredRef.current = false
          }}
        />
      )}
    </div>
  )
}

export default App
