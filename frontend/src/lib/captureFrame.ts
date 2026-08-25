import type { HeadPose } from './headPose'
import { medianPose } from './headPose'

const MAX_DIMENSION = 640
const JPEG_QUALITY = 0.8

/** Draws the current video frame to an offscreen canvas, downscaled, and
 * returns it as a JPEG Blob -- keeps upload payloads small over a phone/
 * tunnel connection. */
export async function captureFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight) return null

  const scale = Math.min(1, MAX_DIMENSION / Math.max(videoWidth, videoHeight))
  const width = Math.round(videoWidth * scale)
  const height = Math.round(videoHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(video, 0, 0, width, height)

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', JPEG_QUALITY)
  })
}

export type PoseAxis = 'center' | 'yaw' | 'pitch'

export interface SweepStep {
  /** Instruction shown while this step is active. */
  label: string
  /** Which head movement has to be measured before frames are taken. */
  axis: PoseAxis
  /** 'first' claims whichever direction the user moves; 'opposite' then
   * demands the other one. The instructions still name a side, but nothing
   * breaks if the user turns the other way first -- both profiles get
   * captured either way, which is the point of the sweep. */
  order: 'first' | 'opposite'
  /** How many frames to grab once the pose is held. */
  frames: number
}

/** The guided enrollment sweep: a face enrolled only head-on can't be matched
 * from the side, so each angle the user is walked through becomes its own
 * stored embedding. */
export const SWEEP_STEPS: SweepStep[] = [
  { label: 'Look straight at the camera', axis: 'center', order: 'first', frames: 2 },
  { label: 'Slowly turn your head to the LEFT', axis: 'yaw', order: 'first', frames: 2 },
  { label: 'Now turn your head to the RIGHT', axis: 'yaw', order: 'opposite', frames: 2 },
  { label: 'Tilt your chin UP', axis: 'pitch', order: 'first', frames: 2 },
  { label: 'Now tilt your chin DOWN', axis: 'pitch', order: 'opposite', frames: 2 },
]

export const TOTAL_SWEEP_FRAMES = SWEEP_STEPS.reduce((n, s) => n + s.frames, 0)

/** Turn far enough that the nose has clearly crossed toward one ear -- about
 * 17 degrees of yaw, past which the side of the face is genuinely a different
 * view to the embedder. */
const YAW_THRESHOLD = 0.35
/** Nose travel along the eye-to-mouth axis once the neutral baseline is
 * removed. Roughly 11 degrees of pitch.
 *
 * Lower than the yaw gate on purpose: tilting the chin up foreshortens the
 * lower face and pushes the mouth keypoint toward the nose, so the measured
 * travel is smaller than the actual head movement -- and the detector's
 * keypoints get noisier as the nostrils come into view. At the old 0.1 the
 * chin-up step could refuse to complete however far back the head went. */
const PITCH_THRESHOLD = 0.07
/** How straight "straight at the camera" has to be. */
const CENTER_YAW_MAX = 0.22
/** The pose must hold this long before frames are taken, so a head swinging
 * through the target angle can't trigger a capture mid-blur. */
const HOLD_MS = 400
const FRAME_INTERVAL_MS = 350
/** How often the pose is sampled while waiting. */
const SAMPLE_MS = 60
/** After this long on one step, offer the user a way past it -- a dim room or
 * an unusual face shape shouldn't make enrollment impossible. */
export const STUCK_AFTER_MS = 8000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface SweepProgress {
  stepIndex: number
  /** Frames captured across the whole sweep. */
  captured: number
  /** True once the target pose is held and frames are being taken. */
  holding: boolean
  /** 0..1 toward the required pose, for a live meter. */
  poseProgress: number
  faceVisible: boolean
  /** Step has run long enough that the user should be offered a skip. */
  stuck: boolean
}

export interface SweepControl {
  cancelled: boolean
  /** Set by the UI to abandon the current step and move on. Cleared here. */
  skipRequested: boolean
}

interface StepCheck {
  satisfied: boolean
  progress: number
  /** Signed pose value on this step's axis, baseline removed. */
  value: number
}

