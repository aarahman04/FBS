import type { FaceBox } from '../types'

export interface LabelPlacement {
  /** Container-space pixel coordinates for the label anchor. */
  centerX: number
  bottomY: number
  /** Face width on screen, used to scale type with distance from camera. */
  faceWidth: number
}

/** Maps a normalized face box onto the on-screen video.
 *
 * The <video> uses object-cover, so it is scaled to fill the container and
 * cropped on one axis -- normalized coordinates can't be applied to the
 * container directly without accounting for that crop, or the label drifts
 * away from the face as the aspect ratios diverge.
 */
export function placeLabel(
  box: FaceBox,
  video: HTMLVideoElement,
  container: { width: number; height: number },
): LabelPlacement | null {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight || !container.width || !container.height) return null

  const scale = Math.max(container.width / videoWidth, container.height / videoHeight)
  const displayedWidth = videoWidth * scale
  const displayedHeight = videoHeight * scale
  const offsetX = (container.width - displayedWidth) / 2
  const offsetY = (container.height - displayedHeight) / 2

  const faceWidth = box.w * displayedWidth
  const centerX = offsetX + (box.x + box.w / 2) * displayedWidth
  const bottomY = offsetY + (box.y + box.h) * displayedHeight

  return { centerX, bottomY, faceWidth }
}
