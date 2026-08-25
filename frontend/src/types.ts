export type RecognizeStatus =
  | 'not_registered'
  | 'no_face_detected'
  | 'no_match'
  /** Two or more registered faces are too alike to choose between. Naming
   * either one would be a guess, so the app says so instead. */
  | 'ambiguous'
  | 'match'

export type LinkKind =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'github'
  | 'x'
  | 'youtube'
  | 'custom'

export interface LinkEntry {
  kind: LinkKind
  url: string
  label?: string | null
}

/** idea.md §7's four recognition modes.
 * - link_only: auto-open the first link, no name shown
 * - name_only: show the name, open nothing
 * - name_then_open: show the name, then auto-open the first link after a beat
 * - name_and_links: show the name with the tappable link bar */
export type DisplayMode = 'link_only' | 'name_only' | 'name_then_open' | 'name_and_links'

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface RecognizeResponse {
  status: RecognizeStatus
  name?: string | null
  links?: LinkEntry[]
  display_mode?: DisplayMode | null
  distance?: number | null
  face?: FaceBox | null
}

export interface RegisterResponse {
  ok: boolean
  poses_captured: number
  frames_rejected: number
  error?: string | null
}

export interface Profile {
  name: string
  links: LinkEntry[]
  display_mode: DisplayMode
  created_at: string
  pose_count: number
}

export interface ApiError {
  detail: string
}
