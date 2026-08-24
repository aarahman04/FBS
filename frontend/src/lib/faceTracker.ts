import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { poseFromKeypoints, type HeadPose } from './headPose'
import type { FaceBox } from '../types'

/** On-device face tracking, used ONLY for where the face is on screen.
 *
 * Identity still comes from the server, but a recognition round trip costs
 * ~1s (detect + embed + poll gap), which is far too slow to anchor a label to
 * a moving head. Detection alone is cheap enough to run every animation frame
 * locally, so position updates at display rate while the name it displays is
 * refreshed at the server's pace.
 */
export class FaceTracker {
  private detector: FaceDetector | null = null
  private running = false
  private rafId: number | undefined
  private lastVideoTime = -1

  /** Latest tracked box, or null when no face is in frame. */
  box: FaceBox | null = null
  /** Latest head pose, or null when no face is in frame. Enrollment gates
   * each guided angle on this instead of on a timer. */
  pose: HeadPose | null = null
  /** False if MediaPipe failed to load -- callers fall back to server boxes. */
  available = false

  async init(): Promise<boolean> {
    try {
      const fileset = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
      this.detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: '/mediapipe/models/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      })
      this.available = true
      return true
    } catch {
      this.available = false
      return false
    }
  }

  start(video: HTMLVideoElement) {
    if (!this.detector || this.running) return
    this.running = true

    const loop = () => {
      if (!this.running) return
      this.rafId = requestAnimationFrame(loop)

      const detector = this.detector
      if (!detector || video.readyState < 2 || !video.videoWidth) return

      // detectForVideo rejects a repeated timestamp, and re-running on a frame
      // the camera hasn't advanced past is wasted work anyway.
      if (video.currentTime === this.lastVideoTime) return
      this.lastVideoTime = video.currentTime

      try {
        const result = detector.detectForVideo(video, performance.now())
        const detections = result.detections ?? []
        if (detections.length === 0) {
          this.box = null
          this.pose = null
          return
        }

        // Largest face = the subject, not a bystander behind them.
        let best = detections[0]
        let bestArea = 0
        for (const d of detections) {
          const bb = d.boundingBox
          if (!bb) continue
          const area = bb.width * bb.height
          if (area > bestArea) {
            bestArea = area
            best = d
          }
        }

        const bb = best.boundingBox
        if (!bb) {
          this.box = null
          this.pose = null
          return
        }

        this.pose = poseFromKeypoints(best.keypoints ?? [])

        this.box = {
          x: bb.originX / video.videoWidth,
          y: bb.originY / video.videoHeight,
          w: bb.width / video.videoWidth,
          h: bb.height / video.videoHeight,
        }
      } catch {
        // A dropped frame shouldn't kill the tracking loop.
      }
    }

    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId)
    this.rafId = undefined
    this.box = null
    this.pose = null
  }

  close() {
    this.stop()
    this.detector?.close()
    this.detector = null
  }
}
