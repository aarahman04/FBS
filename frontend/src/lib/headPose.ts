/** Head pose estimated from the 6 BlazeFace keypoints (both eyes, nose tip,
 * mouth, both ear tragions).
 *
 * Enrollment claims to capture a side profile, so it has to actually verify
 * the head turned -- a timer alone happily records five identical head-on
 * frames while the user sits still. A full landmark model would give real
 * Euler angles, but the detector we already run for label tracking exposes
 * enough points for a monotonic proxy, at no extra model download.
 */

export interface Keypoint {
  x: number
  y: number
}

export interface HeadPose {
  /** Nose offset between the ear tragions, roughly -1..1. 0 = facing camera.
   * Derived: yaw = (d/e)·tan(angle), so it grows monotonically with turn. */
  yaw: number
  /** Nose height between the eye line and the mouth, ~0.5 head-on. Person-
   * specific (nose length / face length), so only useful once a neutral
   * baseline has been subtracted. */
  pitch: number
}

/** Number of keypoints blaze_face_short_range emits. */
const REQUIRED_KEYPOINTS = 6

export function poseFromKeypoints(kps: Keypoint[]): HeadPose | null {
  if (kps.length < REQUIRED_KEYPOINTS) return null

  const [eyeA, eyeB, nose, mouth, earA, earB] = kps

  // Which tragion is which side doesn't matter -- the metric is symmetric
  // about the midpoint between them.
  const earLeft = Math.min(earA.x, earB.x)
  const earRight = Math.max(earA.x, earB.x)
  const earSpan = earRight - earLeft
  if (earSpan < 1e-4) return null

  // The eyes always sit inside the tragions horizontally, at any pose -- both
  // spans foreshorten together as the head turns. A pair that fails this isn't
  // the pair we think it is, so report no pose rather than gate on nonsense.
  if (Math.abs(eyeA.x - eyeB.x) >= earSpan) return null

  const eyeY = (eyeA.y + eyeB.y) / 2
  const eyeToMouth = mouth.y - eyeY
  if (Math.abs(eyeToMouth) < 1e-4) return null

  return {
    yaw: ((nose.x - earLeft) / earSpan - 0.5) * 2,
    pitch: (nose.y - eyeY) / eyeToMouth,
  }
}

export function medianPose(samples: HeadPose[]): HeadPose | null {
  if (samples.length === 0) return null
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  return {
    yaw: median(samples.map((s) => s.yaw)),
    pitch: median(samples.map((s) => s.pitch)),
  }
}
