import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface SessionState {
  session: Session | null
  /** True until the initial session lookup resolves. Distinguishes "not
   * signed in" from "we don't know yet" -- without it the sign-in screen
   * flashes on every reload for an already-signed-in user. */
  loading: boolean
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  return { session, loading }
}

/** Google gives us a display name at sign-in, so onboarding can prefill it
 * instead of asking for something we already know. */
export function googleDisplayName(session: Session | null): string {
  const meta = session?.user.user_metadata
  return (meta?.full_name as string) ?? (meta?.name as string) ?? ''
}
