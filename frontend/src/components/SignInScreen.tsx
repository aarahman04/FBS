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
    <div className="flex h-dvh w-dvw flex-col items-center justify-center gap-8 bg-black px-6 text-white">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">FBS</h1>
        <p className="mt-3 max-w-xs text-balance text-white/60">
          Turn your face into a link. Sign in to register yours.
        </p>
      </div>

      <button
        onClick={signIn}
        disabled={busy}
        className="flex w-full max-w-xs items-center justify-center gap-3 rounded-full bg-white px-6 py-3.5 font-medium text-black shadow-lg transition-opacity disabled:opacity-50"
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

      {error && <p className="max-w-xs text-center text-sm text-red-400">{error}</p>}
    </div>
  )
}
