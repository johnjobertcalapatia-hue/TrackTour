export interface RiderHeadingFix {
  latitude: number
  longitude: number
  heading: number | null
  speed: number | null
  accuracy: number | null
  timestamp: number
}

interface PositionSample {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

interface HeadingAnimation {
  from: number
  to: number
  startedAt: number
  duration: number
}

interface AnimationClock {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (id: number) => void
  now: () => number
}

const EARTH_RADIUS_METERS = 6_371_000
const MAX_HEADING_ACCURACY_METERS = 35
const MAX_BEARING_ACCURACY_METERS = 25
const MIN_MOVING_SPEED_METERS_PER_SECOND = 0.8
const MIN_BEARING_DISPLACEMENT_METERS = 12
const MAX_ROTATION_DURATION_MS = 500
const MIN_ROTATION_DURATION_MS = 300

const browserClock: AnimationClock = {
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  now: () => performance.now(),
}

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

export function shortestHeadingDelta(from: number, to: number): number {
  return ((normalizeHeading(to) - normalizeHeading(from) + 540) % 360) - 180
}

export function bearingBetween(
  from: Pick<PositionSample, 'latitude' | 'longitude'>,
  to: Pick<PositionSample, 'latitude' | 'longitude'>,
): number {
  const startLatitude = (from.latitude * Math.PI) / 180
  const endLatitude = (to.latitude * Math.PI) / 180
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude)
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta)

  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

function distanceMeters(
  from: Pick<PositionSample, 'latitude' | 'longitude'>,
  to: Pick<PositionSample, 'latitude' | 'longitude'>,
): number {
  const startLatitude = (from.latitude * Math.PI) / 180
  const endLatitude = (to.latitude * Math.PI) / 180
  const latitudeDelta = endLatitude - startLatitude
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function clampRotationDuration(milliseconds: number): number {
  return Math.min(MAX_ROTATION_DURATION_MS, Math.max(MIN_ROTATION_DURATION_MS, milliseconds))
}

export class RiderHeadingController {
  private element: HTMLElement | null = null
  private previousPosition: PositionSample | null = null
  private filteredHeading: number | null = null
  private pendingHeadingDelta = 0
  private lastFixAt: number | null = null
  private currentAngle = 0
  private animation: HeadingAnimation | null = null
  private frameId: number | null = null

  constructor(private readonly clock: AnimationClock = browserClock) {}

  attach(element: HTMLElement | null): void {
    this.element = element
    this.applyAngle(this.currentAngle)
  }

  update(fix: RiderHeadingFix): void {
    if (
      !Number.isFinite(fix.latitude) ||
      !Number.isFinite(fix.longitude) ||
      !Number.isFinite(fix.timestamp)
    ) {
      return
    }

    const accuracy = fix.accuracy
    const positionIsAccurate =
      accuracy !== null &&
      Number.isFinite(accuracy) &&
      accuracy > 0 &&
      accuracy <= MAX_BEARING_ACCURACY_METERS
    const headingIsReliable =
      accuracy !== null &&
      Number.isFinite(accuracy) &&
      accuracy > 0 &&
      accuracy <= MAX_HEADING_ACCURACY_METERS &&
      fix.heading !== null &&
      Number.isFinite(fix.heading) &&
      fix.heading >= 0 &&
      fix.heading <= 360 &&
      (fix.speed === null ||
        (Number.isFinite(fix.speed) && fix.speed >= MIN_MOVING_SPEED_METERS_PER_SECOND))

    let nextHeading: number | null = null
    if (headingIsReliable && fix.heading !== null) {
      nextHeading = normalizeHeading(fix.heading)
    }

    if (positionIsAccurate && accuracy !== null) {
      const currentPosition = {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy,
        timestamp: fix.timestamp,
      }

      if (this.previousPosition) {
        const displacement = distanceMeters(this.previousPosition, currentPosition)
        const minimumDisplacement = Math.max(
          MIN_BEARING_DISPLACEMENT_METERS,
          Math.min(40, this.previousPosition.accuracy + accuracy),
        )
        if (displacement >= minimumDisplacement) {
          const elapsedSeconds = Math.max(
            (fix.timestamp - this.previousPosition.timestamp) / 1000,
            0.001,
          )
          const estimatedSpeed = displacement / elapsedSeconds
          const isMoving =
            fix.speed !== null
              ? Number.isFinite(fix.speed) && fix.speed >= MIN_MOVING_SPEED_METERS_PER_SECOND
              : estimatedSpeed >= MIN_MOVING_SPEED_METERS_PER_SECOND
          if (nextHeading === null && isMoving) {
            nextHeading = bearingBetween(this.previousPosition, currentPosition)
          }
          this.previousPosition = currentPosition
        }
      } else {
        this.previousPosition = currentPosition
      }
    }

    const interval = this.lastFixAt === null ? 600 : fix.timestamp - this.lastFixAt
    this.lastFixAt = fix.timestamp

    if (nextHeading === null) return

    const target = this.filterHeading(nextHeading)
    if (target === null) return

    this.animateTo(target, clampRotationDuration(interval * 0.4))
  }

  destroy(): void {
    if (this.frameId !== null) {
      this.clock.cancelFrame(this.frameId)
      this.frameId = null
    }
    this.animation = null
    this.element = null
  }

  private filterHeading(heading: number): number | null {
    if (this.filteredHeading === null) {
      this.filteredHeading = heading
      return heading
    }

    const delta = shortestHeadingDelta(this.filteredHeading, heading)
    this.pendingHeadingDelta += delta

    if (Math.abs(this.pendingHeadingDelta) < 3) return null

    const smoothing = Math.abs(this.pendingHeadingDelta) >= 45 ? 0.55 : 0.35
    this.filteredHeading = normalizeHeading(
      this.filteredHeading + this.pendingHeadingDelta * smoothing,
    )
    this.pendingHeadingDelta = 0
    return this.filteredHeading
  }

  private angleAt(now: number): number {
    if (!this.animation) return this.currentAngle

    const progress = Math.min(1, Math.max(0, (now - this.animation.startedAt) / this.animation.duration))
    const eased = progress * progress * (3 - 2 * progress)
    return this.animation.from + (this.animation.to - this.animation.from) * eased
  }

  private animateTo(heading: number, duration: number): void {
    const start = this.angleAt(this.clock.now())
    const target = start + shortestHeadingDelta(start, heading)

    if (Math.abs(target - start) < 0.1) return

    if (this.frameId !== null) {
      this.clock.cancelFrame(this.frameId)
    }

    this.currentAngle = start
    this.animation = {
      from: start,
      to: target,
      startedAt: this.clock.now(),
      duration,
    }
    this.applyAngle(start)
    this.frameId = this.clock.requestFrame(this.animateFrame)
  }

  private animateFrame = (timestamp: number): void => {
    if (!this.animation) {
      this.frameId = null
      return
    }

    this.currentAngle = this.angleAt(timestamp)
    this.applyAngle(this.currentAngle)

    if (timestamp >= this.animation.startedAt + this.animation.duration) {
      this.currentAngle = this.animation.to
      this.applyAngle(this.currentAngle)
      this.animation = null
      this.frameId = null
      return
    }

    this.frameId = this.clock.requestFrame(this.animateFrame)
  }

  private applyAngle(angle: number): void {
    if (this.element) {
      this.element.style.transform = `rotate(${angle}deg)`
    }
  }
}
