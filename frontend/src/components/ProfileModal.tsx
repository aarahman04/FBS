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

  const initial = (profile?.name ?? session.user.email ?? '?').trim().charAt(0).toUpperCase()

  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-black/95 text-white">
      {/* Sticky so the way out stays reachable once the content scrolls. */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-black/80 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+1rem)] backdrop-blur-xl">
        <h1 className="text-[17px] font-semibold tracking-tight">Your profile</h1>
        <button
          onClick={onClose}
          aria-label="Close"
          className="glass glass-interactive flex h-9 w-9 items-center justify-center rounded-full text-lg leading-none text-white/80"
        >
          &times;
        </button>
      </div>

      <div className="mx-auto w-full max-w-sm px-5 pb-10">
        {/* Identity up top: who this profile belongs to, before any controls
            that change it. */}
        <div className="flex items-center gap-3.5 py-5">
          <div className="glass flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-medium leading-tight">
              {profile?.name ?? (name || 'Unnamed')}
            </p>
            <p className="truncate text-[13px] text-white/45">
              {profile ? `${profile.pose_count} face angles saved` : 'Not registered yet'}
            </p>
          </div>
        </div>

        {/* Each group gets a label and its own card, so the name field and
            the link settings stop reading as one undifferentiated stack. */}
        <section className="mt-1">
          <h2 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">
            Display name
          </h2>
          <div className="rounded-3xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.07]">
            <ProfileFields.Name
              value={name}
              onChange={(v) => {
                setName(v)
                setSubmitError(null)
              }}
            />
          </div>
        </section>

        <section className="mt-6">
          <h2 className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35">
            Your link
          </h2>
          <div className="space-y-3 rounded-3xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.07]">
            <ProfileFields.Link
              value={link}
              onChange={(v) => {
                setLink(v)
                setLinkError(null)
              }}
              onClearInstant={() => setInstant(false)}
              error={linkError}
            />
            <ProfileFields.InstantToggle
              value={instant}
              onChange={setInstant}
              disabled={link.trim() === ''}
            />
          </div>
        </section>

        {submitError && <p className="mt-4 px-1 text-sm text-red-400">{submitError}</p>}

        <div className="mt-6 space-y-2.5">
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
          <p className="px-1 pt-0.5 text-center text-[13px] leading-relaxed text-white/35">
            Re-scanning replaces your saved face angles.
          </p>
        </div>

        {/* Account-level actions, set apart from the editing controls so
            neither is hit by accident. */}
        <div className="mt-9 border-t border-white/10 pt-5">
          <button
            onClick={() => supabase.auth.signOut()}
            disabled={busy}
            className="flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block text-[15px]">Sign out</span>
              {session.user.email && (
                <span className="block truncate text-[13px] text-white/40">
                  {session.user.email}
                </span>
              )}
            </span>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 shrink-0 text-white/30">
              <path
                d="m9 6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {profile && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="mt-1 w-full rounded-2xl px-3 py-3 text-left text-[15px] text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-50"
            >
              Delete registered profile
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
