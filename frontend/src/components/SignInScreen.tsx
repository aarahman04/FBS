import { useState } from 'react'
import { supabase } from '../lib/supabase'

/** Shown before anything else -- the camera isn't even mounted yet, so the
 * browser doesn't prompt for camera permission before the user has any idea
 * what the app is. */
export function SignInScreen() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Must be an origin listed in Supabase's redirect allowlist, or the
      // provider bounces back to the dashboard's default (localhost).
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setBusy(false)
    }
    // On success the browser navigates to Google, so there's nothing to
    // reset -- the component goes away with the page.
  }

  return (
    <div className="relative flex h-dvh w-dvw flex-col items-center justify-center overflow-hidden bg-black px-6 text-white">
      {/* Something for the glass to refract. A flat black screen gives the
          material nothing to work with and reads as a broken page. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="aurora absolute -left-1/4 top-[-20%] h-[70vmax] w-[70vmax] rounded-full bg-[radial-gradient(circle,rgba(56,189,248,0.28),transparent_62%)] blur-3xl" />
        <div
          className="aurora absolute -right-1/4 bottom-[-25%] h-[65vmax] w-[65vmax] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.26),transparent_62%)] blur-3xl"
          style={{ animationDelay: '-9s' }}
        />
      </div>

      <div className="relative z-10 flex w-full max-w-xs flex-col items-center">
        <div className="glass mb-8 flex h-20 w-20 items-center justify-center rounded-[26px]">
          <svg viewBox="0 0 24 24" fill="none" className="h-9 w-9" aria-hidden="true">
            <path
              d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle cx="12" cy="10.5" r="2.6" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M8.2 16.4a4.2 4.2 0 0 1 7.6 0"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <h1 className="text-[2.75rem] font-semibold leading-none tracking-tight">FBS</h1>
        <p className="mt-4 text-balance text-center text-[15px] leading-relaxed text-white/55">
          Turn your face into a link. Sign in to register yours.
        </p>
      </div>

      <button
        onClick={signIn}
        disabled={busy}
        className="relative z-10 mt-10 flex w-full max-w-xs items-center justify-center gap-3 rounded-full bg-white px-6 py-3.5 font-medium text-black shadow-[0_10px_40px_-10px_rgba(255,255,255,0.45)] transition-transform duration-200 active:scale-[0.97] disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3.01h3.89c2.27-2.09 3.57-5.17 3.57-8.82Z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.89-3.01c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z"
          />
          <path
            fill="#FBBC05"
            d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.61H1.28a12 12 0 0 0 0 10.78l4.01-3.11Z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.86 8.88 4.75 12 4.75Z"
          />
        </svg>
        {busy ? 'Opening Google…' : 'Sign in with Google'}
      </button>

      {error && (
        <p className="relative z-10 mt-4 max-w-xs text-center text-sm text-red-400">{error}</p>
      )}

      <p className="relative z-10 mt-6 max-w-[16rem] text-balance text-center text-xs leading-relaxed text-white/30">
        Only people who register are ever recognized.
      </p>
    </div>
  )
}
