export type RecognizeStatus =
  | 'not_registered'
  | 'no_face_detected'
  | 'no_match'
  /** Two or more registered faces are too alike to choose between. Naming
   * either one would be a guess, so the app says so instead. */
  | 'ambiguous'
  | 'match'

export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface RecognizeResponse {
  status: RecognizeStatus
  name?: string | null
  link?: string | null
  instant?: boolean
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
  link: string | null
  instant: boolean
  created_at: string
  pose_count: number
}

export interface ApiError {
  detail: string
}
