import { useEffect, useState, type RefObject } from 'react'
import type { Session } from '@supabase/supabase-js'
import { deleteProfile, getProfile, registerProfile, updateProfile } from '../lib/api'
import type { HeadPose } from '../lib/headPose'
import { validateLink } from '../lib/linkValidation'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import { FaceScanOverlay } from './FaceScanOverlay'
import { ProfileFields } from './ProfileFields'

interface ProfileModalProps {
  session: Session
  videoRef: RefObject<HTMLVideoElement | null>
  /** On-device head pose for the re-scan sweep. Null when detection is
   * unavailable -- the sweep falls back to timed capture. */
  getPose: (() => HeadPose | null) | null
  onClose: () => void
  onSaved: () => void
}

type Stage = 'details' | 'scanning' | 'saving'

/** Editing an existing profile. First-run setup is OnboardingFlow's job --
 * by the time this opens the user is signed in and already registered. */
export function ProfileModal({ session, videoRef, getPose, onClose, onSaved }: ProfileModalProps) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stage, setStage] = useState<Stage>('details')
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [instant, setInstant] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  function validate(): string | null {
    if (!name.trim()) {
      setSubmitError('Enter a display name.')
      return null
    }
    const err = link.trim() ? validateLink(link) : null
    if (err) {
      setLinkError(err)
      return null
    }
    return name.trim()
  }

  function handleStartScan() {
    if (!validate()) return
    if (!videoRef.current) {
      setSubmitError('Camera is not ready.')
      return
    }
    setSubmitError(null)
    setStage('scanning')
  }

  async function handleScanComplete(blobs: Blob[]) {
    if (blobs.length === 0) {
      setSubmitError('No usable frames were captured. Try again in better light.')
      setStage('details')
      return
    }

    setStage('saving')
    try {
      const res = await registerProfile(blobs, name.trim(), link, instant)
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

  /** An existing profile's embeddings stay valid when only the name, link, or
   * link mode changes -- no need to re-capture the face. */
  async function handleSaveDetails() {
    const trimmedName = validate()
    if (!trimmedName) return

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

  if (stage === 'scanning' || stage === 'saving') {
    return (
      <FaceScanOverlay
        videoRef={videoRef}
        getPose={getPose}
        saving={stage === 'saving'}
        onComplete={handleScanComplete}
        onCancel={() => setStage('details')}
      />
    )
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <h1 className="text-lg font-medium">Your profile</h1>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-2xl leading-none">
          &times;
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 pb-8">
        <div className="w-full max-w-xs space-y-3">
          <ProfileFields
            name={name}
            onNameChange={(v) => {
              setName(v)
              setSubmitError(null)
            }}
            link={link}
            onLinkChange={(v) => {
              setLink(v)
              setLinkError(null)
            }}
            instant={instant}
            onInstantChange={setInstant}
            linkError={linkError}
          />

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}

          <button
            onClick={handleSaveDetails}
            disabled={busy}
            className="w-full rounded-full bg-white px-6 py-3.5 font-medium text-black transition-transform duration-200 active:scale-[0.97] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>

          <button
            onClick={handleStartScan}
            disabled={busy}
            className="glass glass-interactive w-full rounded-full px-6 py-3.5 font-medium text-white disabled:opacity-50"
          >
            Re-scan face
          </button>

          <p className="text-center text-[13px] leading-relaxed text-white/40">
            Re-scanning replaces your saved face angles.
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

        <button
          onClick={() => supabase.auth.signOut()}
          disabled={busy}
          className="text-center text-sm text-white/40 underline disabled:opacity-50"
        >
          Sign out{session.user.email ? ` (${session.user.email})` : ''}
        </button>
      </div>
    </div>
  )
}