function checkStep(
  step: SweepStep,
  pose: HeadPose,
  baseline: HeadPose | null,
  sign: number | undefined,
): StepCheck {
  if (step.axis === 'center') {
    const deviation = Math.abs(pose.yaw)
    return {
      satisfied: deviation <= CENTER_YAW_MAX,
      progress: Math.max(0, Math.min(1, 1 - deviation / (CENTER_YAW_MAX * 3))),
      value: pose.yaw,
    }
  }

  const threshold = step.axis === 'yaw' ? YAW_THRESHOLD : PITCH_THRESHOLD
  const raw = step.axis === 'yaw' ? pose.yaw : pose.pitch
  const base = baseline ? (step.axis === 'yaw' ? baseline.yaw : baseline.pitch) : 0
  const value = raw - base

  // 'opposite' only counts movement away from the direction already used, so
  // repeating the same turn twice cannot satisfy both sides of the sweep.
  const effective =
    step.order === 'opposite' && sign !== undefined ? value * -sign : Math.abs(value)

  return {
    satisfied: effective >= threshold,
    progress: Math.max(0, Math.min(1, effective / threshold)),
    value,
  }
}

/** Walks the user through SWEEP_STEPS, capturing frames only once the head is
 * actually in the requested pose and has been held there.
 *
 * `getPose` returns null when no face is visible, and may itself be null when
 * on-device detection is unavailable -- in that case the sweep degrades to the
 * old timed capture rather than blocking enrollment entirely.
 */
export async function captureSweep(
  video: HTMLVideoElement,
  getPose: (() => HeadPose | null) | null,
  onProgress: (progress: SweepProgress) => void,
  control: SweepControl,
): Promise<Blob[]> {
  const blobs: Blob[] = []
  const gated = getPose !== null

  /** Neutral pose, measured during the centre step. Pitch means nothing
   * without it (nose length varies per face), so pitch steps stay ungated
   * until it exists. */
  let baseline: HeadPose | null = null
  const signs: Partial<Record<PoseAxis, number>> = {}

  for (let stepIndex = 0; stepIndex < SWEEP_STEPS.length; stepIndex++) {
    const step = SWEEP_STEPS[stepIndex]
    const stepStart = Date.now()
    const centreSamples: HeadPose[] = []
    let capturedInStep = 0
    let holdStart: number | null = null

    // Pitch needs the neutral baseline; without one, fall back to a timed grab
    // for that step alone rather than gating on a value we can't interpret.
    const stepGated = gated && !(step.axis === 'pitch' && baseline === null)

    onProgress({
      stepIndex,
      captured: blobs.length,
      holding: false,
      poseProgress: 0,
      faceVisible: false,
      stuck: false,
    })

    if (!stepGated) {
      // Ungated fallback: give the user a beat to move, then grab frames.
      await sleep(900)
      while (capturedInStep < step.frames) {
        if (control.cancelled) return blobs
        if (control.skipRequested) {
          control.skipRequested = false
          break
        }
        const blob = await captureFrame(video)
        if (blob) {
          blobs.push(blob)
          capturedInStep++
        }
        onProgress({
          stepIndex,
          captured: blobs.length,
          holding: true,
          poseProgress: 1,
          faceVisible: true,
          stuck: false,
        })
        await sleep(FRAME_INTERVAL_MS)
      }
      continue
    }

    while (capturedInStep < step.frames) {
      if (control.cancelled) return blobs
      if (control.skipRequested) {
        control.skipRequested = false
        break
      }

      const pose = getPose!()
      const check = pose ? checkStep(step, pose, baseline, signs[step.axis]) : null

      if (pose && check?.satisfied) {
        if (holdStart === null) holdStart = Date.now()
        if (step.axis === 'center') centreSamples.push(pose)

        if (Date.now() - holdStart >= HOLD_MS) {
          // Fix the neutral baseline before the first capture, so the frame
          // that gets stored and the pose that was verified agree.
          if (step.axis === 'center' && baseline === null) {
            baseline = medianPose(centreSamples)
          }
          if (step.axis !== 'center' && signs[step.axis] === undefined) {
            signs[step.axis] = Math.sign(check.value) || 1
          }

          const blob = await captureFrame(video)
          if (blob) {
            blobs.push(blob)
            capturedInStep++
          }
          onProgress({
            stepIndex,
            captured: blobs.length,
            holding: true,
            poseProgress: 1,
            faceVisible: true,
            stuck: false,
          })
          await sleep(FRAME_INTERVAL_MS)
          continue
        }
      } else {
        holdStart = null
      }

      onProgress({
        stepIndex,
        captured: blobs.length,
        holding: holdStart !== null,
        poseProgress: check?.progress ?? 0,
        faceVisible: pose !== null,
        stuck: Date.now() - stepStart > STUCK_AFTER_MS,
      })
      await sleep(SAMPLE_MS)
    }
  }

  return blobs
}
