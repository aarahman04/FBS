import { useState, type RefObject } from 'react'
import type { Session } from '@supabase/supabase-js'
import { registerProfile } from '../lib/api'
import type { HeadPose } from '../lib/headPose'
import { validateLink } from '../lib/linkValidation'
import { supabase } from '../lib/supabase'
import { googleDisplayName } from '../lib/useSession'
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
  const [link, setLink] = useState('')
  const [instant, setInstant] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function startScan() {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a display name.')
      return
    }
    const err = link.trim() ? validateLink(link) : null
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
      const res = await registerProfile(blobs, name.trim(), link, instant)
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
    <div className="absolute inset-0 z-30 flex flex-col bg-black/95 text-white">
      <div className="px-6 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <h1 className="text-2xl font-semibold">Set up your face link</h1>
        <p className="mt-1 text-white/60">
          This is what people see when they point a camera at you.
        </p>
      </div>

      <div className="flex flex-1 flex-col justify-center px-6 pb-8">
        <div className="mx-auto w-full max-w-xs space-y-3">
          <ProfileFields
            name={name}
            onNameChange={(v) => {
              setName(v)
              setError(null)
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

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            onClick={startScan}
            className="w-full rounded-full bg-emerald-500 px-6 py-3 font-medium text-black"
          >
            Continue to face scan
          </button>

          <p className="text-center text-sm text-white/50">
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
