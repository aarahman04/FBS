import { supabase } from './supabase'
import type { ApiError, Profile, RecognizeResponse, RegisterResponse } from '../types'

// Defaults to the Vite dev proxy. Set VITE_API_BASE to the backend's public
// URL when the frontend is hosted apart from it (see DEPLOYMENT.md) -- the
// recognition backend cannot run on Vercel itself.
const BASE = import.meta.env.VITE_API_BASE ?? '/api'

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null
    throw new Error(body?.detail ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

/** register/profile all act on the signed-in user's own row -- every call
 * needs the current Supabase session's access token. There's no meaningful
 * fallback if it's missing: the caller shouldn't be reachable while signed
 * out, so a missing token surfaces as the backend's 401 rather than being
 * silently swallowed here. */
async function authHeaders(): Promise<HeadersInit> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session ? { Authorization: `Bearer ${session.access_token}` } : {}
}

export async function registerProfile(
  images: Blob[],
  name: string,
  link: string,
  instant: boolean,
): Promise<RegisterResponse> {
  const form = new FormData()
  images.forEach((image, i) => form.append('images', image, `pose-${i}.jpg`))
  form.append('name', name)
  form.append('instant', String(instant))
  if (link.trim() !== '') form.append('link', link.trim())

  const res = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  })
  return parseJsonOrThrow<RegisterResponse>(res)
}

export async function recognizeFrame(image: Blob): Promise<RecognizeResponse> {
  const form = new FormData()
  form.append('image', image, 'capture.jpg')

  const res = await fetch(`${BASE}/recognize`, { method: 'POST', body: form })
  return parseJsonOrThrow<RecognizeResponse>(res)
}

/** Updates name/link/instant without re-running the face capture sweep. */
export async function updateProfile(
  name: string,
  link: string,
  instant: boolean,
): Promise<Profile> {
  const form = new FormData()
  form.append('name', name)
  form.append('instant', String(instant))
  if (link.trim() !== '') form.append('link', link.trim())

  const res = await fetch(`${BASE}/profile`, {
    method: 'PATCH',
    headers: await authHeaders(),
    body: form,
  })
  return parseJsonOrThrow<Profile>(res)
}

export async function getProfile(): Promise<Profile | null> {
  const res = await fetch(`${BASE}/profile`, { headers: await authHeaders() })
  return parseJsonOrThrow<Profile | null>(res)
}

export async function deleteProfile(): Promise<void> {
  const res = await fetch(`${BASE}/profile`, {
    method: 'DELETE',
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
}
