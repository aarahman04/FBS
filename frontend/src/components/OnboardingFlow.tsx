import { useState, type RefObject } from 'react'
import type { Session } from '@supabase/supabase-js'
import { registerProfile } from '../lib/api'
import type { HeadPose } from '../lib/headPose'
import { firstLinkError, toLinkEntries } from '../lib/links'
import { supabase } from '../lib/supabase'
import { googleDisplayName } from '../lib/useSession'
import type { DisplayMode } from '../types'
import { FaceScanOverlay } from './FaceScanOverlay'
import { ProfileFields } from './ProfileFields'

interface OnboardingFlowProps {
  session: Session
  videoRef: RefObject<HTMLVideoElement | null>
  getPose: (() => HeadPose | null) | null
  onDone: () => void
}

type Step = 'details' | 'scanning' | 'saving'

/** First run for a signed-in user with no profile yet: confirm the name
 * Google gave us, optionally add a link, then scan. Runs straight through to
 * a registered profile so the user reaches the camera already recognizable,
 * rather than having to discover a second setup step on their own.
 */
export function OnboardingFlow({ session, videoRef, getPose, onDone }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>('details')
  const [name, setName] = useState(() => googleDisplayName(session))
  const [links, setLinks] = useState<string[]>([''])
  const [displayMode, setDisplayMode] = useState<DisplayMode>('name_and_links')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startScan() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a display name.')
      return
    }
    const err = firstLinkError(links)
    if (err) {
      setLinkError(err)
      return
    }
    setError(null)
    setStep('scanning')
  }

  async function handleScanComplete(blobs: Blob[]) {
    if (blobs.length === 0) {
      setError('No usable frames were captured. Try again in better light.')
      setStep('details')
      return
    }

    setStep('saving')
    try {
      const res = await registerProfile(blobs, name.trim(), toLinkEntries(links), displayMode)
      if (!res.ok) {
        setError(res.error ?? 'Registration failed.')
        setStep('details')
        return
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Registration failed.')
      setStep('details')
    }
  }

  if (step === 'scanning' || step === 'saving') {
    return (
      <FaceScanOverlay
        videoRef={videoRef}
        getPose={getPose}
        saving={step === 'saving'}
        onComplete={handleScanComplete}
        onCancel={() => setStep('details')}
      />
    )
  }

  return (
    // Scrolls when the fields + mode picker are taller than the viewport --
    // otherwise the Continue button sits below the fold, behind the browser
    // chrome / taskbar, with no way to reach it (especially on mobile). The
    // min-h-full + flex-1 pair still centres the form when it does fit.
    <div className="absolute inset-0 z-30 overflow-y-auto bg-black/95 text-white">
      <div className="flex min-h-full flex-col px-6 pt-[calc(env(safe-area-inset-top)+2rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Set up your face link</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-white/55">
            This is what people see when they point a camera at you.
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-xs flex-1 flex-col justify-center gap-3 py-8">
          <ProfileFields
            name={name}
            onNameChange={(v) => {
              setName(v)
              setError(null)
            }}
            links={links}
            onLinksChange={(v) => {
              setLinks(v)
              setLinkError(null)
            }}
            linkError={linkError}
            displayMode={displayMode}
            onDisplayModeChange={setDisplayMode}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={startScan}
            className="w-full rounded-full bg-white px-6 py-3 text-[15px] font-medium text-black transition-transform duration-200 active:scale-[0.97]"
          >
            Continue to face scan
          </button>

          <p className="text-center text-[13px] leading-relaxed text-white/40">
            You'll be guided through 5 head positions so you can be recognized
            from any angle.
          </p>

          {/* Without this, deleting a profile drops the user back here with
              no way out but clearing site data. */}
          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full pt-2 text-center text-sm text-white/40 underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
