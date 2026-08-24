import { useEffect, useRef, useState, type RefObject } from 'react'
import { deleteProfile, getProfile, registerProfile, updateProfile } from '../lib/api'
import {
  captureSweep,
  SWEEP_STEPS,
  TOTAL_SWEEP_FRAMES,
  type SweepControl,
  type SweepProgress,
} from '../lib/captureFrame'
import type { HeadPose } from '../lib/headPose'
import { validateLink } from '../lib/linkValidation'
import type { Profile } from '../types'

interface ProfileModalProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** On-device head pose, used to verify each guided angle is actually struck.
   * Null when detection is unavailable -- the sweep then falls back to timed
   * capture. */
  getPose: (() => HeadPose | null) | null
  onClose: () => void
  onSaved: () => void
}

type Stage = 'details' | 'scanning' | 'saving'

const IDLE_PROGRESS: SweepProgress = {
  stepIndex: 0,
  captured: 0,
  holding: false,
  poseProgress: 0,
  faceVisible: false,
  stuck: false,
}

export function ProfileModal({ videoRef, getPose, onClose, onSaved }: ProfileModalProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stage, setStage] = useState<Stage>('details')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [instant, setInstant] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [sweep, setSweep] = useState<SweepProgress>(IDLE_PROGRESS)
  const [busy, setBusy] = useState(false)

  const controlRef = useRef<SweepControl>({ cancelled: false, skipRequested: false })

  useEffect(() => {
    getProfile()
      .then((p) => {
        setProfile(p)
        if (p) {
          setName(p.name)
          setLink(p.link ?? '')
          setInstant(p.instant)
        }
      })
      .catch(() => setProfile(null))
  }, [])

  useEffect(() => {
    const control = controlRef.current
    return () => {
      control.cancelled = true
    }
  }, [])

  async function handleStartScan() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setSubmitError('Enter a display name.')
      return
    }
    const err = link.trim() ? validateLink(link) : null
    if (err) {
      setLinkError(err)
      return
    }

    const video = videoRef.current
    if (!video) {
      setSubmitError('Camera is not ready.')
      return
    }

    setSubmitError(null)
    setSweep(IDLE_PROGRESS)
    setStage('scanning')
    controlRef.current = { cancelled: false, skipRequested: false }
    const control = controlRef.current

    const blobs = await captureSweep(video, getPose, setSweep, control)

    if (control.cancelled) return

    // Every angle skipped leaves nothing to enroll from.
    if (blobs.length === 0) {
      setSubmitError('No usable frames were captured. Try again in better light.')
      setStage('details')
      return
    }

    setStage('saving')
    try {
      const res = await registerProfile(blobs, trimmedName, link, instant)
      if (!res.ok) {
        setSubmitError(res.error ?? 'Registration failed.')
        setStage('details')
        return
      }
      onSaved()
      onClose()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Registration failed.')
      setStage('details')
    }
  }

  async function handleSaveDetails() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setSubmitError('Enter a display name.')
      return
    }
    const err = link.trim() ? validateLink(link) : null
    if (err) {
      setLinkError(err)
      return
    }

    setBusy(true)
    setSubmitError(null)
    try {
      await updateProfile(trimmedName, link, instant)
      onSaved()
      onClose()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save changes.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteProfile()
      onSaved()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // While scanning, the live camera behind this overlay must stay visible --
  // the user needs to see themselves to follow the pose instructions.
  if (stage === 'scanning' || stage === 'saving') {
    const pct = Math.round((sweep.captured / TOTAL_SWEEP_FRAMES) * 100)
    const step = SWEEP_STEPS[sweep.stepIndex]
    // The pose is verified, so progress only moves when the head really does.
    // Say why it is standing still, or it reads as the scan having frozen.
    const hint = !sweep.faceVisible
      ? 'Looking for your face…'
      : sweep.holding
        ? 'Hold it there…'
        : step.axis === 'center'
          ? 'Face the camera straight on'
          : 'Keep going — a bit further'

    return (
      <div className="absolute inset-0 z-20 flex flex-col justify-between bg-black/25">
        <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <span className="rounded-full bg-black/60 px-3 py-1 text-sm text-white">
            {stage === 'saving' ? 'Saving…' : `Scanning ${pct}%`}
          </span>
          <button
            onClick={() => {
              controlRef.current.cancelled = true
              setStage('details')
            }}
            className="rounded-full bg-black/60 px-3 py-1 text-sm text-white"
          >
            Cancel
          </button>
        </div>

        <div className="mb-24 px-6 text-center">
          <p className="mx-auto max-w-sm rounded-2xl bg-black/70 px-5 py-4 text-xl font-medium text-white">
            {stage === 'saving' ? 'Building your face profile…' : step.label}
          </p>

          {stage === 'scanning' && (
            <>
              <p className="mt-2 text-sm text-white/80 drop-shadow">{hint}</p>

              {/* How close the head currently is to the angle being asked for. */}
              <div className="mx-auto mt-3 h-1 w-40 overflow-hidden rounded-full bg-white/20">
                <div
                  className={`h-full rounded-full ${sweep.holding ? 'bg-white' : 'bg-amber-300'}`}
                  style={{ width: `${Math.round(sweep.poseProgress * 100)}%` }}
                />
              </div>
            </>
          )}

          <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* A face the detector can't read on some angle shouldn't be a dead
              end -- enrollment works with fewer poses, just less reliably. */}
          {stage === 'scanning' && sweep.stuck && (
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

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <h1 className="text-lg font-medium">{profile ? 'Edit profile' : 'Register your face'}</h1>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-2xl leading-none">
          &times;
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 pb-8">
        <div className="w-full max-w-xs space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-white placeholder:text-white/40"
          />
          <div>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value)
                setLinkError(null)
                // Instant mode has nothing to open without a link; the server
                // enforces this too, but leaving the toggle visibly on would
                // misrepresent what was saved.
                if (e.target.value.trim() === '') setInstant(false)
              }}
              placeholder="Link (optional) — https://…"
              className="w-full rounded-lg bg-neutral-800 px-4 py-3 text-white placeholder:text-white/40"
            />
            {linkError && <p className="mt-1 text-sm text-red-400">{linkError}</p>}
          </div>

          <button
            type="button"
            onClick={() => setInstant((v) => !v)}
            disabled={link.trim() === ''}
            className="flex w-full items-start gap-3 rounded-lg bg-neutral-800 px-4 py-3 text-left disabled:opacity-40"
          >
            <span
              className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                instant ? 'bg-emerald-500' : 'bg-neutral-600'
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white transition-transform ${
                  instant ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </span>
            <span>
              <span className="block text-white">Instant link</span>
              <span className="block text-sm text-white/50">
                {instant
                  ? 'Your link opens by itself a moment after your face is recognized.'
                  : 'Your name shows with a button to tap to open your link.'}
              </span>
            </span>
          </button>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          {/* An existing profile's embeddings stay valid when only the name,
              link, or link mode changes -- no need to re-capture the face. */}
          {profile && (
            <button
              onClick={handleSaveDetails}
              disabled={busy}
              className="w-full rounded-full bg-emerald-500 px-6 py-3 font-medium text-black disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          )}

          <button
            onClick={handleStartScan}
            disabled={busy}
            className={`w-full rounded-full px-6 py-3 font-medium disabled:opacity-50 ${
              profile
                ? 'border border-white/25 text-white'
                : 'bg-emerald-500 text-black'
            }`}
          >
            {profile ? 'Re-scan face' : 'Start face scan'}
          </button>

          <p className="text-center text-sm text-white/50">
            {profile
              ? 'Re-scanning replaces your saved face angles.'
              : `You'll be guided through ${SWEEP_STEPS.length} head positions so you can be recognized from any angle. Each one waits until you actually hold the pose.`}
          </p>
        </div>

        {profile && (
          <div className="text-center text-sm text-white/50">
            <p>
              Registered as <span className="text-white">{profile.name}</span> ·{' '}
              {profile.pose_count} angles
            </p>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="mt-3 text-red-400 underline disabled:opacity-50"
            >
              Delete registered profile
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
